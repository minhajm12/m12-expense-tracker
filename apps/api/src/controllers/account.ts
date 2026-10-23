import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { BankAccount } from '../models/BankAccount';
import { CashAccount } from '../models/CashAccount';
import { Transaction } from '../models/Transaction';
import { ChitFund } from '../models/ChitFund';
import { sendSuccess, sendError, AppError } from '../utils/api-response';
import {
  createBankAccountSchema,
  updateBankAccountSchema,
  updateCashAccountSchema,
  cashAdjustmentSchema,
  paginationQuerySchema,
  parseDateInput,
  TransactionType,
  TransactionStatus,
  PaymentMethod,
  PaymentChannel,
} from '@finora/shared';
import {
  recalculateAccountBalance,
  getTotalCashSummary,
  calculatePersonalCashInHand,
  calculateCashInHand,
} from '../services/financial';

export const listAccounts = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const includeArchived = req.query.includeArchived === 'true';

  const filter: Record<string, unknown> = { userId };
  if (!includeArchived) {
    filter.isArchived = false;
  }

  const accounts = await BankAccount.find(filter).sort({ createdAt: -1 });
  sendSuccess(res, accounts.map((a) => a.toJSON()));
};

export const getAccountById = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;

  const account = await BankAccount.findOne({ _id: id, userId });
  if (!account) {
    sendError(res, 'Bank account not found', 404, 'ACCOUNT_NOT_FOUND');
    return;
  }

  sendSuccess(res, account.toJSON());
};

export const createAccount = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const validated = createBankAccountSchema.parse(req.body);

  if (validated.isChitFundAccount) {
    const existing = await BankAccount.findOne({
      userId,
      isChitFundAccount: true,
      isArchived: false,
    });
    if (existing) {
      if (!validated.confirmReassign) {
        sendError(
          res,
          `"${existing.accountName}" is currently designated as the Chit Fund account. Please confirm reassignment.`,
          409,
          'CHIT_FUND_ACCOUNT_EXISTS',
          { existingAccountName: existing.accountName, existingAccountId: existing._id.toString() }
        );
        return;
      }
      existing.isChitFundAccount = false;
      await existing.save();
    }
  }

  const account = await BankAccount.create({
    userId,
    accountName: validated.accountName,
    bankName: validated.bankName,
    accountType: validated.accountType,
    accountNumberMasked: validated.accountNumberMasked,
    openingBalance: validated.openingBalance,
    openingBalanceDate: parseDateInput(validated.openingBalanceDate),
    currentBalance: validated.openingBalance, // Initial balance equals opening balance
    currency: validated.currency || req.user!.currency || 'INR',
    color: validated.color || '#10b981',
    icon: validated.icon || 'Wallet',
    isChitFundAccount: Boolean(validated.isChitFundAccount),
    notes: validated.notes,
    isArchived: false,
    isActive: true,
  });

  if (account.isChitFundAccount) {
    await ChitFund.updateMany({ userId }, { designatedBankAccountId: account._id });
  }

  sendSuccess(res, account.toJSON(), 'Bank account created successfully', 201);
};

export const updateAccount = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;
  const validated = updateBankAccountSchema.parse(req.body);

  const account = await BankAccount.findOne({ _id: id, userId });
  if (!account) {
    sendError(res, 'Bank account not found', 404, 'ACCOUNT_NOT_FOUND');
    return;
  }

  if (validated.isChitFundAccount !== undefined) {
    if (validated.isChitFundAccount === true && !account.isChitFundAccount) {
      const existing = await BankAccount.findOne({
        userId,
        isChitFundAccount: true,
        _id: { $ne: account._id },
        isArchived: false,
      });
      if (existing) {
        if (!validated.confirmReassign) {
          sendError(
            res,
            `"${existing.accountName}" is currently designated as the Chit Fund account. Please confirm reassignment.`,
            409,
            'CHIT_FUND_ACCOUNT_EXISTS',
            { existingAccountName: existing.accountName, existingAccountId: existing._id.toString() }
          );
          return;
        }
        existing.isChitFundAccount = false;
        await existing.save();
      }
      account.isChitFundAccount = true;
      await ChitFund.updateMany({ userId }, { designatedBankAccountId: account._id });
    } else if (validated.isChitFundAccount === false) {
      account.isChitFundAccount = false;
      await ChitFund.updateMany({ userId, designatedBankAccountId: account._id }, { designatedBankAccountId: null });
    }
  }

  if (validated.accountName !== undefined) account.accountName = validated.accountName;
  if (validated.bankName !== undefined) account.bankName = validated.bankName;
  if (validated.accountType !== undefined) account.accountType = validated.accountType;
  if (validated.accountNumberMasked !== undefined) account.accountNumberMasked = validated.accountNumberMasked;
  if (validated.color !== undefined) account.color = validated.color;
  if (validated.icon !== undefined) account.icon = validated.icon;
  if (validated.notes !== undefined) account.notes = validated.notes;
  if (validated.isArchived !== undefined) account.isArchived = validated.isArchived;

  // If opening balance was changed, recalculate current balance
  if (validated.openingBalance !== undefined && validated.openingBalance !== account.openingBalance) {
    account.openingBalance = validated.openingBalance;
    if (validated.openingBalanceDate) {
      account.openingBalanceDate = new Date(validated.openingBalanceDate);
    }
    await account.save();
    await recalculateAccountBalance(account._id, userId);
  } else {
    await account.save();
  }

  const updatedAccount = await BankAccount.findById(account._id);
  sendSuccess(res, updatedAccount!.toJSON(), 'Account updated successfully');
};

