import { Request, Response } from 'express';
import { CreditCard } from '../models/CreditCard';
import { CreditCardStatement } from '../models/CreditCardStatement';
import { Transaction } from '../models/Transaction';
import { sendSuccess, sendError, AppError } from '../utils/api-response';
import {
  createCreditCardSchema,
  updateCreditCardSchema,
  creditCardRepaymentSchema,
  paginationQuerySchema,
  TransactionType,
  TransactionStatus,
  StatementStatus,
  PaymentMethod,
  PaymentChannel,
  safeSubtract,
  safeAdd,
  parseDateInput,
} from '@finora/shared';
import {
  recalculateCreditCardOutstanding,
  executeCreditCardRepayment,
  executeCreditCardRefund,
} from '../services/financial';
import {
  computeCardOutstandingBreakdown,
  getCreditCardFullDetails,
  calculateDueDateFromClosingDate,
} from '../services/credit-card-cycle';

export const listCreditCards = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const includeArchived = req.query.includeArchived === 'true';

  const filter: Record<string, unknown> = { userId };
  if (!includeArchived) {
    filter.isArchived = false;
  }

  const cards = await CreditCard.find(filter).sort({ createdAt: -1 });

  const enriched = await Promise.all(
    cards.map(async (c) => {
      const breakdown = await computeCardOutstandingBreakdown(c, userId);
      return {
        ...c.toJSON(),
        previousCycleOutstanding: breakdown.previousCycleOutstanding,
        ongoingCycleOutstanding: breakdown.ongoingCycleOutstanding,
        latestStatementAmount: breakdown.latestStatement?.statementBalance,
        latestStatementDueDate: breakdown.latestStatement?.dueDate,
        latestStatementRemaining: breakdown.latestStatement?.remainingBalance,
        latestStatementStatus: breakdown.latestStatement?.status,
        nextClosingDate: breakdown.dates.nextClosingDate?.toISOString(),
        nextPaymentDueDate: breakdown.dates.nextDueDate?.toISOString(),
      };
    })
  );

  sendSuccess(res, enriched);
};

export const getCreditCardById = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;

  const card = await CreditCard.findOne({ _id: id, userId });
  if (!card) {
    sendError(res, 'Credit card not found', 404, 'CARD_NOT_FOUND');
    return;
  }

  const breakdown = await computeCardOutstandingBreakdown(card, userId);
  const data = {
    ...card.toJSON(),
    previousCycleOutstanding: breakdown.previousCycleOutstanding,
    ongoingCycleOutstanding: breakdown.ongoingCycleOutstanding,
    latestStatementAmount: breakdown.latestStatement?.statementBalance,
    latestStatementDueDate: breakdown.latestStatement?.dueDate,
    latestStatementRemaining: breakdown.latestStatement?.remainingBalance,
    latestStatementStatus: breakdown.latestStatement?.status,
    nextClosingDate: breakdown.dates.nextClosingDate?.toISOString(),
    nextPaymentDueDate: breakdown.dates.nextDueDate?.toISOString(),
  };

  sendSuccess(res, data);
};

export const getCreditCardDetails = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;

  try {
    const details = await getCreditCardFullDetails(id, userId);
    sendSuccess(res, details);
  } catch (err: any) {
    if (err.message && err.message.toLowerCase().includes('not found')) {
      sendError(res, 'Credit card not found', 404, 'CARD_NOT_FOUND');
    } else {
      sendError(res, err.message || 'Failed to fetch credit card details', 500, 'SERVER_ERROR');
    }
  }
};

