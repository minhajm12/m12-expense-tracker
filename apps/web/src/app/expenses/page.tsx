'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { MonthYearPicker } from '@/components/ui/month-year-picker';
import {
  TrendingDown,
  TrendingUp,
  Receipt,
  Calendar,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Layers,
  ArrowDownLeft,
  DollarSign,
  PieChart as PieChartIcon,
  Tag,
  CreditCard,
  Building2,
  ExternalLink,
  X,
  RotateCcw,
} from 'lucide-react';
import {
  formatCurrency,
  MonthlyExpensesReportData,
  MonthlyExpenseTransaction,
  MonthlyExpenseCategoryBreakdown,
} from '@finora/shared';
import { authFetch, getApiUrl } from '@/lib/api-client';
import { useDataSync } from '@/lib/data-sync';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  PieChart,
  Pie,
} from 'recharts';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const EXPENSE_CHART_COLORS = [
  '#CC0000',
  '#E60000',
  '#B30000',
  '#FF1A1A',
  '#990000',
  '#FF3333',
  '#800000',
  '#E62E2E',
];

export default function ExpensesPage() {
  const getCurrentMonthKey = () => {
    const d = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
    });
    return formatter.format(d);
  };

  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonthKey());
  const [data, setData] = useState<MonthlyExpensesReportData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [viewingTransaction, setViewingTransaction] = useState<MonthlyExpenseTransaction | null>(null);

  // Month navigation helpers
  const handlePrevMonth = () => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const prevDate = new Date(y, m - 2, 1);
    const prevY = prevDate.getFullYear();
    const prevM = String(prevDate.getMonth() + 1).padStart(2, '0');
    setSelectedMonth(`${prevY}-${prevM}`);
  };

  const handleNextMonth = () => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const nextDate = new Date(y, m, 1);
    const nextY = nextDate.getFullYear();
    const nextM = String(nextDate.getMonth() + 1).padStart(2, '0');
    setSelectedMonth(`${nextY}-${nextM}`);
  };

  const handleCurrentMonth = () => {
    setSelectedMonth(getCurrentMonthKey());
  };

  const fetchExpensesReport = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${getApiUrl()}/api/v1/reports/expenses-summary?month=${selectedMonth}`);
      if (!res.ok) {
        throw new Error('Failed to load expense report');
      }
      const json = await res.json();
      if (json.success && json.data) {
        setData(json.data);
      }
    } catch (err: any) {
      toast.error(err.message || 'Error fetching expense report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExpensesReport();
  }, [selectedMonth]);

  useDataSync(fetchExpensesReport, ['transactions', 'accounts', 'credit-cards']);

  // Filtered transactions if a category is selected
  const displayedTransactions = useMemo(() => {
    if (!data?.allTransactions) return [];
    if (!selectedCategory) return data.allTransactions;
    return data.allTransactions.filter((tx) => tx.category === selectedCategory);
  }, [data, selectedCategory]);

  return (
    <div className="space-y-6">
      {/* Page Header with Month Navigation */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <TrendingDown className="h-6 w-6 text-foreground" />
            Expenses Report
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Analyse spending breakdown, daily trends, and category distribution for {data?.monthLabel || selectedMonth}
          </p>
        </div>

        {/* Month Selector Controls */}
        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          <Button
            variant="outline"
            size="icon"
            onClick={handlePrevMonth}
            className="h-9 w-9"
            title="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <MonthYearPicker
            value={selectedMonth}
            onChange={(m) => setSelectedMonth(m)}
            className="w-[150px]"
          />

          <Button
            variant="outline"
            size="icon"
            onClick={handleNextMonth}
            className="h-9 w-9"
            title="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          {selectedMonth !== getCurrentMonthKey() && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCurrentMonth}
              className="text-xs text-muted-foreground h-9"
            >
              Current Month
            </Button>
          )}

          <Button
            variant="outline"
            size="icon"
            onClick={fetchExpensesReport}
            className="h-9 w-9"
            title="Refresh"
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Expenses */}
        <Card className="shadow-sm border-border bg-card min-w-0">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Total Expenses
            </CardTitle>
            <div className="h-8 w-8 rounded-lg bg-[#CC0000]/10 text-rose-600 dark:text-[#CC0000] flex items-center justify-center font-bold">
              ₹
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-32 mb-1" />
            ) : (
              <div className="space-y-1">
                <div className="text-2xl font-bold tracking-tight text-foreground font-mono truncate">
                  {formatCurrency(data?.totalExpenses || 0)}
                </div>
                {Boolean(data?.linkedRefunds && data.linkedRefunds > 0) && (
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                    <span>Gross: {formatCurrency(data?.grossExpenses || 0)}</span>
                    <span>•</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                      Refunds: -{formatCurrency(data?.linkedRefunds || 0)}
                    </span>
                  </div>
                )}
                {data?.previousMonthComparison?.changePercentage !== null &&
                  data?.previousMonthComparison?.changePercentage !== undefined && (
                    <div className="flex items-center gap-1.5 text-xs">
                      {data.previousMonthComparison.changePercentage > 0 ? (
                        <span className="text-rose-600 dark:text-[#CC0000] font-medium flex items-center">
                          <TrendingUp className="h-3.5 w-3.5 mr-0.5 inline" />
                          +{data.previousMonthComparison.changePercentage}%
                        </span>
                      ) : (
                        <span className="text-emerald-600 font-medium flex items-center">
                          <TrendingDown className="h-3.5 w-3.5 mr-0.5 inline" />
                          {data.previousMonthComparison.changePercentage}%
                        </span>
                      )}
                      <span className="text-muted-foreground text-[11px]">vs last month</span>
                    </div>
                  )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Transaction Count */}
        <Card className="shadow-sm border-border bg-card min-w-0">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Expense Count
            </CardTitle>
            <div className="h-8 w-8 rounded-lg bg-foreground/10 text-foreground flex items-center justify-center">
              <Receipt className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-20 mb-1" />
            ) : (
              <div className="space-y-1">
                <div className="text-2xl font-bold tracking-tight text-foreground font-mono">
                  {data?.transactionCount || 0}
                </div>
                <p className="text-[11px] text-muted-foreground">Recorded this month</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Highest Expense Category */}
        <Card className="shadow-sm border-border bg-card min-w-0">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Top Category
            </CardTitle>
            <div className="h-8 w-8 rounded-lg bg-foreground/10 text-foreground flex items-center justify-center">
              <Layers className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-28 mb-1" />
            ) : (
              <div className="space-y-1">
                <div className="text-lg font-bold tracking-tight text-foreground truncate">
                  {data?.highestCategory ? data.highestCategory.name : '—'}
                </div>
                <p className="text-[11px] text-muted-foreground font-mono truncate">
                  {data?.highestCategory ? formatCurrency(data.highestCategory.amount) : 'No expenses recorded'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Average Daily Spending */}
        <Card className="shadow-sm border-border bg-card min-w-0">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Daily Average
            </CardTitle>
            <div className="h-8 w-8 rounded-lg bg-foreground/10 text-foreground flex items-center justify-center">
              <Calendar className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24 mb-1" />
            ) : (
              <div className="space-y-1">
                <div className="text-2xl font-bold tracking-tight text-foreground font-mono truncate">
                  {formatCurrency(data?.averageDailySpend || 0)}
                </div>
                <p className="text-[11px] text-muted-foreground">Across {data?.daysInMonth || 30} days</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Visual Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Spending Breakdown (Donut Chart) */}
        <Card className="shadow-sm border-border bg-card min-w-0 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
              <PieChartIcon className="h-4 w-4 text-rose-600 dark:text-[#CC0000]" />
              Category Breakdown
            </CardTitle>
            <CardDescription className="text-xs">
              Spending distribution across categories for {data?.monthLabel}
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0">
            {loading ? (
              <Skeleton className="h-[280px] w-full" />
            ) : !data?.categoryBreakdown || data.categoryBreakdown.length === 0 ? (
              <div className="h-[280px] flex flex-col items-center justify-center text-muted-foreground text-xs">
                <PieChartIcon className="h-8 w-8 mb-2 opacity-30 text-rose-500" />
                No expenses recorded for this month
              </div>
            ) : (
              <div className="h-[280px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.categoryBreakdown}
                      dataKey="amount"
                      nameKey="category"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={95}
                      paddingAngle={2}
                    >
                      {data.categoryBreakdown.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={EXPENSE_CHART_COLORS[index % EXPENSE_CHART_COLORS.length]}
                          stroke="hsl(var(--background))"
                          strokeWidth={2}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val: number) => [formatCurrency(val), 'Spent']}
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        borderColor: 'hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: '12px',
                        color: 'hsl(var(--card-foreground))',
                      }}
                      itemStyle={{ color: 'hsl(var(--card-foreground))' }}
                      labelStyle={{ color: 'hsl(var(--card-foreground))' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Daily Spending Trend (Bar Chart) */}
        <Card className="shadow-sm border-border bg-card min-w-0 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
              <Calendar className="h-4 w-4 text-rose-600 dark:text-[#CC0000]" />
              Daily Spending Trend
            </CardTitle>
            <CardDescription className="text-xs">
              Day-by-day spending pattern throughout {data?.monthLabel}
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0">
            {loading ? (
              <Skeleton className="h-[280px] w-full" />
            ) : !data?.dailySpendingTrend || data.dailySpendingTrend.length === 0 ? (
              <div className="h-[280px] flex flex-col items-center justify-center text-muted-foreground text-xs">
                <Calendar className="h-8 w-8 mb-2 opacity-30 text-rose-500" />
                No daily spending data available
              </div>
            ) : (
              <div className="h-[280px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.dailySpendingTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.2} />
                    <XAxis
                      dataKey="day"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => (v >= 1000 ? `₹${v / 1000}k` : `₹${v}`)}
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    />
                    <Tooltip
                      formatter={(val: number) => [formatCurrency(val), 'Spent']}
                      labelFormatter={(label) => `Day ${label}`}
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        borderColor: 'hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: '12px',
                        color: 'hsl(var(--card-foreground))',
                      }}
                      itemStyle={{ color: 'hsl(var(--card-foreground))' }}
                      labelStyle={{ color: 'hsl(var(--card-foreground))' }}
                    />
                    <Bar dataKey="amount" fill="#CC0000" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Category Breakdown & Details */}
      <Card className="shadow-sm border-border bg-card min-w-0">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold text-foreground">Category Details</CardTitle>
            <CardDescription className="text-xs">
              Click a category to filter the transaction list below
            </CardDescription>
          </div>
          {selectedCategory && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedCategory(null)}
              className="text-xs gap-1.5 h-8"
            >
              <X className="h-3.5 w-3.5" /> Clear Filter ({selectedCategory})
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !data?.categoryBreakdown || data.categoryBreakdown.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">
              No categories recorded for this month
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {data.categoryBreakdown.map((cat, idx) => {
                const isSelected = selectedCategory === cat.category;
                return (
                  <div
                    key={cat.category}
                    onClick={() =>
                      setSelectedCategory(isSelected ? null : cat.category)
                    }
                    className={`p-3 rounded-lg border transition-all cursor-pointer flex flex-col justify-between gap-2 min-w-0 ${isSelected
                      ? 'border-rose-500 bg-[#CC0000]/5 ring-1 ring-rose-500'
                      : 'border-border bg-muted/20 hover:bg-muted/40'
                      }`}
                  >
                    <div className="flex items-center justify-between text-xs gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{
                            backgroundColor: EXPENSE_CHART_COLORS[idx % EXPENSE_CHART_COLORS.length],
                          }}
                        />
                        <span className="font-semibold text-foreground truncate">{cat.category}</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                          {cat.transactionCount} txn{cat.transactionCount !== 1 ? 's' : ''}
                        </Badge>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-mono font-bold text-foreground block">
                          {formatCurrency(cat.amount)}
                        </span>
                        {Boolean(cat.refundAmount && cat.refundAmount > 0) && (
                          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium block">
                            Gross: {formatCurrency(cat.grossAmount || (cat.amount + (cat.refundAmount || 0)))} • Ref: -{formatCurrency(cat.refundAmount || 0)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Progress Bar of Category Share (Red palette) */}
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-full bg-[#CC0000]/15 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-rose-600 dark:bg-[#CC0000] rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, Math.max(1, cat.percentage))}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-mono text-muted-foreground shrink-0 w-8 text-right">
                        {cat.percentage}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Expense Transactions List */}
      <Card className="shadow-sm border-border bg-card min-w-0">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold text-foreground">
              {selectedCategory ? `${selectedCategory} Transactions` : 'All Expense Transactions'}
            </CardTitle>
            <CardDescription className="text-xs">
              Showing {displayedTransactions.length} transaction{displayedTransactions.length !== 1 ? 's' : ''} for {data?.monthLabel}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : displayedTransactions.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              No expense transactions found for this period
            </div>
          ) : (
            <div className="space-y-2">
              {displayedTransactions.map((tx) => (
                <div
                  key={tx.id}
                  onClick={() => setViewingTransaction(tx)}
                  className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors cursor-pointer text-xs gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#CC0000]/10 text-rose-600 dark:text-[#CC0000] shrink-0">
                      <TrendingDown className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground truncate">{tx.title}</span>
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal">
                          {tx.category}
                        </Badge>
                        {Boolean(tx.refundAmount && tx.refundAmount > 0) && (
                          <Badge
                            variant="outline"
                            className="text-[10px] py-0 px-1.5 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 font-normal"
                          >
                            ₹{(tx.refundAmount || 0).toLocaleString()} refunded
                          </Badge>
                        )}
                        {tx.isPastRecorded && (
                          <Badge
                            variant="outline"
                            className="text-[10px] py-0 px-1.5 border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10 font-normal"
                          >
                            Past-Recorded
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5 flex-wrap">
                        <span>
                          {new Date(tx.date).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                        {tx.accountName && (
                          <span>• {tx.accountName}</span>
                        )}
                        {tx.merchantOrRecipient && (
                          <span className="truncate">• {tx.merchantOrRecipient}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="font-mono font-bold text-rose-600 dark:text-[#CC0000] block text-sm">
                      -{formatCurrency(tx.refundAmount && tx.refundAmount > 0 ? (tx.netAmount ?? (tx.amount - tx.refundAmount)) : tx.amount)}
                    </span>
                    {Boolean(tx.refundAmount && tx.refundAmount > 0) && (
                      <span className="text-[10px] text-muted-foreground line-through block">
                        Gross: {formatCurrency(tx.grossAmount || tx.amount)}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground uppercase">
                      {tx.paymentMethod?.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transaction Detail Dialog */}
      <Dialog
        open={Boolean(viewingTransaction)}
        onOpenChange={(open) => !open && setViewingTransaction(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Expense Transaction Detail</DialogTitle>
            <DialogDescription className="text-xs">
              Complete metadata for this expense entry
            </DialogDescription>
          </DialogHeader>

          {viewingTransaction && (
            <div className="space-y-3.5 py-2 text-xs">
              <div className="p-3 rounded-lg bg-muted/40 border border-border flex items-center justify-between">
                <div>
                  <span className="text-muted-foreground block text-[11px]">Amount</span>
                  <span className="font-mono text-xl font-bold text-rose-600 dark:text-[#CC0000]">
                    -{formatCurrency(viewingTransaction.amount)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant="outline" className="text-xs">
                    {viewingTransaction.category}
                  </Badge>
                  {viewingTransaction.isPastRecorded && (
                    <Badge
                      variant="outline"
                      className="text-[10px] py-0 px-1.5 border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10 font-normal"
                    >
                      Past-Recorded
                    </Badge>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-2.5 rounded-lg border border-border bg-card">
                  <span className="text-[11px] text-muted-foreground block">Title</span>
                  <span className="font-medium text-foreground">{viewingTransaction.title}</span>
                </div>
                <div className="p-2.5 rounded-lg border border-border bg-card">
                  <span className="text-[11px] text-muted-foreground block">Date</span>
                  <span className="font-medium text-foreground">
                    {new Date(viewingTransaction.date).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg border border-border bg-card">
                  <span className="text-[11px] text-muted-foreground block">Account / Source</span>
                  <span className="font-medium text-foreground">
                    {viewingTransaction.accountName || viewingTransaction.paymentMethod || '—'}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg border border-border bg-card">
                  <span className="text-[11px] text-muted-foreground block">Payment Method</span>
                  <span className="font-medium text-foreground capitalize">
                    {viewingTransaction.paymentMethod?.replace('_', ' ') || '—'}
                  </span>
                </div>
              </div>

              {viewingTransaction.merchantOrRecipient && (
                <div className="p-2.5 rounded-lg border border-border bg-card">
                  <span className="text-[11px] text-muted-foreground block">Merchant / Recipient</span>
                  <span className="font-medium text-foreground">{viewingTransaction.merchantOrRecipient}</span>
                </div>
              )}

              {viewingTransaction.notes && (
                <div className="p-2.5 rounded-lg border border-border bg-card">
                  <span className="text-[11px] text-muted-foreground block">Notes</span>
                  <span className="font-medium text-foreground">{viewingTransaction.notes}</span>
                </div>
              )}

              {Boolean(viewingTransaction.refunds && viewingTransaction.refunds.length > 0) && (
                <div className="p-3 rounded-lg border border-border bg-muted/20 space-y-2">
                  <div className="flex items-center gap-1.5 font-semibold text-foreground">
                    <RotateCcw className="h-3.5 w-3.5 text-emerald-500" />
                    <span>Linked Refunds ({viewingTransaction.refunds?.length || 0})</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 py-1 border-y border-border/50 text-[11px] text-center">
                    <div>
                      <span className="text-muted-foreground block text-[10px]">Gross</span>
                      <span className="font-mono font-bold text-foreground">
                        {formatCurrency(viewingTransaction.grossAmount || viewingTransaction.amount)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[10px]">Refunded</span>
                      <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        -{formatCurrency(viewingTransaction.refundAmount || 0)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[10px]">Net</span>
                      <span className="font-mono font-bold text-[#CC0000]">
                        {formatCurrency(viewingTransaction.netAmount || 0)}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    {viewingTransaction.refunds?.map((r, i) => (
                      <div
                        key={r.id || i}
                        className="flex items-center justify-between p-2 rounded bg-background border border-border text-[11px]"
                      >
                        <div>
                          <p className="font-medium text-foreground">{r.title || 'Refund'}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {new Date(r.date).toLocaleDateString()} • {r.paymentMethod?.replace('_', ' ')}
                          </p>
                        </div>
                        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          +₹{r.amount.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
