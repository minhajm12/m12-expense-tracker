import { Request, Response } from 'express';
import { Transaction } from '../models/Transaction';
import { BankAccount } from '../models/BankAccount';
import { CreditCard } from '../models/CreditCard';
import { CashAccount } from '../models/CashAccount';
import { sendSuccess, sendError, AppError } from '../utils/api-response';
import {
  createTransactionSchema,
  updateTransactionSchema,
  createTransferSchema,
  paginationQuerySchema,
  TransactionType,
  TransactionStatus,
  PaymentMethod,
  safeAdd,
  safeSubtract,
  parseDateInput,
  getStartOfDay,
  getEndOfDay,
  EmiStatus,
  EmiOccurrenceStatus,
} from '@finora/shared';
import {
  recalculateAccountBalance,
  recalculateCreditCardOutstanding,
  executeAccountTransfer,
  revertRecurringOccurrence,
  calculatePersonalCashInHand,
} from '../services/financial';
import { ChitFundCollection } from '../models/ChitFundCollection';
import { ChitFundPayout } from '../models/ChitFundPayout';
import { ChitFundAdjustment } from '../models/ChitFundAdjustment';
import { EmiRule } from '../models/EmiRule';
import { EmiOccurrence } from '../models/EmiOccurrence';
import { syncEmiNextPayableState } from '../services/emi-schedule';
import { revertInvestmentStateForDeletedTransaction } from '../services/investment-service';
import { InvestmentContribution } from '../models/InvestmentContribution';
import { Investment } from '../models/Investment';
import { LendingBorrowing } from '../models/LendingBorrowing';
import { LendingBorrowingType } from '@finora/shared';

