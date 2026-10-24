'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useDataSync, emitDataChange } from '@/lib/data-sync';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
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
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import {
  Landmark,
  ArrowLeft,
  Calendar,
  CheckCircle,
  Clock,
  Play,
  Edit,
  Trash2,
  FileText,
  ShieldCheck,
  AlertCircle,
  CreditCard,
  Wallet,
  Building2,
  Tag,
  DollarSign,
  History,
  ListOrdered,
  RefreshCw,
} from 'lucide-react';
import {
  formatCurrency,
  PaymentMethod,
  PaymentChannel,
  EmiStatus,
  EmiOccurrenceStatus,
  EmiRule,
  EmiOccurrence,
} from '@finora/shared';

export default function EmiDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const { user } = useAuth();

  const [emi, setEmi] = useState<EmiRule | null>(null);
  const [occurrences, setOccurrences] = useState<EmiOccurrence[]>([]);
  const [accounts, setAccounts] = useState<Array<{ id: string; accountName: string }>>([]);
  const [cards, setCards] = useState<Array<{ id: string; cardNickname: string }>>([]);
  const [loading, setLoading] = useState(true);

  // Tab State: 'schedule' | 'history'
  const [activeTab, setActiveTab] = useState<'schedule' | 'history'>('schedule');

  // Pay Modal State
  const [payOccurrence, setPayOccurrence] = useState<EmiOccurrence | null>(null);
  const [showPayModal, setShowPayModal] = useState(false);
  const [payActualAmount, setPayActualAmount] = useState('');
  const [payDiscountType, setPayDiscountType] = useState<'none' | 'fixed' | 'percentage' | 'override'>('none');
  const [payDiscountValue, setPayDiscountValue] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payPaymentMethod, setPayPaymentMethod] = useState<PaymentMethod>(PaymentMethod.UPI);
  const [payAccountId, setPayAccountId] = useState('');
  const [payCreditCardId, setPayCreditCardId] = useState('');
  const [payUpdateFutureDefaults, setPayUpdateFutureDefaults] = useState(false);
  const [submittingPay, setSubmittingPay] = useState(false);

  // Edit Historical Modal State
  const [editingHistoricalOcc, setEditingHistoricalOcc] = useState<EmiOccurrence | null>(null);
  const [histActualAmount, setHistActualAmount] = useState('');
  const [histNotes, setHistNotes] = useState('');
  const [submittingHistorical, setSubmittingHistorical] = useState(false);

  // View Transaction Details Modal State
  const [viewTxOcc, setViewTxOcc] = useState<EmiOccurrence | null>(null);
  const [deletingTx, setDeletingTx] = useState(false);

  // Edit EMI Settings Modal State
  const [showEditEmiModal, setShowEditEmiModal] = useState(false);
  const [editMonthlyAmount, setEditMonthlyAmount] = useState('');
  const [editNextEmiDate, setEditNextEmiDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editPaymentMethod, setEditPaymentMethod] = useState<PaymentMethod>(PaymentMethod.UPI);
  const [editAccountId, setEditAccountId] = useState('');
  const [editCreditCardId, setEditCreditCardId] = useState('');
  const [submittingEditEmi, setSubmittingEditEmi] = useState(false);

  const getApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const fetchEmiDetails = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [emiRes, accRes, cardRes] = await Promise.all([
        fetch(`${getApiUrl()}/api/v1/emi/${id}`, { credentials: 'include' }),
        fetch(`${getApiUrl()}/api/v1/accounts`, { credentials: 'include' }),
        fetch(`${getApiUrl()}/api/v1/credit-cards`, { credentials: 'include' }),
      ]);

      const [emiJson, accJson, cardJson] = await Promise.all([
        emiRes.json(),
        accRes.json(),
        cardRes.json(),
      ]);

      if (emiRes.ok && emiJson.success) {
        setEmi(emiJson.data);
        setOccurrences(emiJson.data.occurrences || []);
      } else {
        toast.error(emiJson.error?.message || 'EMI schedule not found');
      }

      if (accRes.ok && accJson.success) setAccounts(accJson.data || []);
      if (cardRes.ok && cardJson.success) setCards(cardJson.data || []);
    } catch {
      toast.error('Network error loading EMI details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmiDetails();
  }, [id]);

  useDataSync(fetchEmiDetails, ['transactions', 'emi', 'accounts', 'recurring']);

  // Pay EMI Calculation
  const getPayCalculation = () => {
    if (!payOccurrence || !emi) return { discountAmount: 0, finalAmount: 0 };
    const original = payOccurrence.expectedAmount || emi.monthlyAmount;
    let discountAmount = 0;
    let finalAmount = original;

    if (payDiscountType === 'fixed') {
      const val = parseFloat(payDiscountValue) || 0;
      discountAmount = Math.max(0, Math.min(original, val));
      finalAmount = Math.max(0, original - discountAmount);
    } else if (payDiscountType === 'percentage') {
      const pct = Math.max(0, Math.min(100, parseFloat(payDiscountValue) || 0));
      discountAmount = Math.round(((original * pct) / 100) * 100) / 100;
      finalAmount = Math.max(0, original - discountAmount);
    } else if (payDiscountType === 'override') {
      const val = parseFloat(payDiscountValue) || 0;
      finalAmount = Math.max(0, val);
      discountAmount = Math.max(0, original - finalAmount);
    }

    return { discountAmount, finalAmount };
  };

  const openPayModal = (occ: EmiOccurrence) => {
    if (!emi) return;
    setPayOccurrence(occ);
    setPayDiscountType('none');
    setPayDiscountValue('');
    setPayNotes('');
    setPayPaymentMethod(emi.paymentMethod || PaymentMethod.UPI);
    setPayAccountId(emi.accountId || (accounts.length > 0 ? accounts[0].id : ''));
    setPayCreditCardId(emi.creditCardId || (cards.length > 0 ? cards[0].id : ''));
    setPayUpdateFutureDefaults(false);
    setShowPayModal(true);
  };

  const handleConfirmPay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emi || !payOccurrence) return;

    const { discountAmount, finalAmount } = getPayCalculation();
    if (finalAmount <= 0) {
      toast.error('Payment amount must be greater than 0');
      return;
    }

    if (payPaymentMethod === PaymentMethod.CREDIT_CARD && !payCreditCardId) {
      toast.error('Please select a credit card for payment');
      return;
    }
    if (
      (payPaymentMethod === PaymentMethod.UPI ||
        payPaymentMethod === PaymentMethod.BANK_TRANSFER ||
        payPaymentMethod === PaymentMethod.DEBIT_CARD) &&
      !payAccountId
    ) {
      toast.error('Please select a bank account for payment');
      return;
    }

    setSubmittingPay(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/emi/${emi.id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          occurrenceKey: payOccurrence.occurrenceKey,
          actualAmount: finalAmount,
          discountAmount,
          discountType: payDiscountType,
          discountNotes: payNotes.trim() || undefined,
          paymentMethod: payPaymentMethod,
          accountId:
            payPaymentMethod !== PaymentMethod.CREDIT_CARD && payPaymentMethod !== PaymentMethod.CASH
              ? payAccountId || undefined
              : undefined,
          creditCardId: payPaymentMethod === PaymentMethod.CREDIT_CARD ? payCreditCardId || undefined : undefined,
          updateFuturePaymentSettings: payUpdateFutureDefaults,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(
          discountAmount > 0
            ? `Installment #${payOccurrence.installmentNumber} paid! ₹${finalAmount.toLocaleString()} recorded.`
            : `Installment #${payOccurrence.installmentNumber} paid successfully!`
        );
        setShowPayModal(false);
        setPayOccurrence(null);
        fetchEmiDetails();
        emitDataChange('transactions');
        emitDataChange('accounts');
        emitDataChange('emi');
      } else {
        toast.error(json.error?.message || 'Failed to pay installment');
      }
    } catch {
      toast.error('Network error paying installment');
    } finally {
      setSubmittingPay(false);
    }
  };

  // Open Edit Historical Modal
  const openEditHistorical = (occ: EmiOccurrence) => {
    setEditingHistoricalOcc(occ);
    setHistActualAmount((occ.actualAmountPaid ?? occ.expectedAmount).toString());
    setHistNotes(occ.notes || '');
  };

  const handleSaveHistorical = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emi || !editingHistoricalOcc) return;
    const amountVal = parseFloat(histActualAmount);
    if (isNaN(amountVal) || amountVal <= 0) {
      toast.error('Actual amount must be greater than 0');
      return;
    }

    setSubmittingHistorical(true);
    try {
      const res = await fetch(
        `${getApiUrl()}/api/v1/emi/${emi.id}/installments/${editingHistoricalOcc.occurrenceKey}/historical`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            actualAmount: amountVal,
            notes: histNotes,
          }),
        }
      );

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Historical installment updated successfully. (No bank balances affected)');
        setEditingHistoricalOcc(null);
        fetchEmiDetails();
        emitDataChange('emi');
      } else {
        toast.error(json.error?.message || 'Failed to update historical installment');
      }
    } catch {
      toast.error('Network error updating historical installment');
    } finally {
      setSubmittingHistorical(false);
    }
  };

  // Delete Linked Transaction
  const handleDeleteTransaction = async () => {
    if (!viewTxOcc?.transactionId) return;
    const txId = typeof viewTxOcc.transactionId === 'object' ? (viewTxOcc.transactionId as any)._id : viewTxOcc.transactionId;
    if (!confirm(`Delete linked transaction and reopen installment #${viewTxOcc.installmentNumber}?`)) return;

    setDeletingTx(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/transactions/${txId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`Transaction deleted. Installment #${viewTxOcc.installmentNumber} reopened to DUE.`);
        setViewTxOcc(null);
        fetchEmiDetails();
        emitDataChange('transactions');
        emitDataChange('accounts');
        emitDataChange('emi');
      } else {
        toast.error(json.error?.message || 'Failed to delete transaction');
      }
    } catch {
      toast.error('Network error deleting transaction');
    } finally {
      setDeletingTx(false);
    }
  };

  // Open Edit EMI Settings Modal
  const openEditEmiModal = () => {
    if (!emi) return;
    setEditMonthlyAmount(emi.monthlyAmount.toString());
    setEditNextEmiDate(emi.nextEmiDate ? emi.nextEmiDate.split('T')[0] : '');
    setEditEndDate(emi.endDate.split('T')[0]);
    setEditNotes(emi.notes || '');
    setEditPaymentMethod(emi.paymentMethod || PaymentMethod.UPI);
    setEditAccountId(emi.accountId || (accounts.length > 0 ? accounts[0].id : ''));
    setEditCreditCardId(emi.creditCardId || (cards.length > 0 ? cards[0].id : ''));
    setShowEditEmiModal(true);
  };

  const handleSaveEditEmi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emi) return;
    const amountVal = parseFloat(editMonthlyAmount);
    if (isNaN(amountVal) || amountVal <= 0) {
      toast.error('Monthly amount must be positive');
      return;
    }

    setSubmittingEditEmi(true);
    try {
      const payload: Record<string, any> = {
        monthlyAmount: amountVal,
        endDate: editEndDate,
        paymentMethod: editPaymentMethod,
        accountId:
          editPaymentMethod !== PaymentMethod.CREDIT_CARD && editPaymentMethod !== PaymentMethod.CASH
            ? editAccountId || undefined
            : undefined,
        creditCardId: editPaymentMethod === PaymentMethod.CREDIT_CARD ? editCreditCardId || undefined : undefined,
        notes: editNotes,
      };
      if (editNextEmiDate) {
        payload.nextEmiDate = editNextEmiDate;
      }

      const res = await fetch(`${getApiUrl()}/api/v1/emi/${emi.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('EMI schedule updated successfully');
        setShowEditEmiModal(false);
        fetchEmiDetails();
        emitDataChange('emi');
      } else {
        toast.error(json.error?.message || 'Failed to update EMI settings');
      }
    } catch {
      toast.error('Network error updating EMI settings');
    } finally {
      setSubmittingEditEmi(false);
    }
  };

  const now = new Date();

  if (loading && !emi) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto pb-12">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-48 w-full rounded-2xl" />
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!emi) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center space-y-4">
        <h2 className="text-xl font-bold text-foreground">EMI Schedule Not Found</h2>
        <p className="text-sm text-muted-foreground">The requested EMI record does not exist or has been removed.</p>
        <Link href="/emi">
          <Button variant="outline">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to EMI Management
          </Button>
        </Link>
      </div>
    );
  }

  const isCompleted = emi.status === EmiStatus.COMPLETED;
  const paidCount = emi.paidInstallmentsCount || 0;
  const totalCount = emi.totalInstallments || occurrences.length || 1;
  const progressPercent = Math.min(100, Math.round((paidCount / totalCount) * 100));
  const hasDownPayment = Boolean(emi.downPaymentAmount && emi.downPaymentAmount > 0);

  // Find next unpaid installment
  const nextUnpaidInstallment = occurrences.find(
    (o) => o.status !== EmiOccurrenceStatus.PAID && o.status !== EmiOccurrenceStatus.PAID_HISTORICAL
  );

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      {/* Navigation & Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link href="/emi">
            <Button variant="outline" size="sm" className="h-9 px-3">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              All EMIs
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{emi.name}</h1>
              <Badge variant={isCompleted ? 'default' : 'outline'} className="text-[10px] uppercase font-bold">
                {isCompleted ? 'Completed' : 'Active'}
              </Badge>
              <Badge variant="secondary" className="text-[10px]">
                {emi.lender}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Loan Ref: {emi.loanReference || 'N/A'} • Due on day {emi.dueDay} of each month
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={openEditEmiModal} className="text-xs">
            <Edit className="h-3.5 w-3.5 mr-1.5" />
            Edit Settings
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              if (!emi) return;
              if (
                !confirm(
                  `Are you sure you want to permanently delete EMI agreement "${emi.name}"?\n\nAll scheduled installment records will be permanently removed from EMI tracking and upcoming monthly payments. Confirmed payment transactions in your bank accounts and transaction history will remain preserved.`
                )
              )
                return;
              try {
                const res = await fetch(`${getApiUrl()}/api/v1/emi/${emi.id}`, {
                  method: 'DELETE',
                  credentials: 'include',
                });
                const json = await res.json();
                if (res.ok && json.success) {
                  toast.success(json.message || 'EMI agreement deleted successfully');
                  emitDataChange('emi');
                  emitDataChange('transactions');
                  router.push('/emi');
                } else {
                  toast.error(json.error?.message || 'Failed to delete EMI schedule');
                }
              } catch {
                toast.error('Network error deleting EMI schedule');
              }
            }}
            className="text-xs text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            Delete EMI
          </Button>
          {nextUnpaidInstallment && !isCompleted && (
            <Button
              size="sm"
              onClick={() => openPayModal(nextUnpaidInstallment)}
              className="bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs"
            >
              <Play className="h-3.5 w-3.5 mr-1.5 fill-white" />
              Pay Next EMI (#{nextUnpaidInstallment.installmentNumber})
            </Button>
          )}
        </div>
      </div>

      {/* SECTION A: Overview Card */}
      <Card className="border-border bg-card/70 backdrop-blur-sm overflow-hidden">
        <CardContent className="p-6 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4 text-xs">
            <div>
              <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Monthly Installment</span>
              <span className="text-xl font-bold font-mono text-amber-500">
                {formatCurrency(emi.monthlyAmount, user?.currency || 'INR')}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Start Date</span>
              <span className="text-sm font-semibold text-foreground">
                {new Date(emi.startDate || emi.firstDueDate).toLocaleDateString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Next EMI Date</span>
              <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                {emi.nextDueDate
                  ? new Date(emi.nextDueDate).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })
                  : emi.nextEmiDate
                    ? new Date(emi.nextEmiDate).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })
                    : 'All Settled'}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Final Due Date</span>
              <span className="text-sm font-semibold text-foreground">
                {new Date(emi.endDate).toLocaleDateString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Payment Method</span>
              <span className="text-sm font-medium capitalize text-foreground">
                {emi.paymentMethod === PaymentMethod.CREDIT_CARD
                  ? 'Credit Card'
                  : emi.paymentMethod === PaymentMethod.CASH
                    ? 'Personal Cash'
                    : 'UPI / Bank'}
              </span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Loan Principal</span>
              <span className="text-sm font-mono text-foreground">
                {emi.originalLoanAmount ? formatCurrency(emi.originalLoanAmount, user?.currency || 'INR') : 'N/A'}
              </span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="space-y-1.5 pt-2 border-t border-border/60">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground font-medium">
                Overall Payoff Progress: <strong className="text-foreground">{paidCount}</strong> of{' '}
                <strong className="text-foreground">{totalCount}</strong> installments settled
              </span>
              <span className="font-mono font-bold text-xs text-foreground">{progressPercent}%</span>
            </div>
            <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${isCompleted ? 'bg-emerald-500' : 'bg-amber-500'}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SECTION: Down Payment Details (Phase 2 Requirement) */}
      <Card className="border-border bg-card/60 overflow-hidden">
        <CardHeader className="p-4 pb-2 border-b border-border/60 bg-muted/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20">
                <CreditCard className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold">Down Payment</CardTitle>
                <CardDescription className="text-[11px]">
                  Initial payment made at loan origination (excluded from monthly installment schedule)
                </CardDescription>
              </div>
            </div>
            {hasDownPayment ? (
              emi.downPaymentStatus === 'paid_historical' ? (
                <Badge variant="outline" className="text-purple-600 border-purple-500/40 bg-purple-500/10 text-[10px]">
                  Paid Historically
                </Badge>
              ) : (
                <Badge variant="default" className="bg-emerald-600 text-white text-[10px]">
                  Paid
                </Badge>
              )
            ) : (
              <Badge variant="secondary" className="text-[10px]">
                No Down Payment (100% Financed)
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-4">
          {hasDownPayment ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Amount</span>
                <span className="text-base font-bold font-mono text-foreground">
                  {formatCurrency(emi.downPaymentAmount || 0, user?.currency || 'INR')}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Payment Date</span>
                <span className="text-xs font-medium text-foreground">
                  {emi.downPaymentDate
                    ? new Date(emi.downPaymentDate).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })
                    : 'At origination'}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Payment Source</span>
                <span className="text-xs font-medium capitalize text-foreground">
                  {typeof emi.downPaymentAccountId === 'object' && emi.downPaymentAccountId !== null
                    ? (emi.downPaymentAccountId as any).accountName
                    : typeof emi.downPaymentCreditCardId === 'object' && emi.downPaymentCreditCardId !== null
                      ? (emi.downPaymentCreditCardId as any).cardNickname
                      : emi.downPaymentPaymentMethod || 'Bank / Online'}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Transaction Status</span>
                {emi.downPaymentTransactionId ? (
                  <span className="text-[11px] text-emerald-500 font-medium flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" /> Live Transaction Linked
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground italic">
                    Historical down payment — no bank transaction recorded
                  </span>
                )}
              </div>
              {emi.downPaymentNotes && (
                <div className="col-span-2 sm:col-span-4 pt-1 text-[11px] text-muted-foreground">
                  <strong>Notes:</strong> {emi.downPaymentNotes}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              This loan has no down payment recorded. The entire loan principal is structured across the {totalCount} monthly installments.
            </p>
          )}
        </CardContent>
      </Card>

      {/* SECTION B: Payment Summary Metrics */}
      <div className={`grid grid-cols-2 sm:grid-cols-3 ${hasDownPayment ? 'lg:grid-cols-4' : 'lg:grid-cols-6'} gap-3`}>
        {hasDownPayment ? (
          <div className="p-3.5 rounded-xl border border-border bg-card/60">
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">Down Payment</p>
            <p className="text-lg font-bold font-mono text-amber-500 mt-0.5">
              {formatCurrency(emi.downPaymentAmount || 0, user?.currency || 'INR')}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {emi.downPaymentStatus === 'paid_historical' ? 'Historical Paid' : 'Live Debited'}
            </p>
          </div>
        ) : null}
        <div className="p-3.5 rounded-xl border border-border bg-card/60">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Total Scheduled</p>
          <p className="text-lg font-bold font-mono text-foreground mt-0.5">{totalCount} Installments</p>
          <p className="text-[10px] text-muted-foreground font-mono">
            {formatCurrency(emi.totalScheduledAmount || emi.monthlyAmount * totalCount, user?.currency || 'INR')}
          </p>
        </div>

        <div className="p-3.5 rounded-xl border border-border bg-card/60">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Total Paid</p>
          <p className="text-lg font-bold font-mono text-emerald-500 mt-0.5">{paidCount} Installments</p>
          <p className="text-[10px] text-muted-foreground font-mono">
            {formatCurrency(emi.totalPaidAmount || 0, user?.currency || 'INR')}
          </p>
        </div>

        <div className="p-3.5 rounded-xl border border-border bg-card/60">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Historical Paid</p>
          <p className="text-lg font-bold font-mono text-purple-500 mt-0.5">
            {emi.historicalPaidInstallmentsCount || 0} Installments
          </p>
          <p className="text-[10px] text-muted-foreground">No bank movement</p>
        </div>

        <div className="p-3.5 rounded-xl border border-border bg-card/60">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Normal Tracked Paid</p>
          <p className="text-lg font-bold font-mono text-blue-500 mt-0.5">
            {emi.normalPaidInstallmentsCount || 0} Installments
          </p>
          <p className="text-[10px] text-muted-foreground">Debited from account/card</p>
        </div>

        <div className="p-3.5 rounded-xl border border-border bg-card/60">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Remaining</p>
          <p className="text-lg font-bold font-mono text-amber-500 mt-0.5">
            {emi.remainingInstallmentsCount || 0} Installments
          </p>
          <p className="text-[10px] text-amber-500 font-mono font-semibold">
            {formatCurrency(emi.remainingAmount || 0, user?.currency || 'INR')}
          </p>
        </div>

        <div className="p-3.5 rounded-xl border border-border bg-card/60">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Overdue</p>
          <p
            className={`text-lg font-bold font-mono mt-0.5 ${emi.overdueInstallmentsCount && emi.overdueInstallmentsCount > 0 ? 'text-destructive' : 'text-foreground'
              }`}
          >
            {emi.overdueInstallmentsCount || 0} Installments
          </p>
          <p className="text-[10px] text-muted-foreground">Due date passed</p>
        </div>
      </div>

      {/* Tabs: Schedule vs History */}
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <button
          onClick={() => setActiveTab('schedule')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all ${activeTab === 'schedule'
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:bg-muted/60'
            }`}
        >
          <ListOrdered className="h-3.5 w-3.5" />
          <span>Full Installment Schedule</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-muted/20">{occurrences.length}</span>
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all ${activeTab === 'history'
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:bg-muted/60'
            }`}
        >
          <History className="h-3.5 w-3.5" />
          <span>Payment History Log</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-muted/20">{paidCount}</span>
        </button>
      </div>

      {/* SECTION C: Installment Schedule Table */}
      {activeTab === 'schedule' && (
        <Card className="border-border">
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40 font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="p-3">#</th>
                  <th className="p-3">Cycle</th>
                  <th className="p-3">Due Date</th>
                  <th className="p-3 text-right">Expected</th>
                  <th className="p-3 text-right">Actual Paid</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Transaction Link</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {occurrences.map((occ) => {
                  const isPaidNormal = occ.status === EmiOccurrenceStatus.PAID;
                  const isPaidHistorical = occ.status === EmiOccurrenceStatus.PAID_HISTORICAL;
                  const isPaid = isPaidNormal || isPaidHistorical;
                  const dueDateObj = new Date(occ.dueDate);
                  const isOverdue = !isPaid && dueDateObj < now;

                  return (
                    <tr
                      key={occ.id}
                      className={`hover:bg-muted/30 transition-colors ${isPaidHistorical ? 'bg-purple-500/5' : isPaidNormal ? 'bg-emerald-500/5' : ''
                        }`}
                    >
                      <td className="p-3 font-mono font-bold text-muted-foreground">#{occ.installmentNumber}</td>
                      <td className="p-3 font-bold text-foreground">{occ.occurrenceKey}</td>
                      <td className="p-3 text-muted-foreground">
                        {dueDateObj.toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="p-3 text-right font-mono text-foreground">
                        {formatCurrency(occ.expectedAmount, user?.currency || 'INR')}
                      </td>
                      <td className="p-3 text-right font-mono font-bold">
                        {isPaid ? (
                          <span className={isPaidHistorical ? 'text-purple-600 dark:text-purple-400' : 'text-emerald-500'}>
                            {formatCurrency(occ.actualAmountPaid ?? occ.expectedAmount, user?.currency || 'INR')}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        {isPaidNormal ? (
                          <Badge variant="default" className="bg-emerald-600 text-white text-[10px]">
                            Paid
                          </Badge>
                        ) : isPaidHistorical ? (
                          <Badge variant="outline" className="text-purple-600 border-purple-500/40 bg-purple-500/10 text-[10px]">
                            Paid Historically
                          </Badge>
                        ) : isOverdue ? (
                          <Badge variant="destructive" className="text-[10px]">
                            Overdue
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-500 border-amber-500/40 text-[10px]">
                            Upcoming
                          </Badge>
                        )}
                      </td>
                      <td className="p-3">
                        {isPaidNormal && occ.transactionId ? (
                          <button
                            type="button"
                            onClick={() => setViewTxOcc(occ)}
                            className="text-blue-500 hover:underline font-mono text-[11px] flex items-center gap-1"
                          >
                            <FileText className="h-3 w-3" />
                            View Transaction
                          </button>
                        ) : isPaidHistorical ? (
                          <span className="text-[10px] text-muted-foreground italic">
                            Historical — no bank transaction
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        {!isPaid && (
                          <Button
                            size="sm"
                            onClick={() => openPayModal(occ)}
                            className="bg-amber-600 hover:bg-amber-700 text-white text-[11px] h-7 px-2.5 font-semibold"
                          >
                            <Play className="h-3 w-3 mr-1 fill-white" />
                            Pay
                          </Button>
                        )}
                        {isPaidHistorical && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditHistorical(occ)}
                            className="text-[11px] h-7 px-2 font-medium"
                          >
                            <Edit className="h-3 w-3 mr-1" />
                            Edit
                          </Button>
                        )}
                        {isPaidNormal && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewTxOcc(occ)}
                            className="text-[11px] h-7 px-2 text-muted-foreground"
                          >
                            Details
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* SECTION D: Payment History Tab */}
      {activeTab === 'history' && (
        <Card className="border-border">
          <CardHeader className="pb-3 border-b border-border/60">
            <CardTitle className="text-sm font-semibold">Confirmed Installment Payment History</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Chronological log of both tracked manual transactions and confirmed historical installments.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {occurrences.filter((o) => o.status === EmiOccurrenceStatus.PAID || o.status === EmiOccurrenceStatus.PAID_HISTORICAL).length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No payments recorded yet.</p>
            ) : (
              <div className="divide-y divide-border">
                {occurrences
                  .filter((o) => o.status === EmiOccurrenceStatus.PAID || o.status === EmiOccurrenceStatus.PAID_HISTORICAL)
                  .map((occ) => {
                    const isHistorical = occ.status === EmiOccurrenceStatus.PAID_HISTORICAL;
                    const diff = (occ.actualAmountPaid ?? occ.expectedAmount) - occ.expectedAmount;

                    return (
                      <div key={occ.id} className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-foreground">
                              Installment #{occ.installmentNumber} ({occ.occurrenceKey})
                            </span>
                            {isHistorical ? (
                              <Badge variant="outline" className="text-purple-600 border-purple-500/40 bg-purple-500/10 text-[10px]">
                                Historical Entry
                              </Badge>
                            ) : (
                              <Badge variant="default" className="bg-emerald-600 text-white text-[10px]">
                                Tracked Transaction
                              </Badge>
                            )}
                          </div>

                          <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                            <span>
                              Scheduled: {new Date(occ.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </span>
                            <span>•</span>
                            <span>
                              Paid Date: {occ.paidAt ? new Date(occ.paidAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Historical (Pre-app)'}
                            </span>
                          </div>

                          {occ.notes && <p className="text-[11px] text-muted-foreground italic">Note: {occ.notes}</p>}
                        </div>

                        <div className="flex items-center gap-6">
                          <div className="text-left sm:text-right">
                            <span className="text-[10px] uppercase text-muted-foreground block">Actual Paid</span>
                            <span className="font-mono font-bold text-sm text-foreground">
                              {formatCurrency(occ.actualAmountPaid ?? occ.expectedAmount, user?.currency || 'INR')}
                            </span>
                            {diff !== 0 && (
                              <span className={`block text-[10px] ${diff < 0 ? 'text-emerald-500' : 'text-amber-500'}`}>
                                {diff < 0 ? `Saved ₹${Math.abs(diff)}` : `+₹${diff} adjustment`}
                              </span>
                            )}
                          </div>

                          {isHistorical ? (
                            <Button variant="outline" size="sm" onClick={() => openEditHistorical(occ)} className="h-7 text-xs">
                              Edit
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => setViewTxOcc(occ)} className="h-7 text-xs">
                              View Tx
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* SECTION E: View Transaction Details Modal */}
      <Dialog
        open={Boolean(viewTxOcc)}
        onOpenChange={(open) => {
          if (!open) setViewTxOcc(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              Transaction Details
            </DialogTitle>
            <DialogDescription>
              Linked financial record for Installment #{viewTxOcc?.installmentNumber} ({viewTxOcc?.occurrenceKey})
            </DialogDescription>
          </DialogHeader>

          {viewTxOcc && (
            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-lg border border-border bg-muted/30 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount Debited:</span>
                  <span className="font-mono font-bold text-foreground">
                    {formatCurrency(viewTxOcc.actualAmountPaid ?? viewTxOcc.expectedAmount, user?.currency || 'INR')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment Date:</span>
                  <span className="text-foreground">
                    {viewTxOcc.paidAt ? new Date(viewTxOcc.paidAt).toLocaleString('en-IN') : 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment Method:</span>
                  <span className="capitalize text-foreground">{viewTxOcc.paymentMethod || 'UPI'}</span>
                </div>
                {viewTxOcc.notes && (
                  <div className="flex justify-between pt-1 border-t border-border/50">
                    <span className="text-muted-foreground">Notes:</span>
                    <span className="text-foreground">{viewTxOcc.notes}</span>
                  </div>
                )}
              </div>

              <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400 space-y-1">
                <p className="font-bold flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Transaction Deletion Reversal
                </p>
                <p className="text-[11px] leading-relaxed">
                  Deleting this transaction will immediately reverse the bank/card financial deduction and reopen
                  Installment #{viewTxOcc.installmentNumber} as unpaid.
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="flex justify-between items-center pt-3 border-t border-border">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteTransaction}
              disabled={deletingTx}
              className="text-xs gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deletingTx ? 'Deleting...' : 'Delete Transaction & Reopen'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setViewTxOcc(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SECTION F: Edit Historical Payment Modal */}
      <Dialog
        open={Boolean(editingHistoricalOcc)}
        onOpenChange={(open) => {
          if (!open && !submittingHistorical) setEditingHistoricalOcc(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="h-4 w-4 text-purple-500" />
              Edit Historical Installment #{editingHistoricalOcc?.installmentNumber}
            </DialogTitle>
            <DialogDescription>
              Adjust custom amount or notes for {editingHistoricalOcc?.occurrenceKey}. Does not alter bank balances.
            </DialogDescription>
          </DialogHeader>

          {editingHistoricalOcc && (
            <form onSubmit={handleSaveHistorical} className="space-y-4 text-xs">
              <div>
                <label className="font-semibold text-foreground block mb-1">
                  Actual Amount Paid (₹) *
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={histActualAmount}
                  onChange={(e) => setHistActualAmount(e.target.value)}
                  className="font-mono font-bold"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Scheduled expected amount was {formatCurrency(editingHistoricalOcc.expectedAmount, user?.currency || 'INR')}.
                </p>
              </div>

              <div>
                <label className="font-semibold text-foreground block mb-1">
                  Notes / Historical Adjustment Reason
                </label>
                <Input
                  placeholder="e.g. Processing charges included, pre-paid via cheque"
                  value={histNotes}
                  onChange={(e) => setHistNotes(e.target.value)}
                />
              </div>

              <div className="p-3 rounded-lg border border-purple-500/30 bg-purple-500/5 text-purple-700 dark:text-purple-300">
                <p className="font-bold">Zero Financial Movement Guarantee</p>
                <p className="text-[10px] mt-0.5">
                  Editing this historical payment updates the EMI completion schedule without creating a new transaction
                  or altering current bank account balances.
                </p>
              </div>

              <DialogFooter className="pt-2 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingHistoricalOcc(null)}
                  disabled={submittingHistorical}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={submittingHistorical}
                  className="bg-purple-600 hover:bg-purple-700 text-white font-semibold"
                >
                  {submittingHistorical ? 'Saving...' : 'Save Historical Payment'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Pay EMI Popup Modal */}
      <Dialog
        open={Boolean(showPayModal && payOccurrence)}
        onOpenChange={(open) => {
          if (!open && !submittingPay) setShowPayModal(false);
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Play className="h-5 w-5 text-amber-500 fill-amber-500" />
              Confirm &amp; Pay EMI Installment
            </DialogTitle>
            <DialogDescription>
              Installment #{payOccurrence?.installmentNumber} for {payOccurrence?.occurrenceKey}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleConfirmPay} className="space-y-4">
            <div className="p-3.5 rounded-xl border border-border/80 bg-muted/30 flex justify-between items-center text-xs">
              <div>
                <h4 className="font-bold text-sm text-foreground">{emi.name}</h4>
                <p className="text-muted-foreground">{emi.lender}</p>
              </div>
              <div className="text-right">
                <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
                  Scheduled Amount
                </span>
                <span className="text-base font-bold font-mono text-foreground">
                  {formatCurrency(payOccurrence?.expectedAmount || 0, user?.currency || 'INR')}
                </span>
              </div>
            </div>

              {/* Dynamic Payment Method Selection */}
              <div className="space-y-3 pt-1 border-t border-border/60">
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Payment Method for This Installment
                  </label>
                  <Select
                    value={payPaymentMethod}
                    onValueChange={(val) => {
                      const pm = val as PaymentMethod;
                      setPayPaymentMethod(pm);
                      if (pm === PaymentMethod.CREDIT_CARD && !payCreditCardId && cards.length > 0) {
                        setPayCreditCardId(cards[0].id);
                      }
                      if (
                        (pm === PaymentMethod.UPI || pm === PaymentMethod.DEBIT_CARD || pm === PaymentMethod.BANK_TRANSFER) &&
                        !payAccountId &&
                        accounts.length > 0
                      ) {
                        setPayAccountId(accounts[0].id);
                      }
                    }}
                  >
                    <SelectTrigger className="h-10 text-sm">
                      <SelectValue placeholder="Payment Method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={PaymentMethod.UPI}>UPI / Bank Account</SelectItem>
                      <SelectItem value={PaymentMethod.CREDIT_CARD}>Credit Card</SelectItem>
                      <SelectItem value={PaymentMethod.CASH}>Personal Cash in Hand</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {payPaymentMethod === PaymentMethod.CREDIT_CARD && (
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground block">
                      Select Credit Card *
                    </label>
                    <Select
                      value={payCreditCardId || undefined}
                      onValueChange={setPayCreditCardId}
                    >
                      <SelectTrigger className="h-10 text-sm">
                        <SelectValue placeholder="-- Choose Credit Card --" />
                      </SelectTrigger>
                      <SelectContent>
                        {cards.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.cardNickname}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {payPaymentMethod === PaymentMethod.CASH && (
                  <div className="p-3 rounded-lg border border-border/80 bg-muted/30 flex items-center gap-2 text-xs text-muted-foreground">
                    <Wallet className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span>Deducted strictly from Personal Cash in Hand.</span>
                  </div>
                )}

                {payPaymentMethod !== PaymentMethod.CREDIT_CARD && payPaymentMethod !== PaymentMethod.CASH && (
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground block">
                      Select Bank Account *
                    </label>
                    <Select
                      value={payAccountId || undefined}
                      onValueChange={setPayAccountId}
                    >
                      <SelectTrigger className="h-10 text-sm">
                        <SelectValue placeholder="-- Choose Bank Account --" />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map((acc) => (
                          <SelectItem key={acc.id} value={acc.id}>
                            {acc.accountName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="flex items-center space-x-2 pt-1">
                  <input
                    type="checkbox"
                    id="payUpdateFutureDefaults"
                    checked={payUpdateFutureDefaults}
                    onChange={(e) => setPayUpdateFutureDefaults(e.target.checked)}
                    className="h-4 w-4 rounded border-input text-primary focus:ring-ring cursor-pointer"
                  />
                  <label
                    htmlFor="payUpdateFutureDefaults"
                    className="text-xs font-semibold leading-none cursor-pointer select-none text-foreground"
                  >
                    Update default payment settings for future installments
                  </label>
                </div>
              </div>

              {/* Discounts / Adjustments */}
              <div className="space-y-2 pt-2 border-t border-border/60">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5 text-amber-500" />
                    Discount / Adjustment
                  </label>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'none', label: 'None' },
                    { id: 'fixed', label: '₹ Off' },
                    { id: 'percentage', label: '% Off' },
                    { id: 'override', label: 'Custom' },
                  ].map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => {
                        setPayDiscountType(mode.id as any);
                        if (mode.id === 'none') setPayDiscountValue('');
                      }}
                      className={`py-1.5 px-2 rounded-lg border text-xs font-medium transition-all ${payDiscountType === mode.id
                        ? 'bg-amber-500/10 border-amber-500 text-amber-600 font-bold'
                        : 'border-border/60 hover:bg-muted/40 text-muted-foreground'
                        }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>

                {payDiscountType !== 'none' && (
                  <div className="space-y-2 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5">
                    <label className="text-xs font-semibold text-foreground block">
                      {payDiscountType === 'fixed'
                        ? 'Discount Amount (₹) *'
                        : payDiscountType === 'percentage'
                          ? 'Discount Percentage (%) *'
                          : 'Custom Final Payment (₹) *'}
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={payDiscountValue}
                      onChange={(e) => setPayDiscountValue(e.target.value)}
                      className="font-mono font-bold text-xs"
                      required
                    />
                  </div>
                )}
              </div>

              {/* Live Calculation Breakdown */}
              {(() => {
                const { discountAmount, finalAmount } = getPayCalculation();
                return (
                  <div className="p-3.5 rounded-xl border border-border bg-muted/40 space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Scheduled Amount:</span>
                      <span className="font-mono text-muted-foreground line-through">
                        {discountAmount > 0 ? formatCurrency(payOccurrence?.expectedAmount || 0, user?.currency || 'INR') : ''}
                      </span>
                    </div>
                    {discountAmount > 0 && (
                      <div className="flex justify-between text-amber-500 font-semibold">
                        <span>Discount / Savings:</span>
                        <span className="font-mono">- {formatCurrency(discountAmount, user?.currency || 'INR')}</span>
                      </div>
                    )}
                    <div className="flex justify-between pt-1 border-t border-border/60 text-sm">
                      <span className="font-bold text-foreground">Actual to Pay:</span>
                      <span className="font-mono font-black text-amber-500">
                        {formatCurrency(finalAmount, user?.currency || 'INR')}
                      </span>
                    </div>
                  </div>
                );
              })()}

              <DialogFooter className="pt-3 border-t border-border">
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
                  className="bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                >
                  {submittingPay ? 'Confirming...' : 'Confirm Payment'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

      {/* Edit EMI Settings Modal */}
      <Dialog open={showEditEmiModal} onOpenChange={setShowEditEmiModal}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="h-4 w-4 text-amber-500" />
              Edit EMI Settings
            </DialogTitle>
            <DialogDescription>
              Update expected monthly installment, next due date, or final end date.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveEditEmi} className="space-y-4 text-xs">
              <div>
                <label className="font-semibold text-foreground block mb-1">
                  Monthly Installment Amount (₹) *
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={editMonthlyAmount}
                  onChange={(e) => setEditMonthlyAmount(e.target.value)}
                  className="font-mono font-bold"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Only affects future unpaid installments. Past paid records remain untouched.
                </p>
              </div>

              <div>
                <label className="font-semibold text-foreground block mb-1">
                  Next Expected EMI Date
                </label>
                <DatePicker
                  value={editNextEmiDate}
                  onChange={setEditNextEmiDate}
                  placeholder="Pick next EMI date"
                  className="h-10 text-sm"
                />
              </div>

              <div>
                <label className="font-semibold text-foreground block mb-1">
                  Final End Date *
                </label>
                <DatePicker
                  value={editEndDate}
                  onChange={setEditEndDate}
                  placeholder="Pick final end date"
                  className="h-10 text-sm"
                />
              </div>

              <div>
                <label className="font-semibold text-foreground block mb-1">
                  Default Payment Method
                </label>
                <Select
                  value={editPaymentMethod}
                  onValueChange={(val) => setEditPaymentMethod(val as PaymentMethod)}
                >
                  <SelectTrigger className="h-10 text-sm">
                    <SelectValue placeholder="Payment Method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={PaymentMethod.UPI}>UPI / Bank Account</SelectItem>
                    <SelectItem value={PaymentMethod.CREDIT_CARD}>Credit Card</SelectItem>
                    <SelectItem value={PaymentMethod.CASH}>Personal Cash in Hand</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {editPaymentMethod === PaymentMethod.CREDIT_CARD ? (
                <div>
                  <label className="font-semibold text-foreground block mb-1">
                    Select Credit Card
                  </label>
                  <Select
                    value={editCreditCardId || undefined}
                    onValueChange={setEditCreditCardId}
                  >
                    <SelectTrigger className="h-10 text-sm">
                      <SelectValue placeholder="-- Choose Credit Card --" />
                    </SelectTrigger>
                    <SelectContent>
                      {cards.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.cardNickname}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : editPaymentMethod !== PaymentMethod.CASH ? (
                <div>
                  <label className="font-semibold text-foreground block mb-1">
                    Select Bank Account
                  </label>
                  <Select
                    value={editAccountId || undefined}
                    onValueChange={setEditAccountId}
                  >
                    <SelectTrigger className="h-10 text-sm">
                      <SelectValue placeholder="-- Choose Bank Account --" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((acc) => (
                        <SelectItem key={acc.id} value={acc.id}>
                          {acc.accountName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <div>
                <label className="font-semibold text-foreground block mb-1">
                  Notes
                </label>
                <Input
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                />
              </div>

              <DialogFooter className="pt-3 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowEditEmiModal(false)}
                  disabled={submittingEditEmi}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={submittingEditEmi}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                >
                  {submittingEditEmi ? 'Saving...' : 'Save Settings'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
    </div>
  );
}