export const createCreditCard = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const validated = createCreditCardSchema.parse(req.body);

  const initialOutstanding = validated.openingOutstanding || 0;
  const initialAvailable = Math.max(0, safeSubtract(validated.creditLimit, initialOutstanding));
  const openDate = validated.openingOutstandingDate ? parseDateInput(validated.openingOutstandingDate) : new Date();

  const card = await CreditCard.create({
    userId,
    cardNickname: validated.cardNickname,
    issuingBank: validated.issuingBank,
    network: validated.network,
    lastFourDigits: validated.lastFourDigits,
    creditLimit: validated.creditLimit,
    billingCycleClosingDay: validated.billingCycleClosingDay,
    paymentDueDay: validated.paymentDueDay,
    openingOutstanding: initialOutstanding,
    openingOutstandingDate: openDate,
    currentOutstanding: initialOutstanding,
    availableCredit: initialAvailable,
    annualFee: validated.annualFee || 0,
    rewardsNotes: validated.rewardsNotes,
    notes: validated.notes,
    isArchived: false,
    isActive: true,
  });

  // If opening outstanding is provided, record it as a past-recorded expense transaction
  if (initialOutstanding > 0) {
    const existingOpeningTx = await Transaction.findOne({
      userId,
      creditCardId: card._id,
      isPastRecorded: true,
      notes: 'Opening credit card outstanding balance',
    });

    if (!existingOpeningTx) {
      await Transaction.create({
        userId,
        type: TransactionType.EXPENSE,
        title: `Opening Balance: ${card.cardNickname}`,
        amount: initialOutstanding,
        currency: 'INR',
        date: openDate,
        category: 'Other expenses',
        paymentMethod: PaymentMethod.CREDIT_CARD,
        paymentChannel: PaymentChannel.ONLINE,
        creditCardId: card._id,
        isPastRecorded: true, // past-recorded: historical expense without bank deduction
        status: TransactionStatus.COMPLETED,
        notes: 'Opening credit card outstanding balance',
      });
    }
  }

  sendSuccess(res, card.toJSON(), 'Credit card created successfully', 201);
};

export const updateCreditCard = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;
  const validated = updateCreditCardSchema.parse(req.body);

  const card = await CreditCard.findOne({ _id: id, userId });
  if (!card) {
    sendError(res, 'Credit card not found', 404, 'CARD_NOT_FOUND');
    return;
  }

  if (validated.cardNickname !== undefined) card.cardNickname = validated.cardNickname;
  if (validated.issuingBank !== undefined) card.issuingBank = validated.issuingBank;
  if (validated.network !== undefined) card.network = validated.network;
  if (validated.lastFourDigits !== undefined) card.lastFourDigits = validated.lastFourDigits;
  if (validated.creditLimit !== undefined) card.creditLimit = validated.creditLimit;
  if (validated.billingCycleClosingDay !== undefined) card.billingCycleClosingDay = validated.billingCycleClosingDay;
  if (validated.paymentDueDay !== undefined) card.paymentDueDay = validated.paymentDueDay;
  if (validated.annualFee !== undefined) card.annualFee = validated.annualFee;
  if (validated.rewardsNotes !== undefined) card.rewardsNotes = validated.rewardsNotes;
  if (validated.notes !== undefined) card.notes = validated.notes;
  if (validated.isArchived !== undefined) card.isArchived = validated.isArchived;

  await card.save();
  await recalculateCreditCardOutstanding(card._id, userId);

  const updatedCard = await CreditCard.findById(card._id);
  sendSuccess(res, updatedCard!.toJSON(), 'Credit card updated successfully');
};

export const archiveCreditCard = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;

  const card = await CreditCard.findOne({ _id: id, userId });
  if (!card) {
    sendError(res, 'Credit card not found', 404, 'CARD_NOT_FOUND');
    return;
  }

  // Check if there are any recorded transactions referencing this credit card
  const txCount = await Transaction.countDocuments({ creditCardId: card._id });

  if (txCount === 0) {
    // If no transactions exist, safe to permanently delete statements and card
    await CreditCardStatement.deleteMany({ creditCardId: card._id });
    await CreditCard.deleteOne({ _id: card._id });
    sendSuccess(res, { id: card._id.toString() }, 'Credit card deleted successfully');
    return;
  }

  // If transactions exist, archive the card to preserve historical financial reports
  card.isArchived = true;
  card.isActive = false;
  await card.save();

  sendSuccess(res, card.toJSON(), 'Credit card deleted successfully');
};

