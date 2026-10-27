import mongoose from 'mongoose';
import { Transaction } from '../models/Transaction';
import { BankAccount } from '../models/BankAccount';
import { CreditCard } from '../models/CreditCard';
import {
  TransactionType,
  TransactionStatus,
  RefundClassification,
  fromCents,
  toCents,
  safeAdd,
  safeSubtract,
  resolveDashboardDateRange,
  getStartOfDay,
  getEndOfDay,
  DashboardDateRange,
} from '@finora/shared';

export type DateRange = DashboardDateRange;

export const resolveDateRange = (
  period: string = 'this-month',
  customStart?: string,
  customEnd?: string
): DateRange => {
  return resolveDashboardDateRange(period, customStart, customEnd);
};

export const getDashboardAnalytics = async (
  userId: string | mongoose.Types.ObjectId,
  period: string = 'this-month',
  customStart?: string,
  customEnd?: string
) => {
  const dateRange = resolveDateRange(period, customStart, customEnd);

  // 1. Fetch all accounts and cards for the user
  const [bankAccounts, creditCards] = await Promise.all([
    BankAccount.find({ userId, isArchived: false }),
    CreditCard.find({ userId, isArchived: false }),
  ]);

  const totalBankBalances = bankAccounts.reduce((sum, a) => safeAdd(sum, a.currentBalance || 0), 0);
  const totalCreditCardOutstanding = creditCards.reduce((sum, c) => safeAdd(sum, c.currentOutstanding || 0), 0);
  const totalAvailableCredit = creditCards.reduce((sum, c) => safeAdd(sum, c.availableCredit || 0), 0);

  // 2. Fetch completed transactions in date range
  const periodTransactions = await Transaction.find({
    userId,
    status: TransactionStatus.COMPLETED,
    date: { $gte: dateRange.startDate, $lte: dateRange.endDate },
  });

  // Collect linked refunds for expenses in this period
  const expenseIds = periodTransactions
    .filter((tx) => tx.type === TransactionType.EXPENSE)
    .map((tx) => tx._id);

  const linkedRefunds = await Transaction.find({
    userId,
    originalExpenseId: { $in: expenseIds },
    status: { $ne: TransactionStatus.CANCELLED },
  });

  const expenseRefundCentsMap = new Map<string, number>();
  for (const r of linkedRefunds) {
    if (r.originalExpenseId) {
      const key = r.originalExpenseId.toString();
      expenseRefundCentsMap.set(key, (expenseRefundCentsMap.get(key) || 0) + toCents(r.amount));
    }
  }

  // Calculate Income, Expense (excluding transfers and repayments)
  let periodIncomeCents = 0;
  let periodExpenseCents = 0;
  const categoryTotals: Record<string, number> = {};
  const paymentMethodTotals: Record<string, { value: number; count: number }> = {};
  let onlineExpenseCents = 0;
  let offlineExpenseCents = 0;

  for (const tx of periodTransactions) {
    const amountCents = toCents(tx.amount);

    if (tx.type === TransactionType.INCOME) {
      const isRefundTx =
        tx.category === 'Refunds received' ||
        tx.refundClassification === RefundClassification.LINKED_REFUND ||
        tx.refundClassification === RefundClassification.UNLINKED_REFUND ||
        tx.refundClassification === RefundClassification.PURCHASE_CASHBACK;
      if (!isRefundTx) {
        periodIncomeCents += amountCents;
      }
    } else if (tx.type === TransactionType.EXPENSE) {
      const refCents = expenseRefundCentsMap.get(tx._id.toString()) || 0;
      const netCents = Math.max(0, amountCents - refCents);
      const netAmount = fromCents(netCents);

      periodExpenseCents += netCents;

      // Category aggregation (net)
      categoryTotals[tx.category] = safeAdd(categoryTotals[tx.category] || 0, netAmount);

      // Payment method aggregation (net)
      const method = tx.paymentMethod;
      if (!paymentMethodTotals[method]) {
        paymentMethodTotals[method] = { value: 0, count: 0 };
      }
      paymentMethodTotals[method].value = safeAdd(paymentMethodTotals[method].value, netAmount);
      paymentMethodTotals[method].count += 1;

      // Channel breakdown (net)
      if (tx.paymentChannel === 'online') {
        onlineExpenseCents += netCents;
      } else {
        offlineExpenseCents += netCents;
      }
    } else if (tx.type === TransactionType.CREDIT_CARD_REFUND) {
      // Refunds reduce net expenses if not already linked to an expense
      if (!tx.originalExpenseId) {
        periodExpenseCents = Math.max(0, periodExpenseCents - amountCents);
      }
    }
    // Transfers and Credit Card Repayments are explicitly excluded from income/expense totals!
  }

  const periodIncome = fromCents(periodIncomeCents);
  const periodExpense = fromCents(periodExpenseCents);
  const netCashFlow = safeSubtract(periodIncome, periodExpense);
  const savings = Math.max(0, netCashFlow);
  const savingsRate = periodIncome > 0 ? Math.max(0, Math.round((netCashFlow / periodIncome) * 100)) : 0;

  // 3. Category spending breakdown formatted for Pie / Bar charts
  const categoryBreakdown = Object.entries(categoryTotals)
    .map(([name, value]) => ({
      name,
      value: fromCents(toCents(value)),
    }))
    .sort((a, b) => b.value - a.value);

  // 4. Online vs Offline Channel Breakdown
  const totalChannelExpense = fromCents(onlineExpenseCents + offlineExpenseCents);
  const channelBreakdown = [
    {
      channel: 'Online',
      value: fromCents(onlineExpenseCents),
      percentage: totalChannelExpense > 0 ? Math.round((onlineExpenseCents / (onlineExpenseCents + offlineExpenseCents)) * 100) : 0,
    },
    {
      channel: 'Offline / In-person',
      value: fromCents(offlineExpenseCents),
      percentage: totalChannelExpense > 0 ? Math.round((offlineExpenseCents / (onlineExpenseCents + offlineExpenseCents)) * 100) : 0,
    },
  ];

  // 5. Payment method breakdown
  const paymentMethodBreakdown = Object.entries(paymentMethodTotals).map(([method, data]) => ({
    method,
    name: method.replace('_', ' ').toUpperCase(),
    value: data.value,
    count: data.count,
  }));

  // 6. Monthly Spending & Income Trend (Last 6 Months)
  const monthlyTrend: Array<{ month: string; income: number; expense: number; net: number }> = [];
  const currentMonthDate = new Date();

  for (let i = 5; i >= 0; i--) {
    const d = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() - i, 1);
    const monthStart = getStartOfDay(new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1, 12, 0, 0)));
    const monthEnd = getEndOfDay(new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 0, 12, 0, 0)));
    const monthLabel = d.toLocaleString('default', { month: 'short' });

    // We can compute quickly for the month
    const mTransactions = await Transaction.find({
      userId,
      status: TransactionStatus.COMPLETED,
      date: { $gte: monthStart, $lte: monthEnd },
    });

    const mExpenseIds = mTransactions.filter((t) => t.type === TransactionType.EXPENSE).map((t) => t._id);
    const mLinkedRefunds = await Transaction.find({
      userId,
      originalExpenseId: { $in: mExpenseIds },
      status: { $ne: TransactionStatus.CANCELLED },
    });
    const mRefMap = new Map<string, number>();
    for (const r of mLinkedRefunds) {
      if (r.originalExpenseId) {
        const key = r.originalExpenseId.toString();
        mRefMap.set(key, (mRefMap.get(key) || 0) + toCents(r.amount));
      }
    }

    let mIncomeCents = 0;
    let mExpenseCents = 0;

    for (const t of mTransactions) {
      const amtCents = toCents(t.amount);
      if (t.type === TransactionType.INCOME) {
        const isRef =
          t.category === 'Refunds received' ||
          t.refundClassification === RefundClassification.LINKED_REFUND ||
          t.refundClassification === RefundClassification.UNLINKED_REFUND ||
          t.refundClassification === RefundClassification.PURCHASE_CASHBACK;
        if (!isRef) mIncomeCents += amtCents;
      } else if (t.type === TransactionType.EXPENSE) {
        const rCents = mRefMap.get(t._id.toString()) || 0;
        mExpenseCents += Math.max(0, amtCents - rCents);
      } else if (t.type === TransactionType.CREDIT_CARD_REFUND && !t.originalExpenseId) {
        mExpenseCents = Math.max(0, mExpenseCents - amtCents);
      }
    }

    const mIncome = fromCents(mIncomeCents);
    const mExpense = fromCents(mExpenseCents);

    monthlyTrend.push({
      month: monthLabel,
      income: mIncome,
      expense: mExpense,
      net: safeSubtract(mIncome, mExpense),
    });
  }

  // 7. Recent Transactions (last 8)
  const recentTransactions = await Transaction.find({ userId })
    .sort({ date: -1, createdAt: -1 })
    .limit(8);

  // 8. Upcoming Credit Card Due Dates (cards with outstanding balance)
  const upcomingPayments = creditCards
    .filter((c) => c.currentOutstanding > 0)
    .map((c) => ({
      cardId: c._id.toString(),
      cardNickname: c.cardNickname,
      issuingBank: c.issuingBank,
      outstanding: c.currentOutstanding,
      dueDay: c.paymentDueDay,
    }));

  return {
    kpis: {
      periodIncome,
      periodExpense,
      netCashFlow,
      totalBankBalances,
      totalCreditCardOutstanding,
      totalAvailableCredit,
      savings,
      savingsRate,
      upcomingDueDatesCount: upcomingPayments.length,
      period: dateRange.label,
    },
    charts: {
      monthlyTrend,
      categoryBreakdown,
      channelBreakdown,
      paymentMethodBreakdown,
    },
    recentTransactions: recentTransactions.map((t) => t.toJSON()),
    upcomingPayments,
    bankAccounts: bankAccounts.map((a) => a.toJSON()),
    creditCards: creditCards.map((c) => c.toJSON()),
  };
};
