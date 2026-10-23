import mongoose from 'mongoose';
import { Budget, IBudget } from '../models/Budget';
import { Transaction } from '../models/Transaction';
import { TransactionType, TransactionStatus, toCents, fromCents, safeSubtract } from '@finora/shared';

export interface BudgetWithProgress {
  id: string;
  userId: string;
  category: string;
  limitAmount: number;
  period: 'monthly' | 'custom';
  startDate: string;
  endDate: string;
  alertThresholdPercent: number;
  isActive: boolean;
  spentAmount: number;
  remainingAmount: number;
  percentUsed: number;
  isAlertTriggered: boolean;
  isExceeded: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function calculateBudgetProgress(
  budget: IBudget,
  userId: mongoose.Types.ObjectId
): Promise<BudgetWithProgress> {
  const query: Record<string, any> = {
    userId,
    status: TransactionStatus.COMPLETED,
    isExcludedFromBudget: { $ne: true },
    date: {
      $gte: budget.startDate,
      $lte: budget.endDate,
    },
  };

  if (budget.category !== 'ALL') {
    query.category = budget.category;
  }

  // Get all expenses
  const expenses = await Transaction.find({
    ...query,
    type: TransactionType.EXPENSE,
  }).select('amount');

  // Get any refunds in the same category/period to offset spent
  const refunds = await Transaction.find({
    ...query,
    type: TransactionType.CREDIT_CARD_REFUND,
  }).select('amount');

  const totalExpenseCents = expenses.reduce((sum, tx) => sum + toCents(tx.amount), 0);
  const totalRefundCents = refunds.reduce((sum, tx) => sum + toCents(tx.amount), 0);
  const netSpentCents = Math.max(0, totalExpenseCents - totalRefundCents);
  const spentAmount = fromCents(netSpentCents);

  const limitCents = toCents(budget.limitAmount);
  const remainingCents = Math.max(0, limitCents - netSpentCents);
  const remainingAmount = fromCents(remainingCents);

  const percentUsed = limitCents > 0 ? Number(((netSpentCents / limitCents) * 100).toFixed(1)) : 0;
  const isAlertTriggered = percentUsed >= budget.alertThresholdPercent;
  const isExceeded = netSpentCents > limitCents;


  return {
    id: budget._id.toString(),
    userId: budget.userId.toString(),
    category: budget.category,
    limitAmount: budget.limitAmount,
    period: budget.period,
    alertThresholdPercent: budget.alertThresholdPercent,
    isActive: budget.isActive,
    spentAmount,
    remainingAmount,
    percentUsed,
    isAlertTriggered,
    isExceeded,
    startDate: budget.startDate.toISOString(),
    endDate: budget.endDate.toISOString(),
    createdAt: budget.createdAt ? budget.createdAt.toISOString() : new Date().toISOString(),
    updatedAt: budget.updatedAt ? budget.updatedAt.toISOString() : new Date().toISOString(),
  };
}

export async function getUserBudgetsWithProgress(
  userId: mongoose.Types.ObjectId
): Promise<BudgetWithProgress[]> {
  const budgets = await Budget.find({ userId }).sort({ createdAt: -1 });
  const results = await Promise.all(
    budgets.map((b) => calculateBudgetProgress(b, userId))
  );
  return results;
}
