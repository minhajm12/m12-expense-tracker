'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  TransactionType,
  PaymentMethod,
  PaymentChannel,
  RefundClassification,
  RefundableExpenseItem,
  BankAccount,
  CreditCard,
  DEFAULT_INVESTMENT_CATEGORIES,
  formatDateToInput,
  parseDateInput,
} from '@finora/shared';
import { emitDataChange } from '@/lib/data-sync';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { AlertCircle, RotateCcw, X } from 'lucide-react';

interface CategoryItem {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
}

interface RecordTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function RecordTransactionModal({
  isOpen,
  onClose,
  onSuccess,
}: RecordTransactionModalProps) {
  const { user } = useAuth();

  // Form State
  const [txType, setTxType] = useState<TransactionType>(TransactionType.EXPENSE);
  const [txTitle, setTxTitle] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [txDate, setTxDate] = useState(() => formatDateToInput(new Date()));
  const [txCategory, setTxCategory] = useState('');
  const [txPaymentMethod, setTxPaymentMethod] = useState<PaymentMethod>(PaymentMethod.UPI);
  const [txPaymentChannel, setTxPaymentChannel] = useState<PaymentChannel>(PaymentChannel.ONLINE);
  const [txAccountId, setTxAccountId] = useState('');
  const [txCreditCardId, setTxCreditCardId] = useState('');
  const [txMerchant, setTxMerchant] = useState('');
  const [txNotes, setTxNotes] = useState('');
  const [isPastRecorded, setIsPastRecorded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Refund State
  const [refundClassification, setRefundClassification] = useState<RefundClassification>(RefundClassification.LINKED_REFUND);
  const [selectedExpenseId, setSelectedExpenseId] = useState<string>('');
  const [candidateExpenses, setCandidateExpenses] = useState<RefundableExpenseItem[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState('');

  // Entities Data
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loadingDependencies, setLoadingDependencies] = useState(false);

  const getApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const fetchDependencies = useCallback(async () => {
    setLoadingDependencies(true);
    try {
      const [accsRes, cardsRes, catsRes] = await Promise.all([
        fetch(`${getApiUrl()}/api/v1/accounts`, { credentials: 'include' }),
        fetch(`${getApiUrl()}/api/v1/credit-cards`, { credentials: 'include' }),
        fetch(`${getApiUrl()}/api/v1/categories`, { credentials: 'include' }),
      ]);

      const [accsJson, cardsJson, catsJson] = await Promise.all([
        accsRes.json(),
        cardsRes.json(),
        catsRes.json(),
      ]);

      if (accsJson.success) {
        setAccounts(accsJson.data || []);
        if (accsJson.data?.length > 0 && !txAccountId) {
          setTxAccountId(accsJson.data[0].id);
        }
      }

      if (cardsJson.success) {
        setCreditCards(cardsJson.data || []);
        if (cardsJson.data?.length > 0 && !txCreditCardId) {
          setTxCreditCardId(cardsJson.data[0].id);
        }
      }

      if (catsJson.success) {
        setCategories(catsJson.data || []);
      }
    } catch {
      // Ignored network errors
    } finally {
      setLoadingDependencies(false);
    }
  }, [txAccountId, txCreditCardId]);

  const fetchRefundableCandidates = useCallback(async (searchQuery = '') => {
    setLoadingCandidates(true);
    try {
      const url = `${getApiUrl()}/api/v1/transactions/refundable-candidates?onlyWithRemaining=true${
        searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : ''
      }`;
      const res = await fetch(url, { credentials: 'include' });
      const json = await res.json();
      if (res.ok && json.success) {
        setCandidateExpenses(json.data || []);
      }
    } catch {
      // Ignored network errors
    } finally {
      setLoadingCandidates(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setTxDate(formatDateToInput(new Date()));
      setIsPastRecorded(false);
      fetchDependencies();
      if (txType === TransactionType.INCOME && txCategory === 'Refunds received') {
        fetchRefundableCandidates(candidateSearch);
      }
    }
  }, [isOpen, txType, txCategory, candidateSearch, fetchDependencies, fetchRefundableCandidates]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const filteredCategories = categories.filter((c) => c.type === txType);
  const effectiveCategories =
    filteredCategories.length > 0
      ? filteredCategories
      : txType === TransactionType.INVESTMENT
      ? DEFAULT_INVESTMENT_CATEGORIES.map((c) => ({ id: c.name, name: c.name, type: 'investment' as const }))
      : [];

  const isRefundTx = txType === TransactionType.INCOME && txCategory === 'Refunds received';
  const isLinkedClassification =
    refundClassification === RefundClassification.LINKED_REFUND ||
    refundClassification === RefundClassification.PURCHASE_CASHBACK;
  const selectedExpense = candidateExpenses.find((e) => e.id === selectedExpenseId);
  const parsedTxAmount = parseFloat(txAmount) || 0;
  const isExceedingLimit =
    isRefundTx &&
    isLinkedClassification &&
    !!selectedExpense &&
    parsedTxAmount > selectedExpense.remainingRefundable;

  useEffect(() => {
    if (effectiveCategories.length > 0) {
      const currentCatMatches = effectiveCategories.some((c) => c.name === txCategory);
      if (!currentCatMatches) {
        setTxCategory(effectiveCategories[0].name);
      }
    }
  }, [txType, effectiveCategories, txCategory]);

  const handlePaymentMethodChange = (newMethod: PaymentMethod) => {
    setTxPaymentMethod(newMethod);
    if (newMethod === PaymentMethod.CREDIT_CARD) {
      setTxPaymentChannel(PaymentChannel.OFFLINE);
      setTxAccountId('');
      if (creditCards.length > 0 && !txCreditCardId) {
        setTxCreditCardId(creditCards[0].id);
      }
    } else {
      setTxCreditCardId('');
      if (newMethod === PaymentMethod.UPI) {
        setTxPaymentChannel(PaymentChannel.ONLINE);
      } else if (newMethod === PaymentMethod.CASH) {
        setTxPaymentChannel(PaymentChannel.OFFLINE);
      }
      if (accounts.length > 0 && !txAccountId && newMethod !== PaymentMethod.CASH) {
        setTxAccountId(accounts[0].id);
      }
    }
  };

  const handleCreateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!txTitle.trim()) {
      toast.error('Transaction title is required');
      return;
    }

    const parsedAmount = parseFloat(txAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast.error('Amount must be a positive number');
      return;
    }

    if (txPaymentMethod === PaymentMethod.CREDIT_CARD) {
      if (!txCreditCardId) {
        toast.error('Please select a credit card for credit card payments');
        return;
      }
    } else if (txPaymentMethod !== PaymentMethod.CASH) {
      if (!txAccountId) {
        toast.error('Please select a bank account');
        return;
      }
    }

    if (isRefundTx) {
      if (isLinkedClassification && !selectedExpenseId) {
        toast.error('Please select an original expense to link this refund');
        return;
      }
      if (isExceedingLimit && selectedExpense) {
        toast.error(
          `Refund amount exceeds remaining refundable amount (₹${selectedExpense.remainingRefundable.toLocaleString()})`
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      const idempotencyKey = `tx-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const payload = {
        type: txType,
        title: txTitle.trim(),
        amount: parsedAmount,
        currency: user?.currency || 'INR',
        date: parseDateInput(txDate).toISOString(),
        category: txCategory,
        paymentMethod: txPaymentMethod,
        paymentChannel: txPaymentChannel,
        accountId: txPaymentMethod === PaymentMethod.CREDIT_CARD ? undefined : txAccountId || undefined,
        creditCardId: txPaymentMethod === PaymentMethod.CREDIT_CARD ? txCreditCardId : undefined,
        merchantOrRecipient: txMerchant.trim() || undefined,
        notes: txNotes.trim() || undefined,
        isPastRecorded,
        originalExpenseId:
          isRefundTx &&
          (refundClassification === RefundClassification.LINKED_REFUND ||
            refundClassification === RefundClassification.PURCHASE_CASHBACK)
            ? selectedExpenseId || undefined
            : undefined,
        refundClassification: isRefundTx ? refundClassification : undefined,
        idempotencyKey,
      };

      const res = await fetch(`${getApiUrl()}/api/v1/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`Transaction "${txTitle}" recorded successfully!`);
        // Reset form
        setTxTitle('');
        setTxAmount('');
        setTxMerchant('');
        setTxNotes('');
        setSelectedExpenseId('');
        setCandidateSearch('');
        setRefundClassification(RefundClassification.LINKED_REFUND);
        setIsPastRecorded(false);
        onClose();
        emitDataChange('transactions');
        emitDataChange('accounts');
        onSuccess();
      } else {
        toast.error(json.error?.message || 'Failed to record transaction');
      }
    } catch {
      toast.error('Network error posting transaction');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record Transaction</DialogTitle>
          <DialogDescription>
            Manual financial posting with server-authoritative balance adjustment.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleCreateTransaction} className="space-y-4 pt-2">
          <div className="space-y-4">
            {/* 1. Transaction Type */}
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-muted">
              <button
                type="button"
                onClick={() => setTxType(TransactionType.EXPENSE)}
                className={`py-2 text-xs font-semibold rounded-md transition-all ${
                  txType === TransactionType.EXPENSE
                    ? 'bg-[#CC0000] text-white shadow'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Expense (-)
              </button>
              <button
                type="button"
                onClick={() => setTxType(TransactionType.INCOME)}
                className={`py-2 text-xs font-semibold rounded-md transition-all ${
                  txType === TransactionType.INCOME
                    ? 'bg-[#05A100] text-white shadow'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Income (+)
              </button>
              <button
                type="button"
                onClick={() => setTxType(TransactionType.INVESTMENT)}
                className={`py-2 text-xs font-semibold rounded-md transition-all ${
                  txType === TransactionType.INVESTMENT
                    ? 'bg-purple-600 text-white shadow'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Investment (↗)
              </button>
            </div>

            {/* 2. Title or description */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Title *
              </label>
              <input
                type="text"
                placeholder={
                  txType === TransactionType.INVESTMENT
                    ? 'e.g. Mutual Fund SIP, Stocks, Gold purchase'
                    : txType === TransactionType.INCOME
                    ? 'e.g. Salary, Client Payment, Bonus'
                    : 'e.g. Groceries, Electricity bill, Dinner'
                }
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={txTitle}
                onChange={(e) => setTxTitle(e.target.value)}
                required
              />
            </div>

            {/* 3 & 4. Amount and Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Amount ({user?.currency || 'INR'}) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono font-bold"
                  value={txAmount}
                  onChange={(e) => setTxAmount(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Date *
                </label>
                <DatePicker
                  value={txDate}
                  onChange={(d) => setTxDate(d || formatDateToInput(new Date()))}
                  className="h-10 text-sm"
                />
              </div>
            </div>

            {/* 5. Category */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Category *
              </label>
              <Select value={txCategory} onValueChange={setTxCategory}>
                <SelectTrigger className="h-10 text-sm">
                  <SelectValue placeholder="Select Category" />
                </SelectTrigger>
                <SelectContent>
                  {effectiveCategories.map((c) => (
                    <SelectItem key={c.id} value={c.name}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Refund & Cashback Configuration */}
            {isRefundTx && (
              <div className="rounded-lg border border-border bg-muted/20 p-3.5 space-y-3">
                <div className="flex items-center gap-2">
                  <RotateCcw className="h-4 w-4 text-foreground" />
                  <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                    Refund & Cashback Offset
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Refunds and purchase cashbacks offset your original expense records so your personal income and net spending stay accurate.
                </p>

                {/* Classification */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Classification *
                  </label>
                  <Select
                    value={refundClassification}
                    onValueChange={(val) => {
                      setRefundClassification(val as RefundClassification);
                      if (
                        val === RefundClassification.UNLINKED_REFUND ||
                        val === RefundClassification.GENERAL_CASHBACK
                      ) {
                        setSelectedExpenseId('');
                      }
                    }}
                  >
                    <SelectTrigger className="h-10 text-sm">
                      <SelectValue placeholder="Select Classification" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={RefundClassification.LINKED_REFUND}>
                        Linked Refund (Offsets a specific expense)
                      </SelectItem>
                      <SelectItem value={RefundClassification.PURCHASE_CASHBACK}>
                        Purchase Cashback (Tied to a specific purchase)
                      </SelectItem>
                      <SelectItem value={RefundClassification.UNLINKED_REFUND}>
                        Unlinked Refund (General return without tracked purchase)
                      </SelectItem>
                      <SelectItem value={RefundClassification.GENERAL_CASHBACK}>
                        General Cashback (Card / bank reward)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Candidate Search & Selection */}
                {isLinkedClassification && (
                  <div className="space-y-2 pt-1">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                      <span>Select Original Purchase Expense *</span>
                      {loadingCandidates && (
                        <span className="text-[11px] text-muted-foreground animate-pulse">
                          Loading expenses...
                        </span>
                      )}
                    </label>

                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Search candidate expenses by title or merchant..."
                        value={candidateSearch}
                        onChange={(e) => {
                          setCandidateSearch(e.target.value);
                          fetchRefundableCandidates(e.target.value);
                        }}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </div>

                    {candidateExpenses.length === 0 ? (
                      <div className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                        {loadingCandidates
                          ? 'Searching for eligible expenses...'
                          : 'No refundable expenses found. You can switch classification to "Unlinked Refund" if the purchase is not tracked.'}
                      </div>
                    ) : (
                      <Select
                        value={selectedExpenseId}
                        onValueChange={(val) => {
                          setSelectedExpenseId(val);
                          const found = candidateExpenses.find((e) => e.id === val);
                          if (found && (!txAmount || parseFloat(txAmount) <= 0)) {
                            setTxAmount(found.remainingRefundable.toString());
                          }
                        }}
                      >
                        <SelectTrigger className="h-10 text-sm">
                          <SelectValue placeholder="-- Select original expense --" />
                        </SelectTrigger>
                        <SelectContent className="max-h-60">
                          {candidateExpenses.map((expense) => (
                            <SelectItem key={expense.id} value={expense.id}>
                              <div className="flex flex-col text-left py-0.5">
                                <span className="font-medium text-foreground">
                                  {expense.title} {expense.merchant ? `(${expense.merchant})` : ''} • ₹{expense.amount.toLocaleString()}
                                </span>
                                <span className="text-[11px] text-muted-foreground">
                                  {new Date(expense.date).toLocaleDateString()} • {expense.category} • Max Refundable: ₹{expense.remainingRefundable.toLocaleString()}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    {/* Selected Expense Detail Card */}
                    {selectedExpense && (
                      <div className="rounded-md border border-border bg-card p-3 space-y-2 mt-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-xs font-bold text-foreground">{selectedExpense.title}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {new Date(selectedExpense.date).toLocaleDateString()} • {selectedExpense.category}
                              {selectedExpense.merchant ? ` • ${selectedExpense.merchant}` : ''}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedExpenseId('')}
                            className="text-xs text-muted-foreground hover:text-foreground underline"
                          >
                            Clear
                          </button>
                        </div>

                        <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border/50 text-[11px]">
                          <div>
                            <span className="text-muted-foreground block">Original Amount:</span>
                            <span className="font-semibold text-foreground">
                              ₹{selectedExpense.amount.toLocaleString()}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block">Already Refunded:</span>
                            <span className="font-semibold text-foreground">
                              ₹{selectedExpense.totalRefunded.toLocaleString()}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block">Max Refundable:</span>
                            <span className="font-bold text-foreground">
                              ₹{selectedExpense.remainingRefundable.toLocaleString()}
                            </span>
                          </div>
                        </div>

                        {parsedTxAmount > 0 && (
                          <div className="pt-1 border-t border-border/50 text-[11px] flex justify-between items-center">
                            <span className="text-muted-foreground">Projected Net Expense:</span>
                            <span className="font-bold font-mono text-foreground">
                              ₹{Math.max(0, selectedExpense.remainingRefundable - parsedTxAmount).toLocaleString()}
                            </span>
                          </div>
                        )}

                        {isExceedingLimit && (
                          <div className="rounded bg-red-500/10 border border-red-500/30 p-2 text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            <span>
                              Refund amount (₹{parsedTxAmount.toLocaleString()}) exceeds max remaining refundable amount (₹{selectedExpense.remainingRefundable.toLocaleString()}).
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 6 & 7. Payment Method & Channel */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Payment Method *
                </label>
                <Select
                  value={txPaymentMethod}
                  onValueChange={(val) => handlePaymentMethodChange(val as PaymentMethod)}
                >
                  <SelectTrigger className="h-10 text-sm capitalize">
                    <SelectValue placeholder="Select Payment Method" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(PaymentMethod).map((m) => (
                      <SelectItem key={m} value={m} className="capitalize">
                        {m.replace('_', ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Payment Channel *
                </label>
                <Select
                  value={txPaymentChannel}
                  onValueChange={(val) => setTxPaymentChannel(val as PaymentChannel)}
                >
                  <SelectTrigger className="h-10 text-sm capitalize">
                    <SelectValue placeholder="Select Payment Channel" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(PaymentChannel).map((ch) => (
                      <SelectItem key={ch} value={ch} className="capitalize">
                        {ch}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 8. Bank Account OR Credit Card Selection */}
            {txPaymentMethod === PaymentMethod.CREDIT_CARD ? (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                  <span>Credit Card *</span>
                  <Link href="/credit-cards" className="text-[11px] text-primary hover:underline">
                    Manage Cards
                  </Link>
                </label>
                {creditCards.length === 0 ? (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>No credit cards found. Please <Link href="/credit-cards" className="underline font-bold">add a credit card</Link> first.</span>
                  </div>
                ) : (
                  <Select
                    value={txCreditCardId || undefined}
                    onValueChange={setTxCreditCardId}
                  >
                    <SelectTrigger className="h-10 text-sm">
                      <SelectValue placeholder="Select Credit Card *" />
                    </SelectTrigger>
                    <SelectContent>
                      {creditCards.map((card) => (
                        <SelectItem key={card.id} value={card.id}>
                          {card.cardNickname} • {card.issuingBank} (•••• {card.lastFourDigits || 'Card'})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {txPaymentMethod === PaymentMethod.CASH ? 'Cash / Bank Account (Optional)' : 'Bank Account *'}
                </label>
                <Select
                  value={txAccountId || (txPaymentMethod === PaymentMethod.CASH ? 'none' : undefined)}
                  onValueChange={(val) => setTxAccountId(val === 'none' ? '' : val)}
                >
                  <SelectTrigger className="h-10 text-sm">
                    <SelectValue placeholder="Select Bank Account *" />
                  </SelectTrigger>
                  <SelectContent>
                    {txPaymentMethod === PaymentMethod.CASH && (
                      <SelectItem value="none">None / Physical Cash</SelectItem>
                    )}
                    {accounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.accountName} {acc.bankName ? `• ${acc.bankName}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* 9. Merchant & Notes */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Merchant / Recipient (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Amazon, Starbucks, Client X"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={txMerchant}
                onChange={(e) => setTxMerchant(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Notes (Optional)
              </label>
              <textarea
                placeholder="Additional context or invoice memo..."
                className="flex min-h-[60px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={txNotes}
                onChange={(e) => setTxNotes(e.target.value)}
              />
            </div>

            {/* 10. Past-Recorded Transaction Checkbox */}
            {(txType === TransactionType.INCOME ||
              txType === TransactionType.EXPENSE ||
              txType === TransactionType.INVESTMENT) && (
              <div className="rounded-lg border border-border p-3 bg-muted/20 space-y-1">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isPastRecorded}
                    onChange={(e) => setIsPastRecorded(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-input text-primary focus:ring-ring"
                  />
                  <div>
                    <span className="text-xs font-semibold text-foreground block">
                      Past-Recorded Transaction — Do not adjust account balance
                    </span>
                    <span className="text-[11px] text-muted-foreground block leading-relaxed mt-0.5">
                      Use this option when the transaction has already been reflected in your account balance, such as before you started tracking in M12 Expense Tracker. The transaction will still appear in your records and reports, but it will not change your account balance again.
                    </span>
                  </div>
                </label>
              </div>
            )}
          </div>

          <DialogFooter className="pt-4 border-t border-border">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" isLoading={submitting} disabled={isExceedingLimit}>
              Post Transaction
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
