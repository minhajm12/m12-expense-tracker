'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
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
import { DatePicker } from '@/components/ui/date-picker';
import {
  CreditCard as CreditCardIcon,
  Plus,
  RefreshCw,
  ArrowDownLeft,
  RotateCcw,
  Calendar,
  ShieldCheck,
  Percent,
  CheckCircle2,
  FileText,
  Pencil,
  Sparkles,
} from 'lucide-react';
import {
  CreditCard,
  CreditCardNetwork,
  CreditCardRepaymentMode,
  BankAccount,
  CreditCardStatement,
  formatCurrency,
  parseDateInput,
  formatDateToInput,
} from '@finora/shared';
import { emitDataChange, useDataSync } from '@/lib/data-sync';

export default function CreditCardsPage() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showAddCardModal, setShowAddCardModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showRepaymentModal, setShowRepaymentModal] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [selectedCardForAction, setSelectedCardForAction] = useState<CreditCard | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Add Card Form State
  const [cardNickname, setCardNickname] = useState('');
  const [issuingBank, setIssuingBank] = useState('');
  const [network, setNetwork] = useState<CreditCardNetwork>(CreditCardNetwork.VISA);
  const [lastFourDigits, setLastFourDigits] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [closingDay, setClosingDay] = useState('15');
  const [openingOutstanding, setOpeningOutstanding] = useState('0');
  const [openingOutstandingDate, setOpeningOutstandingDate] = useState(() => formatDateToInput(new Date()));

  // Edit Card Form State
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editNickname, setEditNickname] = useState('');
  const [editBank, setEditBank] = useState('');
  const [editNetwork, setEditNetwork] = useState<CreditCardNetwork>(CreditCardNetwork.VISA);
  const [editLastFour, setEditLastFour] = useState('');
  const [editLimit, setEditLimit] = useState('');
  const [editClosingDay, setEditClosingDay] = useState('15');
  const [editAnnualFee, setEditAnnualFee] = useState('0');
  const [editRewards, setEditRewards] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // Repayment Form State
  const [repaymentCardId, setRepaymentCardId] = useState('');
  const [repaymentSourceAccountId, setRepaymentSourceAccountId] = useState('');
  const [repaymentAmount, setRepaymentAmount] = useState('');
  const [repaymentNotes, setRepaymentNotes] = useState('');
  const [repaymentMode, setRepaymentMode] = useState<CreditCardRepaymentMode>(CreditCardRepaymentMode.FULL_CURRENT);
  const [applyRedemption, setApplyRedemption] = useState(false);
  const [redemptionCredit, setRedemptionCredit] = useState('');
  const [redemptionNotes, setRedemptionNotes] = useState('');

  // Refund Form State
  const [refundTitle, setRefundTitle] = useState('');
  const [refundAmount, setRefundAmount] = useState('');

  const getApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const fetchData = async () => {
    setLoading(true);
    try {
      const [cardsRes, accsRes] = await Promise.all([
        fetch(`${getApiUrl()}/api/v1/credit-cards`, { credentials: 'include' }),
        fetch(`${getApiUrl()}/api/v1/accounts`, { credentials: 'include' }),
      ]);

      const [cardsJson, accsJson] = await Promise.all([cardsRes.json(), accsRes.json()]);

      if (cardsJson.success) {
        setCards(cardsJson.data || []);
        if (cardsJson.data?.length > 0 && !repaymentCardId) {
          setRepaymentCardId(cardsJson.data[0].id);
        }
      }
      if (accsJson.success) {
        setAccounts(accsJson.data || []);
        if (accsJson.data?.length > 0 && !repaymentSourceAccountId) {
          setRepaymentSourceAccountId(accsJson.data[0].id);
        }
      }
    } catch {
      toast.error('Network error loading credit card information');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchData();
    } else {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useDataSync(fetchData, ['credit-cards', 'transactions', 'accounts']);

  const handleCreateCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cardNickname || !issuingBank || !creditLimit) {
      toast.error('Nickname, bank, and limit are required');
      return;
    }

    setSubmitting(true);
    try {
      const parsedOpeningOutstanding = parseFloat(openingOutstanding) || 0;
      const res = await fetch(`${getApiUrl()}/api/v1/credit-cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          cardNickname,
          issuingBank,
          network,
          lastFourDigits: lastFourDigits || undefined,
          creditLimit: parseFloat(creditLimit),
          billingCycleClosingDay: parseInt(closingDay, 10),
          openingOutstanding: parsedOpeningOutstanding,
          openingOutstandingDate: openingOutstandingDate
            ? parseDateInput(openingOutstandingDate).toISOString()
            : new Date().toISOString(),
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`Credit card "${cardNickname}" added successfully!`);
        setShowAddCardModal(false);
        setCardNickname('');
        setIssuingBank('');
        setLastFourDigits('');
        setCreditLimit('');
        setClosingDay('15');
        setOpeningOutstanding('0');
        setOpeningOutstandingDate(formatDateToInput(new Date()));
        fetchData();
      } else {
        toast.error(json.error?.message || 'Failed to create credit card');
      }
    } catch {
      toast.error('Network error creating card');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenEditCard = (card: CreditCard) => {
    setEditingCardId(card.id);
    setEditNickname(card.cardNickname);
    setEditBank(card.issuingBank);
    setEditNetwork(card.network);
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
    if (!editingCardId || !editNickname || !editBank || !editLimit) {
      toast.error('Card nickname, bank, and credit limit are required');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/credit-cards/${editingCardId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          cardNickname: editNickname,
          issuingBank: editBank,
          network: editNetwork,
          lastFourDigits: editLastFour || undefined,
          creditLimit: parseFloat(editLimit),
          billingCycleClosingDay: parseInt(editClosingDay, 10),
          annualFee: parseFloat(editAnnualFee) || 0,
          rewardsNotes: editRewards || undefined,
          notes: editNotes || undefined,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`Credit card "${editNickname}" updated successfully!`);
        setShowEditModal(false);
        setEditingCardId(null);
        fetchData();
      } else {
        toast.error(json.error?.message || 'Failed to update credit card');
      }
    } catch {
      toast.error('Network error updating card');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRepayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const selectedCard = cards.find((c) => c.id === repaymentCardId);
    if (!repaymentCardId || !repaymentSourceAccountId) {
      toast.error('Please select card and source bank account');
      return;
    }

    const outstanding = selectedCard?.currentOutstanding || 0;
    const prevCycleDue = selectedCard?.previousCycleOutstanding ?? 0;
    const stmtDue = selectedCard?.latestStatementRemaining ?? prevCycleDue;

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
    if (selectedCard && liabilitySettled > outstanding) {
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
          creditCardId: repaymentCardId,
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
        setRepaymentAmount('');
        setRepaymentNotes('');
        setApplyRedemption(false);
        setRedemptionCredit('');
        setRedemptionNotes('');
        setRepaymentMode(CreditCardRepaymentMode.FULL_CURRENT);
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
    if (!selectedCardForAction || !refundAmount || !refundTitle) {
      toast.error('Refund amount and title are required');
      return;
    }

    setSubmitting(true);
    try {
      const idempotencyKey = `refund-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const res = await fetch(`${getApiUrl()}/api/v1/credit-cards/${selectedCardForAction.id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          amount: parseFloat(refundAmount),
          title: refundTitle,
          idempotencyKey,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Refund recorded! Card balance reduced consistently.');
        setShowRefundModal(false);
        setRefundAmount('');
        setRefundTitle('');
        fetchData();
        emitDataChange('credit-cards');
      } else {
        toast.error(json.error?.message || 'Refund failed');
      }
    } catch {
      toast.error('Network error recording refund');
    } finally {
      setSubmitting(false);
    }
  };

  const totalOutstanding = cards.reduce((sum, c) => sum + (c.currentOutstanding || 0), 0);
  const totalLimit = cards.reduce((sum, c) => sum + (c.creditLimit || 0), 0);
  const totalAvailable = cards.reduce((sum, c) => sum + (c.availableCredit || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Credit Card Management</h1>
            <Badge variant="default">{cards.length} Cards</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Double-entry liability accounting: purchases count as expenses once; repayments settle debt without double-counting
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {cards.length > 0 && accounts.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRepaymentModal(true)}
              className="gap-2"
            >
              <ArrowDownLeft className="h-4 w-4" />
              Pay Card Bill
            </Button>
          )}
          <Button onClick={() => setShowAddCardModal(true)} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Add Credit Card
          </Button>
        </div>
      </div>

      {/* Aggregate Cards Overview Banner */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="bg-card-gradient text-white border-black-900/40 shadow-xl">
          <CardContent className="p-6">
            <p className="text-xs uppercase font-semibold tracking-wider text-white-200">
              Total Outstanding Debt
            </p>
            <h2 className="text-3xl font-extrabold tracking-tight text-[#CC0000] mt-1">
              {formatCurrency(totalOutstanding, user?.currency || 'INR')}
            </h2>
            <p className="text-xs text-white-400 mt-1">
              {totalLimit > 0 ? `${Math.round((totalOutstanding / totalLimit) * 100)}% total credit utilization` : 'No active limits'}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card-gradient text-white border-black-800">
          <CardContent className="p-6">
            <p className="text-xs uppercase font-semibold tracking-wider text-white-400">
              Total Available Credit
            </p>
            <h2 className="text-3xl font-extrabold tracking-tight text-emerald-400 mt-1">
              {formatCurrency(totalAvailable, user?.currency || 'INR')}
            </h2>
            <p className="text-xs text-white -400 mt-1">
              Aggregate unused credit line ready for deployment
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card-gradient text-white border-black-800">
          <CardContent className="p-6">
            <p className="text-xs uppercase font-semibold tracking-wider text-white-400">
              Total Credit Limit
            </p>
            <h2 className="text-3xl font-extrabold tracking-tight text-white mt-1">
              {formatCurrency(totalLimit, user?.currency || 'INR')}
            </h2>
            <p className="text-xs text-white -400 mt-1">
              Across {cards.length} financial credit facilities
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Credit Cards Grid */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      ) : cards.length === 0 ? (
        <EmptyState
          icon={CreditCardIcon}
          title="No credit cards registered"
          description="Add your first card to record credit purchases, track billing cycles, and settle repayments seamlessly."
          actionLabel="Add Credit Card"
          onAction={() => setShowAddCardModal(true)}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {cards.map((c) => {
            const utilization = c.creditLimit > 0 ? Math.round((c.currentOutstanding / c.creditLimit) * 100) : 0;

            return (
              <div
                key={c.id}
                onClick={() => router.push(`/credit-cards/${c.id}`)}
                className="relative overflow-hidden rounded-2xl p-6 bg-card-gradient text-white shadow-xl border border-black-800 transition-all hover:border-primary/60 cursor-pointer group flex flex-col justify-between"
              >
                <div>
                  {/* Top Card Info */}
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-xs font-semibold tracking-wider uppercase text-emerald-400">
                        {c.issuingBank}
                      </span>
                      <h3 className="text-xl font-bold tracking-tight text-white mt-0.5 group-hover:text-primary transition-colors">
                        {c.cardNickname}
                      </h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="bg-white/10 text-white border-white/20 uppercase font-bold text-xs">
                        {c.network}
                      </Badge>
                    </div>
                  </div>

                  {/* Masked Card Number & Chip */}
                  <div className="my-5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-7 w-10 rounded-md bg-amber-400/90 shadow-inner flex items-center justify-center">
                        <div className="h-4 w-7 border border-amber-600/60 rounded-sm" />
                      </div>
                      <span className="font-mono text-base tracking-widest text-slate-300">
                        •••• •••• •••• {c.lastFourDigits || '••••'}
                      </span>
                    </div>
                    <span className="text-xs text-slate-400 group-hover:text-primary transition-colors flex items-center gap-1">
                      Details &rarr;
                    </span>
                  </div>

                  {/* Balances & Utilization */}
                  <div className="space-y-3 pt-2 border-t border-slate-800">
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-[11px] text-slate-400 uppercase font-semibold">Current Outstanding</p>
                        <p className="text-2xl font-black text-[#CC0000]">
                          {formatCurrency(c.currentOutstanding, 'INR')}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-slate-400 uppercase font-semibold">Available Credit</p>
                        <p className="text-xl font-bold text-[#fff]">
                          {formatCurrency(c.availableCredit, 'INR')}
                        </p>
                      </div>
                    </div>

                    {/* Cycle Breakdown */}
                    <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                      <div className="rounded-lg bg-slate-900/80 p-2 border border-slate-800">
                        <span className="text-[10px] uppercase tracking-wider text-slate-400 block font-semibold">
                          Previous-Cycle
                        </span>
                        <span className="font-mono font-bold text-slate-200">
                          {formatCurrency(c.previousCycleOutstanding ?? 0, 'INR')}
                        </span>
                      </div>
                      <div className="rounded-lg bg-slate-900/80 p-2 border border-slate-800">
                        <span className="text-[10px] uppercase tracking-wider text-slate-400 block font-semibold">
                          Ongoing-Cycle
                        </span>
                        <span className="font-mono font-bold text-slate-200">
                          {formatCurrency(c.ongoingCycleOutstanding ?? 0, 'INR')}
                        </span>
                      </div>
                    </div>

                    {/* Utilization Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] text-slate-400">
                        <span>Credit Utilization</span>
                        <span className={utilization > 70 ? 'text-amber-400 font-bold' : 'text-slate-300'}>
                          {utilization}% (Limit: {formatCurrency(c.creditLimit, 'INR')})
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            utilization > 80
                              ? 'bg-[#CC0000]'
                              : utilization > 50
                              ? 'bg-amber-500'
                              : 'bg-[#fff]'
                          }`}
                          style={{ width: `${Math.min(utilization, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Cycle & Due Date Footer */}
                <div className="flex items-center justify-between text-xs text-slate-400 pt-3 mt-2 border-t border-slate-800/60">
                  <span className="flex items-center gap-1 text-[11px]">
                    <Calendar className="h-3.5 w-3.5" />
                    Closes: {c.billingCycleClosingDay}th | Due: {c.nextPaymentDueDate ? new Date(c.nextPaymentDueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '15 days after closing'}
                  </span>
                  <div className="flex items-center space-x-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenEditCard(c);
                      }}
                      className="text-xs text-slate-300 hover:text-white underline underline-offset-2 flex items-center gap-1"
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedCardForAction(c);
                        setShowRefundModal(true);
                      }}
                      className="text-xs text-slate-300 hover:text-white underline underline-offset-2"
                    >
                      Refund
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRepaymentCardId(c.id);
                        setRepaymentMode(CreditCardRepaymentMode.FULL_CURRENT);
                        setRepaymentAmount(c.currentOutstanding.toString());
                        setShowRepaymentModal(true);
                      }}
                      className="text-xs text-[#fff] hover:text-[#05A100]/80 font-semibold underline underline-offset-2"
                    >
                      Repay
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Credit Card Modal */}
      <Dialog open={showAddCardModal} onOpenChange={setShowAddCardModal}>
        <DialogContent className="max-w-lg md:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Credit Card</DialogTitle>
            <DialogDescription>
              M12 Expense Tracker tracks card liabilities securely without requiring full card numbers, CVVs, or PINs.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateCard} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Card Nickname *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Infinia Metal, Sapphire"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={cardNickname}
                  onChange={(e) => setCardNickname(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Issuing Bank *
                </label>
                <input
                  type="text"
                  placeholder="e.g. HDFC Bank, Chase, SBI"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={issuingBank}
                  onChange={(e) => setIssuingBank(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Network
                </label>
                <Select
                  value={network}
                  onValueChange={(val) => setNetwork(val as CreditCardNetwork)}
                >
                  <SelectTrigger className="h-10 text-sm uppercase">
                    <SelectValue placeholder="Network" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(CreditCardNetwork).map((n) => (
                      <SelectItem key={n} value={n} className="uppercase">
                        {n}
                      </SelectItem>
                    ))}
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
                  placeholder="4321"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono"
                  value={lastFourDigits}
                  onChange={(e) => setLastFourDigits(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Credit Limit *
                </label>
                <input
                  type="number"
                  step="1"
                  placeholder="100000"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono font-bold"
                  value={creditLimit}
                  onChange={(e) => setCreditLimit(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cycle Closing Day (1-31) *
                </label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono"
                  value={closingDay}
                  onChange={(e) => setClosingDay(e.target.value)}
                  required
                />
                <p className="text-[11px] text-muted-foreground">
                  Payment due date is automatically set to 15 calendar days after statement closing.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Opening Outstanding (if any)
                </label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono"
                  value={openingOutstanding}
                  onChange={(e) => setOpeningOutstanding(e.target.value)}
                />
              </div>

              {parseFloat(openingOutstanding) > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Outstanding As Of Date *
                  </label>
                  <DatePicker
                    value={openingOutstandingDate}
                    onChange={setOpeningOutstandingDate}
                    placeholder="Select date of outstanding balance"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Accurately places the opening balance in its appropriate billing cycle.
                  </p>
                </div>
              )}
            </div>

            <DialogFooter className="pt-4 border-t border-border">
              <Button type="button" variant="outline" onClick={() => setShowAddCardModal(false)}>
                Cancel
              </Button>
              <Button type="submit" isLoading={submitting}>
                Save Credit Card
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Repayment Modal */}
      <Dialog open={showRepaymentModal} onOpenChange={setShowRepaymentModal}>
        <DialogContent className="max-w-lg max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="p-6 pb-4 border-b border-border shrink-0">
            <DialogTitle>Credit Card Repayment</DialogTitle>
            <DialogDescription>
              Settle credit card liability from a bank account. Reduces bank balance and card outstanding without counting as a second expense.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleRepayment} className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Target Credit Card *
                </label>
                <Select
                  value={repaymentCardId || undefined}
                  onValueChange={setRepaymentCardId}
                >
                  <SelectTrigger className="h-10 text-sm">
                    <SelectValue placeholder="Select Credit Card *" />
                  </SelectTrigger>
                  <SelectContent>
                    {cards.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.cardNickname} (Outstanding: {formatCurrency(c.currentOutstanding, 'INR')})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

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

              {/* Repayment Card Balance Overview */}
              {(() => {
                const selectedCard = cards.find((c) => c.id === repaymentCardId);
                if (!selectedCard) return null;
                return (
                  <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Total Outstanding</span>
                      <span className="text-lg font-black text-[#CC0000]">
                        {formatCurrency(selectedCard.currentOutstanding, 'INR')}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800 text-xs">
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-slate-400 block font-semibold">Previous-Cycle Due</span>
                        <span className="font-mono font-bold text-slate-200">
                          {formatCurrency(selectedCard.previousCycleOutstanding ?? 0, 'INR')}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-slate-400 block font-semibold">Ongoing-Cycle</span>
                        <span className="font-mono font-bold text-slate-200">
                          {formatCurrency(selectedCard.ongoingCycleOutstanding ?? 0, 'INR')}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Repayment Mode Selection */}
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
                  Repayment Mode *
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {(() => {
                    const selectedCard = cards.find((c) => c.id === repaymentCardId);
                    const total = selectedCard?.currentOutstanding || 0;
                    const prev = selectedCard?.previousCycleOutstanding ?? 0;
                    const stmt = selectedCard?.latestStatementRemaining ?? prev;

                    return (
                      <>
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
                          <div className="font-mono text-[11px] text-[#CC0000]">{formatCurrency(total, 'INR')}</div>
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
                          <div className="font-mono text-[11px] text-foreground">{formatCurrency(prev, 'INR')}</div>
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
                          <div className="font-mono text-[11px] text-foreground">{formatCurrency(stmt, 'INR')}</div>
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
                      </>
                    );
                  })()}
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
                    id="applyRedemptionCheckbox"
                    checked={applyRedemption}
                    onChange={(e) => setApplyRedemption(e.target.checked)}
                    className="h-4 w-4 rounded border-input text-primary focus:ring-ring cursor-pointer"
                  />
                  <label
                    htmlFor="applyRedemptionCheckbox"
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
                        Redemption Source / Remarks (Optional)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. HDFC Reward Points or Cred Cashback"
                        className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={redemptionNotes}
                        onChange={(e) => setRedemptionNotes(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Live Settlement & Bank Deduction Breakdown */}
              {(() => {
                const selectedCard = cards.find((c) => c.id === repaymentCardId);
                const prev = selectedCard?.previousCycleOutstanding ?? 0;
                const stmt = selectedCard?.latestStatementRemaining ?? prev;

                let previewSettled = 0;
                if (repaymentMode === CreditCardRepaymentMode.FULL_CURRENT) {
                  previewSettled = selectedCard?.currentOutstanding || 0;
                } else if (repaymentMode === CreditCardRepaymentMode.PREVIOUS_CYCLE) {
                  previewSettled = prev;
                } else if (repaymentMode === CreditCardRepaymentMode.STATEMENT_DUE) {
                  previewSettled = stmt;
                } else {
                  previewSettled = parseFloat(repaymentAmount) || 0;
                }

                const previewRedemption = applyRedemption ? parseFloat(redemptionCredit) || 0 : 0;
                const previewNetBank = Math.max(0, previewSettled - previewRedemption);
                const remainingDebt = Math.max(0, (selectedCard?.currentOutstanding || 0) - previewSettled);

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
                      <span>Remaining Card Debt after Repayment:</span>
                      <span className="font-mono font-bold text-foreground">
                        {formatCurrency(remainingDebt, 'INR')}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground pt-0.5">
                      Only the net bank deduction is debited from your bank account. Card debt is settled by the full liability amount.
                    </p>
                  </div>
                );
              })()}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Monthly bill settlement"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      <Dialog
        open={Boolean(showRefundModal && selectedCardForAction)}
        onOpenChange={(open) => {
          if (!open) {
            setShowRefundModal(false);
            setSelectedCardForAction(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Merchant Refund</DialogTitle>
            <DialogDescription>
              Refund against {selectedCardForAction?.cardNickname}. Directly reduces card outstanding and net expense.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleRefund} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Refund Description *
              </label>
              <input
                type="text"
                placeholder="e.g. Returned Item, Cancelled Flight"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={refundTitle}
                onChange={(e) => setRefundTitle(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Refund Amount *
              </label>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono font-bold"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                required
              />
            </div>

            <DialogFooter className="pt-4 border-t border-border">
              <Button type="button" variant="outline" onClick={() => setShowRefundModal(false)}>
                Cancel
              </Button>
              <Button type="submit" isLoading={submitting}>
                Post Refund
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Credit Card Modal */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Credit Card</DialogTitle>
            <DialogDescription>
              Update card limits, cycle dates, and nickname. Outstanding liabilities are preserved.
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
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={editNickname}
                  onChange={(e) => setEditNickname(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Issuing Bank *
                </label>
                <input
                  type="text"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={editBank}
                  onChange={(e) => setEditBank(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Card Network
                </label>
                <Select
                  value={editNetwork}
                  onValueChange={(val) => setEditNetwork(val as CreditCardNetwork)}
                >
                  <SelectTrigger className="h-10 text-sm">
                    <SelectValue placeholder="Card Network" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(CreditCardNetwork).map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}
                      </SelectItem>
                    ))}
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
                  onChange={(e) => setEditLastFour(e.target.value.replace(/\D/g, ''))}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Total Credit Limit *
                </label>
                <input
                  type="number"
                  step="0.01"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono font-bold"
                  value={editLimit}
                  onChange={(e) => setEditLimit(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Annual Fee
                </label>
                <input
                  type="number"
                  step="0.01"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono"
                  value={editAnnualFee}
                  onChange={(e) => setEditAnnualFee(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cycle Closing Day (1-31) *
                </label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono"
                  value={editClosingDay}
                  onChange={(e) => setEditClosingDay(e.target.value)}
                  required
                />
                <p className="text-[11px] text-muted-foreground">
                  Payment due date is automatically set to 15 calendar days after statement closing.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Rewards / Notes (Optional)
              </label>
              <textarea
                placeholder="e.g. 5% cashback on groceries and dining..."
                className="flex min-h-[60px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={editRewards}
                onChange={(e) => setEditRewards(e.target.value)}
              />
            </div>

            <DialogFooter className="pt-4 border-t border-border">
              <Button type="button" variant="outline" onClick={() => setShowEditModal(false)}>
                Cancel
              </Button>
              <Button type="submit" isLoading={submitting}>
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
