'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  TransactionType,
  PaymentMethod,
  PaymentChannel,
  BankAccount,
  CreditCard,
  DEFAULT_INVESTMENT_CATEGORIES,
  formatDateToInput,
  parseDateInput,
} from '@finora/shared';
import { emitDataChange } from '@/lib/data-sync';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { AlertCircle, X } from 'lucide-react';

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
  const [submitting, setSubmitting] = useState(false);

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

  useEffect(() => {
    if (isOpen) {
      setTxDate(formatDateToInput(new Date()));
      fetchDependencies();
    }
  }, [isOpen, fetchDependencies]);

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

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card
        className="w-full max-w-lg shadow-2xl border-border animate-in zoom-in-95 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <CardHeader className="relative flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle>Record Transaction</CardTitle>
            <CardDescription>
              Manual financial posting with server-authoritative balance adjustment.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            type="button"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>

        <form onSubmit={handleCreateTransaction}>
          <CardContent className="space-y-4">
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
                <input
                  type="date"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={txDate}
                  onChange={(e) => setTxDate(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* 5. Category */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Category *
              </label>
              <select
                value={txCategory}
                onChange={(e) => setTxCategory(e.target.value)}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
              >
                {effectiveCategories.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* 6 & 7. Payment Method & Channel */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Payment Method *
                </label>
                <select
                  value={txPaymentMethod}
                  onChange={(e) => handlePaymentMethodChange(e.target.value as PaymentMethod)}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring capitalize"
                  required
                >
                  {Object.values(PaymentMethod).map((m) => (
                    <option key={m} value={m}>
                      {m.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Payment Channel *
                </label>
                <select
                  value={txPaymentChannel}
                  onChange={(e) => setTxPaymentChannel(e.target.value as PaymentChannel)}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring capitalize"
                  required
                >
                  {Object.values(PaymentChannel).map((ch) => (
                    <option key={ch} value={ch}>
                      {ch}
                    </option>
                  ))}
                </select>
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
                  <select
                    value={txCreditCardId}
                    onChange={(e) => setTxCreditCardId(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    required
                  >
                    <option value="">Select Credit Card *</option>
                    {creditCards.map((card) => (
                      <option key={card.id} value={card.id}>
                        {card.cardNickname} • {card.issuingBank} (•••• {card.lastFourDigits || 'Card'})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {txPaymentMethod === PaymentMethod.CASH ? 'Cash / Bank Account (Optional)' : 'Bank Account *'}
                </label>
                <select
                  value={txAccountId}
                  onChange={(e) => setTxAccountId(e.target.value)}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  required={txPaymentMethod !== PaymentMethod.CASH}
                >
                  {txPaymentMethod === PaymentMethod.CASH && <option value="">None / Physical Cash</option>}
                  {txPaymentMethod !== PaymentMethod.CASH && <option value="">Select Bank Account *</option>}
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.accountName} {acc.bankName ? `• ${acc.bankName}` : ''}
                    </option>
                  ))}
                </select>
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
          </CardContent>

          <CardFooter className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" isLoading={submitting}>
              Post Transaction
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
