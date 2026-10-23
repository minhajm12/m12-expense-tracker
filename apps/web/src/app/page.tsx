'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useDataSync } from '@/lib/data-sync';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/components/ui/toast';
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  CreditCard,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowLeftRight,
  Calendar,
  Sparkles,
  PieChart as PieChartIcon,
  RefreshCw,
  Plus,
  Coins,
  ShieldCheck,
  ChevronRight,
  AlertCircle,
  Building2,
  Globe,
  Store,
} from 'lucide-react';
import { Logo } from '@/components/ui/logo';
import { formatCurrency, TransactionType } from '@finora/shared';
import { RecordTransactionModal } from '@/components/transactions/record-transaction-modal';
import { UpcomingMonthlyPayments } from '@/components/dashboard/upcoming-monthly-payments';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
} from 'recharts';

interface DashboardData {
  kpis: {
    periodIncome: number;
    periodExpense: number;
    netCashFlow: number;
    totalBankBalances: number;
    totalCreditCardOutstanding: number;
    totalAvailableCredit: number;
    savings: number;
    savingsRate: number;
    upcomingDueDatesCount: number;
    period: string;
  };
  charts: {
    monthlyTrend: Array<{ month: string; income: number; expense: number; net: number }>;
    categoryBreakdown: Array<{ name: string; value: number }>;
    channelBreakdown: Array<{ channel: string; value: number; percentage: number }>;
    paymentMethodBreakdown: Array<{ method: string; name: string; value: number; count: number }>;
  };
  recentTransactions: Array<{
    id: string;
    title: string;
    amount: number;
    type: string;
    category: string;
    paymentMethod: string;
    paymentChannel: string;
    date: string;
    merchantOrRecipient?: string;
  }>;
  upcomingPayments: Array<{
    cardId: string;
    cardNickname: string;
    issuingBank: string;
    outstanding: number;
    dueDay: number;
  }>;
  bankAccounts: Array<{
    id: string;
    accountName: string;
    bankName: string;
    accountType: string;
    currentBalance: number;
    currency: string;
    color?: string;
  }>;
  creditCards: Array<{
    id: string;
    cardNickname: string;
    issuingBank: string;
    creditLimit: number;
    currentOutstanding: number;
    availableCredit: number;
  }>;
}

const CATEGORY_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#f43f5e', '#64748b'];