export const recordRepayment = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const validated = creditCardRepaymentSchema.parse(req.body);

  const result = await executeCreditCardRepayment({
    userId,
    creditCardId: validated.creditCardId,
    sourceAccountId: validated.sourceAccountId,
    amount: validated.amount,
    liabilitySettled: validated.liabilitySettled,
    redemptionCredit: validated.redemptionCredit,
    redemptionNotes: validated.redemptionNotes,
    isFullRepayment: validated.isFullRepayment,
    repaymentMode: validated.repaymentMode,
    date: parseDateInput(validated.date),
    notes: validated.notes,
    statementId: validated.statementId,
    idempotencyKey: validated.idempotencyKey,
  });

  sendSuccess(res, result, 'Credit card repayment posted successfully', 201);
};

export const recordRefund = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id.toString();
  const { id } = req.params;
  const { amount, title, date, category, notes, idempotencyKey } = req.body;

  if (!amount || amount <= 0 || !title) {
    sendError(res, 'Amount and title are required for a refund', 400, 'INVALID_INPUT');
    return;
  }

  const result = await executeCreditCardRefund({
    userId,
    creditCardId: id,
    amount: Number(amount),
    title,
    date: date ? parseDateInput(date) : new Date(),
    category,
    notes,
    idempotencyKey,
  });

  sendSuccess(res, result, 'Credit card refund posted successfully', 201);
};

export const getCardTransactions = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;
  const query = paginationQuerySchema.parse(req.query);
  const skip = (query.page - 1) * query.limit;

  const card = await CreditCard.findOne({ _id: id, userId });
  if (!card) {
    sendError(res, 'Credit card not found', 404, 'CARD_NOT_FOUND');
    return;
  }

  const filter = { userId, creditCardId: card._id };

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

export const generateStatement = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;

  const card = await CreditCard.findOne({ _id: id, userId, isArchived: false });
  if (!card) {
    sendError(res, 'Credit card not found', 404, 'CARD_NOT_FOUND');
    return;
  }

  // Predictable statement period calculation:
  // Billing cycle closing day: e.g. 15th
  const now = new Date();
  const closingDate = new Date(now.getFullYear(), now.getMonth(), card.billingCycleClosingDay);
  const periodStart = new Date(closingDate);
  periodStart.setMonth(periodStart.getMonth() - 1);
  periodStart.setDate(periodStart.getDate() + 1);

  // Due date: automatically 15 calendar days after statement closing date
  const dueDate = calculateDueDateFromClosingDate(closingDate);

  // Fetch transactions in this period
  const txs = await Transaction.find({
    userId,
    creditCardId: card._id,
    date: { $gte: periodStart, $lte: closingDate },
    status: TransactionStatus.COMPLETED,
  });

  let purchases = 0;
  let payments = 0;
  let refunds = 0;

  for (const t of txs) {
    if (t.type === TransactionType.EXPENSE || t.type === TransactionType.INVESTMENT) purchases = safeAdd(purchases, t.amount);
    else if (t.type === TransactionType.CREDIT_CARD_PAYMENT) payments = safeAdd(payments, t.amount);
    else if (t.type === TransactionType.CREDIT_CARD_REFUND) refunds = safeAdd(refunds, t.amount);
  }

  const statementBalance = Math.max(0, safeSubtract(safeAdd(card.openingOutstanding, purchases), safeAdd(payments, refunds)));
  const minimumAmountDue = Math.min(statementBalance, Math.max(500, Math.round(statementBalance * 0.05)));

  const statement = await CreditCardStatement.create({
    userId,
    creditCardId: card._id,
    periodStart,
    periodEnd: closingDate,
    closingDate,
    dueDate,
    openingBalance: card.openingOutstanding,
    newPurchases: purchases,
    feesAndCharges: 0,
    paymentsReceived: payments,
    refundsAndCredits: refunds,
    statementBalance,
    minimumAmountDue,
    status: statementBalance === 0 ? StatementStatus.PAID : StatementStatus.DUE,
  });

  sendSuccess(res, statement.toJSON(), 'Credit card statement generated', 201);
};

export const listStatements = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;

  const statements = await CreditCardStatement.find({ userId, creditCardId: id }).sort({ closingDate: -1 });
  sendSuccess(res, statements.map((s) => s.toJSON()));
};