export const listTransactions = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const pagination = paginationQuerySchema.parse(req.query);
  const skip = (pagination.page - 1) * pagination.limit;

  const {
    accountId,
    creditCardId,
    type,
    category,
    paymentMethod,
    paymentChannel,
    payment,
    startDate,
    endDate,
    search,
  } = req.query;

  const filter: Record<string, unknown> = { userId };

  // Parse Payment filter (unified Payment Method / Bank Account / Credit Card)
  const paymentQuery = typeof payment === 'string' ? payment.trim() : undefined;
  let targetAccountId = typeof accountId === 'string' && accountId !== 'all' ? accountId : undefined;
  let targetCreditCardId =
    typeof creditCardId === 'string' && creditCardId !== 'all' ? (creditCardId as string) : undefined;
  let targetPaymentMethod =
    typeof paymentMethod === 'string' && paymentMethod !== 'all' ? (paymentMethod as string) : undefined;

  if (paymentQuery && paymentQuery !== 'all') {
    if (paymentQuery.startsWith('account:')) {
      targetAccountId = paymentQuery.replace('account:', '');
    } else if (paymentQuery.startsWith('card:')) {
      targetCreditCardId = paymentQuery.replace('card:', '');
    } else if (paymentQuery.startsWith('method:')) {
      targetPaymentMethod = paymentQuery.replace('method:', '');
    }
  }

  if (targetAccountId) {
    filter.$or = [{ accountId: targetAccountId }, { destinationAccountId: targetAccountId }];
  }
  if (targetCreditCardId) {
    filter.creditCardId = targetCreditCardId;
  }
  if (targetPaymentMethod) {
    filter.paymentMethod = targetPaymentMethod;
  }
  if (type && type !== 'all' && type !== 'lending' && type !== 'borrowing') {
    filter.type = type;
  }
  if (category) {
    filter.category = category;
  }
  if (paymentChannel) {
    filter.paymentChannel = paymentChannel;
  }

  // Monthly or custom date range filter (Asia/Kolkata timezone awareness)
  // Supports independent year and month parameters, as well as legacy month=YYYY-MM
  const yearQuery = typeof req.query.year === 'string' ? req.query.year.trim() : undefined;
  const monthQuery = typeof req.query.month === 'string' ? req.query.month.trim() : undefined;

  let dateFilterStart: Date | undefined;
  let dateFilterEnd: Date | undefined;

  if (startDate) {
    dateFilterStart = getStartOfDay(startDate as string);
  }
  if (endDate) {
    dateFilterEnd = getEndOfDay(endDate as string);
  }

  let targetYear: number | undefined;
  let targetMonth: number | undefined;

  if (monthQuery && /^\d{4}-\d{2}$/.test(monthQuery)) {
    // Legacy format 'YYYY-MM'
    const [yStr, mStr] = monthQuery.split('-');
    targetYear = parseInt(yStr, 10);
    targetMonth = parseInt(mStr, 10);
  } else {
    if (yearQuery && yearQuery !== 'all' && /^\d{4}$/.test(yearQuery)) {
      targetYear = parseInt(yearQuery, 10);
    }
    if (monthQuery && monthQuery !== 'all' && /^\d{1,2}$/.test(monthQuery)) {
      targetMonth = parseInt(monthQuery, 10);
    }
  }

  if (targetYear !== undefined && targetMonth !== undefined) {
    // Specific month in year (Asia/Kolkata UTC+05:30)
    const mStr = String(targetMonth).padStart(2, '0');
    const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
    dateFilterStart = new Date(`${targetYear}-${mStr}-01T00:00:00.000+05:30`);
    dateFilterEnd = new Date(`${targetYear}-${mStr}-${String(lastDay).padStart(2, '0')}T23:59:59.999+05:30`);
  } else if (targetYear !== undefined) {
    // Full year (Asia/Kolkata UTC+05:30)
    dateFilterStart = new Date(`${targetYear}-01-01T00:00:00.000+05:30`);
    dateFilterEnd = new Date(`${targetYear}-12-31T23:59:59.999+05:30`);
  }

  if (dateFilterStart || dateFilterEnd) {
    filter.date = {};
    if (dateFilterStart) (filter.date as Record<string, unknown>).$gte = dateFilterStart;
    if (dateFilterEnd) (filter.date as Record<string, unknown>).$lte = dateFilterEnd;
  }

  // Search keyword for Transactions
  if (search && typeof search === 'string') {
    const searchRegex = { $regex: search, $options: 'i' };
    const searchConditions = [
      { title: searchRegex },
      { merchantOrRecipient: searchRegex },
      { notes: searchRegex },
    ];
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, { $or: searchConditions }];
      delete filter.$or;
    } else {
      filter.$or = searchConditions;
    }
  }

  // Build unified Lending & Borrowing entries if requested
  // Strictly prevent lending/borrowing records from leaking into expense, income, investment, transfer, etc.
  const isTypeLendingOrBorrowing = type === 'lending' || type === 'borrowing';
  const isUnifiedRequested = req.query.unified === 'true' || req.query.includeLending === 'true';
  const shouldIncludeLending = isTypeLendingOrBorrowing || (!type || type === 'all' ? isUnifiedRequested : false);

  let filteredLbItems: any[] = [];

  if (shouldIncludeLending) {
    const [lbRecords, bankAccounts] = await Promise.all([
      LendingBorrowing.find({ userId }),
      BankAccount.find({ userId }, '_id accountName bankName'),
    ]);

    const bankNameMap = new Map<string, string>();
    bankAccounts.forEach((acc) => {
      bankNameMap.set(acc._id.toString(), `${acc.accountName} (${acc.bankName})`);
    });

    const unifiedLbItems: any[] = [];

    for (const r of lbRecords) {
      const bAccIdStr = r.bankAccountId ? r.bankAccountId.toString() : undefined;
      // 1. Principal Event (Money Lent or Money Borrowed)
      const principalItem = {
        id: `lb_${r._id.toString()}`,
        userId: r.userId.toString(),
        type: r.type,
        recordType: r.type,
        isLendingBorrowing: true,
        title: r.type === LendingBorrowingType.LENDING ? `Lent to ${r.personName}` : `Borrowed from ${r.personName}`,
        amount: r.amount,
        category: r.type === LendingBorrowingType.LENDING ? 'Lending' : 'Borrowing',
        paymentMethod: r.paymentMethod,
        paymentChannel: 'offline',
        accountId: bAccIdStr,
        bankAccountId: bAccIdStr,
        bankAccountName: bAccIdStr ? bankNameMap.get(bAccIdStr) : undefined,
        isHistorical: Boolean(r.isHistorical),
        date: r.date,
        merchantOrRecipient: r.personName,
        notes: r.description || r.notes || '',
        status: 'completed',
        lendingBorrowingId: r._id.toString(),
        createdAt: r.createdAt || r.date,
        updatedAt: r.updatedAt,
      };
      unifiedLbItems.push(principalItem);

      // 2. Repayment Events
      if (Array.isArray(r.repayments)) {
        for (const rep of r.repayments) {
          const repBAccIdStr = rep.bankAccountId ? rep.bankAccountId.toString() : undefined;
          const isLending = r.type === LendingBorrowingType.LENDING;
          const repaymentItem = {
            id: `rep_${rep._id.toString()}`,
            userId: r.userId.toString(),
            type: isLending ? 'income' : 'expense',
            recordType: 'repayment',
            isLendingBorrowing: true,
            title: isLending
              ? `Repayment received from ${r.personName}`
              : `Repayment paid to ${r.personName}`,
            amount: rep.amount,
            category: isLending ? 'Lending Repayment' : 'Debt Repayment',
            paymentMethod: rep.paymentMethod,
            paymentChannel: 'offline',
            accountId: repBAccIdStr,
            bankAccountId: repBAccIdStr,
            bankAccountName: repBAccIdStr ? bankNameMap.get(repBAccIdStr) : undefined,
            isHistorical: Boolean(rep.isHistorical),
            date: rep.date,
            merchantOrRecipient: r.personName,
            notes: rep.notes || '',
            status: 'completed',
            lendingBorrowingId: r._id.toString(),
            createdAt: rep.createdAt || rep.date,
          };
          unifiedLbItems.push(repaymentItem);
        }
      }
    }

    filteredLbItems = unifiedLbItems.filter((item) => {
      // Date filter
      const itemTime = new Date(item.date).getTime();
      if (dateFilterStart && itemTime < dateFilterStart.getTime()) return false;
      if (dateFilterEnd && itemTime > dateFilterEnd.getTime()) return false;

      // Payment filters
      if (targetAccountId && item.accountId !== targetAccountId) return false;
      if (targetCreditCardId) return false; // Hand loans do not use credit cards
      if (targetPaymentMethod && item.paymentMethod !== targetPaymentMethod) return false;

      // Type filter: strict isolation
      if (type === 'lending') {
        if (item.recordType !== 'lending') return false;
      } else if (type === 'borrowing') {
        if (item.recordType !== 'borrowing') return false;
      }

      // Category filter
      if (category && item.category.toLowerCase() !== (category as string).toLowerCase()) {
        return false;
      }

      // Search filter
      if (search && typeof search === 'string') {
        const q = search.toLowerCase();
        const match =
          (item.title && item.title.toLowerCase().includes(q)) ||
          (item.merchantOrRecipient && item.merchantOrRecipient.toLowerCase().includes(q)) ||
          (item.notes && item.notes.toLowerCase().includes(q));
        if (!match) return false;
      }

      return true;
    });
  }

  // Query transactions matching filter
  // If user explicitly asked for 'lending' or 'borrowing' only, transactions list is empty
  let txList: any[] = [];
  if (type !== 'lending' && type !== 'borrowing') {
    const transactions = await Transaction.find(filter);
    txList = transactions.map((t) => t.toJSON());
  }

  // Merge and sort deterministically
  const combined = [...txList, ...filteredLbItems];
  combined.sort((a, b) => {
    const timeA = new Date(a.date).getTime();
    const timeB = new Date(b.date).getTime();
    if (timeB !== timeA) return timeB - timeA;
    const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return createdB - createdA;
  });

  const total = combined.length;
  const pagedRecords = combined.slice(skip, skip + pagination.limit);

  sendSuccess(
    res,
    pagedRecords,
    undefined,
    200,
    {
      timestamp: new Date().toISOString(),
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit),
      hasMore: skip + pagedRecords.length < total,
    }
  );
};

