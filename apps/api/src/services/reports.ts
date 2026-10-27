import mongoose from 'mongoose';
import { Transaction, ITransaction } from '../models/Transaction';
import { RecurringOccurrence } from '../models/RecurringOccurrence';
import { EmiOccurrence } from '../models/EmiOccurrence';
import { BankAccount } from '../models/BankAccount';
import { CreditCard } from '../models/CreditCard';
import { User } from '../models/User';
import { Category } from '../models/Category';
import { Investment } from '../models/Investment';
import { InvestmentContribution } from '../models/InvestmentContribution';
import {
  TransactionType,
  TransactionStatus,
  RefundClassification,
  PaymentMethod,
  EmiOccurrenceStatus,
  InvestmentStatus,
  toCents,
  fromCents,
  safeAdd,
  safeSubtract,
  getStartOfDay,
  getEndOfDay,
  getLocalDateParts,
  DEFAULT_INCOME_CATEGORIES,
  InvestmentReportData,
  MonthlyExpensesReportData,
  MonthlyExpenseCategoryBreakdown,
  MonthlyExpenseTransaction,
} from '@finora/shared';

export interface MonthlyIncomeCategoryBreakdown {
  category: string;
  amount: number;
  transactionCount: number;
  percentage: number;
  isConfigured: boolean;
  transactions?: Array<{
    id: string;
    title: string;
    amount: number;
    date: string;
    paymentMethod: string;
    merchantOrRecipient?: string;
  }>;
}

export interface MonthlyIncomeReportData {
  month: string;
  monthLabel: string;
  totalMonthlyIncome: number;
  allIncomeTotal: number;
  totalRefundsReceived?: number;
  salaryIncome: number;
  freelanceIncome: number;
  otherSelectedIncome: number;
  qualifyingTransactionCount: number;
  configuredCategories: string[];
  categoryBreakdown: MonthlyIncomeCategoryBreakdown[];
  previousMonthComparison?: {
    previousMonth: string;
    previousTotal: number;
    changeAmount: number;
    changePercentage: number | null;
  };
  trend: Array<{
    month: string;
    income: number;
  }>;
  transactionCount?: number;
  highestCategory?: { name: string; amount: number } | null;
  averageDailyIncome?: number;
  daysInMonth?: number;
  dailyIncomeTrend?: Array<{ day: number; date: string; amount: number }>;
  largestIncomeEntries?: Array<{
    id: string;
    title: string;
    amount: number;
    date: string;
    category: string;
    paymentMethod: string;
    accountName?: string;
    merchantOrRecipient?: string;
  }>;
  allTransactions?: Array<{
    id: string;
    title: string;
    amount: number;
    date: string;
    category: string;
    paymentMethod: string;
    accountName?: string;
    merchantOrRecipient?: string;
  }>;
}

export interface ReportFilterOptions {
  accountId?: string;
  category?: string;
  paymentMethod?: string;
  includeForecast?: boolean;
}

export interface FinancialReportData {
  period: {
    startDate: string;
    endDate: string;
  };
  summary: {
    totalIncome: number;
    totalExpenses: number;
    totalInvestments: number;
    netCashFlow: number;
    savingsRate: number;
    transactionCount: number;
    creditCardSpend: number;
    recurringExpenses: number;
    emiExpenses: number;
    nonRecurringExpenses: number;
    creditCardRepayments: number;
    recurringInvestments: number;
  };
  investments?: InvestmentReportData;
  forecast?: {
    upcomingRecurring: number;
    upcomingEmi: number;
    totalProjectedExpenses: number;
    projectedNetCashFlow: number;
  };
  categoryBreakdown: Array<{
    category: string;
    totalAmount: number;
    transactionCount: number;
    percentage: number;
  }>;
  monthlyTrends: Array<{
    month: string;
    income: number;
    expenses: number;
    investments?: number;
    net: number;
  }>;
  paymentMethodBreakdown: Array<{
    method: string;
    amount: number;
    count: number;
  }>;
  channelBreakdown: Array<{
    channel: string;
    amount: number;
    count: number;
  }>;
}

/**
 * Sanitizes CSV fields to prevent formula injection attacks (CSV Injection / DDE).
 * Prepend single quote if field starts with =, +, -, @, tab, or carriage return.
 */
