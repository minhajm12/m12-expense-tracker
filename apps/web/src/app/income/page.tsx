'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { MonthYearPicker } from '@/components/ui/month-year-picker';
import {
  TrendingUp,
  TrendingDown,
  Receipt,
  Calendar,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Layers,
  PieChart as PieChartIcon,
  X,
  Sliders,
  Check,
  Coins,
  Briefcase,
} from 'lucide-react';
import { formatCurrency, MonthlyIncomeReportData } from '@finora/shared';
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

const INCOME_CHART_COLORS = [
  '#05A100',
  '#06BF00',
  '#048000',
  '#14D90D',
  '#036600',
  '#2EF527',
  '#024D00',
  '#10B981',
];

interface IncomeTxItem {
  id: string;
  title: string;
  amount: number;
  date: string;
  category: string;
  paymentMethod: string;
  accountName?: string;
  merchantOrRecipient?: string;
  notes?: string;
  isPastRecorded?: boolean;
}

interface CategoryOption {
  name: string;
  isCustom: boolean;
  isConfigured: boolean;
}

export default function IncomePage() {
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
  const [data, setData] = useState<MonthlyIncomeReportData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [viewingTransaction, setViewingTransaction] = useState<IncomeTxItem | null>(null);

  // Active Income Categories configuration modal state
  const [showCategoriesModal, setShowCategoriesModal] = useState<boolean>(false);
  const [availableCategories, setAvailableCategories] = useState<CategoryOption[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [savingCategories, setSavingCategories] = useState<boolean>(false);
  const [loadingCategories, setLoadingCategories] = useState<boolean>(false);

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

  const fetchIncomeReport = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${getApiUrl()}/api/v1/reports/income-summary?month=${selectedMonth}`);
      if (!res.ok) {
        throw new Error('Failed to load income report');
      }
      const json = await res.json();
      if (json.success && json.data) {
        setData(json.data);
      }
    } catch (err: any) {
      toast.error(err.message || 'Error fetching income report');
    } finally {
      setLoading(false);
    }
  };

  // Open Active Income Categories configuration modal
  const openCategoriesModal = async () => {
    setShowCategoriesModal(true);
    setLoadingCategories(true);
    try {
      const res = await authFetch(`${getApiUrl()}/api/v1/reports/income-categories`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setAvailableCategories(json.data.categories || []);
          setSelectedCategories(
            new Set((json.data.configuredCategories || []).map((c: string) => c.trim().toLowerCase()))
          );
        }
      }
    } catch {
      toast.error('Failed to load active income categories');
    } finally {
      setLoadingCategories(false);
    }
  };

  const handleToggleCategory = (catName: string) => {
    const key = catName.trim().toLowerCase();
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleSaveCategories = async () => {
    setSavingCategories(true);
    try {
      // Find original category casing from availableCategories or selected set
      const chosenNames = availableCategories
        .filter((c) => selectedCategories.has(c.name.trim().toLowerCase()))
        .map((c) => c.name);

      const res = await authFetch(`${getApiUrl()}/api/v1/reports/income-categories`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: chosenNames }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Active income categories updated');
        setShowCategoriesModal(false);
        // Recalculate and update the Monthly Income summary card immediately!
        await fetchIncomeReport();
      } else {
        toast.error(json.error?.message || 'Failed to update active categories');
      }
    } catch {
      toast.error('Network error saving active income categories');
    } finally {
      setSavingCategories(false);
    }
  };

  useEffect(() => {
    fetchIncomeReport();
  }, [selectedMonth]);

  useDataSync(fetchIncomeReport, ['transactions', 'accounts']);

  // Filtered transactions if a category is selected
  const displayedTransactions: IncomeTxItem[] = useMemo(() => {
    if (!data?.allTransactions) return [];
    if (!selectedCategory) return data.allTransactions as IncomeTxItem[];
    return (data.allTransactions as IncomeTxItem[]).filter((tx) => tx.category === selectedCategory);
  }, [data, selectedCategory]);

  return (
    <div className="space-y-6">
      {/* Page Header with Month Navigation and Category Config Trigger */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-[#05A100] dark:text-[#05A100]" />
            Income Report
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Analyse earnings, salary allocations, and income trends for {data?.monthLabel || selectedMonth}
          </p>
        </div>

        {/* Month Selector & Controls */}
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
            size="sm"
            onClick={openCategoriesModal}
            className="h-9 gap-1.5 text-xs font-semibold border-[#05A100] text-[#05A100] dark:text-[#05A100] hover:border-[#05A100]"
            title="Configure Active Income Categories"
          >
            <Sliders className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Active Categories</span>
            <span className="sm:hidden">Categories</span>
            {data?.configuredCategories && (
              <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-[10px] border-[#05A100] text-[#05A100] dark:text-[#05A100]">
                {data.configuredCategories.length}
              </Badge>
            )}
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={fetchIncomeReport}
            className="h-9 w-9"
            title="Refresh"
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* KPI Overview Cards (5 responsive cards: Total Incoming, Monthly Income, Income Count, Top Source, Daily Average) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {/* 1. Total Incoming (all eligible incoming cash flow recorded) */}
        <Card className="shadow-sm border-border bg-card min-w-0">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Total Incoming
            </CardTitle>
            <div className="h-8 w-8 rounded-lg bg-foreground/10 text-foreground flex items-center justify-center font-bold">
              <Receipt className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-28 mb-1" />
            ) : (
              <div className="space-y-1">
                <div className="text-2xl font-bold tracking-tight text-foreground font-mono truncate">
                  {formatCurrency(data?.allIncomeTotal || 0)}
                </div>
                <p className="text-[11px] text-muted-foreground">All cash inflows this month</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 2. Monthly Income (Authoritative Active Income Categories Total) */}
        <Card className="shadow-sm border-[#05A100]/40 bg-[#05A100]/[0.04] min-w-0 ring-1 ring-[#05A100]/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <div className="flex items-center gap-1.5">
              <CardTitle className="text-xs font-bold text-emerald-700 dark:text-[#05A100] uppercase tracking-wider">
                Monthly Income
              </CardTitle>
              <Badge variant="outline" className="text-[9px] px-1 py-0 border-[#05A100]/40 text-[#05A100] dark:text-[#05A100] font-semibold">
                Active
              </Badge>
            </div>
            <div className="h-8 w-8 rounded-lg border-[#05A100] text-[#05A100] dark:text-[#05A100] flex items-center justify-center font-bold">
              ₹
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-32 mb-1" />
            ) : (
              <div className="space-y-1">
                <div className="text-2xl font-black tracking-tight text-[#05A100] dark:text-[#05A100] font-mono truncate">
                  {formatCurrency(data?.totalMonthlyIncome || 0)}
                </div>
                <div className="flex items-center justify-between text-[11px] pt-0.5">
                  <span className="text-muted-foreground truncate">
                    {data?.configuredCategories?.length || 0} active categories
                  </span>
                  <button
                    type="button"
                    onClick={openCategoriesModal}
                    className="text-[#05A100] dark:text-[#05A100] hover:underline font-semibold inline-flex items-center gap-0.5 shrink-0 ml-1"
                  >
                    Edit
                  </button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 3. Income Transactions Count */}
        <Card className="shadow-sm border-border bg-card min-w-0">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Income Count
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
                  {data?.transactionCount || data?.qualifyingTransactionCount || 0}
                </div>
                <p className="text-[11px] text-muted-foreground">Inflows this month</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 4. Highest Income Category / Source */}
        <Card className="shadow-sm border-border bg-card min-w-0">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Top Source
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
                  {data?.highestCategory ? formatCurrency(data.highestCategory.amount) : 'No income recorded'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 5. Average Daily Income (Monthly Income ÷ Days) */}
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
                  {formatCurrency(data?.averageDailyIncome || 0)}
                </div>
                <p className="text-[11px] text-muted-foreground">Monthly Income ÷ {data?.daysInMonth || 30} days</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Visual Charts Section (Green color family) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Income Breakdown by Source (Donut Chart) */}
        <Card className="shadow-sm border-border bg-card min-w-0 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
              <PieChartIcon className="h-4 w-4 text-[#05A100] dark:text-[#05A100]" />
              Income Breakdown
            </CardTitle>
            <CardDescription className="text-xs">
              Distribution across income sources for {data?.monthLabel}
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0">
            {loading ? (
              <Skeleton className="h-[280px] w-full" />
            ) : !data?.categoryBreakdown || data.categoryBreakdown.length === 0 ? (
              <div className="h-[280px] flex flex-col items-center justify-center text-muted-foreground text-xs">
                <PieChartIcon className="h-8 w-8 mb-2 opacity-30 text-[#05A100]" />
                No income recorded for this month
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
                      {data.categoryBreakdown.map((_: any, index: number) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={INCOME_CHART_COLORS[index % INCOME_CHART_COLORS.length]}
                          stroke="hsl(var(--background))"
                          strokeWidth={2}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val: number) => [formatCurrency(val), 'Received']}
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

        {/* Daily Income Trend (Bar Chart with Emerald Fill) */}
        <Card className="shadow-sm border-border bg-card min-w-0 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
              <Calendar className="h-4 w-4 text-[#05A100] dark:text-[#05A100]" />
              Daily Income Trend
            </CardTitle>
            <CardDescription className="text-xs">
              Inflow timeline across {data?.monthLabel}
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0">
            {loading ? (
              <Skeleton className="h-[280px] w-full" />
            ) : !data?.dailyIncomeTrend || data.dailyIncomeTrend.length === 0 ? (
              <div className="h-[280px] flex flex-col items-center justify-center text-muted-foreground text-xs">
                <Calendar className="h-8 w-8 mb-2 opacity-30 text-[#05A100]" />
                No daily income data available
              </div>
            ) : (
              <div className="h-[280px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.dailyIncomeTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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
                      formatter={(val: number) => [formatCurrency(val), 'Received']}
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
                    <Bar dataKey="amount" fill="#05A100" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Income Source Details Breakdown */}
      <Card className="shadow-sm border-border bg-card min-w-0">
        <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold text-foreground">Income Categories & Sources</CardTitle>
            <CardDescription className="text-xs">
              Click a source to filter transactions. Categories marked Active contribute to Monthly Income.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={openCategoriesModal}
              className="text-xs gap-1.5 h-8 border-[#05A100]/30 text-[#05A100] dark:text-[#05A100] hover:border-[#05A100]"
            >
              <Sliders className="h-3.5 w-3.5" /> Configure Active Categories
            </Button>
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
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !data?.categoryBreakdown || data.categoryBreakdown.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">
              No income categories recorded for this month
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {data.categoryBreakdown.map((cat: any, idx: number) => {
                const isSelected = selectedCategory === cat.category;
                const isConfigured = Boolean(cat.isConfigured);
                return (
                  <div
                    key={cat.category}
                    onClick={() =>
                      setSelectedCategory(isSelected ? null : cat.category)
                    }
                    className={`p-3 rounded-lg border transition-all cursor-pointer flex flex-col justify-between gap-2 min-w-0 ${isSelected
                      ? 'border-[#05A100]/50 bg-[#05A100]/5 ring-1 ring-[#05A100]'
                      : 'border-border bg-muted/20 hover:bg-muted/40'
                      }`}
                  >
                    <div className="flex items-center justify-between text-xs gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{
                            backgroundColor: INCOME_CHART_COLORS[idx % INCOME_CHART_COLORS.length],
                          }}
                        />
                        <span className="font-semibold text-foreground truncate">{cat.category}</span>
                        {isConfigured ? (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-[#05A100] border-[#05A100]/30 text-[#05A100] dark:text-[#05A100] shrink-0 font-medium">
                            Active Income
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground shrink-0">
                            Other Inflow
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                          {cat.transactionCount} txn{cat.transactionCount !== 1 ? 's' : ''}
                        </Badge>
                      </div>
                      <span className="font-mono font-bold text-foreground shrink-0">
                        {formatCurrency(cat.amount)}
                      </span>
                    </div>

                    {/* Progress Bar of Income Share (Green palette) */}
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-full bg-[#05A100]/15 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-600 dark:bg-[#05A100] rounded-full transition-all duration-300"
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

      {/* Income Transactions List */}
      <Card className="shadow-sm border-border bg-card min-w-0">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold text-foreground">
              {selectedCategory ? `${selectedCategory} Inflows` : 'All Income Transactions'}
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
            </div>
          ) : displayedTransactions.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              No income transactions found for this period
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
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border-[#05A100] text-[#05A100] dark:text-[#05A100] shrink-0">
                      <TrendingUp className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground truncate">{tx.title}</span>
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal">
                          {tx.category}
                        </Badge>
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
                    <span className="font-mono font-bold text-[#05A100] dark:text-[#05A100] block text-sm">
                      +{formatCurrency(tx.amount)}
                    </span>
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

      {/* Active Income Categories Configuration Dialog */}
      <Dialog open={showCategoriesModal} onOpenChange={setShowCategoriesModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <Sliders className="h-4 w-4 text-emerald-500 dark:text-emerald-500" />
              Configure Active Income Categories
            </DialogTitle>
            <DialogDescription className="text-xs">
              Select which categories contribute to your authoritative <strong>Monthly Income</strong> metric. Inflows in other categories remain tracked under Total Incoming.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {loadingCategories ? (
              <div className="space-y-2 py-4">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : availableCategories.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No income categories found.
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {availableCategories.map((cat) => {
                  const isChecked = selectedCategories.has(cat.name.trim().toLowerCase());
                  return (
                    <div
                      key={cat.name}
                      onClick={() => handleToggleCategory(cat.name)}
                      className={`flex items-center justify-between p-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${isChecked
                        ? 'border-emerald-500/50 border-emerald-500 text-foreground font-medium'
                        : 'border-border bg-card hover:bg-muted/30 text-muted-foreground'
                        }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${isChecked
                            ? 'bg-emerald-600 border-emerald-600 text-white'
                            : 'border-muted-foreground/40 bg-background'
                            }`}
                        >
                          {isChecked && <Check className="h-3 w-3" />}
                        </div>
                        <span>{cat.name}</span>
                        {cat.isCustom && (
                          <Badge variant="outline" className="text-[9px] py-0 px-1">
                            Custom
                          </Badge>
                        )}
                      </div>
                      {isChecked && (
                        <span className="text-[11px] font-semibold text-emerald-500 dark:text-emerald-500">
                          Active
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="p-3 rounded-lg bg-muted/40 border border-border text-[11px] text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground">Rule Definition:</p>
              <p>
                <strong>Monthly Income</strong> sums income from the selected active categories.
                <br />
                <strong>Total Incoming</strong> continues to reflect all valid incoming cash flow.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCategoriesModal(false)}
                disabled={savingCategories}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveCategories}
                disabled={savingCategories || loadingCategories}
                className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1.5"
              >
                {savingCategories ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Saving...
                  </>
                ) : (
                  'Save Configuration'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Transaction Detail Dialog */}
      <Dialog
        open={Boolean(viewingTransaction)}
        onOpenChange={(open) => !open && setViewingTransaction(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Income Transaction Detail</DialogTitle>
            <DialogDescription className="text-xs">
              Complete metadata for this income entry
            </DialogDescription>
          </DialogHeader>

          {viewingTransaction && (
            <div className="space-y-3.5 py-2 text-xs">
              <div className="p-3 rounded-lg bg-muted/40 border border-border flex items-center justify-between">
                <div>
                  <span className="text-muted-foreground block text-[11px]">Amount</span>
                  <span className="font-mono text-xl font-bold text-[#05A100] dark:text-[#05A100]">
                    +{formatCurrency(viewingTransaction.amount)}
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
                  <span className="text-[11px] text-muted-foreground block">Title / Source</span>
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
                  <span className="text-[11px] text-muted-foreground block">Destination Account</span>
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
                  <span className="text-[11px] text-muted-foreground block">Payer / Employer</span>
                  <span className="font-medium text-foreground">{viewingTransaction.merchantOrRecipient}</span>
                </div>
              )}

              {viewingTransaction.notes && (
                <div className="p-2.5 rounded-lg border border-border bg-card">
                  <span className="text-[11px] text-muted-foreground block">Notes</span>
                  <span className="font-medium text-foreground">{viewingTransaction.notes}</span>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