export const getTransactionById = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;

  if (id.startsWith('lb_')) {
    const lbId = id.replace('lb_', '');
    const lb = await LendingBorrowing.findOne({ _id: lbId, userId });
    if (!lb) {
      sendError(res, 'Lending record not found', 404, 'RECORD_NOT_FOUND');
      return;
    }
    const item = {
      id: `lb_${lb._id.toString()}`,
      userId: lb.userId.toString(),
      type: lb.type,
      recordType: lb.type,
      isLendingBorrowing: true,
      title: lb.type === LendingBorrowingType.LENDING ? `Lent to ${lb.personName}` : `Borrowed from ${lb.personName}`,
      amount: lb.amount,
      category: lb.type === LendingBorrowingType.LENDING ? 'Lending' : 'Borrowing',
      paymentMethod: lb.paymentMethod,
      paymentChannel: 'offline',
      accountId: lb.bankAccountId ? lb.bankAccountId.toString() : undefined,
      date: lb.date,
      merchantOrRecipient: lb.personName,
      notes: lb.description || lb.notes || '',
      status: 'completed',
      lendingBorrowingId: lb._id.toString(),
      createdAt: lb.createdAt || lb.date,
      updatedAt: lb.updatedAt,
    };
    sendSuccess(res, item);
    return;
  }

  if (id.startsWith('rep_')) {
    const repId = id.replace('rep_', '');
    const lb = await LendingBorrowing.findOne({ 'repayments._id': repId, userId });
    if (!lb) {
      sendError(res, 'Repayment record not found', 404, 'RECORD_NOT_FOUND');
      return;
    }
    const rep = lb.repayments.find((r) => r._id.toString() === repId);
    if (!rep) {
      sendError(res, 'Repayment record not found', 404, 'RECORD_NOT_FOUND');
      return;
    }
    const isLending = lb.type === LendingBorrowingType.LENDING;
    const item = {
      id: `rep_${rep._id.toString()}`,
      userId: lb.userId.toString(),
      type: isLending ? 'income' : 'expense',
      recordType: 'repayment',
      isLendingBorrowing: true,
      title: isLending ? `Repayment received from ${lb.personName}` : `Repayment paid to ${lb.personName}`,
      amount: rep.amount,
      category: isLending ? 'Lending Repayment' : 'Debt Repayment',
      paymentMethod: rep.paymentMethod,
      paymentChannel: 'offline',
      accountId: rep.bankAccountId ? rep.bankAccountId.toString() : undefined,
      date: rep.date,
      merchantOrRecipient: lb.personName,
      notes: rep.notes || '',
      status: 'completed',
      lendingBorrowingId: lb._id.toString(),
      createdAt: rep.createdAt || rep.date,
    };
    sendSuccess(res, item);
    return;
  }

  const transaction = await Transaction.findOne({ _id: id, userId });
  if (!transaction) {
    sendError(res, 'Transaction not found', 404, 'TRANSACTION_NOT_FOUND');
    return;
  }

  sendSuccess(res, transaction.toJSON());
};