export default function DashboardPage() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('this-month');
  const [showAddTxModal, setShowAddTxModal] = useState(false);

  const creditCardsEnabled = user?.modulePreferences?.creditCards !== false;
  const expenseTrackerEnabled = user?.modulePreferences?.expenseTracker !== false;
  const emiEnabled = user?.modulePreferences?.emi !== false;
  const recurringEnabled = user?.modulePreferences?.recurringTransactions !== false;
  const investmentEnabled = user?.modulePreferences?.investment !== false;

  const getApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef<number>(0);

  const fetchDashboard = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    // Cancel in-flight request to prevent race conditions
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const currentRequestId = ++requestIdRef.current;
    setLoading(true);

    try {
      const res = await fetch(`${getApiUrl()}/api/v1/analytics/dashboard?period=${period}`, {
        credentials: 'include',
        signal: controller.signal,
      });
      const json = await res.json();

      // Ensure stale/superseded responses do not overwrite newer state
      if (currentRequestId !== requestIdRef.current) {
        return;
      }

      if (res.ok && json.success) {
        setData(json.data);
      } else {
        toast.error(json.error?.message || 'Failed to fetch dashboard data');
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return; // Expected cancellation
      }
      toast.error('Network error loading analytics');
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [isAuthenticated, period]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Live auto-update: automatically re-queries dashboard whenever transactions/accounts change
  useDataSync(fetchDashboard, ['transactions', 'accounts', 'credit-cards', 'all']);

  if (authLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center space-y-4">
        <div className="flex justify-center mb-2">
          <Logo height={48} className="h-12 w-auto" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight">Welcome to M12 Expense Tracker</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          Sign in or create a new account to manage bank accounts, double-entry credit cards, transactions, and real-time analytics.
        </p>
        <div className="flex gap-3 pt-2">
          <Link href="/login">
            <Button variant="default">Sign In</Button>
          </Link>
          <Link href="/register">
            <Button variant="outline">Create Account</Button>
          </Link>
        </div>
      </div>
    );
  }

  const kpis = data?.kpis;
  const charts = data?.charts;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Dashboard Top Header & Period Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Financial Overview</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Server-authoritative calculations derived from verified database records
          </p>
        </div>

        {/* Date Filter Pills */}
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg bg-muted p-1 text-xs font-medium">
            {[
              { id: 'today', label: 'Today' },
              { id: 'this-month', label: 'This Month' },
              { id: 'last-month', label: 'Last Month' },
              { id: 'last-30-days', label: '30 Days' },
              { id: 'last-90-days', label: '90 Days' },
              { id: 'this-year', label: 'This Year' },
              { id: 'all-time', label: 'All Time' },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={`rounded-md px-3 py-1.5 transition-all ${period === p.id
                  ? 'bg-background text-foreground shadow-sm font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
                  }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <Button variant="ghost" size="icon" onClick={fetchDashboard} className="h-8 w-8">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>

          <Button onClick={() => setShowAddTxModal(true)} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Add Transaction
          </Button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Income Card */}
        <Card className="border-border/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {kpis?.period || 'Monthly'} Income
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-[#05A100]">
              <ArrowDownLeft className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div>
                <p className="text-2xl font-bold tracking-tight text-[#05A100]">
                  {formatCurrency(kpis?.periodIncome || 0, user?.currency)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Manual income entries</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Expenses Card */}
        <Card className="border-border/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {kpis?.period || 'Monthly'} Expenses
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/10 text-[#cc0000]">
              <ArrowUpRight className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div>
                <p className="text-2xl font-bold tracking-tight text-[#cc0000]">
                  {formatCurrency(kpis?.periodExpense || 0, user?.currency)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Excludes transfers & repayments</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Net Cash Flow Card */}
        <Card className="border-border/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Net Cash Flow
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <TrendingUp className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div>
                <p
                  className={`text-2xl font-bold tracking-tight ${(kpis?.netCashFlow || 0) >= 0
                    ? 'text-foreground'
                    : 'text-[#cc0000]'
                    }`}
                >
                  {(kpis?.netCashFlow || 0) >= 0 ? '+' : ''}
                  {formatCurrency(kpis?.netCashFlow || 0, user?.currency)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Savings Rate: <span className="font-semibold text-foreground">{kpis?.savingsRate || 0}%</span>
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Liquid Bank Balances Card */}
        <Card className="border-border/60">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Total Bank Balances
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Wallet className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div>
                <p className="text-2xl font-bold tracking-tight text-foreground">
                  {formatCurrency(kpis?.totalBankBalances || 0, user?.currency)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {data?.bankAccounts?.length || 0} active bank accounts
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Credit Card Liability Strip */}
      {creditCardsEnabled && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="bg-credit-widget-gradient dark:!bg-white text-white border-neutral-800 shadow-lg">
            <CardContent className="p-5 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase font-semibold tracking-wider text-slate-400">
                  Credit Card Outstanding
                </p>
                <h3 className="text-2xl font-black text-[#CC0000] mt-0.5">
                  {formatCurrency(kpis?.totalCreditCardOutstanding || 0, user?.currency)}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Available Credit: {formatCurrency(kpis?.totalAvailableCredit || 0, user?.currency)}
                </p>
              </div>
              <Link href="/credit-cards">
                <Button size="sm" variant="outline" className="border-slate-700 bg-slate-800 text-white hover:bg-slate-700">
                  Manage Cards
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardContent className="p-5 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase font-semibold tracking-wider text-muted-foreground">
                  Upcoming Due Dates
                </p>
                <h3 className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
                  {kpis?.upcomingDueDatesCount || 0} Card Bills Pending
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Zero interest penalty with timely manual repayments
                </p>
              </div>
              {expenseTrackerEnabled && (
                <Button size="sm" variant="secondary" className="gap-2" onClick={() => setShowAddTxModal(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  Add Transaction
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Charts Section: Income vs Expense Trend & Category Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Income vs Expenses Bar Chart (2 Columns) */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Monthly Income vs Expenses Trend</CardTitle>
            <CardDescription>Server-aggregated financial performance across last 6 months</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-72 w-full" />
            ) : charts?.monthlyTrend && charts.monthlyTrend.length > 0 ? (
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={charts.monthlyTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(val) => `₹${val / 1000}k`} />
                    <Tooltip
                      formatter={(val: number) => [formatCurrency(val, user?.currency), '']}
                      contentStyle={{ borderRadius: '0.5rem', fontSize: '12px' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                    <Bar dataKey="income" name="Income" fill="#05A100" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expense" name="Expense" fill="#cc0000" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState title="No historical data" description="Post transactions across months to see trends." />
            )}
          </CardContent>
        </Card>

        {/* Category Breakdown Doughnut Chart (1 Column) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Category Breakdown</CardTitle>
            <CardDescription>Top spending categories for {kpis?.period}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-72 w-full" />
            ) : charts?.categoryBreakdown && charts.categoryBreakdown.length > 0 ? (
              <div className="h-72 w-full flex flex-col items-center justify-center">
                <ResponsiveContainer width="100%" height="75%">
                  <PieChart>
                    <Pie
                      data={charts.categoryBreakdown}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={75}
                      paddingAngle={3}
                    >
                      {charts.categoryBreakdown.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val: number) => [formatCurrency(val, user?.currency), 'Spent']}
                      contentStyle={{ borderRadius: '0.5rem', fontSize: '12px' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap justify-center gap-2 mt-2 max-h-16 overflow-y-auto">
                  {charts.categoryBreakdown.slice(0, 4).map((c, i) => (
                    <span key={c.name} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
                      />
                      {c.name} ({formatCurrency(c.value, user?.currency)})
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState title="No expenses recorded" description="Expenses recorded for this period will appear here." />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Monthly Payments Forecast Section */}
      {(emiEnabled || recurringEnabled || investmentEnabled) && <UpcomingMonthlyPayments />}

      {/* Online vs Offline Channels & Payment Methods */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Payment Channels Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Online vs Offline Spending</CardTitle>
            <CardDescription>Independent tracking of payment channels</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {charts?.channelBreakdown?.map((ch) => (
              <div key={ch.channel} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-foreground flex items-center gap-2">
                    {ch.channel === 'Online' ? <Globe className="h-4 w-4 text-primary" /> : <Store className="h-4 w-4 text-amber-500" />}
                    {ch.channel}
                  </span>
                  <span className="font-semibold text-foreground">
                    {formatCurrency(ch.value, user?.currency)} ({ch.percentage}%)
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full ${ch.channel === 'Online' ? 'bg-primary' : 'bg-amber-500'}`}
                    style={{ width: `${ch.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Bank Account Balances Strip */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Bank Accounts Summary</CardTitle>
            <CardDescription>Live liquid balances across verified accounts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data?.bankAccounts?.length === 0 ? (
              <p className="text-xs text-muted-foreground">No bank accounts created yet.</p>
            ) : (
              data?.bankAccounts?.map((acc) => (
                <div key={acc.id} className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-card/60">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="h-7 w-7 rounded-md flex items-center justify-center text-white text-xs font-bold"
                      style={{ backgroundColor: acc.color || '#10b981' }}
                    >
                      <Building2 className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground leading-none">{acc.accountName}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{acc.bankName} • {acc.accountType}</p>
                    </div>
                  </div>
                  <span className="font-mono text-xs font-bold text-foreground">
                    {formatCurrency(acc.currentBalance, acc.currency)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Transactions Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold">Recent Financial Transactions</CardTitle>
            <CardDescription>Latest entries with payment method and channel badges</CardDescription>
          </div>
          <Link href="/transactions">
            <Button variant="ghost" size="sm" className="gap-1 text-xs">
              View All <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {data?.recentTransactions?.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No transactions recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30">
                    <th className="p-3">Title</th>
                    <th className="p-3">Category</th>
                    <th className="p-3">Method</th>
                    <th className="p-3">Channel</th>
                    <th className="p-3">Date</th>
                    <th className="p-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data?.recentTransactions?.map((tx) => (
                    <tr key={tx.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3 font-medium text-foreground">{tx.title}</td>
                      <td className="p-3">
                        <Badge variant="secondary" className="text-xs">
                          {tx.category}
                        </Badge>
                      </td>
                      <td className="p-3 capitalize text-xs text-muted-foreground">
                        {tx.paymentMethod.replace('_', ' ')}
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className="capitalize text-[10px]">
                          {tx.paymentChannel}
                        </Badge>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {new Intl.DateTimeFormat('en-IN', {
                          timeZone: 'Asia/Kolkata',
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        }).format(new Date(tx.date))}
                      </td>
                      <td className="p-3 text-right font-bold text-xs">
                        <span
                          className={
                            tx.type === 'income'
                              ? 'text-[#05A100]'
                              : tx.type === 'expense'
                                ? 'text-[#CC0000]'
                                : 'text-blue-500'
                          }
                        >
                          {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}
                          {formatCurrency(tx.amount, user?.currency)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Shared Record Transaction Modal */}
      <RecordTransactionModal
        isOpen={showAddTxModal}
        onClose={() => setShowAddTxModal(false)}
        onSuccess={fetchDashboard}
      />
    </div>
  );
}