export const archiveAccount = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;

  const account = await BankAccount.findOne({ _id: id, userId });
  if (!account) {
    sendError(res, 'Bank account not found', 404, 'ACCOUNT_NOT_FOUND');
    return;
  }

  // Soft archive account to preserve transaction history
  account.isArchived = true;
  if (account.isChitFundAccount) {
    account.isChitFundAccount = false;
    await ChitFund.updateMany({ userId, designatedBankAccountId: account._id }, { designatedBankAccountId: null });
  }
  await account.save();

  sendSuccess(res, account.toJSON(), 'Account archived successfully');
};

export const getAccountTransactions = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;
  const query = paginationQuerySchema.parse(req.query);
  const skip = (query.page - 1) * query.limit;

  const account = await BankAccount.findOne({ _id: id, userId });
  if (!account) {
    sendError(res, 'Bank account not found', 404, 'ACCOUNT_NOT_FOUND');
    return;
  }

  const filter = {
    userId,
    $or: [{ accountId: account._id }, { destinationAccountId: account._id }],
  };

  const [total, transactions] = await Promise.all([
    Transaction.countDocuments(filter),
    Transaction.find(filter).sort({ date: -1 }).skip(skip).limit(query.limit),
  ]);

  sendSuccess(
    res,
    transactions.map((t) => t.toJSON()),
    undefined,
    200,
    {
      timestamp: new Date().toISOString(),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    }
  );
};

export const triggerRecalculateBalance = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;

  const newBalance = await recalculateAccountBalance(id, userId);
  sendSuccess(res, { accountId: id, currentBalance: newBalance }, 'Balance recalculated successfully');
};

export const getTotalCash = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const summary = await getTotalCashSummary(userId);
  sendSuccess(res, summary);
};

export const updateCashInHand = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const validated = updateCashAccountSchema.parse(req.body);

  let cashDoc = await CashAccount.findOne({ userId });
  if (!cashDoc) {
    cashDoc = new CashAccount({
      userId,
      currency: req.user!.currency || 'INR',
    });
  }

  cashDoc.openingBalance = validated.openingBalance;
  if (validated.openingBalanceDate) {
    cashDoc.openingBalanceDate = parseDateInput(validated.openingBalanceDate);
  }
  if (validated.notes !== undefined) {
    cashDoc.notes = validated.notes;
  }
  await cashDoc.save();

  await calculateCashInHand(userId);
  const updatedSummary = await getTotalCashSummary(userId);

  sendSuccess(res, updatedSummary, 'Cash in hand opening balance updated successfully');
};

export const getCashInHand = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  await calculatePersonalCashInHand(userId);
  const cashDoc = await CashAccount.findOne({ userId });
  sendSuccess(res, cashDoc ? cashDoc.toJSON() : null);
};

