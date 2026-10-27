import mongoose from 'mongoose';
import { Transaction, ITransaction } from '../models/Transaction';
import {
  TransactionType,
  TransactionStatus,
  RefundClassification,
  toCents,
  fromCents,
  ExpenseRefundContext,
  RefundableExpenseItem,
} from '@finora/shared';
import { AppError } from '../utils/api-response';

export interface RefundCalculationResult {
  originalExpense: ITransaction;
  originalAmount: number;
  totalRefunded: number;
  remainingRefundable: number;
  netAmount: number;
  refunds: ITransaction[];
}

/**
 * Authoritatively calculates the remaining refundable amount for an original expense.
 * Sums all active (non-cancelled) linked refunds using exact integer cent arithmetic.
 */
export async function getRemainingRefundableAmount(
  expenseId: string | mongoose.Types.ObjectId,
  userId: string | mongoose.Types.ObjectId,
  excludeRefundId?: string | mongoose.Types.ObjectId
): Promise<RefundCalculationResult> {
  const expense = await Transaction.findOne({ _id: expenseId, userId });
  if (!expense) {
    throw new AppError('Original expense transaction not found', 404, 'EXPENSE_NOT_FOUND');
  }

  if (expense.type !== TransactionType.EXPENSE) {
    throw new AppError('Referenced transaction is not an expense', 400, 'INVALID_EXPENSE_TYPE');
  }

  if (expense.status === TransactionStatus.CANCELLED) {
    throw new AppError('Cannot link a refund to a cancelled expense', 400, 'EXPENSE_CANCELLED');
  }

  const refundQuery: Record<string, any> = {
    userId,
    originalExpenseId: expense._id,
    status: { $ne: TransactionStatus.CANCELLED },
  };

  if (excludeRefundId) {
    refundQuery._id = { $ne: excludeRefundId };
  }

  const refunds = await Transaction.find(refundQuery).sort({ date: -1 });

  const originalCents = toCents(expense.amount);
  const totalRefundedCents = refunds.reduce((sum, r) => sum + toCents(r.amount), 0);
  const remainingRefundableCents = Math.max(0, originalCents - totalRefundedCents);
  const netAmountCents = Math.max(0, originalCents - totalRefundedCents);

  return {
    originalExpense: expense,
    originalAmount: expense.amount,
    totalRefunded: fromCents(totalRefundedCents),
    remainingRefundable: fromCents(remainingRefundableCents),
    netAmount: fromCents(netAmountCents),
    refunds,
  };
}

/**
 * Validates that a requested refund amount does not exceed the remaining refundable amount.
 */
export async function validateRefundLimit(
  expenseId: string | mongoose.Types.ObjectId,
  userId: string | mongoose.Types.ObjectId,
  requestedAmount: number,
  excludeRefundId?: string | mongoose.Types.ObjectId
): Promise<RefundCalculationResult> {
  const result = await getRemainingRefundableAmount(expenseId, userId, excludeRefundId);
  const requestedCents = toCents(requestedAmount);
  const remainingCents = toCents(result.remainingRefundable);

  if (requestedCents > remainingCents) {
    throw new AppError(
      `Refund amount (₹${requestedAmount.toLocaleString()}) exceeds the remaining refundable amount (₹${result.remainingRefundable.toLocaleString()}) for "${result.originalExpense.title}".`,
      400,
      'REFUND_EXCEEDS_REMAINING_AMOUNT'
    );
  }

  return result;
}

/**
 * Fetches candidate expenses for refund linking with real-time remaining refundable amounts.
 */
