'use client';

import React, { useState, useEffect } from 'react';
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
  Repeat,
  Plus,
  RefreshCw,
  Trash2,
  Play,
  Calendar,
  CheckCircle,
  Clock,
  Sparkles,
  ShieldCheck,
  CreditCard,
  Wallet,
  Tag,
  CheckCheck,
  Ban,
  XCircle,
  SkipForward,
} from 'lucide-react';
import {
  formatCurrency,
  TransactionType,
  RecurringFrequency,
  PaymentMethod,
  PaymentChannel,
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INVESTMENT_CATEGORIES,
} from '@finora/shared';
import { emitDataChange, useDataSync } from '@/lib/data-sync';

interface RecurringItem {
  id: string;
  title: string;
  amount: number;
  type: TransactionType;
  category: string;
  frequency: RecurringFrequency;
  paymentMethod: PaymentMethod;
  paymentChannel: PaymentChannel;
  accountId?: string;
  creditCardId?: string;
  nextExecutionDate: string;
  lastExecutedAt?: string;
  notes?: string;
  isActive: boolean;
  status?: 'active' | 'completed' | 'cancelled';
  isFlexibleDate?: boolean;
  isLoggedForCurrentMonth?: boolean;
  currentMonthCycleKey?: string;
  currentMonthOccurrenceStatus?: 'DUE' | 'LOGGED' | 'SKIPPED';
  currentMonthTransactionId?: string;
}