export const createTransaction = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const validated = createTransactionSchema.parse(req.body);

  // Idempotency check
  if (validated.idempotencyKey) {
    const existing = await Transaction.findOne({ userId, idempotencyKey: validated.idempotencyKey });
    if (existing) {
      sendSuccess(res, existing.toJSON(), 'Transaction already recorded (idempotent)', 200);
      return;
    }
  }

  // Conditional account and credit card validation
  let bankAccount = null;
  let creditCard = null;

  if (validated.paymentMethod === PaymentMethod.CREDIT_CARD) {
    if (!validated.creditCardId) {
      sendError(res, 'Valid credit card must be selected for credit card transactions', 400, 'CARD_REQUIRED');
      return;
    }
    creditCard = await CreditCard.findOne({ _id: validated.creditCardId, userId, isArchived: false });
    if (!creditCard) {
      sendError(res, 'Credit card not found or is archived', 404, 'CARD_NOT_FOUND');
      return;
    }
    // Prevent unrelated bank account from being charged
    validated.accountId = undefined;
  } else if (
    [PaymentMethod.UPI, PaymentMethod.DEBIT_CARD, PaymentMethod.NET_BANKING, PaymentMethod.BANK_TRANSFER].includes(
      validated.paymentMethod
    )
  ) {
    if (!validated.accountId) {
      sendError(res, 'Valid bank account must be selected for bank-funded transactions', 400, 'ACCOUNT_REQUIRED');
      return;
    }
    bankAccount = await BankAccount.findOne({ _id: validated.accountId, userId, isArchived: false });
    if (!bankAccount) {
      sendError(res, 'Bank account not found or is archived', 404, 'ACCOUNT_NOT_FOUND');
      return;
    }
    validated.creditCardId = undefined;
  } else {
    // Cash or Other
    if (validated.accountId) {
      bankAccount = await BankAccount.findOne({ _id: validated.accountId, userId, isArchived: false });
    }
    validated.creditCardId = undefined;
  }

  // If charging a designated Chit Fund account with a personal expense or investment, ensure personal funds suffice
  if (
    bankAccount &&
    bankAccount.isChitFundAccount &&
    (validated.type === TransactionType.EXPENSE || validated.type === TransactionType.INVESTMENT)
  ) {
    const [collections, payouts, adjustments] = await Promise.all([
      ChitFundCollection.find({ userId, receivingBankAccountId: bankAccount._id }),
      ChitFundPayout.find({ userId, sourceBankAccountId: bankAccount._id }),
      ChitFundAdjustment.find({ userId, bankAccountId: bankAccount._id }),
    ]);
    const totalColl = collections.reduce((s, c) => s + c.actualAmountReceived, 0);
    const totalPay = payouts.reduce((s, p) => s + p.amount, 0);
    const totalAdj = adjustments.reduce((s, a) => s + a.amount, 0);
    const chitHeld = Math.max(0, safeAdd(safeSubtract(totalColl, totalPay), totalAdj));
    const personalAvailable = safeSubtract(bankAccount.currentBalance, chitHeld);

    if (validated.amount > personalAvailable) {
      sendError(
        res,
        `Amount (₹${validated.amount.toLocaleString()}) exceeds personal available balance (₹${personalAvailable.toLocaleString()}). Chit fund pool money cannot be used for personal expenses or investments.`,
        400,
        'INSUFFICIENT_PERSONAL_FUNDS'
      );
      return;
    }
  }

  const transaction = await Transaction.create({
    userId,
    type: validated.type,
    title: validated.title,
    amount: validated.amount,
    currency: validated.currency || bankAccount?.currency || 'INR',
    date: parseDateInput(validated.date),
    category: validated.category,
    subcategory: validated.subcategory,
    paymentMethod: validated.paymentMethod,
    paymentChannel: validated.paymentChannel,
    accountId: validated.accountId,
    creditCardId: validated.creditCardId,
    merchantOrRecipient: validated.merchantOrRecipient,
    tags: validated.tags || [],
    notes: validated.notes,
    receiptUrl: validated.receiptUrl,
    status: validated.status || TransactionStatus.COMPLETED,
    idempotencyKey: validated.idempotencyKey,
    isExcludedFromBudget: validated.isExcludedFromBudget || false,
  });

  // If completed and linked to a bank account, authoritatively update balance using safe math
  if (bankAccount && transaction.status === TransactionStatus.COMPLETED) {
    await recalculateAccountBalance(bankAccount._id, userId);
  }

  // If completed and linked to a credit card, update card outstanding atomically
  if (creditCard && transaction.status === TransactionStatus.COMPLETED) {
    if (transaction.type === TransactionType.EXPENSE || transaction.type === TransactionType.INVESTMENT) {
      creditCard.currentOutstanding = safeAdd(creditCard.currentOutstanding, transaction.amount);
      creditCard.availableCredit = Math.max(0, safeSubtract(creditCard.creditLimit, creditCard.currentOutstanding));
    } else if (transaction.type === TransactionType.CREDIT_CARD_REFUND) {
      creditCard.currentOutstanding = Math.max(0, safeSubtract(creditCard.currentOutstanding, transaction.amount));
      creditCard.availableCredit = Math.min(creditCard.creditLimit, safeAdd(creditCard.availableCredit, transaction.amount));
    }
    await creditCard.save();
  }

  // If completed and cash payment method, recalculate personal cash in hand
  if (transaction.paymentMethod === PaymentMethod.CASH && transaction.status === TransactionStatus.COMPLETED) {
    await calculatePersonalCashInHand(userId);
  }

  sendSuccess(res, transaction.toJSON(), 'Transaction created successfully', 201);
};

