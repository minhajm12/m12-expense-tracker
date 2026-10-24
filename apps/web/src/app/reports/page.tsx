'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  FileText,
  Download,
  Calendar,
  TrendingUp,
  TrendingDown,
  PieChart,
  RefreshCw,
  AlertTriangle,
  BellRing,
  ShieldCheck,
  CreditCard,
  CheckCircle,
  ExternalLink,
  Coins,
  Repeat,
  Landmark,
  Layers,
  Wallet,
  Sparkles,
  Filter,
} from 'lucide-react';
import {
  FinancialReportData,
  BankAccount,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INVESTMENT_CATEGORIES,
  formatCurrency,
  formatDateToInput,
} from '@finora/shared';
import { useDataSync } from '@/lib/data-sync';
import { MonthlyIncomeBreakdown } from '@/components/reports/monthly-income-breakdown';
import Link from 'next/link';

interface Reminder {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'danger';
  dueDate?: string;
  actionUrl: string;
}

export default function ReportsPage() {
  const { user } = useAuth();
  const [report, setReport] = useState<FinancialReportData | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [showForecast, setShowForecast] = useState(false);

  // Filters
  const now = new Date();
  const defaultStart = formatDateToInput(new Date(now.getFullYear(), now.getMonth(), 1));
  const defaultEnd = formatDateToInput(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [filterPreset, setFilterPreset] = useState<'this-month' | 'last-month' | 'ytd' | 'custom'>('this-month');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  const getApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const applyPreset = (preset: 'this-month' | 'last-month' | 'ytd' | 'custom') => {
    setFilterPreset(preset);
    const d = new Date();
    if (preset === 'this-month') {
      setStartDate(formatDateToInput(new Date(d.getFullYear(), d.getMonth(), 1)));
      setEndDate(formatDateToInput(new Date(d.getFullYear(), d.getMonth() + 1, 0)));
    } else if (preset === 'last-month') {
      const firstDayLastMonth = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const lastDayLastMonth = new Date(d.getFullYear(), d.getMonth(), 0);
      setStartDate(formatDateToInput(firstDayLastMonth));
      setEndDate(formatDateToInput(lastDayLastMonth));
    } else if (preset === 'ytd') {
      setStartDate(formatDateToInput(new Date(d.getFullYear(), 0, 1)));
      setEndDate(formatDateToInput(d));
    }
  };

  const fetchAccounts = async () => {
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/accounts`, { credentials: 'include' });
      const json = await res.json();
      if (res.ok && json.success) {
        setAccounts(json.data || []);
      }
    } catch {
      // silently handle account list fetch error
    }
  };

  const fetchReport = async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams({
        startDate,
        endDate,
        includeForecast: 'true',
      });
      if (selectedAccountId) queryParams.set('accountId', selectedAccountId);
      if (selectedCategory) queryParams.set('category', selectedCategory);

      const [repRes, remRes] = await Promise.all([
        fetch(`${getApiUrl()}/api/v1/reports?${queryParams.toString()}`, {
          credentials: 'include',
        }),
        fetch(`${getApiUrl()}/api/v1/reminders`, {
          credentials: 'include',
        }),
      ]);

      const [repJson, remJson] = await Promise.all([repRes.json(), remRes.json()]);

      if (repRes.ok && repJson.success) setReport(repJson.data);
      if (remRes.ok && remJson.success) setReminders(remJson.data || []);
    } catch {
      toast.error('Network error loading financial report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  useEffect(() => {
    fetchReport();
  }, [startDate, endDate, selectedAccountId, selectedCategory]);

  useDataSync(fetchReport, ['transactions']);

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const queryParams = new URLSearchParams({
        startDate,
        endDate,
      });
      if (selectedAccountId) queryParams.set('accountId', selectedAccountId);
      if (selectedCategory) queryParams.set('category', selectedCategory);

      const res = await fetch(
        `${getApiUrl()}/api/v1/reports/export-csv?${queryParams.toString()}`,
        {
          credentials: 'include',
        }
      );

      if (!res.ok) {
        throw new Error('Export failed');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `m12-personal-report-${startDate}-to-${endDate}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success('CSV export generated safely with formula protection');
    } catch {
      toast.error('Failed to export transactions CSV');
    } finally {
      setExporting(false);
    }
  };

  const getCategoryColor = (categoryName: string) => {
    const match = DEFAULT_EXPENSE_CATEGORIES.find(
      (c) => c.name.toLowerCase() === categoryName.toLowerCase()
    );
    return match?.color || '#10b981';
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <FileText className="h-8 w-8 text-[#05A100]" />
            Personal Financial Reports & Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Personal cash flow, genuine category expenditures, recurring & EMI breakdown, and spreadsheet-safe exports.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchReport} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          <Button
            size="sm"
            onClick={handleExportCsv}
            disabled={exporting}
            className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
          >
            <Download className={`h-4 w-4 mr-2 ${exporting ? 'animate-bounce' : ''}`} />
            {exporting ? 'Exporting...' : 'Export CSV (Safe)'}
          </Button>
        </div>
      </div>

      {/* Reminders & Proactive Alerts Panel */}
      {reminders.length > 0 && (
        <Card className="border-border bg-card/60 backdrop-blur-sm overflow-hidden">
          <CardHeader className="py-3 px-5 border-b border-border bg-muted/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-foreground font-semibold text-sm">
                <BellRing className="h-4 w-4 text-[#05A100]" />
                <span>Attention & Reminders ({reminders.length})</span>
              </div>
              <Badge variant="outline" className="text-[10px] uppercase font-bold">
                Live Status
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-4 space-y-2.5">
            {reminders.map((rem) => (
              <div
                key={rem.id}
                className={`flex items-center justify-between p-3 rounded-lg border text-xs ${
                  rem.severity === 'danger'
                    ? 'border-rose-500/30 bg-rose-500/10 text-rose-950 dark:text-rose-200'
                    : rem.severity === 'warning'
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-200'
                    : 'border-blue-500/30 bg-blue-500/10 text-blue-950 dark:text-blue-200'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <AlertTriangle
                    className={`h-4 w-4 shrink-0 mt-0.5 ${
                      rem.severity === 'danger'
                        ? 'text-rose-600'
                        : rem.severity === 'warning'
                        ? 'text-amber-600'
                        : 'text-blue-600'
                    }`}
                  />
                  <div>
                    <p className="font-bold">{rem.title}</p>
                    <p className="text-muted-foreground opacity-90 mt-0.5">{rem.message}</p>
                  </div>
                </div>

                <Link
                  href={rem.actionUrl}
                  className="flex items-center gap-1 font-semibold underline shrink-0 ml-4 hover:opacity-80"
                >
                  <span>Review</span>
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Prominent Monthly Income Breakdown Section (Phase 3) */}
      <MonthlyIncomeBreakdown />

      {/* Global Filters Toolbar */}
      <Card className="border-border bg-card/60 backdrop-blur-sm p-4">
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* Presets */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground mr-1">Period:</span>
              <Button
                variant={filterPreset === 'this-month' ? 'default' : 'outline'}
                size="sm"
                onClick={() => applyPreset('this-month')}
                className="text-xs h-8"
              >
                This Month
              </Button>
              <Button
                variant={filterPreset === 'last-month' ? 'default' : 'outline'}
                size="sm"
                onClick={() => applyPreset('last-month')}
                className="text-xs h-8"
              >
                Last Month
              </Button>
              <Button
                variant={filterPreset === 'ytd' ? 'default' : 'outline'}
                size="sm"
                onClick={() => applyPreset('ytd')}
                className="text-xs h-8"
              >
                Year to Date
              </Button>
            </div>

            {/* Date Pickers */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">From:</span>
                <DatePicker
                  value={startDate}
                  onChange={(d) => {
                    setStartDate(d);
                    setFilterPreset('custom');
                  }}
                  className="h-8 text-xs w-36"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">To:</span>
                <DatePicker
                  value={endDate}
                  onChange={(d) => {
                    setEndDate(d);
                    setFilterPreset('custom');
                  }}
                  className="h-8 text-xs w-36"
                />
              </div>
            </div>
          </div>

          {/* Account & Category Filter Line */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Account:</span>
                <Select
                  value={selectedAccountId || 'all'}
                  onValueChange={(val) => setSelectedAccountId(val === 'all' ? '' : val)}
                >
                  <SelectTrigger className="h-8 text-xs w-[140px]">
                    <SelectValue placeholder="All Accounts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Accounts</SelectItem>
                    {accounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.accountName} {acc.isChitFundAccount ? '(Chit Bank)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Category:</span>
                <Select
                  value={selectedCategory || 'all'}
                  onValueChange={(val) => setSelectedCategory(val === 'all' ? '' : val)}
                >
                  <SelectTrigger className="h-8 text-xs w-[150px]">
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {DEFAULT_EXPENSE_CATEGORIES.map((cat) => (
                      <SelectItem key={`exp-${cat.name}`} value={cat.name}>
                        {cat.name}
                      </SelectItem>
                    ))}
                    {DEFAULT_INVESTMENT_CATEGORIES.map((cat) => (
                      <SelectItem key={`inv-${cat.name}`} value={cat.name}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Forecast View Toggle */}
            <div className="flex items-center gap-2">
              <Button
                variant={showForecast ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowForecast(!showForecast)}
                className={`text-xs h-8 gap-1.5 ${showForecast ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : ''}`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>{showForecast ? 'Hide Projections' : 'Preview Month-End Forecast'}</span>
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Projection / Forecast Callout Banner */}
      {showForecast && report?.forecast && (
        <Card className="border-indigo-500/30 bg-indigo-500/5 backdrop-blur-sm p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-500" />
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">
                  Forecast Projection (Actuals + Upcoming Unpaid)
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Combines settled expenditures with pending recurring rules and upcoming EMI installments due before period end.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-6 text-xs">
              <div>
                <span className="text-muted-foreground block text-[11px]">Due Recurring</span>
                <span className="font-mono font-bold text-foreground">
                  {formatCurrency(report.forecast.upcomingRecurring, user?.currency || 'INR')}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[11px]">Due EMIs</span>
                <span className="font-mono font-bold text-foreground">
                  {formatCurrency(report.forecast.upcomingEmi, user?.currency || 'INR')}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[11px]">Projected Total Outflow</span>
                <span className="font-mono font-bold text-[#cc0000]">
                  {formatCurrency(report.forecast.totalProjectedExpenses, user?.currency || 'INR')}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[11px]">Projected Net Flow</span>
                <span
                  className={`font-mono font-bold ${
                    report.forecast.projectedNetCashFlow >= 0 ? 'text-[#05A100]' : 'text-[#cc0000]'
                  }`}
                >
                  {formatCurrency(report.forecast.projectedNetCashFlow, user?.currency || 'INR')}
                </span>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Summary KPI Cards Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : report ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 1. Period Income */}
          <Card className="bg-card/70 backdrop-blur-sm border-border">
            <CardContent className="p-5">
              <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <span>Personal Income</span>
                <TrendingUp className="h-4 w-4 text-emerald-500" />
              </div>
              <p className="text-2xl font-bold tracking-tight text-[#05A100] mt-2 font-mono">
                {formatCurrency(report.summary.totalIncome, user?.currency || 'INR')}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Settled personal inflows</p>
            </CardContent>
          </Card>

          {/* 2. Period Expenses */}
          <Card className="bg-card/70 backdrop-blur-sm border-border">
            <CardContent className="p-5">
              <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <span>Ordinary Expenses</span>
                <TrendingDown className="h-4 w-4 text-rose-500" />
              </div>
              <p className="text-2xl font-bold tracking-tight text-[#cc0000] mt-2 font-mono">
                {formatCurrency(report.summary.totalExpenses, user?.currency || 'INR')}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Excludes investments and transfers</p>
            </CardContent>
          </Card>

          {/* 3. Total Invested */}
          <Card className="bg-card/70 backdrop-blur-sm border-border">
            <CardContent className="p-5">
              <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <span>Total Invested</span>
                <TrendingUp className="h-4 w-4 text-purple-500" />
              </div>
              <p className="text-2xl font-bold tracking-tight text-purple-500 mt-2 font-mono">
                {formatCurrency(report.summary.totalInvestments || 0, user?.currency || 'INR')}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Allocated to capital & assets</p>
            </CardContent>
          </Card>

          {/* 4. Net Cash Flow */}
          <Card className="bg-card/70 backdrop-blur-sm border-border">
            <CardContent className="p-5">
              <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <span>Net Cash Flow</span>
                <PieChart className="h-4 w-4 text-teal-500" />
              </div>
              <p
                className={`text-2xl font-bold tracking-tight mt-2 font-mono ${
                  report.summary.netCashFlow >= 0 ? 'text-[#05A100]' : 'text-[#cc0000]'
                }`}
              >
                {formatCurrency(report.summary.netCashFlow, user?.currency || 'INR')}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Savings rate: {report.summary.savingsRate}%</p>
            </CardContent>
          </Card>

          {/* 5. Credit Card Spend */}
          <Card className="bg-card/70 backdrop-blur-sm border-border">
            <CardContent className="p-5">
              <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <span>Credit Card Spend</span>
                <CreditCard className="h-4 w-4 text-blue-500" />
              </div>
              <p className="text-2xl font-bold tracking-tight text-foreground mt-2 font-mono">
                {formatCurrency(report.summary.creditCardSpend || 0, user?.currency || 'INR')}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Charged on cards (net of refunds)</p>
            </CardContent>
          </Card>

          {/* 6. Credit Card Repayments */}
          <Card className="bg-card/70 backdrop-blur-sm border-border">
            <CardContent className="p-5">
              <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <span>Card Repayments</span>
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
              </div>
              <p className="text-2xl font-bold tracking-tight text-foreground mt-2 font-mono">
                {formatCurrency(report.summary.creditCardRepayments || 0, user?.currency || 'INR')}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Debt settlements (not double-counted)</p>
            </CardContent>
          </Card>

          {/* 7. Recurring Outlay */}
          <Card className="bg-card/70 backdrop-blur-sm border-border">
            <CardContent className="p-5">
              <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <span>Recurring Outlay</span>
                <Repeat className="h-4 w-4 text-purple-500" />
              </div>
              <p className="text-2xl font-bold tracking-tight text-foreground mt-2 font-mono">
                {formatCurrency(report.summary.recurringExpenses || 0, user?.currency || 'INR')}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Logged recurring subscriptions</p>
            </CardContent>
          </Card>

          {/* 8. EMI Payments */}
          <Card className="bg-card/70 backdrop-blur-sm border-border">
            <CardContent className="p-5">
              <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <span>EMI Payments</span>
                <Landmark className="h-4 w-4 text-indigo-500" />
              </div>
              <p className="text-2xl font-bold tracking-tight text-foreground mt-2 font-mono">
                {formatCurrency(report.summary.emiExpenses || 0, user?.currency || 'INR')}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Paid loan installments in period</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Breakdowns Grid */}
      {report && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Category Breakdown Table */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                <PieChart className="h-4 w-4 text-emerald-500" />
                Category Spending Distribution
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Ranked by total personal expenditures (includes personal Chits category; excludes internal chit fund operations).
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {report.categoryBreakdown.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  No expense records in this date window.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {report.categoryBreakdown.map((item) => {
                    const isChitCategory = item.category.toLowerCase() === 'chits';
                    const catColor = isChitCategory ? '#14b8a6' : getCategoryColor(item.category);
                    return (
                      <div key={item.category} className="p-4 flex items-center justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            {isChitCategory && <Coins className="h-4 w-4 text-teal-400" />}
                            <span className="font-semibold text-sm text-foreground">{item.category}</span>
                            <span className="text-xs text-muted-foreground">
                              ({item.transactionCount} {item.transactionCount === 1 ? 'entry' : 'entries'})
                            </span>
                            {isChitCategory && (
                              <Badge variant="outline" className="text-[10px] border-teal-500/40 text-teal-400">
                                Personal Chit Outlay
                              </Badge>
                            )}
                          </div>
                          <div className="w-48 bg-muted h-1.5 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${Math.min(100, item.percentage)}%`,
                                backgroundColor: catColor,
                              }}
                            />
                          </div>
                        </div>

                        <div className="text-right">
                          <p className="font-bold text-foreground text-sm font-mono">
                            {formatCurrency(item.totalAmount, user?.currency || 'INR')}
                          </p>
                          <p className="text-xs text-muted-foreground">{item.percentage}% of total</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Payment Method & Channel Distribution */}
          <div className="space-y-6">
            <Card className="border-border bg-card">
              <CardHeader className="pb-3 border-b border-border/50">
                <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-blue-500" />
                  Payment Instrument Breakdown
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Breakdown by personal payment mechanism.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                {report.paymentMethodBreakdown.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No data recorded.</p>
                ) : (
                  report.paymentMethodBreakdown.map((pm) => (
                    <div key={pm.method} className="flex items-center justify-between text-xs">
                      <span className="capitalize font-semibold text-foreground">
                        {pm.method.replace(/_/g, ' ')}
                      </span>
                      <div className="flex items-center gap-4">
                        <span className="text-muted-foreground">{pm.count} transactions</span>
                        <span className="font-bold text-foreground font-mono">
                          {formatCurrency(pm.amount, user?.currency || 'INR')}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader className="pb-3 border-b border-border/50">
                <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                  Channel Distribution (Online vs Offline)
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Digital payment channels vs physical cash outlays.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                {report.channelBreakdown.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No data recorded.</p>
                ) : (
                  report.channelBreakdown.map((ch) => (
                    <div key={ch.channel} className="flex items-center justify-between text-xs">
                      <span className="capitalize font-semibold text-foreground">{ch.channel}</span>
                      <div className="flex items-center gap-4">
                        <span className="text-muted-foreground">{ch.count} transactions</span>
                        <span className="font-bold text-foreground font-mono">
                          {formatCurrency(ch.amount, user?.currency || 'INR')}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Investment Portfolio & Contributions Section */}
      {report && report.investments && (
        <Card className="border-border bg-card overflow-hidden">
          <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-purple-500" />
                  Investments &amp; Capital Allocation
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground mt-0.5">
                  Tracked capital allocations, asset contributions, and funding sources. Not classified as ordinary consumption expenses.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs border-purple-500/40 text-purple-400 font-mono font-bold">
                  Total: {formatCurrency(report.investments.totalInvested, user?.currency || 'INR')}
                </Badge>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-6 space-y-6">
            {report.investments.totalInvested === 0 && report.investments.transactions.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                No investment contributions recorded in this date range.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Category / Purpose Breakdown */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Allocation by Category / Purpose
                    </h4>
                    <div className="space-y-2.5">
                      {report.investments.categoryBreakdown.map((item) => (
                        <div key={item.category} className="p-3 rounded-lg border border-border bg-muted/20 space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-foreground">{item.category}</span>
                            <span className="font-mono font-bold text-purple-400">
                              {formatCurrency(item.totalAmount, user?.currency || 'INR')} ({item.percentage}%)
                            </span>
                          </div>
                          <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-purple-500 rounded-full transition-all duration-300"
                              style={{ width: `${Math.min(100, item.percentage)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Funding Source Breakdown */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Contributions by Funding Source
                    </h4>
                    <div className="space-y-2.5">
                      {report.investments.fundingSourceBreakdown.map((item) => (
                        <div key={item.source} className="p-3 rounded-lg border border-border bg-muted/20 space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-foreground">{item.source}</span>
                            <span className="font-mono font-bold text-foreground">
                              {formatCurrency(item.amount, user?.currency || 'INR')} ({item.percentage}%)
                            </span>
                          </div>
                          <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                              style={{ width: `${Math.min(100, item.percentage)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Investment History Ledger */}
                {report.investments.transactions.length > 0 && (
                  <div className="space-y-3 pt-4 border-t border-border">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Investment Contributions History ({report.investments.transactions.length})
                    </h4>
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-muted/40 text-muted-foreground font-semibold border-b border-border">
                          <tr>
                            <th className="py-2.5 px-3">Date</th>
                            <th className="py-2.5 px-3">Title</th>
                            <th className="py-2.5 px-3">Category</th>
                            <th className="py-2.5 px-3">Funding Source</th>
                            <th className="py-2.5 px-3 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {report.investments.transactions.map((it) => (
                            <tr key={it.id} className="hover:bg-muted/20">
                              <td className="py-2.5 px-3 text-muted-foreground font-mono">
                                {new Date(it.date).toLocaleDateString()}
                              </td>
                              <td className="py-2.5 px-3 font-semibold text-foreground">
                                {it.title}
                                {it.notes && (
                                  <span className="block text-[10px] text-muted-foreground font-normal">
                                    {it.notes}
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3">
                                <Badge variant="secondary" className="text-[10px]">
                                  {it.category}
                                </Badge>
                              </td>
                              <td className="py-2.5 px-3 text-muted-foreground font-medium">
                                {it.fundingSource}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-purple-400">
                                ↗ {formatCurrency(it.amount, user?.currency || 'INR')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Monthly Trends Table (if multiple months exist) */}
      {report && report.monthlyTrends && report.monthlyTrends.length > 1 && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-3 border-b border-border/50">
            <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4 text-emerald-500" />
              Monthly Cash Flow Trends
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Month-by-month historical comparison for the active filter window.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/40 text-muted-foreground font-semibold border-b border-border">
                  <tr>
                    <th className="py-2.5 px-4">Month</th>
                    <th className="py-2.5 px-4 text-right">Income</th>
                    <th className="py-2.5 px-4 text-right">Expenses</th>
                    <th className="py-2.5 px-4 text-right">Investments</th>
                    <th className="py-2.5 px-4 text-right">Net Flow</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {report.monthlyTrends.map((t) => (
                    <tr key={t.month} className="hover:bg-muted/20">
                      <td className="py-3 px-4 font-semibold text-foreground">{t.month}</td>
                      <td className="py-3 px-4 text-right font-mono text-[#05A100]">
                        {formatCurrency(t.income, user?.currency || 'INR')}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-[#cc0000]">
                        {formatCurrency(t.expenses, user?.currency || 'INR')}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-purple-400">
                        {formatCurrency(t.investments || 0, user?.currency || 'INR')}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono font-bold ${
                          t.net >= 0 ? 'text-[#05A100]' : 'text-[#cc0000]'
                        }`}
                      >
                        {formatCurrency(t.net, user?.currency || 'INR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