export function sanitizeCsvField(val: unknown): string {
  if (val === null || val === undefined) return '';
  let str = String(val);

  // Neutralize formula triggers
  if (/^[=\+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // Escape quotes and wrap if contains comma, quote, or newline
  if (/[",\n\r]/.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export function generateTransactionsCsv(transactions: ITransaction[]): string {
  const headers = [
    'Date',
    'Title',
    'Type',
    'Amount',
    'Currency',
    'Category',
    'Subcategory',
    'Payment Method',
    'Payment Channel',
    'Status',
    'Merchant/Recipient',
    'Notes',
  ];

  const rows = transactions.map((tx) => [
    sanitizeCsvField(new Date(tx.date).toISOString().split('T')[0]),
    sanitizeCsvField(tx.title),
    sanitizeCsvField(tx.type),
    sanitizeCsvField(tx.amount.toFixed(2)),
    sanitizeCsvField(tx.currency),
    sanitizeCsvField(tx.category),
    sanitizeCsvField(tx.subcategory || ''),
    sanitizeCsvField(tx.paymentMethod),
    sanitizeCsvField(tx.paymentChannel),
    sanitizeCsvField(tx.status),
    sanitizeCsvField(tx.merchantOrRecipient || ''),
    sanitizeCsvField(tx.notes || ''),
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
}

export async function getFinancialReport(
  userId: mongoose.Types.ObjectId,
  startDate: Date,
  endDate: Date,
  filters?: ReportFilterOptions
): Promise<FinancialReportData> {
  const query: Record<string, any> = {
    userId,
    status: TransactionStatus.COMPLETED,
    date: { $gte: startDate, $lte: endDate },
    // Strict isolation: exclude internal chit separation allocations and bank transfers
    type: { $nin: [TransactionType.CHIT_SEPARATION, TransactionType.TRANSFER] },
  };

  if (filters?.accountId && mongoose.Types.ObjectId.isValid(filters.accountId)) {
    const accObjId = new mongoose.Types.ObjectId(filters.accountId);
    query.$or = [{ accountId: accObjId }, { destinationAccountId: accObjId }];
  }

  if (filters?.category) {
    query.category = filters.category;
  }

  if (filters?.paymentMethod) {
    query.paymentMethod = filters.paymentMethod;
  }

  const [transactions, bankAccounts, creditCards, wonInvestments] = await Promise.all([
    Transaction.find(query).sort({ date: 1 }),
    BankAccount.find({ userId }),
    CreditCard.find({ userId }),
    Investment.find({
      userId,
      $or: [
        { isWon: true },
        { status: InvestmentStatus.WON },
        { winningDate: { $exists: true, $ne: null } },
      ],
    }).select('_id'),
  ]);

  const wonInvestmentIdSet = new Set(wonInvestments.map((inv: { _id: mongoose.Types.ObjectId }) => inv._id.toString()));

  const wonContributions =
    wonInvestmentIdSet.size > 0
      ? await InvestmentContribution.find({
          userId,
          investmentId: { $in: Array.from(wonInvestments.map((inv: { _id: mongoose.Types.ObjectId }) => inv._id)) },
        }).select('_id')
      : [];
  const wonContributionIdSet = new Set(wonContributions.map((c: { _id: mongoose.Types.ObjectId }) => c._id.toString()));

  const isWonChitInvestmentTx = (tx: ITransaction) => {
    if (tx.type !== TransactionType.INVESTMENT) return false;
    if (tx.investmentId && wonInvestmentIdSet.has(tx.investmentId.toString())) return true;
    if (tx.investmentContributionId && wonContributionIdSet.has(tx.investmentContributionId.toString()))
      return true;
    return false;
  };

  // Authoritative active reporting transactions:
  // Won external chits are excluded from active investment calculations, breakdowns, and ledgers in Main Reports
  const reportTransactions = transactions.filter((tx: ITransaction) => !isWonChitInvestmentTx(tx));

  const accountMap = new Map(bankAccounts.map((a: { _id: mongoose.Types.ObjectId; accountName: string }) => [a._id.toString(), a.accountName]));
  const cardMap = new Map(creditCards.map((c: { _id: mongoose.Types.ObjectId; cardNickname: string }) => [c._id.toString(), c.cardNickname]));

  let totalIncomeCents = 0;
  let totalExpenseCents = 0;
  let totalInvestedCents = 0;
  let creditCardSpendCents = 0;
  let creditCardRepaymentCents = 0;
  let recurringExpenseCents = 0;
  let recurringInvestmentCents = 0;
  let emiExpenseCents = 0;

  const categoryMap = new Map<string, { totalCents: number; count: number }>();
  const methodMap = new Map<string, { totalCents: number; count: number }>();
  const channelMap = new Map<string, { totalCents: number; count: number }>();
  const monthMap = new Map<string, { incomeCents: number; expenseCents: number; investmentCents: number }>();

  const investmentCategoryMap = new Map<string, { totalCents: number; count: number }>();
  const investmentSourceMap = new Map<string, { totalCents: number; count: number }>();
  const investmentTransactions: InvestmentReportData['transactions'] = [];

  // Query linked refunds for any expenses in reportTransactions
  const expenseIds = reportTransactions
    .filter((tx: ITransaction) => tx.type === TransactionType.EXPENSE)
    .map((tx: ITransaction) => tx._id);

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

  for (const tx of reportTransactions) {
    const amountCents = toCents(tx.amount);
    const monthKey = new Date(tx.date).toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    });

    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, { incomeCents: 0, expenseCents: 0, investmentCents: 0 });
    }
    const monthData = monthMap.get(monthKey)!;

    if (tx.type === TransactionType.INCOME) {
      const isRefundTx =
        tx.category === 'Refunds received' ||
        tx.refundClassification === RefundClassification.LINKED_REFUND ||
        tx.refundClassification === RefundClassification.UNLINKED_REFUND ||
        tx.refundClassification === RefundClassification.PURCHASE_CASHBACK;
      if (!isRefundTx) {
        totalIncomeCents += amountCents;
        monthData.incomeCents += amountCents;
      }
    } else if (tx.type === TransactionType.EXPENSE) {
      const expRefundCents = expenseRefundCentsMap.get(tx._id.toString()) || 0;
      const netExpenseCents = Math.max(0, amountCents - expRefundCents);

      totalExpenseCents += netExpenseCents;
      monthData.expenseCents += netExpenseCents;

      // Track credit card spend
      if (tx.paymentMethod === PaymentMethod.CREDIT_CARD || tx.creditCardId) {
        creditCardSpendCents += netExpenseCents;
      }

      // Track recurring vs EMI
      if (tx.emiRuleId) {
        emiExpenseCents += netExpenseCents;
      } else if (tx.recurringRuleId) {
        recurringExpenseCents += netExpenseCents;
      }

      // Category tracking for expenses
      const cat = tx.category || 'Uncategorized';
      const existing = categoryMap.get(cat) || { totalCents: 0, count: 0 };
      categoryMap.set(cat, {
        totalCents: existing.totalCents + netExpenseCents,
        count: existing.count + 1,
      });

      // Payment method tracking
      const method = tx.paymentMethod || 'other';
      const mExisting = methodMap.get(method) || { totalCents: 0, count: 0 };
      methodMap.set(method, {
        totalCents: mExisting.totalCents + netExpenseCents,
        count: mExisting.count + 1,
      });

      // Channel tracking
      const channel = tx.paymentChannel || 'other';
      const cExisting = channelMap.get(channel) || { totalCents: 0, count: 0 };
      channelMap.set(channel, {
        totalCents: cExisting.totalCents + netExpenseCents,
        count: cExisting.count + 1,
      });
    } else if (tx.type === TransactionType.INVESTMENT) {
      totalInvestedCents += amountCents;
      monthData.investmentCents += amountCents;

      if (tx.recurringRuleId) {
        recurringInvestmentCents += amountCents;
      }

      // Investment category tracking
      const cat = tx.category || 'Other Investments';
      const existing = investmentCategoryMap.get(cat) || { totalCents: 0, count: 0 };
      investmentCategoryMap.set(cat, {
        totalCents: existing.totalCents + amountCents,
        count: existing.count + 1,
      });

      // Funding source identification
      let sourceName = 'Other';
      if (tx.paymentMethod === PaymentMethod.CASH) {
        sourceName = 'Personal Cash in Hand';
      } else if (tx.creditCardId) {
        sourceName = cardMap.get(tx.creditCardId.toString()) || 'Credit Card';
      } else if (tx.accountId) {
        sourceName = accountMap.get(tx.accountId.toString()) || 'Bank Account';
      } else if (tx.paymentMethod) {
        sourceName = tx.paymentMethod.replace('_', ' ').toUpperCase();
      }

      const sExisting = investmentSourceMap.get(sourceName) || { totalCents: 0, count: 0 };
      investmentSourceMap.set(sourceName, {
        totalCents: sExisting.totalCents + amountCents,
        count: sExisting.count + 1,
      });

      investmentTransactions.push({
        id: tx._id.toString(),
        title: tx.title,
        amount: tx.amount,
        date: tx.date.toISOString(),
        category: tx.category,
        subcategory: tx.subcategory,
        paymentMethod: tx.paymentMethod,
        fundingSource: sourceName,
        notes: tx.notes,
      });
    } else if (tx.type === TransactionType.CREDIT_CARD_PAYMENT) {
      creditCardRepaymentCents += amountCents;
    } else if (tx.type === TransactionType.CREDIT_CARD_REFUND) {
      // Refunds reduce expenses if not already linked
      if (!tx.originalExpenseId) {
        totalExpenseCents = Math.max(0, totalExpenseCents - amountCents);
        monthData.expenseCents = Math.max(0, monthData.expenseCents - amountCents);
        creditCardSpendCents = Math.max(0, creditCardSpendCents - amountCents);
      }
    }
  }

  const totalIncome = fromCents(totalIncomeCents);
  const totalExpenses = fromCents(totalExpenseCents);
  const totalInvested = fromCents(totalInvestedCents);
  const netCashFlow = fromCents(totalIncomeCents - totalExpenseCents);
  const savingsRate =
    totalIncomeCents > 0
      ? Number((((totalIncomeCents - totalExpenseCents) / totalIncomeCents) * 100).toFixed(1))
      : 0;

  const creditCardSpend = fromCents(creditCardSpendCents);
  const recurringExpenses = fromCents(recurringExpenseCents);
  const emiExpenses = fromCents(emiExpenseCents);
  const nonRecurringExpenses = fromCents(
    Math.max(0, totalExpenseCents - recurringExpenseCents - emiExpenseCents)
  );

  const categoryBreakdown = Array.from(categoryMap.entries())
    .map(([category, val]) => ({
      category,
      totalAmount: fromCents(val.totalCents),
      transactionCount: val.count,
      percentage:
        totalExpenseCents > 0
          ? Number(((val.totalCents / totalExpenseCents) * 100).toFixed(1))
          : 0,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);

  const monthlyTrends = Array.from(monthMap.entries()).map(([month, val]) => ({
    month,
    income: fromCents(val.incomeCents),
    expenses: fromCents(val.expenseCents),
    investments: fromCents(val.investmentCents || 0),
    net: fromCents(val.incomeCents - val.expenseCents),
  }));

  const paymentMethodBreakdown = Array.from(methodMap.entries()).map(([method, val]) => ({
    method,
    amount: fromCents(val.totalCents),
    count: val.count,
  }));

  const channelBreakdown = Array.from(channelMap.entries()).map(([channel, val]) => ({
    channel,
    amount: fromCents(val.totalCents),
    count: val.count,
  }));

  const investmentCategoryBreakdown = Array.from(investmentCategoryMap.entries())
    .map(([category, val]) => ({
      category,
      totalAmount: fromCents(val.totalCents),
      count: val.count,
      percentage:
        totalInvestedCents > 0
          ? Number(((val.totalCents / totalInvestedCents) * 100).toFixed(1))
          : 0,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);

  const investmentSourceBreakdown = Array.from(investmentSourceMap.entries())
    .map(([source, val]) => ({
      source,
      amount: fromCents(val.totalCents),
      count: val.count,
      percentage:
        totalInvestedCents > 0
          ? Number(((val.totalCents / totalInvestedCents) * 100).toFixed(1))
          : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const monthlyInvestmentContributions = Array.from(monthMap.entries()).map(([month, val]) => ({
    month,
    amount: fromCents(val.investmentCents || 0),
    count: investmentTransactions.filter((it: InvestmentReportData['transactions'][number]) => {
      const itMonth = new Date(it.date).toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      });
      return itMonth === month;
    }).length,
  }));

  const investmentsData: InvestmentReportData = {
    totalInvested,
    monthlyContributions: monthlyInvestmentContributions,
    categoryBreakdown: investmentCategoryBreakdown,
    fundingSourceBreakdown: investmentSourceBreakdown,
    transactions: investmentTransactions,
  };

  // Calculate Forecast if requested or available
  let forecastData: FinancialReportData['forecast'] = undefined;
  try {
    const [dueRecurringOccs, dueEmiOccs] = await Promise.all([
      RecurringOccurrence.find({
        userId,
        status: 'DUE',
        scheduledDate: { $gte: startDate, $lte: endDate },
      }).populate('recurringRuleId'),
      EmiOccurrence.find({
        userId,
        status: { $in: [EmiOccurrenceStatus.DUE, EmiOccurrenceStatus.OVERDUE] },
        dueDate: { $gte: startDate, $lte: endDate },
      }).populate('emiRuleId'),
    ]);

    let upcomingRecurring = 0;
    for (const r of dueRecurringOccs) {
      const rule = r.recurringRuleId as any;
      const expected = r.originalAmount || rule?.amount || 0;
      upcomingRecurring = safeAdd(upcomingRecurring, expected);
    }

    let upcomingEmi = 0;
    for (const e of dueEmiOccs) {
      upcomingEmi = safeAdd(upcomingEmi, e.expectedAmount || 0);
    }

    const totalProjectedExpenses = safeAdd(totalExpenses, safeAdd(upcomingRecurring, upcomingEmi));
    const projectedNetCashFlow = safeSubtract(totalIncome, totalProjectedExpenses);

    forecastData = {
      upcomingRecurring,
      upcomingEmi,
      totalProjectedExpenses,
      projectedNetCashFlow,
    };
  } catch {
    // If forecast tables are empty or cannot be queried, safely omit
  }

  return {
    period: {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    },
    summary: {
      totalIncome,
      totalExpenses,
      totalInvestments: totalInvested,
      netCashFlow,
      savingsRate,
      transactionCount: reportTransactions.length,
      creditCardSpend,
      recurringExpenses,
      emiExpenses,
      nonRecurringExpenses,
      creditCardRepayments: fromCents(creditCardRepaymentCents),
      recurringInvestments: fromCents(recurringInvestmentCents),
    },
    investments: investmentsData,
    forecast: forecastData,
    categoryBreakdown,
    monthlyTrends,
    paymentMethodBreakdown,
    channelBreakdown,
  };
}

/**
 * Calculates authoritative configurable monthly income breakdown for the selected month in Asia/Kolkata.
 */
export async function getMonthlyIncomeSummary(
  userId: mongoose.Types.ObjectId,
  targetMonth: string // YYYY-MM
): Promise<MonthlyIncomeReportData> {
  const parts = targetMonth.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);

  // Month date boundaries in Asia/Kolkata
  const firstDay = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  const lastDay = new Date(Date.UTC(year, month, 0, 12, 0, 0));
  const startDate = getStartOfDay(firstDay, 'Asia/Kolkata');
  const endDate = getEndOfDay(lastDay, 'Asia/Kolkata');

  // Month label formatted nicely in India locale
  const monthLabel = firstDay.toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

  // Fetch user's configured income categories
  const user = await User.findById(userId);
  const configuredCategories =
    user?.preferences?.incomeCategories && user.preferences.incomeCategories.length > 0
      ? user.preferences.incomeCategories
      : ['Salary', 'Freelance income'];

  const configuredSet = new Set(configuredCategories.map((c) => c.trim().toLowerCase()));

  // Query only genuine completed income transactions for the month in Asia/Kolkata
  const [transactions, bankAccounts] = await Promise.all([
    Transaction.find({
      userId,
      status: TransactionStatus.COMPLETED,
      type: TransactionType.INCOME,
      date: { $gte: startDate, $lte: endDate },
    }).sort({ date: -1 }),
    BankAccount.find({ userId }),
  ]);

  const bankMap = new Map(bankAccounts.map((a) => [a._id.toString(), a.accountName]));
  const daysInMonth = new Date(year, month, 0).getDate();
  const dailyIncomeMap = new Map<number, number>();
  const allFormattedTransactions: Array<{
    id: string;
    title: string;
    amount: number;
    date: string;
    category: string;
    paymentMethod: string;
    accountName?: string;
    merchantOrRecipient?: string;
  }> = [];

  const categoryMap = new Map<
    string,
    { total: number; count: number; transactions: any[] }
  >();

  let allIncomeTotal = 0;
  let totalMonthlyIncome = 0;
  let totalRefundsReceived = 0;
  let salaryIncome = 0;
  let freelanceIncome = 0;
  let otherSelectedIncome = 0;
  let qualifyingTransactionCount = 0;

  for (const tx of transactions) {
    const day = getLocalDateParts(tx.date, 'Asia/Kolkata').day;
    dailyIncomeMap.set(day, safeAdd(dailyIncomeMap.get(day) || 0, tx.amount));

    const cat = tx.category || 'Other income';
    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, { total: 0, count: 0, transactions: [] });
    }
    const entry = categoryMap.get(cat)!;
    entry.total = safeAdd(entry.total, tx.amount);
    entry.count += 1;

    const accountName = tx.accountId ? bankMap.get(tx.accountId.toString()) : undefined;

    const txItem = {
      id: tx._id.toString(),
      title: tx.title,
      amount: tx.amount,
      date: tx.date.toISOString(),
      category: cat,
      paymentMethod: tx.paymentMethod,
      accountName,
      merchantOrRecipient: tx.merchantOrRecipient,
      isPastRecorded: Boolean((tx as any).isPastRecorded),
    };

    entry.transactions.push(txItem);
    allFormattedTransactions.push(txItem);

    allIncomeTotal = safeAdd(allIncomeTotal, tx.amount);

    const isRefundTx =
      cat.trim().toLowerCase() === 'refunds received' ||
      tx.refundClassification === RefundClassification.LINKED_REFUND ||
      tx.refundClassification === RefundClassification.UNLINKED_REFUND ||
      tx.refundClassification === RefundClassification.PURCHASE_CASHBACK;

    if (isRefundTx) {
      totalRefundsReceived = safeAdd(totalRefundsReceived, tx.amount);
    }

    const isConfigured = !isRefundTx && configuredSet.has(cat.trim().toLowerCase());
    if (isConfigured) {
      totalMonthlyIncome = safeAdd(totalMonthlyIncome, tx.amount);
      qualifyingTransactionCount += 1;

      const lowerCat = cat.trim().toLowerCase();
      if (lowerCat === 'salary') {
        salaryIncome = safeAdd(salaryIncome, tx.amount);
      } else if (lowerCat.includes('freelance')) {
        freelanceIncome = safeAdd(freelanceIncome, tx.amount);
      } else {
        otherSelectedIncome = safeAdd(otherSelectedIncome, tx.amount);
      }
    }
  }

  // Build category breakdown
  const categoryBreakdown: MonthlyIncomeCategoryBreakdown[] = Array.from(categoryMap.entries())
    .map(([category, data]) => {
      const isRefundCat = category.trim().toLowerCase() === 'refunds received';
      const isConfigured = !isRefundCat && configuredSet.has(category.trim().toLowerCase());
      return {
        category,
        amount: data.total,
        transactionCount: data.count,
        percentage:
          allIncomeTotal > 0
            ? Math.round((data.total / allIncomeTotal) * 100)
            : 0,
        isConfigured,
        transactions: data.transactions,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  const highestCategory =
    categoryBreakdown.length > 0
      ? { name: categoryBreakdown[0].category, amount: categoryBreakdown[0].amount }
      : null;

  const averageDailyIncome =
    daysInMonth > 0 ? Math.round((totalMonthlyIncome / daysInMonth) * 100) / 100 : 0;

  // Build daily income trend
  const dailyIncomeTrend: Array<{ day: number; date: string; amount: number }> = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    dailyIncomeTrend.push({
      day: d,
      date: dStr,
      amount: dailyIncomeMap.get(d) || 0,
    });
  }

  // Largest income entries (top 10)
  const largestIncomeEntries = [...allFormattedTransactions]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  // Previous month comparison
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevMonthKey = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
  const prevFirstDay = new Date(Date.UTC(prevYear, prevMonth - 1, 1, 12, 0, 0));
  const prevLastDay = new Date(Date.UTC(prevYear, prevMonth, 0, 12, 0, 0));
  const prevStart = getStartOfDay(prevFirstDay, 'Asia/Kolkata');
  const prevEnd = getEndOfDay(prevLastDay, 'Asia/Kolkata');

  const prevTransactions = await Transaction.find({
    userId,
    status: TransactionStatus.COMPLETED,
    type: TransactionType.INCOME,
    date: { $gte: prevStart, $lte: prevEnd },
  });

  let prevTotal = 0;
  for (const ptx of prevTransactions) {
    const isPrevRefund =
      (ptx.category || '').trim().toLowerCase() === 'refunds received' ||
      ptx.refundClassification === RefundClassification.LINKED_REFUND ||
      ptx.refundClassification === RefundClassification.UNLINKED_REFUND ||
      ptx.refundClassification === RefundClassification.PURCHASE_CASHBACK;
    if (!isPrevRefund && configuredSet.has((ptx.category || '').trim().toLowerCase())) {
      prevTotal = safeAdd(prevTotal, ptx.amount);
    }
  }

  const changeAmount = safeSubtract(totalMonthlyIncome, prevTotal);
  const changePercentage =
    prevTotal > 0 ? Math.round(((totalMonthlyIncome - prevTotal) / prevTotal) * 100) : null;

  // 6-month historical trend
  const trend: Array<{ month: string; income: number }> = [];
  for (let i = 5; i >= 0; i--) {
    let tYear = year;
    let tMonth = month - i;
    while (tMonth < 1) {
      tMonth += 12;
      tYear -= 1;
    }
    const tFirst = new Date(Date.UTC(tYear, tMonth - 1, 1, 12, 0, 0));
    const tLast = new Date(Date.UTC(tYear, tMonth, 0, 12, 0, 0));
    const tStart = getStartOfDay(tFirst, 'Asia/Kolkata');
    const tEnd = getEndOfDay(tLast, 'Asia/Kolkata');

    const mKey = `${tYear}-${String(tMonth).padStart(2, '0')}`;
    const mLabel = tFirst.toLocaleDateString('en-IN', {
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    });

    const mTxList = await Transaction.find({
      userId,
      status: TransactionStatus.COMPLETED,
      type: TransactionType.INCOME,
      date: { $gte: tStart, $lte: tEnd },
    });

    let mTotal = 0;
    for (const t of mTxList) {
      const isMRefund =
        (t.category || '').trim().toLowerCase() === 'refunds received' ||
        t.refundClassification === RefundClassification.LINKED_REFUND ||
        t.refundClassification === RefundClassification.UNLINKED_REFUND ||
        t.refundClassification === RefundClassification.PURCHASE_CASHBACK;
      if (!isMRefund && configuredSet.has((t.category || '').trim().toLowerCase())) {
        mTotal = safeAdd(mTotal, t.amount);
      }
    }

    trend.push({ month: mLabel, income: mTotal });
  }

  return {
    month: targetMonth,
    monthLabel,
    totalMonthlyIncome,
    allIncomeTotal,
    totalRefundsReceived,
    salaryIncome,
    freelanceIncome,
    otherSelectedIncome,
    qualifyingTransactionCount,
    configuredCategories,
    categoryBreakdown,
    previousMonthComparison: {
      previousMonth: prevMonthKey,
      previousTotal: prevTotal,
      changeAmount,
      changePercentage,
    },
    trend,
    transactionCount: transactions.length,
    highestCategory,
    averageDailyIncome,
    daysInMonth,
    dailyIncomeTrend,
    largestIncomeEntries,
    allTransactions: allFormattedTransactions,
  };
}

/**
 * Calculates authoritative monthly expense breakdown and analytics for the selected month in Asia/Kolkata.
 */
export async function getMonthlyExpensesSummary(
  userId: mongoose.Types.ObjectId,
  targetMonth: string // YYYY-MM
): Promise<MonthlyExpensesReportData> {
  const parts = targetMonth.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);

  // Month date boundaries in Asia/Kolkata
  const firstDay = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  const lastDay = new Date(Date.UTC(year, month, 0, 12, 0, 0));
  const startDate = getStartOfDay(firstDay, 'Asia/Kolkata');
  const endDate = getEndOfDay(lastDay, 'Asia/Kolkata');
  const daysInMonth = new Date(year, month, 0).getDate();

  const monthLabel = firstDay.toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

  // Query only genuine completed expense transactions (and refunds) for the month
  const [transactions, bankAccounts, creditCards] = await Promise.all([
    Transaction.find({
      userId,
      status: TransactionStatus.COMPLETED,
      type: { $in: [TransactionType.EXPENSE, TransactionType.CREDIT_CARD_REFUND] },
      date: { $gte: startDate, $lte: endDate },
    }).sort({ date: -1 }),
    BankAccount.find({ userId }),
    CreditCard.find({ userId }),
  ]);

  const expenseIds = transactions
    .filter((tx) => tx.type === TransactionType.EXPENSE)
    .map((tx) => tx._id);

  const [linkedRefundsDocs, unlinkedRefundsList] = await Promise.all([
    Transaction.find({
      userId,
      originalExpenseId: { $in: expenseIds },
      status: { $ne: TransactionStatus.CANCELLED },
    }).sort({ date: -1 }),
    Transaction.find({
      userId,
      status: TransactionStatus.COMPLETED,
      type: TransactionType.INCOME,
      refundClassification: RefundClassification.UNLINKED_REFUND,
      date: { $gte: startDate, $lte: endDate },
    }),
  ]);

  const bankMap = new Map(bankAccounts.map((a) => [a._id.toString(), a.accountName]));
  const cardMap = new Map(creditCards.map((c) => [c._id.toString(), c.cardNickname]));

  const refundMapByExpense = new Map<
    string,
    Array<{
      id: string;
      title: string;
      amount: number;
      date: string;
      paymentMethod?: string;
      refundClassification?: string;
    }>
  >();
  const refundCentsByExpense = new Map<string, number>();

  for (const ref of linkedRefundsDocs) {
    if (ref.originalExpenseId) {
      const expId = ref.originalExpenseId.toString();
      const currentList = refundMapByExpense.get(expId) || [];
      currentList.push({
        id: ref._id.toString(),
        title: ref.title,
        amount: ref.amount,
        date: ref.date.toISOString(),
        paymentMethod: ref.paymentMethod,
        refundClassification: ref.refundClassification,
      });
      refundMapByExpense.set(expId, currentList);
      refundCentsByExpense.set(expId, (refundCentsByExpense.get(expId) || 0) + toCents(ref.amount));
    }
  }

  const categoryMap = new Map<
    string,
    { grossTotal: number; refundTotal: number; netTotal: number; count: number; transactions: MonthlyExpenseTransaction[] }
  >();

  let totalGrossCents = 0;
  let totalLinkedRefundCents = 0;
  let totalCardRefundCents = 0;
  let transactionCount = 0;
  const formattedTransactions: MonthlyExpenseTransaction[] = [];
  const dailySpendMap = new Map<number, number>();

  for (const tx of transactions) {
    const amountCents = toCents(tx.amount);
    const day = getLocalDateParts(tx.date, 'Asia/Kolkata').day;

    if (tx.type === TransactionType.EXPENSE) {
      const expenseIdStr = tx._id.toString();
      const refList = refundMapByExpense.get(expenseIdStr) || [];
      const refCents = refundCentsByExpense.get(expenseIdStr) || 0;
      const netCents = Math.max(0, amountCents - refCents);

      totalGrossCents += amountCents;
      totalLinkedRefundCents += refCents;
      transactionCount += 1;

      // Daily spending trend reflects net spending for accuracy
      dailySpendMap.set(day, safeAdd(dailySpendMap.get(day) || 0, fromCents(netCents)));

      const cat = tx.category || 'Other expense';
      if (!categoryMap.has(cat)) {
        categoryMap.set(cat, { grossTotal: 0, refundTotal: 0, netTotal: 0, count: 0, transactions: [] });
      }
      const catEntry = categoryMap.get(cat)!;
      catEntry.grossTotal = safeAdd(catEntry.grossTotal, tx.amount);
      catEntry.refundTotal = safeAdd(catEntry.refundTotal, fromCents(refCents));
      catEntry.netTotal = safeAdd(catEntry.netTotal, fromCents(netCents));
      catEntry.count += 1;

      const accountName = tx.accountId
        ? bankMap.get(tx.accountId.toString())
        : tx.creditCardId
        ? cardMap.get(tx.creditCardId.toString())
        : undefined;

      const item: MonthlyExpenseTransaction = {
        id: expenseIdStr,
        title: tx.title,
        amount: fromCents(netCents), // Net amount
        grossAmount: tx.amount,
        refundAmount: fromCents(refCents),
        netAmount: fromCents(netCents),
        date: tx.date.toISOString(),
        category: cat,
        paymentMethod: tx.paymentMethod,
        paymentChannel: tx.paymentChannel,
        accountName,
        merchantOrRecipient: tx.merchantOrRecipient,
        notes: tx.notes,
        isPastRecorded: Boolean((tx as any).isPastRecorded),
        refunds: refList,
      };

      catEntry.transactions.push(item);
      formattedTransactions.push(item);
    } else if (tx.type === TransactionType.CREDIT_CARD_REFUND) {
      if (!tx.originalExpenseId) {
        totalCardRefundCents += amountCents;
      }
    }
  }

  const unlinkedRefundCents = unlinkedRefundsList.reduce((sum, r) => sum + toCents(r.amount), 0);
  const totalRefundCents = totalLinkedRefundCents + totalCardRefundCents;
  const netExpenseCents = Math.max(0, totalGrossCents - totalRefundCents);
  const totalExpenses = fromCents(netExpenseCents);
  const grossExpenses = fromCents(totalGrossCents);
  const linkedRefunds = fromCents(totalRefundCents);
  const unlinkedRefunds = fromCents(unlinkedRefundCents);
  const netExpenses = totalExpenses;
  const averageDailySpend = daysInMonth > 0 ? Math.round((totalExpenses / daysInMonth) * 100) / 100 : 0;

  // Build category breakdown
  const categoryBreakdown: MonthlyExpenseCategoryBreakdown[] = Array.from(categoryMap.entries())
    .map(([category, data]) => ({
      category,
      amount: data.netTotal,
      grossAmount: data.grossTotal,
      refundAmount: data.refundTotal,
      netAmount: data.netTotal,
      transactionCount: data.count,
      percentage: totalExpenses > 0 ? Math.round((data.netTotal / totalExpenses) * 100) : 0,
      transactions: data.transactions,
    }))
    .sort((a, b) => b.amount - a.amount);

  const highestCategory =
    categoryBreakdown.length > 0
      ? { name: categoryBreakdown[0].category, amount: categoryBreakdown[0].amount }
      : null;

  // Build daily spending trend
  const dailySpendingTrend: Array<{ day: number; date: string; amount: number }> = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    dailySpendingTrend.push({
      day: d,
      date: dStr,
      amount: dailySpendMap.get(d) || 0,
    });
  }

  // Largest expenses (top 10)
  const largestExpenses = [...formattedTransactions]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  // Previous month comparison
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevMonthKey = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
  const prevFirstDay = new Date(Date.UTC(prevYear, prevMonth - 1, 1, 12, 0, 0));
  const prevLastDay = new Date(Date.UTC(prevYear, prevMonth, 0, 12, 0, 0));
  const prevStart = getStartOfDay(prevFirstDay, 'Asia/Kolkata');
  const prevEnd = getEndOfDay(prevLastDay, 'Asia/Kolkata');

  const prevTransactions = await Transaction.find({
    userId,
    status: TransactionStatus.COMPLETED,
    type: { $in: [TransactionType.EXPENSE, TransactionType.CREDIT_CARD_REFUND] },
    date: { $gte: prevStart, $lte: prevEnd },
  });

  const prevExpenseIds = prevTransactions
    .filter((ptx) => ptx.type === TransactionType.EXPENSE)
    .map((ptx) => ptx._id);

  const prevLinkedRefunds = await Transaction.find({
    userId,
    originalExpenseId: { $in: prevExpenseIds },
    status: { $ne: TransactionStatus.CANCELLED },
  });

  const prevRefundMap = new Map<string, number>();
  for (const r of prevLinkedRefunds) {
    if (r.originalExpenseId) {
      const key = r.originalExpenseId.toString();
      prevRefundMap.set(key, (prevRefundMap.get(key) || 0) + toCents(r.amount));
    }
  }

  let prevGrossCents = 0;
  let prevTotalRefundCents = 0;
  for (const ptx of prevTransactions) {
    if (ptx.type === TransactionType.EXPENSE) {
      const amtCents = toCents(ptx.amount);
      const refCents = prevRefundMap.get(ptx._id.toString()) || 0;
      prevGrossCents += amtCents;
      prevTotalRefundCents += refCents;
    } else if (ptx.type === TransactionType.CREDIT_CARD_REFUND && !ptx.originalExpenseId) {
      prevTotalRefundCents += toCents(ptx.amount);
    }
  }

  const prevTotal = fromCents(Math.max(0, prevGrossCents - prevTotalRefundCents));
  const changeAmount = safeSubtract(totalExpenses, prevTotal);
  const changePercentage =
    prevTotal > 0 ? Math.round(((totalExpenses - prevTotal) / prevTotal) * 100) : null;

  return {
    month: targetMonth,
    monthLabel,
    totalExpenses, // Net expenses for backward compatibility
    grossExpenses,
    linkedRefunds,
    unlinkedRefunds,
    netExpenses,
    transactionCount,
    highestCategory,
    averageDailySpend,
    daysInMonth,
    categoryBreakdown,
    dailySpendingTrend,
    largestExpenses,
    allTransactions: formattedTransactions,
    previousMonthComparison: {
      previousMonth: prevMonthKey,
      previousTotal: prevTotal,
      changeAmount,
      changePercentage,
    },
  };
}

/**
 * Retrieves all available income categories (seeded default categories + custom user income categories)
 * alongside user's current selection.
 */
export async function getAvailableIncomeCategories(userId: mongoose.Types.ObjectId) {
  const user = await User.findById(userId);
  const configuredCategories =
    user?.preferences?.incomeCategories && user.preferences.incomeCategories.length > 0
      ? user.preferences.incomeCategories
      : ['Salary', 'Freelance income'];

  const configuredSet = new Set(configuredCategories.map((c) => c.trim().toLowerCase()));

  // Fetch custom categories created by this user with type 'income'
  const customCategories = await Category.find({
    userId,
    type: 'income',
  });

  const availableMap = new Map<string, { name: string; isCustom: boolean; isConfigured: boolean }>();

  // Add default income categories
  for (const def of DEFAULT_INCOME_CATEGORIES) {
    availableMap.set(def.name.toLowerCase(), {
      name: def.name,
      isCustom: false,
      isConfigured: configuredSet.has(def.name.toLowerCase()),
    });
  }

  // Add custom income categories
  for (const cust of customCategories) {
    availableMap.set(cust.name.toLowerCase(), {
      name: cust.name,
      isCustom: true,
      isConfigured: configuredSet.has(cust.name.toLowerCase()),
    });
  }

  return {
    configuredCategories,
    categories: Array.from(availableMap.values()),
  };
}

/**
 * Updates user's configured income categories.
 */
export async function updateConfiguredIncomeCategories(
  userId: mongoose.Types.ObjectId,
  categories: string[]
) {
  const cleanCategories = Array.from(
    new Set(categories.map((c) => c.trim()).filter((c) => c.length > 0))
  );

  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  if (!user.preferences) {
    user.preferences = {
      theme: 'light',
      dateFormat: 'YYYY-MM-DD',
      notifyDueDates: true,
      notifyBudgetAlerts: true,
      incomeCategories: cleanCategories,
    };
  } else {
    user.preferences.incomeCategories = cleanCategories;
  }

  await user.save();
  return cleanCategories;
}
