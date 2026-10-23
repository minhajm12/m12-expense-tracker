'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import {
  TrendingUp,
  Coins,
  Landmark,
  Plus,
  Search,
  Filter,
  Calendar,
  CheckCircle2,
  Clock,
  Sparkles,
  RotateCcw,
  Trash2,
  Edit3,
  Wallet,
  CreditCard,
  ArrowRight,
  Eye,
  Trophy,
  ArrowUpRight,
  RefreshCw,
  AlertCircle,
  HelpCircle,
  X,
  PieChart,
  Layers,
} from 'lucide-react';
import {
  InvestmentItem,
  InvestmentDashboardData,
  UpcomingPaymentItem,
  PaymentMethod,
  DEFAULT_INVESTMENT_CATEGORIES,
  formatCurrency,
} from '@finora/shared';
import { emitDataChange } from '@/lib/data-sync';
import { DatePicker } from '@/components/ui/date-picker';
import { MonthYearPicker } from '@/components/ui/month-year-picker';
import { MonthYearRangePicker, MonthYearRange } from '@/components/ui/month-year-range-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function InvestmentsPage() {
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState<InvestmentDashboardData | null>(null);

  // Filters & Tabs
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'chits' | 'won' | 'completed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
  const [showWonModal, setShowWonModal] = useState(false);
  const [selectedInvestmentForPay, setSelectedInvestmentForPay] = useState<InvestmentItem | null>(null);
  const [selectedChitForWon, setSelectedChitForWon] = useState<InvestmentItem | null>(null);

  // Bank Accounts & Credit Cards for selectors
  const [accounts, setAccounts] = useState<any[]>([]);
  const [creditCards, setCreditCards] = useState<any[]>([]);

  // Add Investment Form State
  const [name, setName] = useState('');
  const [category, setCategory] = useState('CHIT');
  const [initialAmount, setInitialAmount] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState('');
  const [durationMonths, setDurationMonths] = useState('12');
  const [monthlyContribution, setMonthlyContribution] = useState('1000');
  const [isMonthlyPaymentEnabled, setIsMonthlyPaymentEnabled] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.UPI);
  const [accountId, setAccountId] = useState('');
  const [creditCardId, setCreditCardId] = useState('');
  const [notes, setNotes] = useState('');
  // Historical midway paid range for chits
  const [enableHistoricalRange, setEnableHistoricalRange] = useState(false);
  const [historicalRange, setHistoricalRange] = useState<MonthYearRange>({});
  const [submittingAdd, setSubmittingAdd] = useState(false);

  // Pay Modal State
  const [payCycleKey, setPayCycleKey] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
  const [payMethod, setPayMethod] = useState<PaymentMethod>(PaymentMethod.UPI);
  const [payCashSource, setPayCashSource] = useState<'tracked_personal_cash' | 'untracked_cash'>('tracked_personal_cash');
  const [personalCashBalance, setPersonalCashBalance] = useState<number | null>(null);
  const [payAccountId, setPayAccountId] = useState('');
  const [payCreditCardId, setPayCreditCardId] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [submittingPay, setSubmittingPay] = useState(false);

  // Won Modal State
  const [wonDate, setWonDate] = useState(new Date().toISOString().split('T')[0]);
  const [wonPayoutAmount, setWonPayoutAmount] = useState('');
  const [wonDestinationType, setWonDestinationType] = useState<'bank' | 'cash'>('bank');
  const [wonAccountId, setWonAccountId] = useState('');
  const [wonNotes, setWonNotes] = useState('');
  const [isHistoricalPayout, setIsHistoricalPayout] = useState(false);
  const [submittingWon, setSubmittingWon] = useState(false);

  const getApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${getApiUrl()}/api/v1/investments/dashboard`, {
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setDashboardData(json.data);
      } else {
        toast.error(json.error?.message || 'Failed to load investments dashboard');
      }
    } catch {
      toast.error('Network error loading investments');
    } finally {
      setLoading(false);
    }
  };

  const fetchFundingSources = async () => {
    try {
      const [accRes, cardRes] = await Promise.all([
        fetch(`${getApiUrl()}/api/v1/accounts`, { credentials: 'include' }),
        fetch(`${getApiUrl()}/api/v1/credit-cards`, { credentials: 'include' }),
      ]);
      const [accJson, cardJson] = await Promise.all([accRes.json(), cardRes.json()]);

      if (accRes.ok && accJson.success) {
        setAccounts(accJson.data || []);
        if (accJson.data?.length > 0 && !accountId) {
          setAccountId(accJson.data[0].id);
          setPayAccountId(accJson.data[0].id);
          setWonAccountId(accJson.data[0].id);
        }
      }
      if (cardRes.ok && cardJson.success) {
        setCreditCards(cardJson.data || []);
      }

      fetch(`${getApiUrl()}/api/v1/accounts/total-cash`, { credentials: 'include' })
        .then((r) => r.json())
        .then((j) => {
          if (j.success && j.data) {
            setPersonalCashBalance(j.data.personalCashInHand ?? j.data.cashInHand ?? 0);
          }
        })
        .catch(() => {});
    } catch {
      // Non-blocking
    }
  };

  useEffect(() => {
    fetchDashboardData();
    fetchFundingSources();
  }, []);

  // Filtered investments list
  const filteredInvestments = useMemo(() => {
    if (!dashboardData?.investments) return [];
    return dashboardData.investments.filter((inv) => {
      // Tab filter
      if (activeTab === 'active' && inv.status !== 'active') return false;
      if (activeTab === 'chits' && !inv.isExternalChit) return false;
      if (activeTab === 'won' && !inv.isWon) return false;
      if (activeTab === 'completed' && inv.status !== 'completed') return false;

      // Category filter
      if (selectedCategoryFilter !== 'all' && inv.category !== selectedCategoryFilter) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = inv.name.toLowerCase().includes(q);
        const matchesCat = inv.category.toLowerCase().includes(q);
        const matchesNotes = inv.notes?.toLowerCase().includes(q);
        if (!matchesName && !matchesCat && !matchesNotes) return false;
      }

      return true;
    });
  }, [dashboardData?.investments, activeTab, selectedCategoryFilter, searchQuery]);

  // Handle Add Investment Submission
  const handleAddInvestment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Investment name is required');
      return;
    }

    const isChit = category === 'CHIT';
    const parsedMonthly = parseFloat(monthlyContribution) || 0;
    const parsedInitial = parseFloat(initialAmount) || 0;

    if (isChit && parsedMonthly <= 0) {
      toast.error('Monthly contribution must be greater than 0 for an external chit');
      return;
    }

    const hasRange = isChit && enableHistoricalRange && Boolean(historicalRange.startMonth && historicalRange.endMonth);

    setSubmittingAdd(true);
    try {
      const payload: any = {
        name: name.trim(),
        category,
        investmentType: isChit ? 'chit' : isMonthlyPaymentEnabled ? 'recurring' : 'one_time',
        initialAmount: parsedInitial,
        startDate,
        endDate: isChit && endDate ? endDate : undefined,
        durationMonths: isChit && durationMonths ? parseInt(durationMonths, 10) : undefined,
        monthlyContribution: parsedMonthly,
        isMonthlyPaymentEnabled,
        paymentMethod,
        accountId: accountId || undefined,
        creditCardId: paymentMethod === PaymentMethod.CREDIT_CARD ? creditCardId : undefined,
        notes: notes.trim() || undefined,
        historicalRange: hasRange ? historicalRange : undefined,
      };

      const res = await fetch(`${getApiUrl()}/api/v1/investments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(
          isChit
            ? `External chit "${name}" configured successfully.`
            : `Investment "${name}" created successfully.`
        );
        setShowAddModal(false);
        // Reset form
        setName('');
        setInitialAmount('');
        setNotes('');
        setEnableHistoricalRange(false);
        setHistoricalRange({});
        fetchDashboardData();
        emitDataChange('all');
      } else {
        toast.error(json.error?.message || 'Failed to create investment');
      }
    } catch {
      toast.error('Network error creating investment');
    } finally {
      setSubmittingAdd(false);
    }
  };

  // Open Pay Modal
  const handleOpenPayModal = (inv: InvestmentItem, defaultCycle?: string) => {
    setSelectedInvestmentForPay(inv);
    const cycle = defaultCycle || inv.nextDueCycle || new Date().toISOString().slice(0, 7);
    setPayCycleKey(cycle);
    setPayAmount(String(inv.monthlyContribution || inv.initialAmount || 1000));
    setPayMethod(inv.paymentMethod || PaymentMethod.UPI);
    setPayAccountId(inv.accountId || (accounts[0]?.id || ''));
    setPayCreditCardId(inv.creditCardId || '');
    setPayNotes('');
    setShowPayModal(true);
  };

  // Handle Pay Submission
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvestmentForPay) return;

    const amt = parseFloat(payAmount);
    if (isNaN(amt) || amt <= 0) {
      toast.error('Please enter a valid payment amount greater than 0');
      return;
    }

    setSubmittingPay(true);
    try {
      const isCash = payMethod === PaymentMethod.CASH;
      const isCard = payMethod === PaymentMethod.CREDIT_CARD;
      const res = await fetch(
        `${getApiUrl()}/api/v1/investments/${selectedInvestmentForPay.id}/pay`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            cycleKey: payCycleKey,
            amount: amt,
            paymentDate: payDate,
            paymentMethod: payMethod,
            cashSource: isCash ? payCashSource : undefined,
            accountId: !isCash && !isCard ? (payAccountId || undefined) : undefined,
            creditCardId: isCard ? payCreditCardId : undefined,
            notes: payNotes.trim() || undefined,
          }),
        }
      );

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`Payment of ${formatCurrency(amt)} for ${payCycleKey} recorded successfully!`);
        setShowPayModal(false);
        setSelectedInvestmentForPay(null);
        fetchDashboardData();
        emitDataChange('all');
      } else {
        toast.error(json.error?.message || 'Failed to record investment payment');
      }
    } catch {
      toast.error('Network error recording payment');
    } finally {
      setSubmittingPay(false);
    }
  };

  // Open Won Modal
  const handleOpenWonModal = (inv: InvestmentItem) => {
    setSelectedChitForWon(inv);
    setWonDate(new Date().toISOString().split('T')[0]);
    // Rough estimate for external chit payout = monthlyContribution * (duration - 1)
    const est = inv.monthlyContribution * ((inv.durationMonths || 12) - 1);
    setWonPayoutAmount(String(est > 0 ? est : 50000));
    setWonDestinationType('bank');
    setWonAccountId(accounts[0]?.id || '');
    setWonNotes('');
    setIsHistoricalPayout(false);
    setShowWonModal(true);
  };

  // Handle Won Submission
  const handleMarkAsWon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChitForWon) return;

    const payout = parseFloat(wonPayoutAmount);
    if (isNaN(payout) || payout <= 0) {
      toast.error('Please enter a valid payout amount');
      return;
    }

    setSubmittingWon(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/investments/${selectedChitForWon.id}/won`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          winningDate: wonDate,
          payoutAmount: payout,
          payoutDestinationType: wonDestinationType,
          payoutAccountId: (!isHistoricalPayout && wonDestinationType === 'bank') ? wonAccountId : undefined,
          payoutNotes: wonNotes.trim() || undefined,
          isHistoricalPayout,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(
          isHistoricalPayout
            ? `Chit marked as won with ${formatCurrency(payout)} historical payout recorded under investment returns without affecting current bank balance.`
            : `Congratulations! Chit marked as won and ${formatCurrency(payout)} payout credited to ${
                wonDestinationType === 'bank' ? 'selected bank account' : 'cash in hand'
              }.`
        );
        setShowWonModal(false);
        setSelectedChitForWon(null);
        fetchDashboardData();
        emitDataChange('all');
      } else {
        toast.error(json.error?.message || 'Failed to mark chit as won');
      }
    } catch {
      toast.error('Network error updating chit winning status');
    } finally {
      setSubmittingWon(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header & Primary Action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <TrendingUp className="h-7 w-7 text-purple-500" />
            <span>Investment Module</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Track capital allocation, mutual funds, gold, and external chit funds with isolated payout settlements.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              setCategory('CHIT');
              setShowAddModal(true);
            }}
            variant="outline"
            className="gap-2 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 text-xs"
          >
            <Coins className="h-4 w-4" />
            <span>Add External Chit</span>
          </Button>

          <Button
            onClick={() => {
              setCategory('Mutual Funds');
              setShowAddModal(true);
            }}
            className="gap-2 bg-primary text-primary-foreground text-xs"
          >
            <Plus className="h-4 w-4" />
            <span>New Investment</span>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Historical Invested */}
        <Card className="border-border/60 bg-card/60 backdrop-blur-sm shadow-sm">
          <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between space-y-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Historical Invested
            </span>
            <div className="h-8 w-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
              <TrendingUp className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold tracking-tight text-foreground">
              {loading ? '...' : formatCurrency(dashboardData?.totalHistoricalInvested || 0)}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
              <span>Cumulative contributions (including won chits)</span>
            </p>
          </CardContent>
        </Card>

        {/* Invested This Month */}
        <Card className="border-border/60 bg-card/60 backdrop-blur-sm shadow-sm">
          <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between space-y-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Invested This Month
            </span>
            <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Calendar className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold tracking-tight text-emerald-400">
              {loading ? '...' : formatCurrency(dashboardData?.totalInvestedThisMonth || 0)}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Actual cash deployed in current cycle
            </p>
          </CardContent>
        </Card>

        {/* Active Investments */}
        <Card className="border-border/60 bg-card/60 backdrop-blur-sm shadow-sm">
          <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between space-y-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Active Investments
            </span>
            <div className="h-8 w-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Clock className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold tracking-tight text-foreground">
              {loading ? '...' : dashboardData?.activeInvestmentsCount || 0}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Ongoing recurring plans & active chits
            </p>
          </CardContent>
        </Card>

        {/* Won Chits / Completed */}
        <Card className="border-border/60 bg-card/60 backdrop-blur-sm shadow-sm">
          <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between space-y-0">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Chits Won & Completed
            </span>
            <div className="h-8 w-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Trophy className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold tracking-tight text-amber-400">
              {loading ? '...' : `${dashboardData?.wonChitsCount || 0} Won`}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Payout settled & obligations stopped
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Investment Payments (Current Month Alert) */}
      {dashboardData?.upcomingPayments && dashboardData.upcomingPayments.length > 0 && (
        <Card className="border-purple-500/30 bg-purple-500/5 backdrop-blur-sm shadow-sm">
          <CardHeader className="py-3 px-4 flex flex-row items-center justify-between border-b border-purple-500/20">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-purple-400" />
              <CardTitle className="text-sm font-semibold text-foreground">
                Upcoming Investment Obligations This Month
              </CardTitle>
            </div>
            <Badge variant="outline" className="text-xs border-purple-500/40 text-purple-400">
              {dashboardData.upcomingPayments.filter((u) => u.status === 'unpaid').length} Due
            </Badge>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-border/40">
            {dashboardData.upcomingPayments.map((item) => {
              const matchingInv = dashboardData.investments.find((i) => i.id === item.ruleId);
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between px-4 py-3 text-xs hover:bg-card/40 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                        item.status === 'paid'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-purple-500/10 text-purple-400'
                      }`}
                    >
                      {item.isExternalChit ? <Coins className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{item.title}</span>
                        {item.category && (
                          <Badge variant="secondary" className="text-[10px] py-0">
                            {item.category}
                          </Badge>
                        )}
                        {item.isWon && (
                          <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400 py-0">
                            Won
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        Cycle: <strong className="text-foreground">{item.occurrenceKey}</strong> • Due: {new Date(item.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="font-bold text-foreground">{formatCurrency(item.expectedAmount)}</div>
                      <div className="text-[10px]">
                        {item.status === 'paid' ? (
                          <span className="text-emerald-400 font-medium">✓ Paid</span>
                        ) : (
                          <span className="text-amber-400 font-medium">Upcoming Due</span>
                        )}
                      </div>
                    </div>

                    {item.status !== 'paid' && matchingInv && (
                      <Button
                        size="sm"
                        onClick={() => handleOpenPayModal(matchingInv, item.occurrenceKey)}
                        className="text-xs h-8 gap-1.5 bg-purple-600 hover:bg-purple-500 text-white"
                      >
                        <Wallet className="h-3.5 w-3.5" />
                        <span>Pay Now</span>
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Main Content: Filter Tabs & Investments List */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm shadow-sm">
        <CardHeader className="pb-3 border-b border-border/40">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            {/* Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
              {[
                { id: 'all', label: 'All Investments' },
                { id: 'active', label: 'Active' },
                { id: 'chits', label: 'External Chits' },
                { id: 'won', label: 'Chits Won' },
                { id: 'completed', label: 'Completed' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Search and Category Filter */}
            <div className="flex items-center gap-2">
              <div className="relative w-full sm:w-56">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search investments..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 w-full rounded-lg border border-input bg-background pl-8 pr-3 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <Select
                value={selectedCategoryFilter}
                onValueChange={setSelectedCategoryFilter}
              >
                <SelectTrigger className="w-[160px] h-9 text-xs">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {DEFAULT_INVESTMENT_CATEGORIES.map((c) => (
                    <SelectItem key={c.name} value={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-muted-foreground">
              <RefreshCw className="h-6 w-6 animate-spin mb-2" />
              <p className="text-xs">Loading investment portfolio...</p>
            </div>
          ) : filteredInvestments.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground flex flex-col items-center justify-center">
              <div className="h-12 w-12 rounded-2xl bg-muted/60 flex items-center justify-center mb-3">
                <Coins className="h-6 w-6 text-muted-foreground/60" />
              </div>
              <p className="font-semibold text-sm text-foreground">No investments found</p>
              <p className="text-xs max-w-sm mt-1">
                {searchQuery || selectedCategoryFilter !== 'all' || activeTab !== 'all'
                  ? 'No investments match your current filters. Try resetting the search or category.'
                  : 'Start tracking your mutual funds, gold, fixed deposits, and external chit funds.'}
              </p>
              <Button
                size="sm"
                onClick={() => setShowAddModal(true)}
                className="mt-4 gap-1.5 text-xs bg-purple-600 hover:bg-purple-500 text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Your First Investment</span>
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {filteredInvestments.map((inv) => (
                <div
                  key={inv.id}
                  className="p-4 sm:px-6 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-card/40 transition-colors"
                >
                  {/* Left Column: Info & Badges */}
                  <div className="flex items-start gap-3.5">
                    <div
                      className={`h-10 w-10 shrink-0 rounded-xl flex items-center justify-center mt-0.5 ${
                        inv.isExternalChit
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                      }`}
                    >
                      {inv.isExternalChit ? <Coins className="h-5 w-5" /> : <TrendingUp className="h-5 w-5" />}
                    </div>

                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/investments/${inv.id}`}
                          className="font-semibold text-sm text-foreground hover:text-purple-400 transition-colors flex items-center gap-1.5"
                        >
                          <span>{inv.name}</span>
                          <ArrowUpRight className="h-3.5 w-3.5 opacity-60" />
                        </Link>

                        <Badge variant="outline" className="text-[10px] py-0 border-border">
                          {inv.category}
                        </Badge>

                        {inv.isWon && (
                          <Badge className="text-[10px] py-0 bg-amber-500/15 text-amber-400 border-amber-500/30">
                            🏆 Won
                          </Badge>
                        )}

                        <Badge
                          variant="secondary"
                          className={`text-[10px] py-0 ${
                            inv.status === 'active'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {inv.status.toUpperCase()}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {inv.monthlyContribution > 0 && (
                          <span>
                            Monthly:{' '}
                            <strong className="text-foreground">{formatCurrency(inv.monthlyContribution)}</strong>
                          </span>
                        )}

                        {inv.isExternalChit && inv.durationMonths && (
                          <span>
                            Progress:{' '}
                            <strong className="text-foreground">
                              {inv.paidMonthsCount || 0} / {inv.durationMonths} Months
                            </strong>
                          </span>
                        )}

                        {inv.nextDueCycle && inv.status === 'active' && !inv.isWon && (
                          <span className="text-amber-400/90 font-medium">
                            Next Due: {inv.nextDueCycle}
                          </span>
                        )}

                        {inv.isWon && inv.payoutAmount && (
                          <span className="text-emerald-400 font-medium">
                            Payout Received: {formatCurrency(inv.payoutAmount)}
                          </span>
                        )}
                      </div>

                      {inv.notes && (
                        <p className="text-[11px] text-muted-foreground/80 line-clamp-1 italic">
                          {inv.notes}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Values & Actions */}
                  <div className="flex items-center justify-between md:justify-end gap-4 border-t md:border-t-0 pt-3 md:pt-0 border-border/30">
                    <div className="text-left md:text-right">
                      <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
                        Total Contributed
                      </div>
                      <div className="text-base font-bold text-foreground">
                        {formatCurrency(inv.totalHistoricalContributed || 0)}
                      </div>
                      {inv.remainingScheduledAmount !== undefined && inv.remainingScheduledAmount > 0 && (
                        <div className="text-[10px] text-muted-foreground">
                          {formatCurrency(inv.remainingScheduledAmount)} remaining
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Record Payment Button (if active and not won) */}
                      {inv.status === 'active' && !inv.isWon && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleOpenPayModal(inv)}
                          className="h-8 text-xs gap-1 border-purple-500/40 text-purple-300 hover:bg-purple-500/10"
                        >
                          <Wallet className="h-3.5 w-3.5" />
                          <span>Record Pay</span>
                        </Button>
                      )}

                      {/* Mark as Won Button (for external chits that are not won yet) */}
                      {inv.isExternalChit && !inv.isWon && (
                        <Button
                          size="sm"
                          onClick={() => handleOpenWonModal(inv)}
                          className="h-8 text-xs gap-1 bg-amber-600 hover:bg-amber-500 text-white"
                        >
                          <Trophy className="h-3.5 w-3.5" />
                          <span>Mark Won</span>
                        </Button>
                      )}

                      <Link href={`/investments/${inv.id}`}>
                        <Button size="sm" variant="ghost" className="h-8 text-xs px-2.5">
                          <span>Details</span>
                          <ArrowRight className="h-3.5 w-3.5 ml-1" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ================= MODAL 1: ADD INVESTMENT ================= */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-lg shadow-2xl border-border bg-card max-h-[90vh] flex flex-col">
            <CardHeader className="pb-3 border-b border-border/40 shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  {category === 'CHIT' ? <Coins className="h-5 w-5 text-emerald-400" /> : <TrendingUp className="h-5 w-5 text-purple-400" />}
                  <span>{category === 'CHIT' ? 'Configure External Chit Fund' : 'New Capital Investment'}</span>
                </CardTitle>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <CardDescription className="text-xs">
                {category === 'CHIT'
                  ? 'Track external chit groups, monthly installments, midway payments, and prize payouts.'
                  : 'Track mutual funds, stocks, fixed deposits, gold, and other asset classes.'}
              </CardDescription>
            </CardHeader>

            <form onSubmit={handleAddInvestment} className="overflow-y-auto p-4 space-y-4 flex-1">
              {/* Category Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Investment Category
                </label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="h-10 text-xs">
                    <SelectValue placeholder="Select Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEFAULT_INVESTMENT_CATEGORIES.map((c) => (
                      <SelectItem key={c.name} value={c.name}>
                        {c.name} {c.name === 'CHIT' ? '(External Chit Group)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Investment Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {category === 'CHIT' ? 'External Chit Group Name' : 'Investment Name'}
                </label>
                <input
                  type="text"
                  placeholder={category === 'CHIT' ? 'e.g., Sri Gokulam Chits 25L' : 'e.g., Parag Parikh Flexi Cap Fund'}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              {/* Amounts Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Monthly Contribution (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="1000"
                    value={monthlyContribution}
                    onChange={(e) => setMonthlyContribution(e.target.value)}
                    required={category === 'CHIT'}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Initial / Lump Sum Invested (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0"
                    value={initialAmount}
                    onChange={(e) => setInitialAmount(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              </div>

              {/* Dates Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Start Date
                  </label>
                  <DatePicker
                    value={startDate}
                    onChange={setStartDate}
                  />
                </div>

                {category === 'CHIT' ? (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Total Duration (Months)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="120"
                      value={durationMonths}
                      onChange={(e) => setDurationMonths(e.target.value)}
                      required
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Target Maturity Date (Optional)
                    </label>
                    <DatePicker
                      value={endDate}
                      onChange={setEndDate}
                      placeholder="Select target maturity date"
                    />
                  </div>
                )}
              </div>

              {/* External Chit Midway Historical Range Picker */}
              {category === 'CHIT' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-lg border border-border/60 bg-muted/20">
                    <div>
                      <div className="text-xs font-semibold text-foreground">Import Midway Historical Months</div>
                      <div className="text-[11px] text-muted-foreground">
                        Enable if this chit started in the past and you have already paid prior months
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={enableHistoricalRange}
                      onChange={(e) => setEnableHistoricalRange(e.target.checked)}
                      className="h-4 w-4 rounded border-input text-emerald-600 focus:ring-emerald-500"
                    />
                  </div>

                  {enableHistoricalRange && (
                    <MonthYearRangePicker
                      value={historicalRange}
                      onChange={setHistoricalRange}
                      monthlyAmount={parseFloat(monthlyContribution) || 0}
                      chitStartDate={startDate}
                    />
                  )}
                </div>
              )}

              {/* Monthly Payment Toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg border border-border/60 bg-muted/20">
                <div>
                  <div className="text-xs font-semibold text-foreground">Monthly Payment Reminders</div>
                  <div className="text-[11px] text-muted-foreground">
                    Include upcoming installments in Upcoming Monthly Payments on Dashboard
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={isMonthlyPaymentEnabled}
                  onChange={(e) => setIsMonthlyPaymentEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-input text-purple-600 focus:ring-purple-500"
                />
              </div>

              {/* Funding Source Defaults */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Default Payment Method
                  </label>
                  <Select value={paymentMethod} onValueChange={(val) => setPaymentMethod(val as PaymentMethod)}>
                    <SelectTrigger className="h-10 text-xs">
                      <SelectValue placeholder="Payment Method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={PaymentMethod.UPI}>UPI / Net Banking</SelectItem>
                      <SelectItem value={PaymentMethod.BANK_TRANSFER}>Bank Transfer</SelectItem>
                      <SelectItem value={PaymentMethod.DEBIT_CARD}>Debit Card</SelectItem>
                      <SelectItem value={PaymentMethod.CASH}>Cash in Hand</SelectItem>
                      <SelectItem value={PaymentMethod.CREDIT_CARD}>Credit Card</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Default Bank Account
                  </label>
                  <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger className="h-10 text-xs">
                      <SelectValue placeholder="Select Bank Account" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.accountName} (₹{a.currentBalance?.toLocaleString()})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Notes / Reference ID
                </label>
                <textarea
                  placeholder="Policy number, chit passbook number, broker info..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <CardFooter className="p-0 pt-2 flex items-center justify-end gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddModal(false)}
                  disabled={submittingAdd}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={submittingAdd}
                  className="gap-2 bg-purple-600 hover:bg-purple-500 text-white"
                >
                  {submittingAdd ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  <span>{submittingAdd ? 'Saving...' : 'Create Investment'}</span>
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      {/* ================= MODAL 2: RECORD PAYMENT ================= */}
      {showPayModal && selectedInvestmentForPay && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-md shadow-2xl border-border bg-card">
            <CardHeader className="pb-3 border-b border-border/40">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-purple-400" />
                  <span>Record Investment Payment</span>
                </CardTitle>
                <button
                  type="button"
                  onClick={() => setShowPayModal(false)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <CardDescription className="text-xs">
                Logging payment for <strong className="text-foreground">{selectedInvestmentForPay.name}</strong>
              </CardDescription>
            </CardHeader>

            <form onSubmit={handleRecordPayment} className="p-4 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                    Cycle Month (YYYY-MM)
                  </label>
                  <input
                    type="text"
                    value={payCycleKey}
                    onChange={(e) => setPayCycleKey(e.target.value)}
                    required
                    placeholder="2026-10"
                    className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                    Amount (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    required
                    className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 font-bold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                  Payment Date
                </label>
                <DatePicker
                  value={payDate}
                  onChange={setPayDate}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                    Payment Method
                  </label>
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                    className="flex h-9 w-full rounded-lg border border-input bg-background px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value={PaymentMethod.UPI}>UPI</option>
                    <option value={PaymentMethod.BANK_TRANSFER}>Bank Transfer</option>
                    <option value={PaymentMethod.DEBIT_CARD}>Debit Card</option>
                    <option value={PaymentMethod.CASH}>Cash in Hand</option>
                    <option value={PaymentMethod.CREDIT_CARD}>Credit Card</option>
                  </select>
                </div>

                {payMethod !== PaymentMethod.CASH && payMethod !== PaymentMethod.CREDIT_CARD && (
                  <div className="space-y-1">
                    <label className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                      Funding Bank Account
                    </label>
                    <select
                      value={payAccountId}
                      onChange={(e) => setPayAccountId(e.target.value)}
                      required
                      className="flex h-9 w-full rounded-lg border border-input bg-background px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.accountName}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {payMethod === PaymentMethod.CREDIT_CARD && (
                  <div className="space-y-1">
                    <label className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                      Credit Card
                    </label>
                    <select
                      value={payCreditCardId}
                      onChange={(e) => setPayCreditCardId(e.target.value)}
                      required
                      className="flex h-9 w-full rounded-lg border border-input bg-background px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {creditCards.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.cardNickname || c.cardNumber}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {payMethod === PaymentMethod.CASH && (
                <div className="space-y-1.5 rounded-lg border border-border/80 bg-muted/20 p-2.5">
                  <label className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                    Cash Source Option *
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPayCashSource('tracked_personal_cash')}
                      className={`flex flex-col p-2 rounded-lg border text-left transition-all ${
                        payCashSource === 'tracked_personal_cash'
                          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-400 font-medium'
                          : 'border-border bg-card text-muted-foreground hover:bg-muted/40'
                      }`}
                    >
                      <span className="font-semibold text-[11px]">Tracked Cash in Hand</span>
                      <span className="text-[10px] opacity-80">
                        Available: {personalCashBalance !== null ? formatCurrency(personalCashBalance) : '...'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPayCashSource('untracked_cash')}
                      className={`flex flex-col p-2 rounded-lg border text-left transition-all ${
                        payCashSource === 'untracked_cash'
                          ? 'border-purple-500 bg-purple-500/15 text-purple-400 font-medium'
                          : 'border-border bg-card text-muted-foreground hover:bg-muted/40'
                      }`}
                    >
                      <span className="font-semibold text-[11px]">Untracked / External Cash</span>
                      <span className="text-[10px] opacity-80">Records payment (0 cash debit)</span>
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Cash in Hand payments will never debit any bank account.
                  </p>
                </div>
              )}

              <div className="space-y-1">
                <label className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                  Payment Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="UPI Ref ID, transaction notes..."
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <CardFooter className="p-0 pt-3 flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPayModal(false)}
                  disabled={submittingPay}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={submittingPay}
                  className="gap-2 bg-purple-600 hover:bg-purple-500 text-white"
                >
                  {submittingPay ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  <span>{submittingPay ? 'Recording...' : 'Confirm & Debit Account'}</span>
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      {/* ================= MODAL 3: MARK CHIT AS WON ================= */}
      {showWonModal && selectedChitForWon && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-md shadow-2xl border-amber-500/30 bg-card">
            <CardHeader className="pb-3 border-b border-border/40">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold flex items-center gap-2 text-amber-400">
                  <Trophy className="h-5 w-5 text-amber-400" />
                  <span>Mark External Chit as Won</span>
                </CardTitle>
                <button
                  type="button"
                  onClick={() => setShowWonModal(false)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <CardDescription className="text-xs">
                Record prize payout for <strong className="text-foreground">{selectedChitForWon.name}</strong>. Future monthly contributions will continue until the full chit duration ends.
              </CardDescription>
            </CardHeader>

            <form onSubmit={handleMarkAsWon} className="p-4 space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                  Winning Date
                </label>
                <DatePicker
                  value={wonDate}
                  onChange={setWonDate}
                />
              </div>

              {/* Already Received Before Tracking (Historical Payout) Toggle */}
              <div className="flex items-start gap-2.5 p-3 rounded-lg border border-border/70 bg-muted/20">
                <input
                  type="checkbox"
                  id="isHistoricalPayout"
                  checked={isHistoricalPayout}
                  onChange={(e) => setIsHistoricalPayout(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-input text-amber-500 focus:ring-amber-500"
                />
                <div className="space-y-0.5">
                  <label htmlFor="isHistoricalPayout" className="text-xs font-semibold text-foreground cursor-pointer">
                    Payout Already Received Before Tracking
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    Enable if you won and received this prize payout in a prior month before tracking it in this app. It will be recorded under Investment Returns without altering current bank or cash balances.
                  </p>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                  Actual Prize Payout Received (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  value={wonPayoutAmount}
                  onChange={(e) => setWonPayoutAmount(e.target.value)}
                  required
                  placeholder="e.g., 90000"
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 font-bold text-amber-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              {!isHistoricalPayout && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                      Payout Destination
                    </label>
                    <Select value={wonDestinationType} onValueChange={(val) => setWonDestinationType(val as any)}>
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue placeholder="Destination" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bank">Bank Account</SelectItem>
                        <SelectItem value="cash">Cash in Hand</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {wonDestinationType === 'bank' && (
                    <div className="space-y-1">
                      <label className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                        Credited Bank Account
                      </label>
                      <Select value={wonAccountId} onValueChange={setWonAccountId}>
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue placeholder="Select Account" />
                        </SelectTrigger>
                        <SelectContent>
                          {accounts.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.accountName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <label className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                  Winning Notes / Dividend Details
                </label>
                <input
                  type="text"
                  placeholder="Auction discount, dividend deduction notes..."
                  value={wonNotes}
                  onChange={(e) => setWonNotes(e.target.value)}
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-400 space-y-1">
                <p className="font-semibold">Financial Safety Rules:</p>
                <p>
                  {isHistoricalPayout
                    ? '• Historical payout records the won prize in your ledger without crediting your bank account.'
                    : '• Payout is recorded as an inflow transaction, crediting your chosen account once.'}
                </p>
                <p>• Monthly contributions continue until the full chit duration ends.</p>
              </div>

              <CardFooter className="p-0 pt-3 flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowWonModal(false)}
                  disabled={submittingWon}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={submittingWon}
                  className="gap-2 bg-amber-600 hover:bg-amber-500 text-white"
                >
                  {submittingWon ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trophy className="h-3.5 w-3.5" />}
                  <span>{submittingWon ? 'Processing...' : 'Confirm Chit Won & Credit Payout'}</span>
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
