'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/components/ui/toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CreditCard as CreditCardIcon,
  ArrowLeft,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Clock,
  Sparkles,
  RotateCcw,
  ArrowDownLeft,
  ArrowUpRight,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  FileText,
  DollarSign,
  Tag,
  Receipt,
  Layers,
  Trash2,
} from 'lucide-react';
import {
  CreditCard,
  CreditCardNetwork,
  CreditCardRepaymentMode,
  CreditCardDetailResponse,
  CreditCardCycleInfo,
  CreditCardStatement,
  Transaction,
  BankAccount,
  TransactionType,
  StatementStatus,
  formatCurrency,
  parseDateInput,
  formatDateToInput,
} from '@finora/shared';
import { emitDataChange, useDataSync } from '@/lib/data-sync';

export default function CreditCardDetailPage() {
  const router = useRouter();
  const params = useParams();
  const cardId = (params?.id as string) || '';
  const { user, isAuthenticated } = useAuth();

  const [data, setData] = useState<CreditCardDetailResponse | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'cycles' | 'statements' | 'payments'>('cycles');

  // Modals
  const [showRepaymentModal, setShowRepaymentModal] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Repayment State
  const [repaymentSourceAccountId, setRepaymentSourceAccountId] = useState('');
  const [repaymentAmount, setRepaymentAmount] = useState('');
  const [repaymentNotes, setRepaymentNotes] = useState('');
  const [repaymentMode, setRepaymentMode] = useState<CreditCardRepaymentMode>(
    CreditCardRepaymentMode.FULL_CURRENT
  );
  const [applyRedemption, setApplyRedemption] = useState(false);
  const [redemptionCredit, setRedemptionCredit] = useState('');
  const [redemptionNotes, setRedemptionNotes] = useState('');

  // Refund State
  const [refundTitle, setRefundTitle] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundCategory, setRefundCategory] = useState('Refunds received');
  const [refundNotes, setRefundNotes] = useState('');

  // Edit State
  const [editNickname, setEditNickname] = useState('');
  const [editBank, setEditBank] = useState('');
  const [editNetwork, setEditNetwork] = useState<CreditCardNetwork>(CreditCardNetwork.VISA);
  const [editLastFour, setEditLastFour] = useState('');
  const [editLimit, setEditLimit] = useState('');
  const [editClosingDay, setEditClosingDay] = useState('15');
  const [editAnnualFee, setEditAnnualFee] = useState('0');
  const [editRewards, setEditRewards] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const getApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const fetchData = useCallback(async () => {
    if (!cardId) return;
    setLoading(true);
    try {
      const [detailRes, accsRes] = await Promise.all([
        fetch(`${getApiUrl()}/api/v1/credit-cards/${cardId}/details`, { credentials: 'include' }),
        fetch(`${getApiUrl()}/api/v1/accounts`, { credentials: 'include' }),
      ]);

      const [detailJson, accsJson] = await Promise.all([detailRes.json(), accsRes.json()]);

      if (detailRes.ok && detailJson.success) {
        setData(detailJson.data);
      } else {
        toast.error(detailJson.error?.message || 'Failed to load card details');
      }

      if (accsJson.success) {
        setAccounts(accsJson.data || []);
        if (accsJson.data?.length > 0 && !repaymentSourceAccountId) {
          setRepaymentSourceAccountId(accsJson.data[0].id);
        }
      }
    } catch {
      toast.error('Network error loading credit card details');
    } finally {
      setLoading(false);
    }
  }, [cardId, repaymentSourceAccountId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useDataSync(fetchData, ['credit-cards', 'transactions', 'accounts']);

  const card = data?.card;

  const handleOpenEdit = () => {
    if (!card) return;
    setEditNickname(card.cardNickname);
    setEditBank(card.issuingBank);
    setEditNetwork(card.network as CreditCardNetwork);
    setEditLastFour(card.lastFourDigits || '');
    setEditLimit(card.creditLimit.toString());
    setEditClosingDay(card.billingCycleClosingDay.toString());
    setEditAnnualFee((card.annualFee || 0).toString());
    setEditRewards(card.rewardsNotes || '');
    setEditNotes(card.notes || '');
    setShowEditModal(true);
  };

  const handleUpdateCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!card) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/credit-cards/${card.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          cardNickname: editNickname.trim(),
          issuingBank: editBank.trim(),
          network: editNetwork,
          lastFourDigits: editLastFour.trim() || undefined,
          creditLimit: parseFloat(editLimit),
          billingCycleClosingDay: parseInt(editClosingDay, 10),
          annualFee: parseFloat(editAnnualFee) || 0,
          rewardsNotes: editRewards.trim() || undefined,
          notes: editNotes.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Credit card updated successfully');
        setShowEditModal(false);
        fetchData();
        emitDataChange('credit-cards');
      } else {
        toast.error(json.error?.message || 'Failed to update credit card');
      }
    } catch {
      toast.error('Network error updating credit card');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenRepay = () => {
    if (!card) return;
    setRepaymentMode(CreditCardRepaymentMode.FULL_CURRENT);
    setRepaymentAmount(card.currentOutstanding.toString());
    setRepaymentNotes('');
    setApplyRedemption(false);
    setRedemptionCredit('');
    setRedemptionNotes('');
    setShowRepaymentModal(true);
  };

  const handleRepayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!card || !repaymentSourceAccountId) {
      toast.error('Please select a source bank account');
      return;
    }

    const outstanding = card.currentOutstanding || 0;
    const prevCycleDue = data?.previousCycleOutstanding ?? card.previousCycleOutstanding ?? 0;
    const stmtDue = data?.latestStatement?.remainingBalance ?? card.latestStatementRemaining ?? prevCycleDue;

    let liabilitySettled = 0;
    if (repaymentMode === CreditCardRepaymentMode.FULL_CURRENT) {
      liabilitySettled = outstanding;
    } else if (repaymentMode === CreditCardRepaymentMode.PREVIOUS_CYCLE) {
      liabilitySettled = prevCycleDue;
    } else if (repaymentMode === CreditCardRepaymentMode.STATEMENT_DUE) {
      liabilitySettled = stmtDue;
    } else {
      liabilitySettled = parseFloat(repaymentAmount);
    }

    if (isNaN(liabilitySettled) || liabilitySettled <= 0) {
      toast.error('Repayment liability amount must be greater than 0');
      return;
    }
    if (liabilitySettled > outstanding) {
      toast.error(`Liability settled cannot exceed current outstanding balance of ₹${outstanding}`);
      return;
    }

    const redemptionNum = applyRedemption ? parseFloat(redemptionCredit) || 0 : 0;
    if (applyRedemption && (isNaN(redemptionNum) || redemptionNum <= 0)) {
      toast.error('Please enter a valid redemption credit amount greater than 0');
      return;
    }
    if (applyRedemption && redemptionNum > liabilitySettled) {
      toast.error(`Redemption credit (₹${redemptionNum}) cannot exceed settled liability (₹${liabilitySettled})`);
      return;
    }

    const actualBankPayment = Math.max(0, liabilitySettled - redemptionNum);

    setSubmitting(true);
    try {
      const idempotencyKey = `repay-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const res = await fetch(`${getApiUrl()}/api/v1/credit-cards/repayment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          creditCardId: card.id,
          sourceAccountId: repaymentSourceAccountId,
          repaymentMode,
          amount: actualBankPayment,
          liabilitySettled,
          redemptionCredit: redemptionNum,
          redemptionNotes: applyRedemption ? redemptionNotes.trim() || undefined : undefined,
          isFullRepayment: repaymentMode === CreditCardRepaymentMode.FULL_CURRENT && !applyRedemption,
          date: parseDateInput(new Date()).toISOString(),
          notes: repaymentNotes || undefined,
          idempotencyKey,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(
          applyRedemption
            ? `Repayment posted! ₹${liabilitySettled.toLocaleString()} settled (₹${actualBankPayment.toLocaleString()} paid from bank, ₹${redemptionNum.toLocaleString()} redeemed).`
            : repaymentMode === CreditCardRepaymentMode.FULL_CURRENT
            ? 'Full repayment posted! Card outstanding completely settled.'
            : 'Repayment posted! Liability settled and available credit restored.'
        );
        setShowRepaymentModal(false);
        fetchData();
        emitDataChange('credit-cards');
      } else {
        toast.error(json.error?.message || 'Repayment failed');
      }
    } catch {
      toast.error('Network error posting repayment');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!card) return;
    const numAmount = parseFloat(refundAmount);
    if (isNaN(numAmount) || numAmount <= 0) {
      toast.error('Please enter a valid refund amount greater than 0');
      return;
    }

    setSubmitting(true);
    try {
      const idempotencyKey = `refund-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const res = await fetch(`${getApiUrl()}/api/v1/credit-cards/${card.id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          amount: numAmount,
          title: refundTitle.trim(),
          category: refundCategory,
          notes: refundNotes || undefined,
          date: parseDateInput(new Date()).toISOString(),
          idempotencyKey,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`Refund of ₹${numAmount.toLocaleString()} recorded. Outstanding reduced.`);
        setShowRefundModal(false);
        setRefundTitle('');
        setRefundAmount('');
        setRefundNotes('');
        fetchData();
        emitDataChange('credit-cards');
      } else {
        toast.error(json.error?.message || 'Failed to record refund');
      }
    } catch {
      toast.error('Network error recording refund');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteCard = async () => {
    if (!card) return;
    setDeleting(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/credit-cards/${card.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`Credit card "${card.cardNickname}" deleted successfully.`);
        setShowDeleteModal(false);
        emitDataChange('credit-cards');
        router.push('/credit-cards');
      } else {
        toast.error(json.error?.message || 'Failed to delete credit card');
      }
    } catch {
      toast.error('Network error deleting credit card');
    } finally {
      setDeleting(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-48" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  if (!card) {
    return (
      <div className="space-y-6">
        <Link
          href="/credit-cards"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Credit Cards
        </Link>
        <EmptyState
          title="Credit Card Not Found"
          description="The requested credit card does not exist or may have been deleted/archived."
          actionLabel="View All Credit Cards"
          onAction={() => router.push('/credit-cards')}
        />
      </div>
    );
  }

  const utilization = data.utilization ?? (card.creditLimit > 0 ? Math.round((card.currentOutstanding / card.creditLimit) * 100) : 0);

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <Link
            href="/credit-cards"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-semibold uppercase tracking-wider"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Credit Cards
          </Link>
          <div className="flex items-center gap-3 pt-1">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-2">
              <CreditCardIcon className="h-7 w-7 text-primary" />
              {card.cardNickname}
            </h1>
            <Badge variant="outline" className="uppercase font-bold text-xs bg-muted/60">
              {card.network}
            </Badge>
            <span className="text-xs font-semibold tracking-wider uppercase text-emerald-500 font-mono">
              {card.issuingBank}
            </span>
          </div>
          <p className="text-xs text-muted-foreground font-mono">
            •••• •••• •••• {card.lastFourDigits || '••••'}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleOpenEdit} className="h-9 gap-1.5 text-xs">
            <Pencil className="h-3.5 w-3.5" />
            Edit Card
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowRefundModal(true)}
            className="h-9 gap-1.5 text-xs text-slate-200 hover:text-white"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Refund
          </Button>
          <Button size="sm" onClick={handleOpenRepay} className="h-9 gap-1.5 text-xs font-semibold">
            <Sparkles className="h-3.5 w-3.5" />
            Repay Card
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDeleteModal(true)}
            className="h-9 gap-1.5 text-xs text-red-500 border-red-500/30 hover:bg-red-500/10 hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete Card
          </Button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Outstanding Card */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Outstanding
            </CardDescription>
            <CardTitle className="text-3xl font-black text-[#CC0000]">
              {formatCurrency(data.totalOutstanding, 'INR')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            <div className="flex justify-between items-center text-muted-foreground pt-1 border-t border-border/60">
              <span>Previous-Cycle:</span>
              <span className="font-mono font-bold text-foreground">
                {formatCurrency(data.previousCycleOutstanding, 'INR')}
              </span>
            </div>
            <div className="flex justify-between items-center text-muted-foreground">
              <span>Ongoing-Cycle:</span>
              <span className="font-mono font-bold text-foreground">
                {formatCurrency(data.ongoingCycleOutstanding, 'INR')}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Available Credit Card */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Available Credit
            </CardDescription>
            <CardTitle className="text-3xl font-black text-foreground">
              {formatCurrency(data.availableCredit, 'INR')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex justify-between text-muted-foreground">
              <span>Limit: {formatCurrency(data.creditLimit, 'INR')}</span>
              <span className={utilization > 70 ? 'text-amber-500 font-bold' : 'text-foreground'}>
                {utilization}% used
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  utilization > 80
                    ? 'bg-[#CC0000]'
                    : utilization > 50
                    ? 'bg-amber-500'
                    : 'bg-primary'
                }`}
                style={{ width: `${Math.min(utilization, 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Cycle Schedule Card */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Cycle Schedule
            </CardDescription>
            <CardTitle className="text-xl font-bold text-foreground flex items-center gap-1.5">
              <Calendar className="h-5 w-5 text-primary" />
              {card.billingCycleClosingDay}th of month
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs text-muted-foreground">
            <div className="flex justify-between items-center pt-1 border-t border-border/60">
              <span>Next Statement:</span>
              <span className="font-medium text-foreground">
                {card.nextClosingDate ? new Date(card.nextClosingDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : `${card.billingCycleClosingDay}th`}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span>Next Payment Due:</span>
              <span className="font-medium text-foreground">
                {card.nextPaymentDueDate ? new Date(card.nextPaymentDueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '15 days after closing'}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Latest Statement Snapshot Card */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Latest Statement
              </CardDescription>
              {data.latestStatement && (
                <Badge
                  variant="outline"
                  className={
                    data.latestStatement.status === StatementStatus.PAID
                      ? 'border-emerald-500/40 text-emerald-500 bg-emerald-500/10 text-[10px]'
                      : data.latestStatement.status === StatementStatus.OVERDUE
                      ? 'border-red-500/40 text-red-500 bg-red-500/10 text-[10px]'
                      : 'border-amber-500/40 text-amber-500 bg-amber-500/10 text-[10px]'
                  }
                >
                  {data.latestStatement.status}
                </Badge>
              )}
            </div>
            <CardTitle className="text-2xl font-black text-foreground">
              {data.latestStatement ? formatCurrency(data.latestStatement.statementBalance, 'INR') : 'No statement'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            {data.latestStatement ? (
              <>
                <div className="flex justify-between items-center pt-1 border-t border-border/60">
                  <span>Remaining Due:</span>
                  <span className="font-mono font-bold text-[#CC0000]">
                    {formatCurrency(data.latestStatement.remainingBalance ?? 0, 'INR')}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span>Due Date:</span>
                  <span className="font-medium text-foreground">
                    {new Date(data.latestStatement.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
              </>
            ) : (
              <p className="pt-1 text-[11px] text-muted-foreground">
                Ongoing cycle transactions will be snapshotted on day {card.billingCycleClosingDay}.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs / Filter Nav */}
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <button
          onClick={() => setActiveTab('cycles')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
            activeTab === 'cycles'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          Cycle-Grouped Transactions
        </button>
        <button
          onClick={() => setActiveTab('statements')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
            activeTab === 'statements'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
          Statement Snapshots ({data.statements?.length || 0})
        </button>
        <button
          onClick={() => setActiveTab('payments')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
            activeTab === 'payments'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Repayment History ({data.recentPayments?.length || 0})
        </button>
      </div>

      {/* Tab 1: Billing Cycles Grouped Transactions */}
      {activeTab === 'cycles' && (
        <div className="space-y-6">
          {(!data.cycles || data.cycles.length === 0) ? (
            <EmptyState
              title="No Card Transactions Found"
              description="Record credit card expenses, merchant refunds, or repayments to see them grouped by billing cycle."
            />
          ) : (
            data.cycles.map((cycle) => {
              const isOngoing = cycle.isCurrentCycle;
              const txs = cycle.transactions || [];

              return (
                <div
                  key={cycle.cycleId}
                  className={`rounded-2xl border transition-all overflow-hidden ${
                    isOngoing
                      ? 'border-primary/50 bg-card/60 shadow-md ring-1 ring-primary/20'
                      : 'border-border bg-card'
                  }`}
                >
                  {/* Cycle Header */}
                  <div
                    className={`p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 border-b ${
                      isOngoing ? 'bg-primary/5 border-primary/20' : 'bg-muted/30 border-border/80'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2.5">
                        {isOngoing ? (
                          <Badge className="bg-primary text-primary-foreground text-xs font-bold px-2 py-0.5">
                            Ongoing Cycle
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs font-bold px-2 py-0.5">
                            Closed Cycle
                          </Badge>
                        )}
                        <h3 className="text-base font-bold text-foreground">
                          {cycle.cycleLabel}
                        </h3>
                        {cycle.status && (
                          <Badge
                            variant="outline"
                            className={
                              cycle.status === StatementStatus.PAID
                                ? 'border-emerald-500/40 text-emerald-500 bg-emerald-500/10 text-[10px]'
                                : cycle.status === StatementStatus.OVERDUE
                                ? 'border-red-500/40 text-red-500 bg-red-500/10 text-[10px]'
                                : 'border-amber-500/40 text-amber-500 bg-amber-500/10 text-[10px]'
                            }
                          >
                            {cycle.status}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Period: <span className="font-semibold text-foreground">{cycle.periodStart}</span> to{' '}
                        <span className="font-semibold text-foreground">{cycle.periodEnd}</span>
                        {cycle.dueDate && (
                          <span className="ml-3">
                            Due:{' '}
                            <span className="font-semibold text-foreground">
                              {new Date(cycle.dueDate).toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </span>
                          </span>
                        )}
                      </p>
                    </div>

                    {/* Cycle Metric Summary Badges */}
                    <div className="flex items-center gap-3 self-start md:self-auto">
                      <div className="rounded-lg bg-background/80 border border-border/80 px-3 py-1.5 text-right">
                        <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
                          {isOngoing ? 'Cycle Spend' : 'Billed Total'}
                        </span>
                        <span className="font-mono font-bold text-sm text-[#CC0000]">
                          {formatCurrency(cycle.statementAmount || 0, 'INR')}
                        </span>
                      </div>

                      {!isOngoing && (
                        <>
                          <div className="rounded-lg bg-background/80 border border-border/80 px-3 py-1.5 text-right">
                            <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
                              Settled / Paid
                            </span>
                            <span className="font-mono font-bold text-sm text-emerald-500">
                              {formatCurrency(cycle.amountPaid || 0, 'INR')}
                            </span>
                          </div>
                          <div className="rounded-lg bg-background/80 border border-border/80 px-3 py-1.5 text-right">
                            <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
                              Remaining
                            </span>
                            <span className={`font-mono font-bold text-sm ${(cycle.remainingDue || 0) > 0 ? 'text-[#CC0000]' : 'text-muted-foreground'}`}>
                              {formatCurrency(cycle.remainingDue || 0, 'INR')}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Transactions List */}
                  <div className="divide-y divide-border/60">
                    {txs.length === 0 ? (
                      <div className="p-6 text-center text-xs text-muted-foreground">
                        No transactions recorded in this billing period.
                      </div>
                    ) : (
                      txs.map((tx) => {
                        const isPayment = tx.type === TransactionType.CREDIT_CARD_PAYMENT;
                        const isRefund = tx.type === TransactionType.CREDIT_CARD_REFUND;
                        const isExpense = tx.type === TransactionType.EXPENSE || tx.type === TransactionType.INVESTMENT;

                        return (
                          <div
                            key={tx.id || (tx as any)._id}
                            className="p-3.5 sm:px-5 flex items-center justify-between gap-3 hover:bg-muted/20 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                                  isPayment
                                    ? 'bg-blue-500/10 text-blue-500'
                                    : isRefund
                                    ? 'bg-emerald-500/10 text-emerald-500'
                                    : 'bg-red-500/10 text-[#CC0000]'
                                }`}
                              >
                                {isPayment ? (
                                  <ArrowDownLeft className="h-4 w-4" />
                                ) : isRefund ? (
                                  <RotateCcw className="h-4 w-4" />
                                ) : (
                                  <ArrowUpRight className="h-4 w-4" />
                                )}
                              </div>
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold text-foreground">
                                    {tx.title}
                                  </span>
                                  {tx.category && (
                                    <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                                      {tx.category}
                                    </Badge>
                                  )}
                                  {isPayment && (
                                    <Badge variant="secondary" className="text-[10px] py-0 px-1.5 font-bold">
                                      Liability Settled
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {new Date(tx.date).toLocaleDateString('en-IN', {
                                    day: 'numeric',
                                    month: 'short',
                                    year: 'numeric',
                                  })}{' '}
                                  {tx.paymentMethod && `• ${tx.paymentMethod}`}
                                  {tx.notes && ` • ${tx.notes}`}
                                </p>
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              <p
                                className={`text-sm font-mono font-bold ${
                                  isPayment
                                    ? 'text-blue-400'
                                    : isRefund
                                    ? 'text-emerald-500'
                                    : 'text-[#CC0000]'
                                }`}
                              >
                                {isRefund ? '+ ' : isPayment ? '' : '- '}
                                {formatCurrency(
                                  isPayment && tx.liabilitySettled !== undefined
                                    ? tx.liabilitySettled
                                    : tx.amount,
                                  'INR'
                                )}
                              </p>
                              {isPayment && tx.redemptionCredit && tx.redemptionCredit > 0 && (
                                <p className="text-[10px] text-amber-500 font-mono">
                                  incl. ₹{tx.redemptionCredit} redeemed
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Tab 2: Statement Snapshots */}
      {activeTab === 'statements' && (
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg">Credit Card Statement Snapshots</CardTitle>
            <CardDescription className="text-xs">
              Idempotent historical billing statements generated at every cycle closing day.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(!data.statements || data.statements.length === 0) ? (
              <EmptyState
                title="No Statements Available"
                description="Statements are automatically calculated and recorded when each billing cycle closes."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border bg-muted/40 uppercase font-semibold text-muted-foreground">
                    <tr>
                      <th className="p-3">Period</th>
                      <th className="p-3">Closing Date</th>
                      <th className="p-3">Due Date</th>
                      <th className="p-3 text-right">Statement Balance</th>
                      <th className="p-3 text-right">Amount Paid</th>
                      <th className="p-3 text-right">Remaining Due</th>
                      <th className="p-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {data.statements.map((stmt) => (
                      <tr key={stmt.id || (stmt as any)._id} className="hover:bg-muted/20">
                        <td className="p-3 font-medium">
                          {new Date(stmt.periodStart).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} –{' '}
                          {new Date(stmt.periodEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {new Date(stmt.closingDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="p-3 text-muted-foreground font-semibold">
                          {new Date(stmt.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-foreground">
                          {formatCurrency(stmt.statementBalance, 'INR')}
                        </td>
                        <td className="p-3 text-right font-mono text-emerald-500 font-semibold">
                          {formatCurrency(stmt.paymentsReceived || stmt.amountPaid || 0, 'INR')}
                        </td>
                        <td className={`p-3 text-right font-mono font-bold ${(stmt.remainingBalance ?? Math.max(0, stmt.statementBalance - (stmt.paymentsReceived || 0))) > 0 ? 'text-[#CC0000]' : 'text-muted-foreground'}`}>
                          {formatCurrency(stmt.remainingBalance ?? Math.max(0, stmt.statementBalance - (stmt.paymentsReceived || 0)), 'INR')}
                        </td>
                        <td className="p-3 text-center">
                          <Badge
                            variant="outline"
                            className={
                              stmt.status === StatementStatus.PAID
                                ? 'border-emerald-500/40 text-emerald-500 bg-emerald-500/10'
                                : stmt.status === StatementStatus.OVERDUE
                                ? 'border-red-500/40 text-red-500 bg-red-500/10'
                                : 'border-amber-500/40 text-amber-500 bg-amber-500/10'
                            }
                          >
                            {stmt.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tab 3: Payment History */}
      {activeTab === 'payments' && (
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-lg">Repayment History</CardTitle>
            <CardDescription className="text-xs">
              Payments settled against this card from your linked bank accounts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(!data.recentPayments || data.recentPayments.length === 0) ? (
              <EmptyState
                title="No Repayments Recorded"
                description="Make full or partial repayments against this card to settle debt and restore available credit."
                actionLabel="Make Repayment"
                onAction={handleOpenRepay}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border bg-muted/40 uppercase font-semibold text-muted-foreground">
                    <tr>
                      <th className="p-3">Date</th>
                      <th className="p-3">Title / Details</th>
                      <th className="p-3 text-right">Liability Settled</th>
                      <th className="p-3 text-right">Bank Debited</th>
                      <th className="p-3 text-right">Reward Redeemed</th>
                      <th className="p-3">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {data.recentPayments.map((p) => (
                      <tr key={p.id || (p as any)._id} className="hover:bg-muted/20">
                        <td className="p-3 font-medium text-muted-foreground">
                          {new Date(p.date).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="p-3 font-semibold text-foreground">
                          {p.title}
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-foreground">
                          {formatCurrency(p.liabilitySettled !== undefined ? p.liabilitySettled : p.amount, 'INR')}
                        </td>
                        <td className="p-3 text-right font-mono font-semibold text-emerald-500">
                          {formatCurrency(p.amount, 'INR')}
                        </td>
                        <td className="p-3 text-right font-mono text-amber-500">
                          {p.redemptionCredit ? formatCurrency(p.redemptionCredit, 'INR') : '—'}
                        </td>
                        <td className="p-3 text-muted-foreground max-w-xs truncate">
                          {p.notes || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Repayment Modal */}
      <Dialog open={showRepaymentModal} onOpenChange={setShowRepaymentModal}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="p-6 pb-4 border-b border-border shrink-0">
            <DialogTitle>Credit Card Repayment</DialogTitle>
            <DialogDescription>
              Settle credit card liability from your bank account without duplicating expenses.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleRepayment} className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">
              {/* Overview Header */}
              <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Total Outstanding</span>
                  <span className="text-lg font-black text-[#CC0000]">
                    {formatCurrency(card.currentOutstanding, 'INR')}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800 text-xs">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-slate-400 block font-semibold">Previous-Cycle Due</span>
                    <span className="font-mono font-bold text-slate-200">
                      {formatCurrency(data.previousCycleOutstanding, 'INR')}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-slate-400 block font-semibold">Ongoing-Cycle</span>
                    <span className="font-mono font-bold text-slate-200">
                      {formatCurrency(data.ongoingCycleOutstanding, 'INR')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Source Bank Account */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Source Bank Account *
                </label>
                <Select
                  value={repaymentSourceAccountId || undefined}
                  onValueChange={setRepaymentSourceAccountId}
                >
                  <SelectTrigger className="h-10 text-sm">
                    <SelectValue placeholder="Select Bank Account *" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.accountName} (Balance: {formatCurrency(acc.currentBalance, acc.currency)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Repayment Mode Selection */}
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
                  Repayment Mode *
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setRepaymentMode(CreditCardRepaymentMode.FULL_CURRENT)}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      repaymentMode === CreditCardRepaymentMode.FULL_CURRENT
                        ? 'border-primary bg-primary/10 text-primary font-bold'
                        : 'border-border/60 hover:bg-muted/40 text-muted-foreground'
                    }`}
                  >
                    <div className="font-semibold text-foreground text-xs">Full Outstanding</div>
                    <div className="font-mono text-[11px] text-[#CC0000]">
                      {formatCurrency(card.currentOutstanding, 'INR')}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRepaymentMode(CreditCardRepaymentMode.PREVIOUS_CYCLE)}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      repaymentMode === CreditCardRepaymentMode.PREVIOUS_CYCLE
                        ? 'border-primary bg-primary/10 text-primary font-bold'
                        : 'border-border/60 hover:bg-muted/40 text-muted-foreground'
                    }`}
                  >
                    <div className="font-semibold text-foreground text-xs">Previous-Cycle</div>
                    <div className="font-mono text-[11px] text-foreground">
                      {formatCurrency(data.previousCycleOutstanding, 'INR')}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRepaymentMode(CreditCardRepaymentMode.STATEMENT_DUE)}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      repaymentMode === CreditCardRepaymentMode.STATEMENT_DUE
                        ? 'border-primary bg-primary/10 text-primary font-bold'
                        : 'border-border/60 hover:bg-muted/40 text-muted-foreground'
                    }`}
                  >
                    <div className="font-semibold text-foreground text-xs">Statement Due</div>
                    <div className="font-mono text-[11px] text-foreground">
                      {formatCurrency(data.latestStatement?.remainingBalance ?? data.previousCycleOutstanding, 'INR')}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRepaymentMode(CreditCardRepaymentMode.CUSTOM_PARTIAL)}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      repaymentMode === CreditCardRepaymentMode.CUSTOM_PARTIAL
                        ? 'border-primary bg-primary/10 text-primary font-bold'
                        : 'border-border/60 hover:bg-muted/40 text-muted-foreground'
                    }`}
                  >
                    <div className="font-semibold text-foreground text-xs">Custom Partial</div>
                    <div className="text-[11px] text-muted-foreground">Specify amount</div>
                  </button>
                </div>
              </div>

              {repaymentMode === CreditCardRepaymentMode.CUSTOM_PARTIAL && (
                <div className="space-y-1.5 animate-in fade-in duration-150">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Custom Repayment Amount *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono font-bold"
                    value={repaymentAmount}
                    onChange={(e) => setRepaymentAmount(e.target.value)}
                    required={repaymentMode === CreditCardRepaymentMode.CUSTOM_PARTIAL}
                  />
                </div>
              )}

              {/* Reward Points / Cashback Redemption Toggle */}
              <div className="pt-2 border-t border-border/60 space-y-3">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="modalApplyRedemption"
                    checked={applyRedemption}
                    onChange={(e) => setApplyRedemption(e.target.checked)}
                    className="h-4 w-4 rounded border-input text-primary focus:ring-ring cursor-pointer"
                  />
                  <label
                    htmlFor="modalApplyRedemption"
                    className="text-xs font-semibold leading-none cursor-pointer select-none text-foreground flex items-center gap-1.5"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    Redeem Reward Points / Cashback against this Bill
                  </label>
                </div>

                {applyRedemption && (
                  <div className="p-3.5 rounded-lg border border-amber-500/30 bg-amber-500/5 space-y-3 animate-in fade-in duration-150">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Redemption Credit Amount (₹) *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="e.g. 750"
                        className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono font-bold"
                        value={redemptionCredit}
                        onChange={(e) => setRedemptionCredit(e.target.value)}
                        required={applyRedemption}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Redemption Remarks (Optional)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. HDFC Reward Points"
                        className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={redemptionNotes}
                        onChange={(e) => setRedemptionNotes(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Live Settlement Breakdown */}
              {(() => {
                let previewSettled = 0;
                if (repaymentMode === CreditCardRepaymentMode.FULL_CURRENT) {
                  previewSettled = card.currentOutstanding || 0;
                } else if (repaymentMode === CreditCardRepaymentMode.PREVIOUS_CYCLE) {
                  previewSettled = data.previousCycleOutstanding || 0;
                } else if (repaymentMode === CreditCardRepaymentMode.STATEMENT_DUE) {
                  previewSettled = data.latestStatement?.remainingBalance ?? data.previousCycleOutstanding ?? 0;
                } else {
                  previewSettled = parseFloat(repaymentAmount) || 0;
                }

                const previewRedemption = applyRedemption ? parseFloat(redemptionCredit) || 0 : 0;
                const previewNetBank = Math.max(0, previewSettled - previewRedemption);
                const remainingDebt = Math.max(0, (card.currentOutstanding || 0) - previewSettled);

                return (
                  <div className="p-3.5 rounded-xl border border-border bg-muted/30 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Card Liability Settled:</span>
                      <span className="font-mono font-bold text-foreground">
                        {formatCurrency(previewSettled, 'INR')}
                      </span>
                    </div>
                    {applyRedemption && (
                      <div className="flex items-center justify-between text-amber-500">
                        <span>Reward / Cashback Credit:</span>
                        <span className="font-mono font-bold">
                          - {formatCurrency(previewRedemption, 'INR')}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-1.5 border-t border-border/60 text-sm font-semibold">
                      <span className="text-foreground">Actual Bank Deduction:</span>
                      <span className="font-mono font-bold text-emerald-500">
                        {formatCurrency(previewNetBank, 'INR')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-0.5">
                      <span>Remaining Card Debt:</span>
                      <span className="font-mono font-bold text-foreground">
                        {formatCurrency(remainingDebt, 'INR')}
                      </span>
                    </div>
                  </div>
                );
              })()}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. October monthly bill full settlement"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={repaymentNotes}
                  onChange={(e) => setRepaymentNotes(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter className="p-4 border-t border-border bg-muted/20 shrink-0">
              <Button type="button" variant="outline" onClick={() => setShowRepaymentModal(false)}>
                Cancel
              </Button>
              <Button type="submit" isLoading={submitting}>
                Post Repayment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Refund Modal */}
      <Dialog open={showRefundModal} onOpenChange={setShowRefundModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Credit Card Refund</DialogTitle>
            <DialogDescription>
              Record a merchant refund or credit adjustment. Reduces credit card outstanding and increases available credit.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleRefund} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Refund Description / Merchant *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Amazon Return or Flight Cancellation"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={refundTitle}
                onChange={(e) => setRefundTitle(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Refund Amount (₹) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="0.00"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono font-bold"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Notes (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Order #1234 returned"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={refundNotes}
                onChange={(e) => setRefundNotes(e.target.value)}
              />
            </div>

            <DialogFooter className="pt-4 border-t border-border">
              <Button type="button" variant="outline" onClick={() => setShowRefundModal(false)}>
                Cancel
              </Button>
              <Button type="submit" isLoading={submitting}>
                Record Refund
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Card Modal */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Credit Card</DialogTitle>
            <DialogDescription>
              Update card limit, billing cycle closing day, payment due day, and rewards notes.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleUpdateCard} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Card Nickname *
                </label>
                <input
                  type="text"
                  required
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={editNickname}
                  onChange={(e) => setEditNickname(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Issuing Bank *
                </label>
                <input
                  type="text"
                  required
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={editBank}
                  onChange={(e) => setEditBank(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Card Network *
                </label>
                <Select
                  value={editNetwork}
                  onValueChange={(val) => setEditNetwork(val as CreditCardNetwork)}
                >
                  <SelectTrigger className="h-10 text-sm">
                    <SelectValue placeholder="Network" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={CreditCardNetwork.VISA}>Visa</SelectItem>
                    <SelectItem value={CreditCardNetwork.MASTERCARD}>Mastercard</SelectItem>
                    <SelectItem value={CreditCardNetwork.RUPAY}>RuPay</SelectItem>
                    <SelectItem value={CreditCardNetwork.AMEX}>American Express</SelectItem>
                    <SelectItem value={CreditCardNetwork.OTHER}>Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Last 4 Digits (Optional)
                </label>
                <input
                  type="text"
                  maxLength={4}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono"
                  value={editLastFour}
                  onChange={(e) => setEditLastFour(e.target.value)}
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Credit Limit (₹) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono font-bold"
                  value={editLimit}
                  onChange={(e) => setEditLimit(e.target.value)}
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cycle Closing Day (1–31) *
                </label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  required
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={editClosingDay}
                  onChange={(e) => setEditClosingDay(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Payment due date is automatically set to 15 calendar days after statement closing.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Rewards Notes (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. 5% cashback on Amazon, 2% on Dining"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={editRewards}
                onChange={(e) => setEditRewards(e.target.value)}
              />
            </div>

            <DialogFooter className="pt-4 border-t border-border flex flex-col sm:flex-row sm:justify-between items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowEditModal(false);
                  setShowDeleteModal(true);
                }}
                className="w-full sm:w-auto text-red-500 hover:text-red-400 hover:bg-red-500/10 text-xs gap-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Card
              </Button>
              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <Button type="button" variant="outline" onClick={() => setShowEditModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" isLoading={submitting}>
                  Save Changes
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Card Confirmation Modal */}
      <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
        <DialogContent className="max-w-md border-border bg-card">
          <DialogHeader>
            <div className="flex items-center gap-2 text-red-500 mb-1">
              <AlertCircle className="h-5 w-5" />
              <DialogTitle className="text-lg font-bold">Delete Credit Card</DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground">
              Are you sure you want to delete{' '}
              <span className="font-semibold text-foreground">{card?.cardNickname}</span>?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            {card && card.currentOutstanding > 0 && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-red-400 space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  Outstanding Balance Notice
                </p>
                <p>
                  This card currently has an outstanding balance of{' '}
                  <span className="font-mono font-bold text-foreground">
                    {formatCurrency(card.currentOutstanding, 'INR')}
                  </span>
                  .
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Recorded transactions and past reports will be preserved in your accounting history, but this card will be removed from your active credit cards.
                </p>
              </div>
            )}

            {card && card.currentOutstanding === 0 && (
              <p className="text-muted-foreground">
                This card has zero outstanding balance. Its past transaction records and financial reports will remain intact, and the card will be removed from your active accounts.
              </p>
            )}
          </div>

          <DialogFooter className="pt-3 border-t border-border flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={deleting}
              onClick={() => setShowDeleteModal(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={handleDeleteCard}
              className="gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deleting ? 'Deleting...' : 'Delete Card'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
