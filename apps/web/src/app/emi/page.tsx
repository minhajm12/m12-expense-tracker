'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/components/ui/toast';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Landmark,
  Plus,
  RefreshCw,
  Trash2,
  Play,
  Calendar,
  CheckCircle,
  Clock,
  ShieldCheck,
  CreditCard,
  Wallet,
  Tag,
  ChevronRight,
  ListOrdered,
  Edit,
  X,
  AlertCircle,
  ArrowRight,
  Building2,
  DollarSign,
  Percent,
  History,
} from 'lucide-react';
import {
  formatCurrency,
  PaymentMethod,
  PaymentChannel,
  EmiStatus,
  EmiOccurrenceStatus,
  EmiRule,
  EmiOccurrence,
  EmiSummary,
} from '@finora/shared';
import { emitDataChange, useDataSync } from '@/lib/data-sync';

function EmiManagementContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const [emis, setEmis] = useState<EmiRule[]>([]);
  const [summary, setSummary] = useState<EmiSummary | null>(null);
  const [accounts, setAccounts] = useState<Array<{ id: string; accountName: string }>>([]);
  const [cards, setCards] = useState<Array<{ id: string; cardNickname: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'active' | 'completed' | 'all' | 'history'>('active');

  // Add EMI Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [submittingAdd, setSubmittingAdd] = useState(false);

  // Form fields
  const [name, setName] = useState('');
  const [lender, setLender] = useState('');
  const [monthlyAmount, setMonthlyAmount] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [firstDueDate, setFirstDueDate] = useState('');
  const [dueDay, setDueDay] = useState('');
  const [endDate, setEndDate] = useState('');
  const [totalInstallments, setTotalInstallments] = useState('');
  const [originalLoanAmount, setOriginalLoanAmount] = useState('');
  const [outstandingPrincipal, setOutstandingPrincipal] = useState('');
  const [loanReference, setLoanReference] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.UPI);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [selectedCardId, setSelectedCardId] = useState('');
  const [notes, setNotes] = useState('');

  // Down Payment Form State (Phase 2 Requirement)
  const [downPaymentAmount, setDownPaymentAmount] = useState('');
  const [downPaymentAlreadyPaid, setDownPaymentAlreadyPaid] = useState(false);
  const [downPaymentPaymentMethod, setDownPaymentPaymentMethod] = useState<PaymentMethod>(PaymentMethod.UPI);
  const [downPaymentAccountId, setDownPaymentAccountId] = useState('');
  const [downPaymentCreditCardId, setDownPaymentCreditCardId] = useState('');
  const [downPaymentDate, setDownPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [downPaymentNotes, setDownPaymentNotes] = useState('');

  // Historical Installments Tracking
  const [nextEmiDate, setNextEmiDate] = useState('');
  const [markHistoricalPaid, setMarkHistoricalPaid] = useState(true);
  const [historicalMode, setHistoricalMode] = useState<'modeA' | 'modeB'>('modeA');
  const [historicalOccurrences, setHistoricalOccurrences] = useState<
    Array<{
      occurrenceKey: string;
      monthLabel: string;
      dueDate: string;
      installmentNumber: number;
      actualAmount: number;
      notes: string;
    }>
  >([]);

  // Pay EMI Modal State
  const [selectedEmiForPay, setSelectedEmiForPay] = useState<EmiRule | null>(null);
  const [selectedOccurrenceForPay, setSelectedOccurrenceForPay] = useState<EmiOccurrence | null>(null);
  const [showPayModal, setShowPayModal] = useState(false);
  const payQueryHandledRef = useRef(false);
  const [payActualAmount, setPayActualAmount] = useState('');
  const [payDiscountType, setPayDiscountType] = useState<'none' | 'fixed' | 'percentage' | 'override'>('none');
  const [payDiscountValue, setPayDiscountValue] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payPaymentMethod, setPayPaymentMethod] = useState<PaymentMethod>(PaymentMethod.UPI);
  const [payAccountId, setPayAccountId] = useState('');
  const [payCreditCardId, setPayCreditCardId] = useState('');
  const [payUpdateFutureDefaults, setPayUpdateFutureDefaults] = useState(false);
  const [payingEmiId, setPayingEmiId] = useState<string | null>(null);

  // View Schedule Modal State
  const [viewScheduleEmi, setViewScheduleEmi] = useState<EmiRule | null>(null);
  const [scheduleOccurrences, setScheduleOccurrences] = useState<EmiOccurrence[]>([]);
  const [loadingSchedule, setLoadingSchedule] = useState(false);

  // Edit EMI Modal State
  const [editingEmi, setEditingEmi] = useState<EmiRule | null>(null);
  const [editMonthlyAmount, setEditMonthlyAmount] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editPaymentMethod, setEditPaymentMethod] = useState<PaymentMethod>(PaymentMethod.UPI);
  const [editAccountId, setEditAccountId] = useState('');
  const [editCreditCardId, setEditCreditCardId] = useState('');
  const [editNextEmiDate, setEditNextEmiDate] = useState('');
  const [submittingEdit, setSubmittingEdit] = useState(false);

  // Compute historical occurrences when firstDueDate, nextEmiDate, dueDay, or monthlyAmount change
  useEffect(() => {
    if (!firstDueDate || !nextEmiDate) {
      setHistoricalOccurrences([]);
      return;
    }
    try {
      const first = new Date(firstDueDate);
      const next = new Date(nextEmiDate);
      if (isNaN(first.getTime()) || isNaN(next.getTime())) {
        setHistoricalOccurrences([]);
        return;
      }

      const fYear = first.getFullYear();
      const fMonth = first.getMonth();
      const nYear = next.getFullYear();
      const nMonth = next.getMonth();

      const totalDiff = (nYear - fYear) * 12 + (nMonth - fMonth);
      if (totalDiff <= 0) {
        setHistoricalOccurrences([]);
        return;
      }

      const defaultAmount = parseFloat(monthlyAmount) || 0;
      const explicitDueDay = dueDay ? parseInt(dueDay, 10) : first.getDate();

      const occs: Array<{
        occurrenceKey: string;
        monthLabel: string;
        dueDate: string;
        installmentNumber: number;
        actualAmount: number;
        notes: string;
      }> = [];

      for (let i = 0; i < totalDiff; i++) {
        const curDate = new Date(fYear, fMonth + i, 1);
        const y = curDate.getFullYear();
        const m = curDate.getMonth();
        const daysInCurMonth = new Date(y, m + 1, 0).getDate();
        const clampedDay = Math.min(explicitDueDay, daysInCurMonth);
        const dueObj = new Date(y, m, clampedDay);

        const key = `${y}-${String(m + 1).padStart(2, '0')}`;
        const monthLabel = dueObj.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
        const dueDateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;

        occs.push({
          occurrenceKey: key,
          monthLabel,
          dueDate: dueDateStr,
          installmentNumber: i + 1,
          actualAmount: defaultAmount,
          notes: '',
        });
      }

      setHistoricalOccurrences(occs);
    } catch {
      setHistoricalOccurrences([]);
    }
  }, [firstDueDate, nextEmiDate, dueDay, monthlyAmount]);

  const getApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const fetchData = async () => {
    setLoading(true);
    try {
      const [emiRes, accRes, cardRes] = await Promise.all([
        fetch(`${getApiUrl()}/api/v1/emi?status=all`, { credentials: 'include' }),
        fetch(`${getApiUrl()}/api/v1/accounts`, { credentials: 'include' }),
        fetch(`${getApiUrl()}/api/v1/credit-cards`, { credentials: 'include' }),
      ]);

      const [emiJson, accJson, cardJson] = await Promise.all([
        emiRes.json(),
        accRes.json(),
        cardRes.json(),
      ]);

      if (emiRes.ok && emiJson.success) {
        const loadedEmis = emiJson.data || [];
        setEmis(loadedEmis);
        setSummary(emiJson.summary || null);
      }
      if (accRes.ok && accJson.success) {
        setAccounts(accJson.data || []);
        if (accJson.data?.length > 0 && !selectedAccountId) {
          setSelectedAccountId(accJson.data[0].id);
        }
      }
      if (cardRes.ok && cardJson.success) {
        setCards(cardJson.data || []);
        if (cardJson.data?.length > 0 && !selectedCardId) {
          setSelectedCardId(cardJson.data[0].id);
        }
      }
    } catch {
      toast.error('Network error loading EMI data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useDataSync(fetchData, ['transactions', 'emi', 'accounts', 'recurring']);

  // Add EMI Form Submission
  const handleCreateEmi = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountVal = parseFloat(monthlyAmount);
    if (isNaN(amountVal) || amountVal <= 0) {
      toast.error('Monthly amount must be positive');
      return;
    }
    if (!firstDueDate || !endDate) {
      toast.error('First due date and end date are required');
      return;
    }

    setSubmittingAdd(true);
    try {
      const payload: Record<string, any> = {
        name,
        lender,
        monthlyAmount: amountVal,
        startDate,
        firstDueDate,
        endDate,
        paymentMethod,
        paymentChannel: paymentMethod === PaymentMethod.CASH ? PaymentChannel.OFFLINE : PaymentChannel.ONLINE,
      };

      if (dueDay) payload.dueDay = parseInt(dueDay, 10);
      if (totalInstallments) payload.totalInstallments = parseInt(totalInstallments, 10);
      if (originalLoanAmount) payload.originalLoanAmount = parseFloat(originalLoanAmount);
      if (outstandingPrincipal) payload.outstandingPrincipal = parseFloat(outstandingPrincipal);
      if (loanReference) payload.loanReference = loanReference;
      if (notes) payload.notes = notes;

      if (nextEmiDate) {
        payload.nextEmiDate = nextEmiDate;
      }
      if (historicalOccurrences.length > 0) {
        payload.markHistoricalPaid = markHistoricalPaid;
        if (markHistoricalPaid) {
          payload.historicalInstallments = historicalOccurrences.map((h) => ({
            occurrenceKey: h.occurrenceKey,
            actualAmount: historicalMode === 'modeB' ? h.actualAmount : amountVal,
            notes: h.notes || undefined,
          }));
        }
      }

      if (paymentMethod === PaymentMethod.CREDIT_CARD) {
        payload.creditCardId = selectedCardId || undefined;
      } else if (paymentMethod !== PaymentMethod.CASH) {
        payload.accountId = selectedAccountId || undefined;
      }

      // Include Down Payment payload
      if (downPaymentAmount && parseFloat(downPaymentAmount) > 0) {
        payload.downPaymentAmount = parseFloat(downPaymentAmount);
        payload.downPaymentAlreadyPaid = downPaymentAlreadyPaid;
        payload.downPaymentPaymentMethod = downPaymentPaymentMethod;
        payload.downPaymentDate = downPaymentDate;
        payload.downPaymentNotes = downPaymentNotes.trim() || undefined;
        if (downPaymentPaymentMethod === PaymentMethod.CREDIT_CARD) {
          payload.downPaymentCreditCardId = downPaymentCreditCardId || selectedCardId || undefined;
        } else if (downPaymentPaymentMethod !== PaymentMethod.CASH) {
          payload.downPaymentAccountId = downPaymentAccountId || selectedAccountId || undefined;
        }
      }

      const res = await fetch(`${getApiUrl()}/api/v1/emi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(json.message || 'EMI schedule created successfully');
        setShowAddModal(false);
        // Reset form
        setName('');
        setLender('');
        setMonthlyAmount('');
        setFirstDueDate('');
        setEndDate('');
        setDueDay('');
        setNextEmiDate('');
        setMarkHistoricalPaid(true);
        setHistoricalMode('modeA');
        setHistoricalOccurrences([]);
        setTotalInstallments('');
        setOriginalLoanAmount('');
        setOutstandingPrincipal('');
        setLoanReference('');
        setNotes('');
        setDownPaymentAmount('');
        setDownPaymentAlreadyPaid(false);
        setDownPaymentPaymentMethod(PaymentMethod.UPI);
        setDownPaymentAccountId('');
        setDownPaymentCreditCardId('');
        setDownPaymentDate(new Date().toISOString().split('T')[0]);
        setDownPaymentNotes('');
        fetchData();
        emitDataChange('emi');
      } else {
        toast.error(json.error?.message || 'Failed to create EMI schedule');
      }
    } catch {
      toast.error('Network error creating EMI schedule');
    } finally {
      setSubmittingAdd(false);
    }
  };

  // Pay EMI Calculation
  const getPayCalculation = () => {
    if (!selectedEmiForPay) return { discountAmount: 0, finalAmount: 0 };
    const original = selectedOccurrenceForPay ? selectedOccurrenceForPay.expectedAmount : selectedEmiForPay.monthlyAmount;
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

  // Open Pay Modal
  const openPayModal = (emi: EmiRule, occurrence?: EmiOccurrence) => {
    setSelectedEmiForPay(emi);
    setSelectedOccurrenceForPay(occurrence || null);
    setPayDiscountType('none');
    setPayDiscountValue('');
    setPayNotes('');
    setPayPaymentMethod(emi.paymentMethod || PaymentMethod.UPI);
    setPayAccountId(emi.accountId || (accounts.length > 0 ? accounts[0].id : ''));
    setPayCreditCardId(emi.creditCardId || (cards.length > 0 ? cards[0].id : ''));
    setPayUpdateFutureDefaults(false);
    setShowPayModal(true);
  };

  // Close Pay Modal safely and purge URL query param so it never re-opens
  const closePayModal = () => {
    setShowPayModal(false);
    setSelectedEmiForPay(null);
    setSelectedOccurrenceForPay(null);
    if (typeof window !== 'undefined' && window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  };

  // Handle direct URL payment request exactly once per page visit
  useEffect(() => {
    if (payQueryHandledRef.current) return;
    const payRuleId = searchParams.get('pay');
    if (!payRuleId || emis.length === 0) return;

    payQueryHandledRef.current = true;
    const payOccurrenceKey = searchParams.get('occurrence');
    const targetEmi = emis.find((e: any) => e.id === payRuleId || e._id === payRuleId);
    if (targetEmi) {
      fetch(`${getApiUrl()}/api/v1/emi/${payRuleId}/installments`, { credentials: 'include' })
        .then((r) => r.json())
        .then((occJson) => {
          if (occJson.success && occJson.data) {
            const targetOcc = payOccurrenceKey
              ? occJson.data.find((o: any) => o.occurrenceKey === payOccurrenceKey)
              : occJson.data.find(
                  (o: any) =>
                    o.status !== EmiOccurrenceStatus.PAID &&
                    o.status !== EmiOccurrenceStatus.PAID_HISTORICAL
                );
            if (targetOcc) {
              openPayModal(targetEmi, targetOcc);
            }
          }
        })
        .catch(() => {});
    }
  }, [emis, searchParams]);

  // Confirm Pay EMI
  const handleConfirmPay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmiForPay) return;
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

    setPayingEmiId(selectedEmiForPay.id);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/emi/${selectedEmiForPay.id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          occurrenceKey: selectedOccurrenceForPay ? selectedOccurrenceForPay.occurrenceKey : undefined,
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
            ? `EMI paid! ₹${finalAmount.toLocaleString()} recorded (Discount: ₹${discountAmount.toLocaleString()}).`
            : `EMI payment recorded successfully!`
        );
        closePayModal();
        fetchData();
        if (viewScheduleEmi) {
          fetchSchedule(viewScheduleEmi.id);
        }
        emitDataChange('transactions');
        emitDataChange('accounts');
        emitDataChange('emi');
      } else {
        toast.error(json.error?.message || 'Failed to pay EMI installment');
      }
    } catch {
      toast.error('Network error paying EMI installment');
    } finally {
      setPayingEmiId(null);
    }
  };

  // Fetch Schedule for View Modal
  const fetchSchedule = async (emiId: string) => {
    setLoadingSchedule(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/emi/${emiId}/installments`, { credentials: 'include' });
      const json = await res.json();
      if (res.ok && json.success) {
        setScheduleOccurrences(json.data || []);
      } else {
        toast.error(json.error?.message || 'Failed to load schedule');
      }
    } catch {
      toast.error('Network error loading schedule');
    } finally {
      setLoadingSchedule(false);
    }
  };

  const openScheduleModal = (emi: EmiRule) => {
    setViewScheduleEmi(emi);
    fetchSchedule(emi.id);
  };

  // Open Edit Modal
  const openEditModal = (emi: EmiRule) => {
    setEditingEmi(emi);
    setEditMonthlyAmount(emi.monthlyAmount.toString());
    setEditEndDate(emi.endDate.split('T')[0]);
    setEditNextEmiDate(emi.nextEmiDate ? new Date(emi.nextEmiDate).toISOString().split('T')[0] : '');
    setEditNotes(emi.notes || '');
    setEditPaymentMethod(emi.paymentMethod || PaymentMethod.UPI);
    setEditAccountId(emi.accountId || (accounts.length > 0 ? accounts[0].id : ''));
    setEditCreditCardId(emi.creditCardId || (cards.length > 0 ? cards[0].id : ''));
  };

  // Save Edit EMI
  const handleSaveEditEmi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmi) return;
    const amountVal = parseFloat(editMonthlyAmount);
    if (isNaN(amountVal) || amountVal <= 0) {
      toast.error('Monthly amount must be positive');
      return;
    }

    setSubmittingEdit(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/emi/${editingEmi.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          monthlyAmount: amountVal,
          endDate: editEndDate,
          nextEmiDate: editNextEmiDate || undefined,
          paymentMethod: editPaymentMethod,
          accountId:
            editPaymentMethod !== PaymentMethod.CREDIT_CARD && editPaymentMethod !== PaymentMethod.CASH
              ? editAccountId || undefined
              : undefined,
          creditCardId: editPaymentMethod === PaymentMethod.CREDIT_CARD ? editCreditCardId || undefined : undefined,
          notes: editNotes,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('EMI schedule updated successfully');
        setEditingEmi(null);
        fetchData();
        emitDataChange('emi');
      } else {
        toast.error(json.error?.message || 'Failed to update EMI schedule');
      }
    } catch {
      toast.error('Network error updating EMI schedule');
    } finally {
      setSubmittingEdit(false);
    }
  };

  // Permanently Delete EMI Agreement
  const handleDeleteEmi = async (emi: EmiRule) => {
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
        fetchData();
        emitDataChange('emi');
        emitDataChange('transactions');
      } else {
        toast.error(json.error?.message || 'Failed to delete EMI schedule');
      }
    } catch {
      toast.error('Network error deleting EMI schedule');
    }
  };

  // Filtered List
  const filteredEmis = emis.filter((emi) => {
    if (activeTab === 'active') return emi.status === EmiStatus.ACTIVE;
    if (activeTab === 'completed') return emi.status === EmiStatus.COMPLETED;
    return emi.status !== EmiStatus.ARCHIVED; // 'all' (excludes archived/deleted)
  });

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Landmark className="h-8 w-8 text-amber-500" />
            EMI Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track monthly loans, gadget EMIs, vehicle financing, and repayment progress without auto-debits.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowAddModal(true)} className="bg-amber-600 hover:bg-amber-700 text-white font-semibold">
            <Plus className="h-4 w-4 mr-2" />
            Add New EMI
          </Button>
        </div>
      </div>

      {/* Manual Control Safeguard Banner */}
      <Card className="bg-amber-500/10 border-amber-500/20 text-foreground">
        <CardContent className="p-4 flex items-center gap-3.5">
          <ShieldCheck className="h-6 w-6 text-amber-500 shrink-0" />
          <div className="text-xs">
            <span className="font-bold text-foreground">Manual Confirmation Safeguard: </span>
            In strict compliance with financial integrity specifications, EMI commitments are never debited automatically.
            Every monthly installment requires your explicit confirmation via <strong>Pay EMI</strong>.
          </div>
        </CardContent>
      </Card>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Active EMIs */}
        <Card className="bg-card/70 backdrop-blur-sm border-border">
          <CardContent className="p-4">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Active EMIs</p>
            {loading ? (
              <Skeleton className="h-7 w-16 mt-2" />
            ) : (
              <p className="text-2xl font-bold font-mono text-foreground mt-1">
                {summary ? summary.activeEmisCount : 0}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">Ongoing active commitments</p>
          </CardContent>
        </Card>

        {/* Estimated Monthly Outflow */}
        <Card className="bg-card/70 backdrop-blur-sm border-border">
          <CardContent className="p-4">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Est. Monthly Outflow</p>
            {loading ? (
              <Skeleton className="h-7 w-24 mt-2" />
            ) : (
              <p className="text-2xl font-bold font-mono text-amber-500 mt-1">
                {formatCurrency(summary?.estimatedMonthlyOutflow || 0, user?.currency || 'INR')}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">Expected monthly commitment</p>
          </CardContent>
        </Card>

        {/* Next EMI Due */}
        <Card className="bg-card/70 backdrop-blur-sm border-border">
          <CardContent className="p-4">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Next EMI Due</p>
            {loading ? (
              <Skeleton className="h-7 w-28 mt-2" />
            ) : summary?.nextEmiDue ? (
              <div>
                <p className="text-lg font-bold font-mono text-foreground mt-1 truncate">
                  {formatCurrency(summary.nextEmiDue.amount, user?.currency || 'INR')}
                </p>
                <p className="text-[10px] text-amber-500 font-semibold truncate">
                  {summary.nextEmiDue.emiName} ({new Date(summary.nextEmiDue.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })})
                </p>
              </div>
            ) : (
              <p className="text-sm font-medium text-muted-foreground mt-2">No pending EMIs</p>
            )}
          </CardContent>
        </Card>

        {/* Total Remaining EMI Amount */}
        <Card className="bg-card/70 backdrop-blur-sm border-border">
          <CardContent className="p-4">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Total Remaining</p>
            {loading ? (
              <Skeleton className="h-7 w-24 mt-2" />
            ) : (
              <p className="text-2xl font-bold font-mono text-foreground mt-1">
                {formatCurrency(summary?.totalRemainingAmount || 0, user?.currency || 'INR')}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">Scheduled outstanding obligations</p>
          </CardContent>
        </Card>

        {/* Completed EMIs */}
        <Card className="bg-card/70 backdrop-blur-sm border-border">
          <CardContent className="p-4">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Completed EMIs</p>
            {loading ? (
              <Skeleton className="h-7 w-16 mt-2" />
            ) : (
              <p className="text-2xl font-bold font-mono text-emerald-500 mt-1">
                {summary ? summary.completedEmisCount : 0}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">Fully settled loans</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-3">
        {[
          { id: 'active', label: 'Active EMIs', count: summary?.activeEmisCount || 0 },
          { id: 'completed', label: 'Completed EMIs', count: summary?.completedEmisCount || 0 },
          { id: 'all', label: 'All EMIs', count: emis.length },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all ${
              activeTab === tab.id
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted/60'
            }`}
          >
            <span>{tab.label}</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                activeTab === tab.id ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* EMI Cards / Table List */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : filteredEmis.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title={activeTab === 'completed' ? 'No Completed EMIs' : 'No Active EMIs Found'}
          description={
            activeTab === 'completed'
              ? 'When all installments of an EMI schedule are settled, it moves here automatically.'
              : 'Add your first EMI obligation to plan ahead and track monthly debt payoff progress.'
          }
          actionLabel={activeTab === 'active' ? 'Add New EMI' : undefined}
          onAction={activeTab === 'active' ? () => setShowAddModal(true) : undefined}
        />
      ) : (
        <div className="space-y-4">
          {filteredEmis.map((emi) => {
            const isCompleted = emi.status === EmiStatus.COMPLETED;
            const paidCount = emi.paidInstallmentsCount || 0;
            const totalCount = emi.totalInstallments || 1;
            const progressPercent = Math.min(100, Math.round((paidCount / totalCount) * 100));

            return (
              <Card key={emi.id} className="border-border bg-card/60 backdrop-blur-sm overflow-hidden hover:border-border/80 transition-all">
                <CardContent className="p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Link href={`/emi/${emi.id}`} className="hover:underline flex items-center gap-1.5 group">
                          <h3 className="text-base font-bold text-foreground group-hover:text-amber-500 transition-colors">
                            {emi.name}
                          </h3>
                          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-amber-500 transition-colors" />
                        </Link>
                        <Badge variant={isCompleted ? 'default' : 'outline'} className="text-[10px] uppercase font-bold">
                          {isCompleted ? 'Completed' : 'Active'}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          {emi.lender}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {emi.notes || `Due on day ${emi.dueDay} of each month`}
                      </p>
                    </div>

                    <div className="text-left sm:text-right">
                      <p className="text-[10px] uppercase font-semibold text-muted-foreground">Monthly Installment</p>
                      <p className="text-xl font-bold font-mono text-amber-500">
                        {formatCurrency(emi.monthlyAmount, user?.currency || 'INR')}
                      </p>
                    </div>
                  </div>

                  {/* Progress Bar & Key Counts */}
                  <div className="space-y-1.5 pt-2 border-t border-border/50">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground font-medium">
                        Progress: <strong className="text-foreground">{paidCount}</strong> of <strong>{totalCount}</strong> installments paid
                      </span>
                      <span className="font-mono font-bold text-xs text-foreground">{progressPercent}%</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${isCompleted ? 'bg-emerald-500' : 'bg-amber-500'}`}
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>

                  {/* Metrics Row & Action Buttons */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-2 text-xs">
                    <div className="flex flex-wrap items-center gap-4 text-muted-foreground">
                      <div>
                        <span className="block text-[10px] uppercase">Total Paid</span>
                        <span className="font-mono font-bold text-foreground">
                          {formatCurrency(emi.totalPaidAmount || 0, user?.currency || 'INR')}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] uppercase">Remaining</span>
                        <span className="font-mono font-bold text-amber-500">
                          {formatCurrency(emi.remainingAmount || 0, user?.currency || 'INR')}
                        </span>
                      </div>
                      {emi.nextDueDate && !isCompleted && (
                        <div>
                          <span className="block text-[10px] uppercase">Next Due</span>
                          <span className="font-semibold text-foreground">
                            {new Date(emi.nextDueDate).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Link href={`/emi/${emi.id}`}>
                        <Button variant="outline" size="sm" className="text-xs">
                          View Details
                        </Button>
                      </Link>
                      <Button variant="outline" size="sm" onClick={() => openScheduleModal(emi)} className="text-xs">
                        <ListOrdered className="h-3.5 w-3.5 mr-1.5" />
                        Schedule
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openEditModal(emi)} className="text-xs">
                        <Edit className="h-3.5 w-3.5 mr-1.5" />
                        Edit
                      </Button>
                      {!isCompleted && (
                        <Button
                          size="sm"
                          onClick={() => openPayModal(emi)}
                          disabled={payingEmiId === emi.id}
                          className="bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs"
                        >
                          <Play className="h-3.5 w-3.5 mr-1.5 fill-white" />
                          Pay EMI
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteEmi(emi)}
                        className="text-destructive hover:bg-destructive/10 text-xs px-2"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add New EMI Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-xl rounded-2xl bg-card border border-border p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Landmark className="h-5 w-5 text-amber-500" />
                  Add New EMI Schedule
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Set up monthly installment parameters, due day, and financing details.
                </p>
              </div>
            </div>

            <form onSubmit={handleCreateEmi} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    EMI / Loan Name *
                  </label>
                  <Input
                    required
                    placeholder="e.g. MacBook Pro M3 EMI, Home Loan"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Lender / Bank / Financier *
                  </label>
                  <Input
                    required
                    placeholder="e.g. HDFC Bank, Bajaj Finserv, Apple"
                    value={lender}
                    onChange={(e) => setLender(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Monthly EMI (₹) *
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="e.g. 5000"
                    value={monthlyAmount}
                    onChange={(e) => setMonthlyAmount(e.target.value)}
                    className="font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    First Due Date *
                  </label>
                  <DatePicker
                    value={firstDueDate}
                    onChange={setFirstDueDate}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Next EMI Date
                    <span className="text-[10px] text-muted-foreground ml-1 font-normal">(if ongoing)</span>
                  </label>
                  <DatePicker
                    value={nextEmiDate}
                    onChange={setNextEmiDate}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Final Due Date *
                  </label>
                  <DatePicker
                    value={endDate}
                    onChange={setEndDate}
                  />
                </div>
              </div>

              {/* Historical Installments Confirmation & Config */}
              {historicalOccurrences.length > 0 && (
                <div className="p-3.5 rounded-xl border border-amber-500/40 bg-amber-500/5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                        <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                        Historical Installments Detected ({historicalOccurrences.length})
                      </h4>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        The Next EMI Date is after First Due Date. There are {historicalOccurrences.length} installment(s) strictly prior to {nextEmiDate}.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        type="checkbox"
                        id="markHistPaid"
                        checked={markHistoricalPaid}
                        onChange={(e) => setMarkHistoricalPaid(e.target.checked)}
                        className="rounded border-input text-amber-600 focus:ring-amber-500 h-4 w-4"
                      />
                      <label htmlFor="markHistPaid" className="text-xs font-semibold text-foreground cursor-pointer select-none">
                        Mark previous as paid
                      </label>
                    </div>
                  </div>

                  {markHistoricalPaid ? (
                    <div className="space-y-3 pt-2 border-t border-border/50">
                      <div className="flex flex-wrap items-center gap-4 text-xs">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="histMode"
                            checked={historicalMode === 'modeA'}
                            onChange={() => setHistoricalMode('modeA')}
                            className="text-amber-600 focus:ring-amber-500"
                          />
                          <span>Mode A: Default monthly amount (₹{monthlyAmount || '0'})</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="histMode"
                            checked={historicalMode === 'modeB'}
                            onChange={() => setHistoricalMode('modeB')}
                            className="text-amber-600 focus:ring-amber-500"
                          />
                          <span>Mode B: Enter custom amounts per month</span>
                        </label>
                      </div>

                      {historicalMode === 'modeB' && (
                        <div className="max-h-48 overflow-y-auto space-y-2 pr-1 border border-border/40 rounded-lg p-2 bg-background/50">
                          {historicalOccurrences.map((h, idx) => (
                            <div key={h.occurrenceKey} className="flex items-center gap-2 text-xs bg-background p-2 rounded-md border border-border">
                              <span className="font-mono text-muted-foreground w-6">#{h.installmentNumber}</span>
                              <span className="font-medium w-24 shrink-0">{h.monthLabel}</span>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="Amount"
                                value={h.actualAmount}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setHistoricalOccurrences((prev) =>
                                    prev.map((item, i) => (i === idx ? { ...item, actualAmount: val } : item))
                                  );
                                }}
                                className="h-8 text-xs font-mono w-28"
                              />
                              <Input
                                type="text"
                                placeholder="Notes (optional)"
                                value={h.notes}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setHistoricalOccurrences((prev) =>
                                    prev.map((item, i) => (i === idx ? { ...item, notes: val } : item))
                                  );
                                }}
                                className="h-8 text-xs flex-1"
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      <p className="text-[10px] text-muted-foreground">
                        Note: Historical installments will receive <strong>Paid Historically</strong> status. They will <strong>NOT</strong> create bank transactions or alter your current account balances.
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-amber-500 font-medium pt-1">
                      Earlier installments will remain tracked as unpaid or overdue until confirmed or paid.
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Start Date
                  </label>
                  <DatePicker
                    value={startDate}
                    onChange={setStartDate}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    EMI Due Day (1-31)
                  </label>
                  <Input
                    type="number"
                    min="1"
                    max="31"
                    placeholder="Auto from first due date"
                    value={dueDay}
                    onChange={(e) => setDueDay(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Total Installments (Optional)
                  </label>
                  <Input
                    type="number"
                    min="1"
                    placeholder="Auto-calculated"
                    value={totalInstallments}
                    onChange={(e) => setTotalInstallments(e.target.value)}
                  />
                </div>
              </div>

              {/* Payment Method & Accounts */}
              <div className="space-y-3 pt-2 border-t border-border/60">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-foreground block mb-1">
                      Default Payment Method *
                    </label>
                    <select
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    >
                      <option value={PaymentMethod.UPI}>UPI / Bank Account</option>
                      <option value={PaymentMethod.CREDIT_CARD}>Credit Card</option>
                      <option value={PaymentMethod.CASH}>Cash in Hand</option>
                    </select>
                  </div>

                  {paymentMethod === PaymentMethod.CREDIT_CARD ? (
                    <div>
                      <label className="text-xs font-semibold text-foreground block mb-1">
                        Select Default Credit Card *
                      </label>
                      <select
                        className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={selectedCardId}
                        onChange={(e) => setSelectedCardId(e.target.value)}
                        required
                      >
                        <option value="">-- Choose Credit Card --</option>
                        {cards.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.cardNickname}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : paymentMethod === PaymentMethod.CASH ? (
                    <div className="flex items-center text-xs text-muted-foreground pt-6">
                      <span>Deducted from Cash in Hand</span>
                    </div>
                  ) : (
                    <div>
                      <label className="text-xs font-semibold text-foreground block mb-1">
                        Select Default Bank Account *
                      </label>
                      <select
                        className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={selectedAccountId}
                        onChange={(e) => setSelectedAccountId(e.target.value)}
                        required
                      >
                        <option value="">-- Choose Bank Account --</option>
                        {accounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.accountName}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* Down Payment Section (Phase 2 Requirement) */}
              <div className="space-y-3 pt-3 border-t border-border/60">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <CreditCard className="h-3.5 w-3.5 text-amber-500" />
                      Down Payment (Optional)
                    </h4>
                    <p className="text-[10px] text-muted-foreground">
                      Does not count as a monthly installment and does not alter installment count.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-foreground block mb-1">
                      Down Payment Amount (₹)
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="e.g. 15000"
                      value={downPaymentAmount}
                      onChange={(e) => setDownPaymentAmount(e.target.value)}
                      className="font-mono font-bold"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-foreground block mb-1">
                      Down Payment Date
                    </label>
                    <DatePicker
                      value={downPaymentDate}
                      onChange={setDownPaymentDate}
                    />
                  </div>
                </div>

                {parseFloat(downPaymentAmount) > 0 && (
                  <div className="space-y-3 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 animate-in fade-in">
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={downPaymentAlreadyPaid}
                        onChange={(e) => setDownPaymentAlreadyPaid(e.target.checked)}
                        className="mt-0.5 rounded border-input text-amber-600 focus:ring-amber-500 h-4 w-4"
                      />
                      <div>
                        <span className="text-xs font-bold text-foreground block">
                          Down Payment Already Paid (Historical / Offline)
                        </span>
                        <p className="text-[10px] text-muted-foreground">
                          Check this if the down payment was already settled outside the app. Marked as historical without creating a duplicate bank or card transaction.
                        </p>
                      </div>
                    </label>

                    {!downPaymentAlreadyPaid && (
                      <div className="space-y-2 pt-2 border-t border-amber-500/20">
                        <p className="text-[11px] font-semibold text-amber-500">
                          ⚡ Live Down Payment: A linked expense transaction will be recorded and debited from the chosen payment source.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-semibold text-foreground block mb-1">
                              Payment Source Method
                            </label>
                            <select
                              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              value={downPaymentPaymentMethod}
                              onChange={(e) => setDownPaymentPaymentMethod(e.target.value as PaymentMethod)}
                            >
                              <option value={PaymentMethod.UPI}>UPI / Bank Account</option>
                              <option value={PaymentMethod.CREDIT_CARD}>Credit Card</option>
                              <option value={PaymentMethod.CASH}>Cash in Hand</option>
                            </select>
                          </div>

                          {downPaymentPaymentMethod === PaymentMethod.CREDIT_CARD ? (
                            <div>
                              <label className="text-xs font-semibold text-foreground block mb-1">
                                Select Credit Card *
                              </label>
                              <select
                                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                value={downPaymentCreditCardId}
                                onChange={(e) => setDownPaymentCreditCardId(e.target.value)}
                              >
                                <option value="">-- Choose Credit Card --</option>
                                {cards.map((c) => (
                                  <option key={c.id} value={c.id}>{c.cardNickname}</option>
                                ))}
                              </select>
                            </div>
                          ) : downPaymentPaymentMethod === PaymentMethod.CASH ? (
                            <div className="flex items-center text-xs text-muted-foreground pt-6">
                              <span>Deducted from Cash in Hand</span>
                            </div>
                          ) : (
                            <div>
                              <label className="text-xs font-semibold text-foreground block mb-1">
                                Select Bank Account *
                              </label>
                              <select
                                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                value={downPaymentAccountId}
                                onChange={(e) => setDownPaymentAccountId(e.target.value)}
                              >
                                <option value="">-- Choose Bank Account --</option>
                                {accounts.map((acc) => (
                                  <option key={acc.id} value={acc.id}>{acc.accountName}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>

                        <div>
                          <label className="text-xs font-semibold text-foreground block mb-1">
                            Down Payment Notes (Optional)
                          </label>
                          <Input
                            placeholder="e.g. Down payment paid at dealership via UPI"
                            value={downPaymentNotes}
                            onChange={(e) => setDownPaymentNotes(e.target.value)}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Optional Loan Details */}
              <div className="space-y-3 pt-2 border-t border-border/60">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-foreground block mb-1">
                      Original Loan Principal (Optional)
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="e.g. 60000"
                      value={originalLoanAmount}
                      onChange={(e) => setOriginalLoanAmount(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-foreground block mb-1">
                      Loan Reference / Account # (Optional)
                    </label>
                    <Input
                      placeholder="e.g. LN-9843219"
                      value={loanReference}
                      onChange={(e) => setLoanReference(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Notes (Optional)
                  </label>
                  <Input
                    placeholder="e.g. 0% interest offer, auto-debit on 5th"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAddModal(false)}
                  disabled={submittingAdd}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={submittingAdd}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                >
                  {submittingAdd ? 'Creating...' : 'Create EMI Schedule'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pay EMI Popup Modal */}
      {showPayModal && selectedEmiForPay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl bg-card border border-border p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Play className="h-5 w-5 text-amber-500 fill-amber-500" />
                  Confirm &amp; Pay EMI Installment
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Confirm installment payment, adjust amount or discounts, and choose the payment method.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={closePayModal}
                disabled={Boolean(payingEmiId)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form onSubmit={handleConfirmPay} className="space-y-4">
              {/* Summary Card */}
              <div className="p-3.5 rounded-xl border border-border/80 bg-muted/30 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-sm text-foreground">{selectedEmiForPay.name}</h4>
                    <p className="text-xs text-muted-foreground">{selectedEmiForPay.lender}</p>
                    {selectedOccurrenceForPay && (
                      <Badge variant="secondary" className="text-[10px] mt-1">
                        Installment #{selectedOccurrenceForPay.installmentNumber} ({selectedOccurrenceForPay.occurrenceKey})
                      </Badge>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
                      Scheduled EMI
                    </span>
                    <span className="text-base font-bold font-mono text-foreground">
                      {formatCurrency(
                        selectedOccurrenceForPay ? selectedOccurrenceForPay.expectedAmount : selectedEmiForPay.monthlyAmount,
                        user?.currency || 'INR'
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* Dynamic Payment Method Selector */}
              <div className="space-y-3 pt-1 border-t border-border/60">
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Payment Method for This Installment
                  </label>
                  <select
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={payPaymentMethod}
                    onChange={(e) => {
                      const pm = e.target.value as PaymentMethod;
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
                    <option value={PaymentMethod.UPI}>UPI / Bank Account</option>
                    <option value={PaymentMethod.CREDIT_CARD}>Credit Card</option>
                    <option value={PaymentMethod.CASH}>Cash in Hand</option>
                  </select>
                </div>

                {payPaymentMethod === PaymentMethod.CREDIT_CARD && (
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground block">
                      Select Credit Card *
                    </label>
                    <select
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={payCreditCardId}
                      onChange={(e) => setPayCreditCardId(e.target.value)}
                      required
                    >
                      <option value="">-- Choose Credit Card --</option>
                      {cards.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.cardNickname}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-muted-foreground">
                      Charges this credit card and increases outstanding liability. Does not debit your bank account.
                    </p>
                  </div>
                )}

                {payPaymentMethod === PaymentMethod.CASH && (
                  <div className="p-3 rounded-lg border border-border/80 bg-muted/30 flex items-center gap-2.5 text-xs text-muted-foreground">
                    <Wallet className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span>
                      Deducted strictly from <strong>Cash in Hand</strong>. Bank and credit card balances will not be altered.
                    </span>
                  </div>
                )}

                {payPaymentMethod !== PaymentMethod.CREDIT_CARD && payPaymentMethod !== PaymentMethod.CASH && (
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground block">
                      Select Bank Account *
                    </label>
                    <select
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={payAccountId}
                      onChange={(e) => setPayAccountId(e.target.value)}
                      required
                    >
                      <option value="">-- Choose Bank Account --</option>
                      {accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.accountName}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-muted-foreground">
                      Payment will be debited directly from this bank account.
                    </p>
                  </div>
                )}

                {/* Update Future Defaults Checkbox */}
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

              {/* Discount / Offer Mode */}
              <div className="space-y-2 pt-2 border-t border-border/60">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5 text-amber-500" />
                    Offer / Cashback / Discount Adjustment
                  </label>
                  {payDiscountType !== 'none' && (
                    <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500/30">
                      Adjustment Applied
                    </Badge>
                  )}
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
                        if (mode.id === 'none') {
                          setPayDiscountValue('');
                        }
                      }}
                      className={`py-1.5 px-2 rounded-lg border text-xs font-medium transition-all ${
                        payDiscountType === mode.id
                          ? 'bg-amber-500/10 border-amber-500 text-amber-600 font-bold'
                          : 'border-border/60 hover:bg-muted/40 text-muted-foreground'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>

                {payDiscountType !== 'none' && (
                  <div className="space-y-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 animate-in fade-in duration-150">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-foreground">
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
                        placeholder="e.g. 100"
                        value={payDiscountValue}
                        onChange={(e) => setPayDiscountValue(e.target.value)}
                        className="font-mono font-bold"
                        required
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Live Calculation Breakdown */}
              {(() => {
                const { discountAmount, finalAmount } = getPayCalculation();
                const scheduled = selectedOccurrenceForPay
                  ? selectedOccurrenceForPay.expectedAmount
                  : selectedEmiForPay.monthlyAmount;
                return (
                  <div className="p-3.5 rounded-xl border border-border bg-muted/40 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Scheduled Amount:</span>
                      <span className="font-mono text-muted-foreground line-through">
                        {discountAmount > 0 ? formatCurrency(scheduled, user?.currency || 'INR') : ''}
                      </span>
                    </div>
                    {discountAmount > 0 && (
                      <div className="flex items-center justify-between text-amber-500 font-semibold">
                        <span>Discount / Savings:</span>
                        <span className="font-mono">- {formatCurrency(discountAmount, user?.currency || 'INR')}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-1.5 border-t border-border/60 text-sm">
                      <span className="font-bold text-foreground">Actual Amount to Pay:</span>
                      <span className="font-mono font-black text-lg text-amber-500">
                        {formatCurrency(finalAmount, user?.currency || 'INR')}
                      </span>
                    </div>
                  </div>
                );
              })()}

              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closePayModal}
                  disabled={Boolean(payingEmiId)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={Boolean(payingEmiId)}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                >
                  {payingEmiId ? 'Confirming...' : 'Confirm Payment'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Schedule Modal */}
      {viewScheduleEmi && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-2xl rounded-2xl bg-card border border-border p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <ListOrdered className="h-5 w-5 text-amber-500" />
                  EMI Schedule: {viewScheduleEmi.name}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Full monthly installment schedule through final scheduled date.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setViewScheduleEmi(null)}>
                Close
              </Button>
            </div>

            {loadingSchedule ? (
              <div className="space-y-2 py-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : scheduleOccurrences.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No schedule records found.</p>
            ) : (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                {scheduleOccurrences.map((occ) => {
                  const isPaidNormal = occ.status === EmiOccurrenceStatus.PAID;
                  const isPaidHistorical = occ.status === EmiOccurrenceStatus.PAID_HISTORICAL;
                  const isPaid = isPaidNormal || isPaidHistorical;
                  return (
                    <div
                      key={occ.id}
                      className={`flex items-center justify-between p-3 rounded-xl border text-xs transition-all ${
                        isPaidHistorical
                          ? 'border-purple-500/30 bg-purple-500/5'
                          : isPaidNormal
                          ? 'border-emerald-500/30 bg-emerald-500/5'
                          : 'border-border/80 bg-muted/20'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-muted-foreground w-6">#{occ.installmentNumber}</span>
                        <div>
                          <p className="font-bold text-foreground">{occ.occurrenceKey}</p>
                          <p className="text-[10px] text-muted-foreground">
                            Due: {new Date(occ.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="font-mono font-bold text-foreground">
                            {formatCurrency(isPaid ? occ.actualAmountPaid || occ.expectedAmount : occ.expectedAmount, user?.currency || 'INR')}
                          </p>
                          {occ.discountAmount && occ.discountAmount > 0 ? (
                            <p className="text-[10px] text-emerald-500">Saved ₹{occ.discountAmount}</p>
                          ) : null}
                        </div>

                        <div>
                          {isPaidNormal ? (
                            <Badge variant="default" className="bg-emerald-600 text-white text-[10px] flex items-center gap-1">
                              <CheckCircle className="h-3 w-3" /> Paid
                            </Badge>
                          ) : isPaidHistorical ? (
                            <Badge variant="outline" className="text-purple-600 border-purple-500/40 bg-purple-500/10 text-[10px] flex items-center gap-1">
                              <History className="h-3 w-3" /> Historical
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => openPayModal(viewScheduleEmi, occ)}
                              className="bg-amber-600 hover:bg-amber-700 text-white text-[11px] h-7 px-2.5 font-semibold"
                            >
                              Pay
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit EMI Modal */}
      {editingEmi && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl bg-card border border-border p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Edit className="h-5 w-5 text-amber-500" />
                  Edit EMI Settings
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Update future monthly installment amounts, end date, or payment defaults.
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveEditEmi} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-foreground block mb-1">
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
                  Will only update future unpaid installments. Past paid records remain untouched.
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground block mb-1">
                  Final Due Date / End Date *
                </label>
                <DatePicker
                  value={editEndDate}
                  onChange={setEditEndDate}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground block mb-1">
                  Next EMI Date (Optional)
                </label>
                <DatePicker
                  value={editNextEmiDate}
                  onChange={setEditNextEmiDate}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Upcoming installment that remains payable.
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground block mb-1">
                  Default Payment Method
                </label>
                <select
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={editPaymentMethod}
                  onChange={(e) => setEditPaymentMethod(e.target.value as PaymentMethod)}
                >
                  <option value={PaymentMethod.UPI}>UPI / Bank Account</option>
                  <option value={PaymentMethod.CREDIT_CARD}>Credit Card</option>
                  <option value={PaymentMethod.CASH}>Cash in Hand</option>
                </select>
              </div>

              {editPaymentMethod === PaymentMethod.CREDIT_CARD ? (
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Select Credit Card
                  </label>
                  <select
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={editCreditCardId}
                    onChange={(e) => setEditCreditCardId(e.target.value)}
                  >
                    <option value="">-- Choose Credit Card --</option>
                    {cards.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.cardNickname}
                      </option>
                    ))}
                  </select>
                </div>
              ) : editPaymentMethod !== PaymentMethod.CASH ? (
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Select Bank Account
                  </label>
                  <select
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={editAccountId}
                    onChange={(e) => setEditAccountId(e.target.value)}
                  >
                    <option value="">-- Choose Bank Account --</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.accountName}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div>
                <label className="text-xs font-semibold text-foreground block mb-1">
                  Notes
                </label>
                <Input
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingEmi(null)}
                  disabled={submittingEdit}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={submittingEdit}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                >
                  {submittingEdit ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function EmiManagementPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-muted-foreground">Loading EMI management...</div>}>
      <EmiManagementContent />
    </Suspense>
  );
}