export const updateTransaction = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;

  if (id.startsWith('lb_') || id.startsWith('rep_')) {
    sendError(
      res,
      'Lending and borrowing entries must be modified directly in the Lending & Borrowing module to preserve ledger integrity.',
      400,
      'CANNOT_MODIFY_LENDING_RECORD_HERE'
    );
    return;
  }

  const validated = updateTransactionSchema.parse(req.body);

  const transaction = await Transaction.findOne({ _id: id, userId });
  if (!transaction) {
    sendError(res, 'Transaction not found', 404, 'TRANSACTION_NOT_FOUND');
    return;
  }

  const previousAccountId = transaction.accountId;
  const previousCreditCardId = transaction.creditCardId;
  const previousPaymentMethod = transaction.paymentMethod;

  // Determine new payment method
  const targetPaymentMethod = validated.paymentMethod || transaction.paymentMethod;

  if (targetPaymentMethod === PaymentMethod.CREDIT_CARD) {
    const targetCreditCardId = validated.creditCardId || transaction.creditCardId;
    if (!targetCreditCardId) {
      sendError(res, 'Valid credit card must be selected for credit card transactions', 400, 'CARD_REQUIRED');
      return;
    }
    const card = await CreditCard.findOne({ _id: targetCreditCardId, userId, isArchived: false });
    if (!card) {
      sendError(res, 'Credit card not found or is archived', 404, 'CARD_NOT_FOUND');
      return;
    }
    transaction.creditCardId = card._id;
    transaction.accountId = undefined;
  } else if (
    [PaymentMethod.UPI, PaymentMethod.DEBIT_CARD, PaymentMethod.NET_BANKING, PaymentMethod.BANK_TRANSFER].includes(
      targetPaymentMethod
    )
  ) {
    const targetAccountId = validated.accountId || transaction.accountId;
    if (!targetAccountId) {
      sendError(res, 'Valid bank account must be selected for bank-funded transactions', 400, 'ACCOUNT_REQUIRED');
      return;
    }
    const account = await BankAccount.findOne({ _id: targetAccountId, userId, isArchived: false });
    if (!account) {
      sendError(res, 'Bank account not found or is archived', 404, 'ACCOUNT_NOT_FOUND');
      return;
    }
    transaction.accountId = account._id;
    transaction.creditCardId = undefined;
  } else {
    // Cash
    if (validated.accountId !== undefined) {
      transaction.accountId = validated.accountId ? (validated.accountId as unknown as typeof transaction.accountId) : undefined;
    }
    transaction.creditCardId = undefined;
  }

  if (validated.title !== undefined) transaction.title = validated.title;
  if (validated.amount !== undefined) transaction.amount = validated.amount;
  if (validated.type !== undefined) transaction.type = validated.type;
  if (validated.date !== undefined) transaction.date = parseDateInput(validated.date);
  if (validated.category !== undefined) transaction.category = validated.category;
  if (validated.subcategory !== undefined) transaction.subcategory = validated.subcategory;
  if (validated.paymentMethod !== undefined) transaction.paymentMethod = validated.paymentMethod;
  if (validated.paymentChannel !== undefined) transaction.paymentChannel = validated.paymentChannel;
  if (validated.merchantOrRecipient !== undefined) transaction.merchantOrRecipient = validated.merchantOrRecipient;
  if (validated.tags !== undefined) transaction.tags = validated.tags;
  if (validated.notes !== undefined) transaction.notes = validated.notes;
  if (validated.status !== undefined) transaction.status = validated.status;

  await transaction.save();

  // If this transaction was linked to an InvestmentContribution, keep actualAmount and account synced!
  const linkedContrib = await InvestmentContribution.findOne({
    transactionId: transaction._id,
    userId,
  });
  if (linkedContrib) {
    if (validated.amount !== undefined) linkedContrib.actualAmount = validated.amount;
    if (transaction.paymentMethod !== undefined) linkedContrib.paymentMethod = transaction.paymentMethod;
    if (transaction.accountId !== undefined) linkedContrib.accountId = transaction.accountId;
    if (transaction.creditCardId !== undefined) linkedContrib.creditCardId = transaction.creditCardId;
    await linkedContrib.save();
  }

  // If this transaction was linked to an Investment winning payout, keep payoutAmount synced!
  const linkedWonInv = await Investment.findOne({
    payoutTransactionId: transaction._id,
    userId,
  });
  if (linkedWonInv && validated.amount !== undefined) {
    linkedWonInv.payoutAmount = validated.amount;
    await linkedWonInv.save();
  }

  // Recalculate affected bank accounts
  if (previousAccountId) {
    await recalculateAccountBalance(previousAccountId, userId);
  }
  if (transaction.accountId && transaction.accountId.toString() !== previousAccountId?.toString()) {
    await recalculateAccountBalance(transaction.accountId, userId);
  }

  // Recalculate affected credit cards
  if (previousCreditCardId) {
    await recalculateCreditCardOutstanding(previousCreditCardId, userId);
  }
  if (transaction.creditCardId && transaction.creditCardId.toString() !== previousCreditCardId?.toString()) {
    await recalculateCreditCardOutstanding(transaction.creditCardId, userId);
  }

  // Recalculate personal cash in hand if cash method was involved
  if (previousPaymentMethod === PaymentMethod.CASH || transaction.paymentMethod === PaymentMethod.CASH) {
    await calculatePersonalCashInHand(userId);
  }

  const updated = await Transaction.findById(transaction._id);
  sendSuccess(res, updated!.toJSON(), 'Transaction updated successfully');
};