export async function getRefundableExpenses(
  userId: string | mongoose.Types.ObjectId,
  options: {
    search?: string;
    limit?: number;
    page?: number;
    onlyWithRemaining?: boolean;
    includeExpenseId?: string;
  } = {}
): Promise<{ items: RefundableExpenseItem[]; total: number }> {
  const limit = Math.min(options.limit || 20, 50);
  const page = Math.max(options.page || 1, 1);
  const skip = (page - 1) * limit;

  const query: Record<string, any> = {
    userId,
    type: TransactionType.EXPENSE,
    status: { $ne: TransactionStatus.CANCELLED },
  };

  if (options.search && options.search.trim().length > 0) {
    const s = options.search.trim();
    query.$or = [
      { title: { $regex: s, $options: 'i' } },
      { merchantOrRecipient: { $regex: s, $options: 'i' } },
      { category: { $regex: s, $options: 'i' } },
      { notes: { $regex: s, $options: 'i' } },
    ];
  }

  // Find candidate expenses
  const [expenses, total] = await Promise.all([
    Transaction.find(query).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit),
    Transaction.countDocuments(query),
  ]);

  if (expenses.length === 0) {
    return { items: [], total: 0 };
  }

  // Batch query all refunds linked to these candidate expenses
  const expenseIds = expenses.map((e) => e._id);
  const allLinkedRefunds = await Transaction.find({
    userId,
    originalExpenseId: { $in: expenseIds },
    status: { $ne: TransactionStatus.CANCELLED },
  });

  const refundSumMap = new Map<string, number>();
  for (const r of allLinkedRefunds) {
    if (r.originalExpenseId) {
      const key = r.originalExpenseId.toString();
      const current = refundSumMap.get(key) || 0;
      refundSumMap.set(key, current + toCents(r.amount));
    }
  }

  const items: RefundableExpenseItem[] = [];
  for (const exp of expenses) {
    const key = exp._id.toString();
    const refundedCents = refundSumMap.get(key) || 0;
    const originalCents = toCents(exp.amount);
    const remainingCents = Math.max(0, originalCents - refundedCents);

    const isCurrentLinked = options.includeExpenseId && key === options.includeExpenseId;
    if (options.onlyWithRemaining && remainingCents <= 0 && !isCurrentLinked) {
      continue;
    }

    items.push({
      id: key,
      title: exp.title,
      amount: exp.amount,
      date: exp.date.toISOString(),
      category: exp.category,
      paymentMethod: exp.paymentMethod,
      totalRefunded: fromCents(refundedCents),
      remainingRefundable: fromCents(remainingCents),
      merchant: exp.merchantOrRecipient,
      merchantOrRecipient: exp.merchantOrRecipient,
    });
  }

  return { items, total };
}

/**
 * Returns full refund context for an expense or a refund.
 */
export async function getExpenseRefundContext(
  targetId: string | mongoose.Types.ObjectId,
  userId: string | mongoose.Types.ObjectId
): Promise<ExpenseRefundContext> {
  const target = await Transaction.findOne({ _id: targetId, userId });
  if (!target) {
    throw new AppError('Transaction not found', 404, 'TRANSACTION_NOT_FOUND');
  }

  let originalExpenseId: mongoose.Types.ObjectId;
  if (target.type === TransactionType.EXPENSE) {
    originalExpenseId = target._id;
  } else if (target.originalExpenseId) {
    originalExpenseId = target.originalExpenseId;
  } else {
    throw new AppError('This transaction is not an expense and is not linked to any expense', 400, 'NOT_A_REFUND_CONTEXT');
  }

  const calc = await getRemainingRefundableAmount(originalExpenseId, userId);

  return {
    originalExpenseId: calc.originalExpense._id.toString(),
    originalTitle: calc.originalExpense.title,
    originalCategory: calc.originalExpense.category,
    originalDate: calc.originalExpense.date.toISOString(),
    originalAmount: calc.originalAmount,
    totalRefunded: calc.totalRefunded,
    remainingRefundable: calc.remainingRefundable,
    netAmount: calc.netAmount,
    expense: {
      id: calc.originalExpense._id.toString(),
      title: calc.originalExpense.title,
      category: calc.originalExpense.category,
      date: calc.originalExpense.date.toISOString(),
      amount: calc.originalAmount,
      paymentMethod: calc.originalExpense.paymentMethod,
      totalRefunded: calc.totalRefunded,
      remainingRefundable: calc.remainingRefundable,
      netExpense: calc.netAmount,
      merchantOrRecipient: calc.originalExpense.merchantOrRecipient,
    },
    refunds: calc.refunds.map((r) => ({
      id: r._id.toString(),
      title: r.title,
      amount: r.amount,
      date: r.date.toISOString(),
      paymentMethod: r.paymentMethod,
      refundClassification: (r.refundClassification || RefundClassification.LINKED_REFUND) as RefundClassification,
      notes: r.notes,
      isPastRecorded: Boolean(r.isPastRecorded),
    })),
  };
}

/**
 * Migration helper to ensure legacy transactions with 'Refunds received'
 * category have an explicit safe default classification (UNLINKED_REFUND) without modifying balances.
 */
export async function initializeLegacyRefundClassifications(): Promise<{ updatedCount: number }> {
  const result = await Transaction.updateMany(
    {
      category: 'Refunds received',
      refundClassification: { $exists: false },
    },
    {
      $set: { refundClassification: RefundClassification.UNLINKED_REFUND },
    }
  );
  return { updatedCount: result.modifiedCount };
}