export const adjustPersonalCashInHand = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const validated = cashAdjustmentSchema.parse(req.body);

  let cashDoc = await CashAccount.findOne({ userId });
  if (!cashDoc) {
    cashDoc = new CashAccount({
      userId,
      currency: req.user!.currency || 'INR',
      openingBalance: 0,
      openingBalanceDate: new Date(),
      currentBalance: 0,
      adjustments: [],
    });
  }

  const adjDate = parseDateInput(validated.date);

  if (validated.type === 'set_balance') {
    cashDoc.openingBalance = validated.amount;
    cashDoc.openingBalanceDate = adjDate;
    cashDoc.adjustments.push({
      _id: new mongoose.Types.ObjectId(),
      type: 'set_balance',
      amount: validated.amount,
      date: adjDate,
      description: validated.description || 'Set opening balance',
      createdAt: new Date(),
    } as any);
  } else if (validated.type === 'add_cash') {
    if (validated.source === 'bank_account') {
      if (!validated.bankAccountId) {
        sendError(res, 'Bank account is required for cash withdrawal from bank', 400, 'MISSING_BANK_ACCOUNT');
        return;
      }
      const bank = await BankAccount.findOne({ _id: validated.bankAccountId, userId, isArchived: false });
      if (!bank) {
        sendError(res, 'Bank account not found or archived', 404, 'ACCOUNT_NOT_FOUND');
        return;
      }
      if (bank.currentBalance < validated.amount) {
        sendError(
          res,
          `Withdrawal amount (₹${validated.amount.toLocaleString()}) cannot exceed available balance of ${bank.accountName} (₹${bank.currentBalance.toLocaleString()})`,
          400,
          'INSUFFICIENT_BANK_FUNDS'
        );
        return;
      }

      // Create an internal transfer transaction (moves bank money to physical cash in hand)
      const transferTx = await Transaction.create({
        userId,
        type: TransactionType.TRANSFER,
        title: `Cash Withdrawal: ${bank.accountName}`,
        amount: validated.amount,
        currency: bank.currency || 'INR',
        date: adjDate,
        category: 'Transfer',
        paymentMethod: PaymentMethod.CASH,
        paymentChannel: PaymentChannel.OFFLINE,
        accountId: bank._id,
        status: TransactionStatus.COMPLETED,
        isExcludedFromBudget: true,
        notes: validated.description || `Cash withdrawal from ${bank.accountName} to Cash in Hand`,
        tags: ['cash_withdrawal', 'internal_transfer'],
      });

      cashDoc.adjustments.push({
        _id: new mongoose.Types.ObjectId(),
        type: 'add_cash',
        amount: validated.amount,
        date: adjDate,
        source: 'bank_account',
        bankAccountId: bank._id,
        transactionId: transferTx._id,
        description: validated.description || `Withdrawal from ${bank.accountName}`,
        createdAt: new Date(),
      } as any);

      // Debit bank account balance
      await recalculateAccountBalance(bank._id, userId);
    } else if (validated.source === 'person') {
      // Cash In by Person: credits Cash in Hand without debiting any bank account!
      cashDoc.adjustments.push({
        _id: new mongoose.Types.ObjectId(),
        type: 'add_cash',
        amount: validated.amount,
        date: adjDate,
        source: 'person',
        personName: validated.personName,
        description: validated.description || (validated.personName ? `Cash in from ${validated.personName}` : 'Cash in by person'),
        createdAt: new Date(),
      } as any);
    } else {
      // Standard manual cash addition
      cashDoc.adjustments.push({
        _id: new mongoose.Types.ObjectId(),
        type: 'add_cash',
        amount: validated.amount,
        date: adjDate,
        source: 'manual',
        description: validated.description || 'Cash added',
        createdAt: new Date(),
      } as any);
    }
  } else if (validated.type === 'remove_cash') {
    const currentAvailable = await calculatePersonalCashInHand(userId);
    if (validated.amount > currentAvailable) {
      sendError(
        res,
        `Withdrawal amount (₹${validated.amount.toLocaleString()}) cannot exceed available Personal Cash in Hand (₹${currentAvailable.toLocaleString()})`,
        400,
        'EXCEEDS_CASH_BALANCE'
      );
      return;
    }
    cashDoc.adjustments.push({
      _id: new mongoose.Types.ObjectId(),
      type: 'remove_cash',
      amount: validated.amount,
      date: adjDate,
      description: validated.description || 'Cash withdrawn',
      createdAt: new Date(),
    } as any);
  }

  await cashDoc.save();
  await calculatePersonalCashInHand(userId);
  const updatedSummary = await getTotalCashSummary(userId);

  sendSuccess(res, updatedSummary, 'Personal Cash in Hand adjusted successfully');
};