export default function RecurringPage() {
  const { user } = useAuth();
  const [rules, setRules] = useState<RecurringItem[]>([]);
  const [accounts, setAccounts] = useState<Array<{ id: string; accountName: string }>>([]);
  const [cards, setCards] = useState<Array<{ id: string; cardNickname: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [executingId, setExecutingId] = useState<string | null>(null);

  // Log Now Confirmation & Discount Modal State
  const [selectedRuleForLog, setSelectedRuleForLog] = useState<RecurringItem | null>(null);
  const [showLogModal, setShowLogModal] = useState(false);
  const [logDiscountType, setLogDiscountType] = useState<'none' | 'fixed' | 'percentage' | 'override'>('none');
  const [logDiscountValue, setLogDiscountValue] = useState('');
  const [logNotes, setLogNotes] = useState('');
  const [logUpdateFutureAmount, setLogUpdateFutureAmount] = useState(false);
  const [logFutureAmount, setLogFutureAmount] = useState('');
  const [logPaymentMethod, setLogPaymentMethod] = useState<PaymentMethod>(PaymentMethod.UPI);
  const [logAccountId, setLogAccountId] = useState('');
  const [logCreditCardId, setLogCreditCardId] = useState('');
  const [logUpdateFuturePaymentSettings, setLogUpdateFuturePaymentSettings] = useState(false);

  // Form State
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<TransactionType>(TransactionType.EXPENSE);
  const [category, setCategory] = useState('Utilities');
  const [frequency, setFrequency] = useState<RecurringFrequency>(RecurringFrequency.MONTHLY);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.UPI);
  const [paymentChannel, setPaymentChannel] = useState<PaymentChannel>(PaymentChannel.ONLINE);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [selectedCardId, setSelectedCardId] = useState('');
  const [nextExecutionDate, setNextExecutionDate] = useState(tomorrow.toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [isFlexibleDate, setIsFlexibleDate] = useState(false);

  const getApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const fetchData = async () => {
    setLoading(true);
    try {
      const [rulesRes, accRes, cardRes] = await Promise.all([
        fetch(`${getApiUrl()}/api/v1/recurring`, { credentials: 'include' }),
        fetch(`${getApiUrl()}/api/v1/accounts`, { credentials: 'include' }),
        fetch(`${getApiUrl()}/api/v1/credit-cards`, { credentials: 'include' }),
      ]);

      const [rulesJson, accJson, cardJson] = await Promise.all([
        rulesRes.json(),
        accRes.json(),
        cardRes.json(),
      ]);

      if (rulesRes.ok && rulesJson.success) setRules(rulesJson.data || []);
      if (accRes.ok && accJson.success) {
        setAccounts(accJson.data || []);
        if (accJson.data?.length > 0 && !selectedAccountId) {
          setSelectedAccountId(accJson.data[0].id);
        }
      }
      if (cardRes.ok && cardJson.success) setCards(cardJson.data || []);
    } catch {
      toast.error('Network error loading recurring schedules');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useDataSync(fetchData, ['transactions', 'recurring', 'accounts']);

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) {
      toast.error('Amount must be positive');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/recurring`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title,
          amount: val,
          type,
          category,
          frequency,
          paymentMethod,
          paymentChannel,
          accountId: paymentMethod === PaymentMethod.CREDIT_CARD ? undefined : selectedAccountId || undefined,
          creditCardId: paymentMethod === PaymentMethod.CREDIT_CARD ? selectedCardId || undefined : undefined,
          nextExecutionDate: new Date(nextExecutionDate).toISOString(),
          notes,
          isActive: true,
          isFlexibleDate,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Recurring schedule created successfully');
        setShowAddModal(false);
        setTitle('');
        setAmount('');
        setIsFlexibleDate(false);
        fetchData();
        emitDataChange('recurring');
      } else {
        toast.error(json.error?.message || 'Failed to create recurring rule');
      }
    } catch {
      toast.error('Network error creating recurring schedule');
    } finally {
      setSubmitting(false);
    }
  };

  const getLogCalculation = () => {
    if (!selectedRuleForLog) return { discountAmount: 0, finalAmount: 0 };
    const original = selectedRuleForLog.amount;
    let discountAmount = 0;
    let finalAmount = original;

    if (logDiscountType === 'fixed') {
      const val = parseFloat(logDiscountValue) || 0;
      discountAmount = Math.max(0, Math.min(original, val));
      finalAmount = Math.max(0, original - discountAmount);
    } else if (logDiscountType === 'percentage') {
      const pct = Math.max(0, Math.min(100, parseFloat(logDiscountValue) || 0));
      discountAmount = Math.round((original * pct) / 100 * 100) / 100;
      finalAmount = Math.max(0, original - discountAmount);
    } else if (logDiscountType === 'override') {
      const val = parseFloat(logDiscountValue) || 0;
      finalAmount = Math.max(0, val);
      discountAmount = Math.max(0, original - finalAmount);
    }

    return { discountAmount, finalAmount };
  };

  const openLogModal = (rule: RecurringItem) => {
    setSelectedRuleForLog(rule);
    setLogDiscountType('none');
    setLogDiscountValue('');
    setLogNotes('');
    setLogUpdateFutureAmount(false);
    setLogFutureAmount(rule.amount.toString());
    setLogPaymentMethod(rule.paymentMethod || PaymentMethod.UPI);
    setLogAccountId(rule.accountId || (accounts.length > 0 ? accounts[0].id : ''));
    setLogCreditCardId(rule.creditCardId || (cards.length > 0 ? cards[0].id : ''));
    setLogUpdateFuturePaymentSettings(false);
    setShowLogModal(true);
  };

  const handleConfirmLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRuleForLog) return;
    const { discountAmount, finalAmount } = getLogCalculation();
    if (finalAmount <= 0) {
      toast.error('Final transaction amount must be greater than 0');
      return;
    }

    if (logPaymentMethod === PaymentMethod.CREDIT_CARD && !logCreditCardId) {
      toast.error('Please select a credit card for payment');
      return;
    }
    if (
      (logPaymentMethod === PaymentMethod.UPI ||
        logPaymentMethod === PaymentMethod.BANK_TRANSFER ||
        logPaymentMethod === PaymentMethod.DEBIT_CARD) &&
      !logAccountId
    ) {
      toast.error('Please select a bank account for payment');
      return;
    }

    let futureAmtNum: number | undefined = undefined;
    if (logUpdateFutureAmount) {
      futureAmtNum = parseFloat(logFutureAmount);
      if (isNaN(futureAmtNum) || futureAmtNum <= 0) {
        toast.error('Please enter a valid future recurring amount greater than 0');
        return;
      }
    }

    setExecutingId(selectedRuleForLog.id);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/recurring/${selectedRuleForLog.id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          actualAmount: finalAmount,
          discountType: logDiscountType,
          discountAmount,
          discountNotes: logNotes.trim() || undefined,
          updateFutureAmount: logUpdateFutureAmount,
          futureAmount: futureAmtNum,
          paymentMethod: logPaymentMethod,
          accountId:
            logPaymentMethod !== PaymentMethod.CREDIT_CARD && logPaymentMethod !== PaymentMethod.CASH
              ? logAccountId || undefined
              : undefined,
          creditCardId: logPaymentMethod === PaymentMethod.CREDIT_CARD ? logCreditCardId || undefined : undefined,
          updateFuturePaymentSettings: logUpdateFuturePaymentSettings,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(
          discountAmount > 0
            ? `Transaction logged! ₹${finalAmount.toLocaleString()} debited (Saved ₹${discountAmount.toLocaleString()}).`
            : `Transaction logged: "${selectedRuleForLog.title}" posted successfully!`
        );
        setShowLogModal(false);
        setSelectedRuleForLog(null);
        fetchData();
        emitDataChange('transactions');
        emitDataChange('accounts');
        emitDataChange('recurring');
      } else {
        toast.error(json.error?.message || 'Failed to execute recurring schedule');
      }
    } catch {
      toast.error('Network error executing recurring transaction');
    } finally {
      setExecutingId(null);
    }
  };

  const handleDeleteRule = async (id: string, ruleTitle: string) => {
    if (!confirm(`Delete recurring schedule for "${ruleTitle}"?`)) return;

    try {
      const res = await fetch(`${getApiUrl()}/api/v1/recurring/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Recurring schedule deleted');
        setRules(rules.filter((r) => r.id !== id));
        emitDataChange('recurring');
      } else {
        toast.error(json.error?.message || 'Failed to delete schedule');
      }
    } catch {
      toast.error('Network error deleting recurring schedule');
    }
  };

  const handleSkipMonth = async (rule: RecurringItem) => {
    if (!confirm(`Skip this month's installment for "${rule.title}"? No balance will be debited.`)) return;

    try {
      const res = await fetch(`${getApiUrl()}/api/v1/recurring/${rule.id}/skip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(json.message || 'Skipped payment for this month');
        fetchData();
        emitDataChange('recurring');
      } else {
        toast.error(json.error?.message || 'Failed to skip payment');
      }
    } catch {
      toast.error('Network error skipping recurring payment');
    }
  };

  const handleCompleteRule = async (rule: RecurringItem) => {
    if (!confirm(`Mark recurring schedule "${rule.title}" as completed? No further payments will be scheduled.`)) return;

    try {
      const res = await fetch(`${getApiUrl()}/api/v1/recurring/${rule.id}/complete`, {
        method: 'POST',
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(json.message || 'Recurring schedule marked as completed');
        fetchData();
        emitDataChange('recurring');
      } else {
        toast.error(json.error?.message || 'Failed to mark schedule as completed');
      }
    } catch {
      toast.error('Network error updating recurring schedule');
    }
  };

  const handleCancelRule = async (rule: RecurringItem) => {
    if (!confirm(`Cancel future payments for recurring schedule "${rule.title}"?`)) return;

    try {
      const res = await fetch(`${getApiUrl()}/api/v1/recurring/${rule.id}/cancel`, {
        method: 'POST',
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(json.message || 'Recurring schedule cancelled');
        fetchData();
        emitDataChange('recurring');
      } else {
        toast.error(json.error?.message || 'Failed to cancel recurring schedule');
      }
    } catch {
      toast.error('Network error cancelling recurring schedule');
    }
  };

  // Aggregates
  const totalMonthlyCommitments = rules
    .filter((r) => r.isActive && r.type === TransactionType.EXPENSE)
    .reduce((sum, r) => {
      if (r.frequency === RecurringFrequency.MONTHLY) return sum + r.amount;
      if (r.frequency === RecurringFrequency.WEEKLY) return sum + r.amount * 4.33;
      if (r.frequency === RecurringFrequency.QUARTERLY) return sum + r.amount / 3;
      if (r.frequency === RecurringFrequency.YEARLY) return sum + r.amount / 12;
      return sum + r.amount;
    }, 0);

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Repeat className="h-8 w-8 text-[#05A100]" />
            Recurring Transactions & Bills
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track subscriptions, utilities, and rent with explicit manual confirmation workflows.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowAddModal(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            <Plus className="h-4 w-4 mr-2" />
            New Recurring Rule
          </Button>
        </div>
      </div>

      {/* Manual Control Banner */}
      <Card className="bg-emerald-500/10 border-emerald-500/20 text-foreground">
        <CardContent className="p-4 flex items-center gap-3.5">
          <ShieldCheck className="h-6 w-6 text-[#05A100] shrink-0" />
          <div className="text-xs">
            <span className="font-bold text-foreground">Controlled Financial Integrity: </span>
            In strict compliance with M12 Expense Tracker manual financial specifications, recurring rules never create ghost
            duplicate transactions automatically. You maintain full oversight and confirm execution with a single click.
          </div>
        </CardContent>
      </Card>

      {/* Quick KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-card/70 backdrop-blur-sm border-border">
          <CardContent className="p-5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Est. Monthly Outflow
            </p>
            <p className="text-2xl font-bold text-foreground mt-1">
              {formatCurrency(totalMonthlyCommitments, user?.currency || 'INR')}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Across active recurring expenses</p>
          </CardContent>
        </Card>

        <Card className="bg-card/70 backdrop-blur-sm border-border">
          <CardContent className="p-5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Active Schedules
            </p>
            <p className="text-2xl font-bold text-foreground mt-1">
              {rules.filter((r) => r.isActive).length}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{rules.length} total rules configured</p>
          </CardContent>
        </Card>

        <Card className="bg-card/70 backdrop-blur-sm border-border">
          <CardContent className="p-5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Next Due Date
            </p>
            <p className="text-2xl font-bold text-foreground mt-1">
              {rules.length > 0
                ? new Date(rules[0].nextExecutionDate).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })
                : 'None'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {rules.length > 0 ? rules[0].title : 'No upcoming schedules'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Rules List */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : rules.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title="No Recurring Transactions Configured"
          description="Create recurring rules for rent, salaries, EMI, broadband, and subscriptions to receive due reminders and record them with one click."
          actionLabel="Add Recurring Rule"
          onAction={() => setShowAddModal(true)}
        />
      ) : (

        <div className="space-y-3">
          {rules.map((rule) => {
            const isDueSoon = new Date(rule.nextExecutionDate) <= new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

            return (
              <Card key={rule.id} className="border-border hover:shadow-sm transition-all bg-card">
                <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <div className="h-10 w-10 rounded-xl bg-muted/60 flex items-center justify-center shrink-0 text-foreground">
                      <Repeat className="h-5 w-5 text-[#05A100]" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-foreground text-base">{rule.title}</h4>
                        <Badge variant="outline" className="text-[10px] uppercase font-semibold">
                          {rule.frequency}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] capitalize">
                          {rule.category}
                        </Badge>
                        {rule.isFlexibleDate && (
                          <Badge variant="outline" className="text-[10px] text-cyan-500 border-cyan-500/30">
                            Flexible Date
                          </Badge>
                        )}
                        {rule.status === 'completed' && (
                          <Badge variant="secondary" className="text-[10px] bg-muted text-muted-foreground">
                            Completed
                          </Badge>
                        )}
                        {rule.status === 'cancelled' && (
                          <Badge variant="secondary" className="text-[10px] bg-rose-500/10 text-rose-500 border-rose-500/30">
                            Cancelled
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" /> Next Due:{' '}
                          <span className={isDueSoon ? 'text-amber-500 font-semibold' : 'text-foreground'}>
                            {new Date(rule.nextExecutionDate).toLocaleDateString()}
                          </span>
                        </span>
                        {rule.lastExecutedAt && (
                          <span className="flex items-center gap-1">
                            <CheckCircle className="h-3.5 w-3.5 text-teal-500" /> Last logged:{' '}
                            {new Date(rule.lastExecutedAt).toLocaleDateString()}
                          </span>
                        )}
                        {rule.notes && <span>• {rule.notes}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 pt-3 sm:pt-0 border-t sm:border-t-0 border-border">
                    <div className="text-right mr-2">
                      <p className="text-lg font-bold text-foreground">
                        {formatCurrency(rule.amount, user?.currency || 'INR')}
                      </p>
                      <p className="text-[11px] text-muted-foreground capitalize">{rule.type}</p>
                    </div>

                    {rule.status === 'completed' || rule.status === 'cancelled' ? (
                      <span className="text-xs font-medium text-muted-foreground italic px-2 py-1">
                        Inactive schedule
                      </span>
                    ) : rule.isLoggedForCurrentMonth ? (
                      <Button
                        size="sm"
                        disabled={true}
                        variant="secondary"
                        className="bg-muted text-muted-foreground cursor-not-allowed opacity-90 shadow-none border border-border"
                      >
                        <CheckCircle className="h-3.5 w-3.5 mr-1.5 text-teal-500" />
                        Logged for {new Date().toLocaleString('en-US', { month: 'long' })}
                      </Button>
                    ) : rule.currentMonthOccurrenceStatus === 'SKIPPED' ? (
                      <Button
                        size="sm"
                        disabled={true}
                        variant="outline"
                        className="bg-amber-500/10 text-amber-500 border-amber-500/30 cursor-not-allowed opacity-90 shadow-none"
                      >
                        <Ban className="h-3.5 w-3.5 mr-1.5" />
                        Skipped for {new Date().toLocaleString('en-US', { month: 'long' })}
                      </Button>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          onClick={() => openLogModal(rule)}
                          disabled={executingId === rule.id}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                        >
                          <Play className={`h-3.5 w-3.5 mr-1.5 ${executingId === rule.id ? 'animate-spin' : ''}`} />
                          {executingId === rule.id ? 'Posting...' : 'Log Now'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSkipMonth(rule)}
                          className="text-amber-500 border-amber-500/30 hover:bg-amber-500/10 text-xs"
                          title="Skip This Month"
                        >
                          <SkipForward className="h-3.5 w-3.5 mr-1" />
                          Skip
                        </Button>
                      </div>
                    )}

                    {rule.status !== 'completed' && rule.status !== 'cancelled' && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCompleteRule(rule)}
                          className="text-muted-foreground hover:text-emerald-500 h-8 w-8 p-0"
                          title="Mark as Completed"
                        >
                          <CheckCheck className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCancelRule(rule)}
                          className="text-muted-foreground hover:text-amber-500 h-8 w-8 p-0"
                          title="Cancel Future Payments"
                        >
                          <Ban className="h-4 w-4" />
                        </Button>
                      </>
                    )}

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteRule(rule.id, rule.title)}
                      className="text-muted-foreground hover:text-rose-600 h-8 w-8 p-0"
                      title="Delete Schedule"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add Recurring Rule Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl bg-card border border-border p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4 border-b border-border pb-3">
              <div>
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-emerald-500" />
                  New Recurring Schedule
                </h3>
                <p className="text-xs text-muted-foreground">
                  Schedule recurring expenses, salaries, or bill reminders.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAddModal(false)}
                className="h-8 w-8 p-0 rounded-full"
              >
                ✕
              </Button>
            </div>

            <form onSubmit={handleCreateRule} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-foreground block mb-1">
                  Schedule Title
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Netflix Subscription, Apartment Rent"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Amount ({user?.currency || 'INR'})
                  </label>
                  <Input
                    type="number"
                    min="1"
                    step="any"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="1500"
                    required
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Frequency
                  </label>
                  <select
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as RecurringFrequency)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value={RecurringFrequency.WEEKLY}>Weekly</option>
                    <option value={RecurringFrequency.MONTHLY}>Monthly</option>
                    <option value={RecurringFrequency.QUARTERLY}>Quarterly</option>
                    <option value={RecurringFrequency.YEARLY}>Yearly</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Transaction Type
                  </label>
                  <select
                    value={type}
                    onChange={(e) => {
                      const newType = e.target.value as TransactionType;
                      setType(newType);
                      if (newType === TransactionType.INVESTMENT) {
                        setCategory(DEFAULT_INVESTMENT_CATEGORIES[0].name);
                      } else if (newType === TransactionType.INCOME) {
                        setCategory(DEFAULT_INCOME_CATEGORIES[0].name);
                      } else {
                        setCategory(DEFAULT_EXPENSE_CATEGORIES[0].name);
                      }
                    }}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value={TransactionType.EXPENSE}>Expense</option>
                    <option value={TransactionType.INCOME}>Income</option>
                    <option value={TransactionType.INVESTMENT}>Investment</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {(type === TransactionType.INCOME
                      ? DEFAULT_INCOME_CATEGORIES
                      : type === TransactionType.INVESTMENT
                      ? DEFAULT_INVESTMENT_CATEGORIES
                      : DEFAULT_EXPENSE_CATEGORIES
                    ).map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Payment Method
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value={PaymentMethod.UPI}>UPI</option>
                    <option value={PaymentMethod.NET_BANKING}>Net Banking</option>
                    <option value={PaymentMethod.DEBIT_CARD}>Debit Card</option>
                    <option value={PaymentMethod.CREDIT_CARD}>Credit Card</option>
                    <option value={PaymentMethod.BANK_TRANSFER}>Bank Transfer</option>
                    <option value={PaymentMethod.CASH}>Cash</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Payment Channel
                  </label>
                  <select
                    value={paymentChannel}
                    onChange={(e) => setPaymentChannel(e.target.value as PaymentChannel)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value={PaymentChannel.ONLINE}>Online</option>
                    <option value={PaymentChannel.OFFLINE}>Offline</option>
                  </select>
                </div>
              </div>

              {paymentMethod === PaymentMethod.CREDIT_CARD ? (
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Select Credit Card
                  </label>
                  <select
                    value={selectedCardId}
                    onChange={(e) => setSelectedCardId(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  >
                    <option value="">Select a card...</option>
                    {cards.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.cardNickname}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Select Bank Account
                  </label>
                  <select
                    value={selectedAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">None / External</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.accountName}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-foreground block mb-1">
                  Next Due Date
                </label>
                <DatePicker
                  value={nextExecutionDate}
                  onChange={setNextExecutionDate}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground block mb-1">
                  Notes (Optional)
                </label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Account number, contract ID"
                />
              </div>

              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="isFlexibleDate"
                  checked={isFlexibleDate}
                  onChange={(e) => setIsFlexibleDate(e.target.checked)}
                  className="h-4 w-4 rounded border-input text-primary focus:ring-ring cursor-pointer"
                />
                <label
                  htmlFor="isFlexibleDate"
                  className="text-xs font-semibold leading-none cursor-pointer select-none text-foreground"
                >
                  Flexible / Random Payment Date (No strict calendar due date)
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAddModal(false)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={submitting}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {submitting ? 'Creating...' : 'Save Schedule'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Log Now Confirmation & Discount Modal */}
      {showLogModal && selectedRuleForLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl bg-card border border-border p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <Play className="h-5 w-5 text-emerald-500 fill-emerald-500" />
                  {selectedRuleForLog.type === TransactionType.INVESTMENT
                    ? 'Confirm & Log Investment'
                    : 'Confirm & Log Payment'}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {selectedRuleForLog.type === TransactionType.INVESTMENT
                    ? 'Review investment contribution details, confirm actual amount, and post.'
                    : 'Review payment details, apply any bill discounts or promo codes, and post.'}
                </p>
              </div>
            </div>

            <form onSubmit={handleConfirmLog} className="space-y-4">
              {/* Rule Summary Card */}
              <div className="p-3.5 rounded-xl border border-border/80 bg-muted/30 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-sm text-foreground">{selectedRuleForLog.title}</h4>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {selectedRuleForLog.frequency}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {selectedRuleForLog.category}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
                      Configured
                    </span>
                    <span className="text-base font-bold font-mono text-foreground">
                      {formatCurrency(selectedRuleForLog.amount, user?.currency || 'INR')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Dynamic Payment Method & Account Selection */}
              <div className="space-y-3 pt-1 border-t border-border/60">
                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">
                    Payment Method for This Payment
                  </label>
                  <select
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={logPaymentMethod}
                    onChange={(e) => {
                      const pm = e.target.value as PaymentMethod;
                      setLogPaymentMethod(pm);
                      if (pm === PaymentMethod.CREDIT_CARD && !logCreditCardId && cards.length > 0) {
                        setLogCreditCardId(cards[0].id);
                      }
                      if (
                        (pm === PaymentMethod.UPI || pm === PaymentMethod.DEBIT_CARD || pm === PaymentMethod.BANK_TRANSFER) &&
                        !logAccountId &&
                        accounts.length > 0
                      ) {
                        setLogAccountId(accounts[0].id);
                      }
                    }}
                  >
                    <option value={PaymentMethod.UPI}>UPI / Bank Account</option>
                    <option value={PaymentMethod.CREDIT_CARD}>Credit Card</option>
                    <option value={PaymentMethod.CASH}>Cash in Hand</option>
                  </select>
                </div>

                {logPaymentMethod === PaymentMethod.CREDIT_CARD && (
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground block">
                      Select Credit Card *
                    </label>
                    <select
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={logCreditCardId}
                      onChange={(e) => setLogCreditCardId(e.target.value)}
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

                {logPaymentMethod === PaymentMethod.CASH && (
                  <div className="p-3 rounded-lg border border-border/80 bg-muted/30 flex items-center gap-2.5 text-xs text-muted-foreground">
                    <Wallet className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span>
                      Deducted strictly from <strong>Cash in Hand</strong>. Bank and credit card balances will not be altered.
                    </span>
                  </div>
                )}

                {logPaymentMethod !== PaymentMethod.CREDIT_CARD && logPaymentMethod !== PaymentMethod.CASH && (
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-foreground block">
                      Select Bank Account *
                    </label>
                    <select
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={logAccountId}
                      onChange={(e) => setLogAccountId(e.target.value)}
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

                {/* Update Default Payment Settings Option */}
                <div className="flex items-center space-x-2 pt-1">
                  <input
                    type="checkbox"
                    id="logUpdateFuturePaymentSettings"
                    checked={logUpdateFuturePaymentSettings}
                    onChange={(e) => setLogUpdateFuturePaymentSettings(e.target.checked)}
                    className="h-4 w-4 rounded border-input text-primary focus:ring-ring cursor-pointer"
                  />
                  <label
                    htmlFor="logUpdateFuturePaymentSettings"
                    className="text-xs font-semibold leading-none cursor-pointer select-none text-foreground"
                  >
                    Update default payment settings for future payments
                  </label>
                </div>
              </div>

              {/* Discount / Offer Mode */}
              <div className="space-y-2 pt-2 border-t border-border/60">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5 text-emerald-500" />
                    Bill Discount / Promotional Offer
                  </label>
                  {logDiscountType !== 'none' && (
                    <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/30">
                      Offer Applied
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
                        setLogDiscountType(mode.id as any);
                        if (mode.id === 'none') {
                          setLogDiscountValue('');
                        }
                      }}
                      className={`py-1.5 px-2 rounded-lg border text-xs font-medium transition-all ${
                        logDiscountType === mode.id
                          ? 'bg-primary/10 border-primary text-primary font-bold'
                          : 'border-border/60 hover:bg-muted/40 text-muted-foreground'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>

                {logDiscountType !== 'none' && (
                  <div className="space-y-3 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 animate-in fade-in duration-150">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-foreground">
                        {logDiscountType === 'fixed'
                          ? 'Discount Amount (₹) *'
                          : logDiscountType === 'percentage'
                          ? 'Discount Percentage (%) *'
                          : 'Custom Final Amount (₹) *'}
                      </label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder={
                          logDiscountType === 'fixed'
                            ? 'e.g. 150'
                            : logDiscountType === 'percentage'
                            ? 'e.g. 10'
                            : 'e.g. 850'
                        }
                        value={logDiscountValue}
                        onChange={(e) => setLogDiscountValue(e.target.value)}
                        className="font-mono font-bold"
                        required
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-muted-foreground">
                        Offer Notes / Coupon Code (Optional)
                      </label>
                      <Input
                        type="text"
                        placeholder="e.g. Coupon FESTIVE10, Bill Rebate"
                        value={logNotes}
                        onChange={(e) => setLogNotes(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Live Calculation Summary */}
              {(() => {
                const { discountAmount, finalAmount } = getLogCalculation();
                return (
                  <div className="p-3.5 rounded-xl border border-border bg-muted/40 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Original Configured Amount:</span>
                      <span className="font-mono text-muted-foreground line-through">
                        {discountAmount > 0 ? formatCurrency(selectedRuleForLog.amount, user?.currency || 'INR') : ''}
                      </span>
                    </div>
                    {discountAmount > 0 && (
                      <div className="flex items-center justify-between text-emerald-500 font-semibold">
                        <span>Discount / Savings:</span>
                        <span className="font-mono">- {formatCurrency(discountAmount, user?.currency || 'INR')}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-1.5 border-t border-border/60 text-sm">
                      <span className="font-bold text-foreground">Actual Amount to Pay:</span>
                      <span className="font-mono font-black text-lg text-emerald-500">
                        {formatCurrency(finalAmount, user?.currency || 'INR')}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground pt-0.5">
                      The expense transaction and account deduction will strictly match{' '}
                      <strong>{formatCurrency(finalAmount, user?.currency || 'INR')}</strong>.
                    </p>
                  </div>
                );
              })()}

              {/* Future-Only Amount Change Toggle */}
              <div className="pt-2 border-t border-border/60 space-y-2">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="logUpdateFutureCheckbox"
                    checked={logUpdateFutureAmount}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setLogUpdateFutureAmount(checked);
                      if (checked && !logFutureAmount) {
                        const { finalAmount } = getLogCalculation();
                        setLogFutureAmount(finalAmount.toString());
                      }
                    }}
                    className="h-4 w-4 rounded border-input text-primary focus:ring-ring cursor-pointer"
                  />
                  <label
                    htmlFor="logUpdateFutureCheckbox"
                    className="text-xs font-semibold leading-none cursor-pointer select-none text-foreground"
                  >
                    Update recurring amount for future payments
                  </label>
                </div>

                {logUpdateFutureAmount && (
                  <div className="p-3 rounded-lg border border-border bg-muted/30 space-y-1.5 animate-in fade-in duration-150">
                    <label className="text-xs font-semibold text-foreground">
                      New Recurring Amount for Future Cycles (₹) *
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="e.g. 850"
                      value={logFutureAmount}
                      onChange={(e) => setLogFutureAmount(e.target.value)}
                      className="font-mono font-bold"
                      required={logUpdateFutureAmount}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Only future due cycles will use this new amount. Currently logged and past transactions will remain untouched.
                    </p>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowLogModal(false);
                    setSelectedRuleForLog(null);
                  }}
                  disabled={executingId === selectedRuleForLog.id}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={executingId === selectedRuleForLog.id}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                >
                  {executingId === selectedRuleForLog.id ? (
                    'Posting...'
                  ) : (
                    `Confirm & Log ${selectedRuleForLog.type === TransactionType.INVESTMENT ? 'Investment' : 'Payment'} (${formatCurrency(getLogCalculation().finalAmount, user?.currency || 'INR')})`
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
