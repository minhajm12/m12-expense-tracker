'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import {
  TrendingUp,
  Coins,
  Landmark,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Trash2,
  Edit3,
  Wallet,
  Trophy,
  RefreshCw,
  AlertCircle,
  ExternalLink,
  X,
  CreditCard as CreditCardIcon,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';
import {
  InvestmentItem,
  InvestmentContributionItem,
  PaymentMethod,
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

export default function InvestmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [loading, setLoading] = useState(true);
  const [investment, setInvestment] = useState<any>(null);
  const [contributions, setContributions] = useState<InvestmentContributionItem[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);

  // Accounts for selectors
  const [accounts, setAccounts] = useState<any[]>([]);

  // Modals
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
  const [showWonModal, setShowWonModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Edit State
  const [editName, setEditName] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editMonthlyContribution, setEditMonthlyContribution] = useState('');
  const [editIsMonthlyPaymentEnabled, setEditIsMonthlyPaymentEnabled] = useState(true);
  const [editEnableHistoricalRange, setEditEnableHistoricalRange] = useState(false);
  const [editHistoricalRange, setEditHistoricalRange] = useState<MonthYearRange>({});
  const [submittingEdit, setSubmittingEdit] = useState(false);

  // Pay State
  const [selectedCycleForPay, setSelectedCycleForPay] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]);
  const [payMethod, setPayMethod] = useState<PaymentMethod>(PaymentMethod.UPI);
  const [payCashSource, setPayCashSource] = useState<'tracked_personal_cash' | 'untracked_cash'>('tracked_personal_cash');
  const [personalCashBalance, setPersonalCashBalance] = useState<number | null>(null);
  const [payAccountId, setPayAccountId] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [submittingPay, setSubmittingPay] = useState(false);

  // Won / Payout State
  const [wonDate, setWonDate] = useState(new Date().toISOString().split('T')[0]);
  const [wonPayoutAmount, setWonPayoutAmount] = useState('');
  const [wonDestinationType, setWonDestinationType] = useState<'bank' | 'cash'>('bank');
  const [wonAccountId, setWonAccountId] = useState('');
  const [wonNotes, setWonNotes] = useState('');
  const [isHistoricalPayout, setIsHistoricalPayout] = useState(false);
  const [submittingWon, setSubmittingWon] = useState(false);

  const getApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const fetchInvestmentDetails = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${getApiUrl()}/api/v1/investments/${id}`, {
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setInvestment(json.data.investment);
        setContributions(json.data.contributions || []);
        setTransactions(json.data.transactions || []);

        setEditName(json.data.investment.name);
        setEditNotes(json.data.investment.notes || '');
        setEditMonthlyContribution(String(json.data.investment.monthlyContribution || ''));
        setEditIsMonthlyPaymentEnabled(json.data.investment.isMonthlyPaymentEnabled !== false);
      } else {
        toast.error(json.error?.message || 'Failed to load investment');
        router.push('/investments');
      }
    } catch {
      toast.error('Network error loading investment details');
    } finally {
      setLoading(false);
    }
  };

  const fetchAccounts = async () => {
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/accounts`, { credentials: 'include' });
      const json = await res.json();
      if (res.ok && json.success) {
        setAccounts(json.data || []);
        if (json.data?.length > 0 && !payAccountId) {
          setPayAccountId(json.data[0].id);
          setWonAccountId(json.data[0].id);
        }
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
    if (id) {
      fetchInvestmentDetails();
      fetchAccounts();
    }
  }, [id]);

  // Handle Edit Investment
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingEdit(true);
    try {
      const hasHistorical =
        editEnableHistoricalRange &&
        editHistoricalRange.startMonth &&
        editHistoricalRange.endMonth;

      const res = await fetch(`${getApiUrl()}/api/v1/investments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: editName.trim(),
          notes: editNotes.trim() || undefined,
          monthlyContribution: parseFloat(editMonthlyContribution) || 0,
          isMonthlyPaymentEnabled: editIsMonthlyPaymentEnabled,
          historicalRange: hasHistorical ? editHistoricalRange : undefined,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Investment details updated. Future scheduled obligations have been updated.');
        setShowEditModal(false);
        fetchInvestmentDetails();
        emitDataChange('all');
      } else {
        toast.error(json.error?.message || 'Failed to update investment');
      }
    } catch {
      toast.error('Network error updating investment');
    } finally {
      setSubmittingEdit(false);
    }
  };

  // Handle Delete Single Investment
  const handleDeleteInvestment = async () => {
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/investments/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Investment deleted and schedule cleaned up safely.');
        emitDataChange('all');
        router.push('/investments');
      } else {
        toast.error(json.error?.message || 'Failed to delete investment');
      }
    } catch {
      toast.error('Network error deleting investment');
    }
  };

  // Open Pay Modal for a specific cycle
  const handleOpenPay = (contrib: InvestmentContributionItem) => {
    setSelectedCycleForPay(contrib.cycleKey);
    setPayAmount(String(contrib.expectedAmount || investment.monthlyContribution || 1000));
    setPayMethod(contrib.paymentMethod || investment.paymentMethod || PaymentMethod.UPI);
    setPayCashSource('tracked_personal_cash');
    setPayAccountId(contrib.accountId || investment.accountId || (accounts[0]?.id || ''));
    setPayNotes('');
    setShowPayModal(true);
  };

  // Handle Pay Submission
  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(payAmount);
    if (isNaN(amt) || amt <= 0) {
      toast.error('Please enter a valid payment amount');
      return;
    }

    setSubmittingPay(true);
    try {
      const isCash = payMethod === PaymentMethod.CASH;
      const res = await fetch(`${getApiUrl()}/api/v1/investments/${id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          cycleKey: selectedCycleForPay,
          amount: amt,
          paymentDate: payDate,
          paymentMethod: payMethod,
          cashSource: isCash ? payCashSource : undefined,
          accountId: !isCash ? (payAccountId || undefined) : undefined,
          notes: payNotes.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`Payment of ${formatCurrency(amt)} for ${selectedCycleForPay} recorded successfully!`);
        setShowPayModal(false);
        fetchInvestmentDetails();
        emitDataChange('all');
      } else {
        toast.error(json.error?.message || 'Failed to record payment');
      }
    } catch {
      toast.error('Network error recording payment');
    } finally {
      setSubmittingPay(false);
    }
  };

  // Handle Reverse / Delete Payment
  const handleDeletePayment = async (cycleKey: string) => {
    if (!confirm(`Are you sure you want to reverse payment for ${cycleKey}? The balance debit will be refunded to your account.`)) {
      return;
    }

    try {
      const res = await fetch(`${getApiUrl()}/api/v1/investments/${id}/pay`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cycleKey }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`Payment for ${cycleKey} reversed and restored to unpaid.`);
        fetchInvestmentDetails();
        emitDataChange('all');
      } else {
        toast.error(json.error?.message || 'Failed to reverse payment');
      }
    } catch {
      toast.error('Network error reversing payment');
    }
  };

  // Open Won Modal
  const handleOpenWon = () => {
    setWonDate(investment.winningDate ? investment.winningDate.split('T')[0] : new Date().toISOString().split('T')[0]);
    const est = investment.payoutAmount || investment.monthlyContribution * ((investment.durationMonths || 12) - 1);
    setWonPayoutAmount(String(est > 0 ? est : 50000));
    setWonDestinationType(investment.payoutDestinationType || 'bank');
    setWonAccountId(investment.payoutAccountId || accounts[0]?.id || '');
    setWonNotes(investment.payoutNotes || '');
    setIsHistoricalPayout(Boolean(investment.isHistoricalPayout));
    setShowWonModal(true);
  };

  // Handle Won Submission
  const handleWonSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payout = parseFloat(wonPayoutAmount);
    if (isNaN(payout) || payout <= 0) {
      toast.error('Please enter a valid payout amount');
      return;
    }

    setSubmittingWon(true);
    try {
      const endpoint = investment.isWon
        ? `${getApiUrl()}/api/v1/investments/${id}/payout`
        : `${getApiUrl()}/api/v1/investments/${id}/won`;
      const method = investment.isWon ? 'PUT' : 'POST';

      const res = await fetch(endpoint, {
        method,
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
          investment.isWon
            ? 'Chit payout details updated successfully.'
            : isHistoricalPayout
            ? `Chit marked as won with ${formatCurrency(payout)} historical payout recorded under investment returns.`
            : `Chit marked as won and ${formatCurrency(payout)} payout credited to your account!`
        );
        setShowWonModal(false);
        fetchInvestmentDetails();
        emitDataChange('all');
      } else {
        toast.error(json.error?.message || 'Failed to record winning status');
      }
    } catch {
      toast.error('Network error recording winning status');
    } finally {
      setSubmittingWon(false);
    }
  };

  if (loading || !investment) {
    return (
      <div className="py-24 flex flex-col items-center justify-center text-muted-foreground space-y-3">
        <RefreshCw className="h-7 w-7 animate-spin text-purple-400" />
        <p className="text-xs">Loading investment details and contribution ledger...</p>
      </div>
    );
  }

  const isChit = investment.isExternalChit;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-16">
      {/* Back Navigation & Breadcrumb */}
      <div className="flex items-center justify-between">
        <Link
          href="/investments"
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Investments</span>
        </Link>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowEditModal(true)}
            className="text-xs h-8 gap-1.5 border-border"
          >
            <Edit3 className="h-3.5 w-3.5" />
            <span>Edit Details</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowDeleteModal(true)}
            className="text-xs h-8 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Delete</span>
          </Button>
        </div>
      </div>

      {/* Main Header Card */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm shadow-sm overflow-hidden">
        <div className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-border/40">
          <div className="flex items-start gap-4">
            <div
              className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 ${
                isChit
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
              }`}
            >
              {isChit ? <Coins className="h-6 w-6" /> : <TrendingUp className="h-6 w-6" />}
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">{investment.name}</h1>
                <Badge variant="outline" className="text-xs">
                  {investment.category}
                </Badge>
                {investment.isWon && (
                  <Badge className="text-xs bg-amber-500/20 text-amber-400 border-amber-500/30">
                    🏆 Won
                  </Badge>
                )}
                <Badge
                  variant="secondary"
                  className={`text-xs ${
                    investment.status === 'active' ? 'text-emerald-400 bg-emerald-500/10' : ''
                  }`}
                >
                  {investment.status.toUpperCase()}
                </Badge>
              </div>

              <p className="text-xs text-muted-foreground">
                Started on {new Date(investment.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                {investment.endDate && ` • Ends ${new Date(investment.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                {investment.durationMonths && ` (${investment.durationMonths} Months duration)`}
              </p>

              {investment.notes && (
                <p className="text-xs text-muted-foreground/90 italic pt-1 max-w-xl">
                  {investment.notes}
                </p>
              )}
            </div>
          </div>

          {/* Action Button: Mark Won or Record Pay */}
          <div className="flex items-center gap-3">
            {isChit && !investment.isWon && (
              <Button
                onClick={handleOpenWon}
                className="gap-2 text-xs bg-amber-600 hover:bg-amber-500 text-white"
              >
                <Trophy className="h-4 w-4" />
                <span>Mark Chit as Won</span>
              </Button>
            )}

            {isChit && investment.isWon && (
              <Button
                variant="outline"
                onClick={handleOpenWon}
                className="gap-2 text-xs border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
              >
                <Edit3 className="h-3.5 w-3.5" />
                <span>Edit Payout Details</span>
              </Button>
            )}
          </div>
        </div>

        {/* KPI Metrics Sub-Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border/40 bg-muted/20">
          <div className="p-4 text-center sm:text-left">
            <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
              Total Contributions
            </span>
            <div className="text-lg font-bold text-foreground mt-0.5">
              {formatCurrency(investment.totalContributionsInvested || investment.totalInvested || investment.totalHistoricalContributed || 0)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              Hist: {formatCurrency(investment.totalHistoricalContributed || 0)} • In-app: {formatCurrency(investment.totalActualContributed || 0)}
            </div>
          </div>

          <div className="p-4 text-center sm:text-left">
            <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
              Remaining Commitment
            </span>
            <div className="text-lg font-bold text-foreground mt-0.5">
              {formatCurrency(investment.remainingContributionCommitment || investment.remainingScheduledAmount || 0)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {investment.unpaidMonthsCount || 0} unpaid months remaining
            </div>
          </div>

          <div className="p-4 text-center sm:text-left">
            <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
              Installments Paid
            </span>
            <div className="text-lg font-bold text-foreground mt-0.5">
              {investment.paidMonthsCount || 0}{' '}
              {investment.totalScheduledMonths ? `/ ${investment.totalScheduledMonths}` : 'Months'}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {formatCurrency(investment.monthlyContribution || 0)} / month
            </div>
          </div>

          <div className="p-4 text-center sm:text-left">
            <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
              {isChit ? 'Net Chit Cash Flow' : 'Outstanding / Due'}
            </span>
            <div className={`text-lg font-bold mt-0.5 ${
              isChit
                ? (investment.netChitCashFlow || 0) >= 0
                  ? 'text-emerald-400'
                  : 'text-rose-400'
                : 'text-foreground'
            }`}>
              {isChit
                ? `${(investment.netChitCashFlow || 0) >= 0 ? '+' : ''}${formatCurrency(investment.netChitCashFlow || 0)}`
                : formatCurrency(investment.outstandingContributions || 0)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {isChit ? 'Payout Received − Total Invested' : 'Due through current cycle'}
            </div>
          </div>
        </div>
      </Card>

      {/* External Chit Winning Summary Card (if won) */}
      {isChit && investment.isWon && (
        <Card className="border-amber-500/40 bg-amber-500/5 backdrop-blur-sm shadow-sm p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                <Trophy className="h-5 w-5" />
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-sm text-foreground">Chit Prize Won & Settled</h3>
                  {investment.isHistoricalPayout ? (
                    <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-[10px]">
                      Historical Settlement
                    </Badge>
                  ) : (
                    <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px]">
                      Settlement Completed
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Won on {new Date(investment.winningDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} • Destination:{' '}
                  <strong className="text-foreground uppercase">
                    {investment.isHistoricalPayout
                      ? 'Historical Settlement (Not credited to bank)'
                      : (investment.payoutDestinationType || 'Bank')}
                  </strong>
                </p>
                {investment.payoutNotes && (
                  <p className="text-[11px] text-muted-foreground/90 italic pt-0.5">
                    Notes: {investment.payoutNotes}
                  </p>
                )}
                <p className="text-[11px] text-emerald-400/90 pt-0.5 font-medium">
                  • Future monthly obligations remain active: {investment.unpaidMonthsCount || 0} installments ({formatCurrency(investment.remainingContributionCommitment || investment.remainingScheduledAmount || 0)}) remaining until completion.
                </p>
              </div>
            </div>

            <div className="text-right sm:border-l sm:border-border/40 sm:pl-6">
              <div className="text-[11px] text-muted-foreground uppercase font-medium">Payout Received</div>
              <div className="text-xl font-bold text-amber-400">
                {formatCurrency(investment.payoutAmount || 0)}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Contribution Schedule & Ledger */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm shadow-sm">
        <CardHeader className="py-4 px-6 border-b border-border/40 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Calendar className="h-4 w-4 text-purple-400" />
              <span>Contribution Schedule & Payment History</span>
            </CardTitle>
            <CardDescription className="text-xs">
              Chronological ledger of scheduled months, imported historical payments, and recorded in-app transactions.
            </CardDescription>
          </div>

          <Badge variant="outline" className="text-xs">
            {contributions.length} Cycles
          </Badge>
        </CardHeader>

        <CardContent className="p-0">
          {contributions.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              No contribution schedule generated for this investment.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/30 text-muted-foreground uppercase text-[10px] tracking-wider border-b border-border/40">
                  <tr>
                    <th className="py-3 px-4 font-semibold">#</th>
                    <th className="py-3 px-4 font-semibold">Cycle (Month)</th>
                    <th className="py-3 px-4 font-semibold">Due Date</th>
                    <th className="py-3 px-4 font-semibold text-right">Expected</th>
                    <th className="py-3 px-4 font-semibold text-right">Paid Amount</th>
                    <th className="py-3 px-4 font-semibold">Status / Type</th>
                    <th className="py-3 px-4 font-semibold">Payment Details</th>
                    <th className="py-3 px-4 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {contributions.map((c, index) => {
                    const isPaid = c.status === 'paid' || c.status === 'paid_historical';
                    return (
                      <tr key={c.id} className="hover:bg-card/40 transition-colors">
                        <td className="py-3 px-4 font-mono text-muted-foreground">{index + 1}</td>
                        <td className="py-3 px-4 font-mono font-semibold text-foreground">
                          {c.cycleKey}
                        </td>
                        <td className="py-3 px-4 text-muted-foreground">
                          {new Date(c.scheduledDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="py-3 px-4 text-right font-medium text-foreground">
                          {formatCurrency(c.expectedAmount)}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-foreground">
                          {c.actualAmount !== undefined ? formatCurrency(c.actualAmount) : '—'}
                        </td>
                        <td className="py-3 px-4">
                          {c.isHistorical ? (
                            <Badge variant="outline" className="text-[10px] border-blue-500/40 text-blue-400 py-0">
                              Imported Past Month
                            </Badge>
                          ) : c.status === 'paid' ? (
                            <Badge className="text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30 py-0">
                              ✓ Paid in App
                            </Badge>
                          ) : c.status === 'skipped' ? (
                            <Badge variant="outline" className="text-[10px] border-muted text-muted-foreground py-0">
                              Skipped
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400 py-0">
                              Due
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 px-4 text-muted-foreground">
                          {c.isHistorical ? (
                            <span className="text-[11px] italic">Pre-onboarding record</span>
                          ) : isPaid && c.paidAt ? (
                            <span className="text-[11px]">
                              Paid on {new Date(c.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}{' '}
                              {c.paymentMethod && `via ${c.paymentMethod.toUpperCase()}`}
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground/60">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {!isPaid && !investment.isWon ? (
                            <Button
                              size="sm"
                              onClick={() => handleOpenPay(c)}
                              className="h-7 text-[11px] px-2.5 bg-purple-600 hover:bg-purple-500 text-white gap-1"
                            >
                              <Wallet className="h-3 w-3" />
                              <span>Pay</span>
                            </Button>
                          ) : c.status === 'paid' && !c.isHistorical ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDeletePayment(c.cycleKey)}
                              className="h-7 text-[11px] px-2 text-destructive hover:bg-destructive/10"
                              title="Reverse payment and restore cycle to unpaid"
                            >
                              <RotateCcw className="h-3 w-3" />
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Linked Financial Transactions Table */}
      {transactions.length > 0 && (
        <Card className="border-border/60 bg-card/60 backdrop-blur-sm shadow-sm">
          <CardHeader className="py-4 px-6 border-b border-border/40">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Wallet className="h-4 w-4 text-purple-400" />
              <span>Linked Financial Transactions</span>
            </CardTitle>
            <CardDescription className="text-xs">
              Actual financial ledger entries created for balance adjustments and prize payouts.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/30 text-muted-foreground uppercase text-[10px] tracking-wider border-b border-border/40">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">Date</th>
                    <th className="py-2.5 px-4 font-semibold">Title</th>
                    <th className="py-2.5 px-4 font-semibold">Type</th>
                    <th className="py-2.5 px-4 font-semibold">Payment Method</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {transactions.map((t) => (
                    <tr key={t._id || t.id} className="hover:bg-card/40 transition-colors">
                      <td className="py-2.5 px-4 text-muted-foreground">
                        {new Date(t.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-foreground">{t.title}</td>
                      <td className="py-2.5 px-4">
                        <Badge
                          variant="outline"
                          className={`text-[10px] py-0 ${
                            t.type === 'income' ? 'text-emerald-400 border-emerald-500/30' : 'text-purple-400 border-purple-500/30'
                          }`}
                        >
                          {t.type.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4 uppercase text-muted-foreground text-[11px]">{t.paymentMethod}</td>
                      <td className={`py-2.5 px-4 text-right font-bold ${t.type === 'income' ? 'text-emerald-400' : 'text-foreground'}`}>
                        {t.type === 'income' ? `+ ${formatCurrency(t.amount)}` : formatCurrency(t.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================= MODAL: EDIT INVESTMENT ================= */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-md shadow-2xl border-border bg-card">
            <CardHeader className="pb-3 border-b border-border/40">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Edit3 className="h-4 w-4 text-purple-400" />
                  <span>Edit Investment Details</span>
                </CardTitle>
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <CardDescription className="text-xs">
                Modifying monthly contribution updates future upcoming obligations only. Previous payment records remain intact.
              </CardDescription>
            </CardHeader>

            <form onSubmit={handleEditSubmit} className="p-4 space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                  Investment Name
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                  Monthly Contribution Amount (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editMonthlyContribution}
                  onChange={(e) => setEditMonthlyContribution(e.target.value)}
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 font-bold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-lg border border-border/60 bg-muted/20">
                <div>
                  <div className="text-xs font-semibold text-foreground">Monthly Payment Reminders</div>
                  <div className="text-[10px] text-muted-foreground">
                    Display in Upcoming Monthly Payments
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={editIsMonthlyPaymentEnabled}
                  onChange={(e) => setEditIsMonthlyPaymentEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-input text-purple-600 focus:ring-purple-500"
                />
              </div>

              {investment?.isExternalChit && (
                <div className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-emerald-300">
                        Midway Historical Paid Months
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        Configure previously settled installment cycles before app tracking
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={editEnableHistoricalRange}
                      onChange={(e) => setEditEnableHistoricalRange(e.target.checked)}
                      className="h-4 w-4 rounded border-input text-emerald-600 focus:ring-emerald-500"
                    />
                  </div>

                  {editEnableHistoricalRange && (
                    <MonthYearRangePicker
                      value={editHistoricalRange}
                      onChange={setEditHistoricalRange}
                      monthlyAmount={parseFloat(editMonthlyContribution) || 0}
                      chitStartDate={investment?.startDate}
                    />
                  )}
                </div>
              )}

              <div className="space-y-1">
                <label className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                  Notes / Reference Info
                </label>
                <textarea
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="flex w-full rounded-lg border border-input bg-background px-3 py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <CardFooter className="p-0 pt-3 flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowEditModal(false)}
                  disabled={submittingEdit}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={submittingEdit}
                  className="gap-2 bg-purple-600 hover:bg-purple-500 text-white"
                >
                  {submittingEdit ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  <span>Save Changes</span>
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      {/* ================= MODAL: RECORD PAYMENT ================= */}
      {showPayModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-md shadow-2xl border-border bg-card">
            <CardHeader className="pb-3 border-b border-border/40">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-purple-400" />
                  <span>Record Payment: {selectedCycleForPay}</span>
                </CardTitle>
                <button
                  type="button"
                  onClick={() => setShowPayModal(false)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </CardHeader>

            <form onSubmit={handlePaySubmit} className="p-4 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                    Cycle Month
                  </label>
                  <input
                    type="text"
                    value={selectedCycleForPay}
                    disabled
                    className="flex h-9 w-full rounded-lg border border-input bg-muted px-3 py-1.5 font-mono"
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
                  </select>
                </div>

                {payMethod !== PaymentMethod.CASH && (
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
                  Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="UPI reference, notes..."
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
                  <span>{submittingPay ? 'Recording...' : 'Confirm & Debit Balance'}</span>
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      {/* ================= MODAL: MARK WON ================= */}
      {showWonModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-md shadow-2xl border-amber-500/30 bg-card">
            <CardHeader className="pb-3 border-b border-border/40">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold flex items-center gap-2 text-amber-400">
                  <Trophy className="h-5 w-5 text-amber-400" />
                  <span>{investment.isWon ? 'Edit Chit Payout Details' : 'Mark Chit as Won'}</span>
                </CardTitle>
                <button
                  type="button"
                  onClick={() => setShowWonModal(false)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </CardHeader>

            <form onSubmit={handleWonSubmit} className="p-4 space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                  Winning Date
                </label>
                <DatePicker
                  value={wonDate}
                  onChange={setWonDate}
                />
              </div>

              {/* Already Paid Before Tracking (Historical Payout) Toggle */}
              <div className="flex items-start gap-2.5 p-3 rounded-lg border border-border/70 bg-muted/20">
                <input
                  type="checkbox"
                  id="isHistoricalPayoutDetail"
                  checked={isHistoricalPayout}
                  onChange={(e) => setIsHistoricalPayout(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-input text-amber-500 focus:ring-amber-500"
                />
                <div className="space-y-0.5">
                  <label htmlFor="isHistoricalPayoutDetail" className="text-xs font-semibold text-foreground cursor-pointer">
                    Payout Already Received Before Tracking
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    Enable if you won and collected this chit in a past month before using this app. Payout will be recorded under Investment Returns without debiting or crediting your current bank balance.
                  </p>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                  Actual Prize Payout Amount Received (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  value={wonPayoutAmount}
                  onChange={(e) => setWonPayoutAmount(e.target.value)}
                  required
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
                  Notes / Dividend Details
                </label>
                <input
                  type="text"
                  placeholder="Auction notes..."
                  value={wonNotes}
                  onChange={(e) => setWonNotes(e.target.value)}
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-400 space-y-1">
                <p className="font-semibold">Financial Safety Rules:</p>
                <p>
                  {isHistoricalPayout
                    ? '• Historical payout records the prize under returns without crediting bank or cash.'
                    : '• Payout is recorded as an inflow transaction, crediting your chosen account.'}
                </p>
                <p>• Future monthly contribution obligations continue until the full chit duration ends.</p>
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
                  <span>{submittingWon ? 'Saving...' : 'Confirm & Credit Payout'}</span>
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      {/* ================= MODAL: DELETE CONFIRMATION ================= */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-sm shadow-2xl border-destructive/40 bg-card">
            <CardHeader className="pb-3 border-b border-border/40">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-5 w-5" />
                <CardTitle className="text-base font-bold">Delete Investment?</CardTitle>
              </div>
              <CardDescription className="text-xs">
                Are you sure you want to delete <strong className="text-foreground">{investment.name}</strong>?
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 text-xs text-muted-foreground space-y-2">
              <p>
                This will delete the investment schedule, occurrences, and cleanly reverse linked financial transactions with safe balance recalculation.
              </p>
            </CardContent>
            <CardFooter className="p-4 pt-2 flex items-center justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowDeleteModal(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="destructive" onClick={handleDeleteInvestment}>
                Delete Investment
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
    </div>
  );
}