export const deleteTransaction = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;

  if (id.startsWith('lb_') || id.startsWith('rep_')) {
    sendError(
      res,
      'Lending and borrowing entries must be deleted directly in the Lending & Borrowing module to preserve ledger integrity.',
      400,
      'CANNOT_MODIFY_LENDING_RECORD_HERE'
    );
    return;
  }

  const transaction = await Transaction.findOne({ _id: id, userId });
  if (!transaction) {
    sendError(res, 'Transaction not found', 404, 'TRANSACTION_NOT_FOUND');
    return;
  }

  const accountId = transaction.accountId;
  const destinationAccountId = transaction.destinationAccountId;
  const creditCardId = transaction.creditCardId;
  const paymentMethod = transaction.paymentMethod;
  const recurringRuleId = (transaction as any).recurringRuleId;
  const occurrenceKey = (transaction as any).occurrenceKey;
  const emiRuleId = (transaction as any).emiRuleId;
  const emiOccurrenceId = (transaction as any).emiOccurrenceId;

  await Transaction.deleteOne({ _id: transaction._id });

  // Recalculate original account balance
  if (accountId) {
    await recalculateAccountBalance(accountId, userId);
  }
  if (destinationAccountId) {
    await recalculateAccountBalance(destinationAccountId, userId);
  }
  if (creditCardId) {
    await recalculateCreditCardOutstanding(creditCardId, userId);
  }
  if (paymentMethod === PaymentMethod.CASH) {
    await calculatePersonalCashInHand(userId);
  }

  // If this transaction was generated by a recurring rule, reopen the occurrence and recalculate rule schedule!
  if (recurringRuleId) {
    await revertRecurringOccurrence({
      userId,
      recurringRuleId,
      occurrenceKey,
      transactionId: transaction._id,
    });
  }

  // If this transaction was generated by an EMI occurrence, reopen the EMI occurrence!
  if (emiOccurrenceId || emiRuleId) {
    const occ = emiOccurrenceId
      ? await EmiOccurrence.findById(emiOccurrenceId)
      : await EmiOccurrence.findOne({ emiRuleId, occurrenceKey });

    if (occ) {
      occ.status = EmiOccurrenceStatus.DUE;
      occ.transactionId = undefined;
      occ.paidAt = undefined;
      occ.actualAmountPaid = undefined;
      occ.discountAmount = 0;
      occ.discountType = undefined;
      occ.discountNotes = undefined;
      await occ.save();

      // Authoritatively recalculate the next payable installment and update EMI status and nextEmiDate
      await syncEmiNextPayableState(occ.emiRuleId);
    }
  }

  // If this transaction was a Chit Separation, safely remove linked ChitFundCollection
  const chitCollectionId = (transaction as any).metadata?.chitCollectionId;
  if (transaction.type === TransactionType.CHIT_SEPARATION || chitCollectionId) {
    if (chitCollectionId) {
      await ChitFundCollection.deleteOne({ _id: chitCollectionId });
    } else {
      await ChitFundCollection.deleteOne({ transactionId: transaction._id });
    }
  }

  // If this transaction was linked to an Investment contribution or Chit payout, revert investment state!
  await revertInvestmentStateForDeletedTransaction(transaction._id, userId);

  // If this transaction was linked to a CashAccount adjustment (e.g. cash withdrawal), remove that adjustment
  const cashDoc = await CashAccount.findOne({ userId, 'adjustments.transactionId': transaction._id });
  if (cashDoc) {
    cashDoc.adjustments = cashDoc.adjustments.filter(
      (a: any) => a.transactionId?.toString() !== transaction._id.toString()
    );
    await cashDoc.save();
    await calculatePersonalCashInHand(userId);
  }

  sendSuccess(res, null, 'Transaction deleted successfully');
};

export const createTransfer = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const validated = createTransferSchema.parse(req.body);

  const result = await executeAccountTransfer({
    userId,
    sourceAccountId: validated.sourceAccountId,
    destinationAccountId: validated.destinationAccountId,
    amount: validated.amount,
    date: parseDateInput(validated.date),
    notes: validated.notes,
    idempotencyKey: validated.idempotencyKey,
  });

  sendSuccess(res, result, 'Transfer completed successfully', 201);
};
