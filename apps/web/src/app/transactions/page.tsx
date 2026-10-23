'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/components/ui/toast';
import { DatePicker } from '@/components/ui/date-picker';
import {
  ArrowLeftRight,
  Plus,
  Search,
  Filter,
  ArrowUpRight,
  ArrowDownLeft,
  RefreshCw,
  Trash2,
  Copy,
  Pencil,
  Calendar,
  Wallet,
  CreditCard as CreditCardIcon,
  Coins,
  AlertCircle,
  TrendingUp,
} from 'lucide-react';
import {
  Transaction,
  BankAccount,
  CreditCard,
  TransactionCategory,
  TransactionType,
  PaymentMethod,
  PaymentChannel,
  DEFAULT_INVESTMENT_CATEGORIES,
  formatCurrency,
  formatDateToInput,
  parseDateInput,
} from '@finora/shared';
import { RecordTransactionModal } from '@/components/transactions/record-transaction-modal';
import { emitDataChange, useDataSync } from '@/lib/data-sync';

export default function TransactionsPage() {
  const { user, isAuthenticated } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
  const [categories, setCategories] = useState<TransactionCategory[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Create Transaction Form State
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

  // Edit Transaction Form State
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [editType, setEditType] = useState<TransactionType>(TransactionType.EXPENSE);
  const [editTitle, setEditTitle] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editDate, setEditDate] = useState(() => formatDateToInput(new Date()));
  const [editCategory, setEditCategory] = useState('');
  const [editPaymentMethod, setEditPaymentMethod] = useState<PaymentMethod>(PaymentMethod.UPI);
  const [editPaymentChannel, setEditPaymentChannel] = useState<PaymentChannel>(PaymentChannel.ONLINE);
  const [editAccountId, setEditAccountId] = useState('');
  const [editCreditCardId, setEditCreditCardId] = useState('');
  const [editMerchant, setEditMerchant] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // Transfer Form State
  const [sourceAccountId, setSourceAccountId] = useState('');
  const [destAccountId, setDestAccountId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferNotes, setTransferNotes] = useState('');

  const getApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const fetchData = async () => {
    setLoading(true);
    try {
      let queryParams = `?search=${encodeURIComponent(searchTerm)}`;
      if (typeFilter !== 'all') queryParams += `&type=${typeFilter}`;
      if (accountFilter !== 'all') queryParams += `&accountId=${accountFilter}`;

      const [txRes, accRes, cardRes, catRes] = await Promise.all([
        fetch(`${getApiUrl()}/api/v1/transactions${queryParams}`, { credentials: 'include' }),
        fetch(`${getApiUrl()}/api/v1/accounts`, { credentials: 'include' }),
        fetch(`${getApiUrl()}/api/v1/credit-cards`, { credentials: 'include' }),
        fetch(`${getApiUrl()}/api/v1/categories`, { credentials: 'include' }),
      ]);

      const [txJson, accJson, cardJson, catJson] = await Promise.all([
        txRes.json(),
        accRes.json(),
        cardRes.json(),
        catRes.json(),
      ]);

      if (txJson.success) setTransactions(txJson.data || []);
      if (accJson.success) {
        setAccounts(accJson.data || []);
        if (accJson.data?.length > 0 && !txAccountId) {
          setTxAccountId(accJson.data[0].id);
          setSourceAccountId(accJson.data[0].id);
          if (accJson.data.length > 1) {
            setDestAccountId(accJson.data[1].id);
          }
        }
      }
      if (cardJson.success) {
        setCreditCards(cardJson.data || []);
        if (cardJson.data?.length > 0 && !txCreditCardId) {
          setTxCreditCardId(cardJson.data[0].id);
        }
      }
      if (catJson.success) {
        setCategories(catJson.data || []);
        if (catJson.data?.length > 0 && !txCategory) {
          setTxCategory(catJson.data[0].name);
        }
      }
    } catch {
      toast.error('Network error loading financial data');
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
  }, [isAuthenticated, typeFilter, accountFilter]);

  useDataSync(fetchData, ['transactions']);

  const handlePaymentMethodChange = (method: PaymentMethod, isEdit = false) => {
    if (isEdit) {
      setEditPaymentMethod(method);
      if (method === PaymentMethod.CREDIT_CARD) {
        setEditAccountId('');
        if (creditCards.length > 0 && !editCreditCardId) {
          setEditCreditCardId(creditCards[0].id);
        }
      } else if (
        [PaymentMethod.UPI, PaymentMethod.DEBIT_CARD, PaymentMethod.NET_BANKING, PaymentMethod.BANK_TRANSFER].includes(method)
      ) {
        setEditCreditCardId('');
        if (accounts.length > 0 && !editAccountId) {
          setEditAccountId(accounts[0].id);
        }
      } else {
        setEditCreditCardId('');
      }
    } else {
      setTxPaymentMethod(method);
      if (method === PaymentMethod.CREDIT_CARD) {
        setTxAccountId('');
        if (creditCards.length > 0 && !txCreditCardId) {
          setTxCreditCardId(creditCards[0].id);
        }
      } else if (
        [PaymentMethod.UPI, PaymentMethod.DEBIT_CARD, PaymentMethod.NET_BANKING, PaymentMethod.BANK_TRANSFER].includes(method)
      ) {
        setTxCreditCardId('');
        if (accounts.length > 0 && !txAccountId) {
          setTxAccountId(accounts[0].id);
        }
      } else {
        setTxCreditCardId('');
      }
    }
  };

  const handleCreateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!txTitle || !txAmount || !txCategory) {
      toast.error('Title, amount, and category are required');
      return;
    }

    if (txPaymentMethod === PaymentMethod.CREDIT_CARD) {
      if (!txCreditCardId) {
        toast.error('Please select a credit card for this purchase');
        return;
      }
    } else if (
      [PaymentMethod.UPI, PaymentMethod.DEBIT_CARD, PaymentMethod.NET_BANKING, PaymentMethod.BANK_TRANSFER].includes(
        txPaymentMethod
      )
    ) {
      if (!txAccountId) {
        toast.error('Please select a bank account for this payment method');
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          type: txType,
          title: txTitle,
          amount: parseFloat(txAmount),
          date: parseDateInput(txDate).toISOString(),
          category: txCategory,
          paymentMethod: txPaymentMethod,
          paymentChannel: txPaymentChannel,
          accountId: txPaymentMethod === PaymentMethod.CREDIT_CARD ? undefined : (txAccountId || undefined),
          creditCardId: txPaymentMethod === PaymentMethod.CREDIT_CARD ? txCreditCardId : undefined,
          merchantOrRecipient: txMerchant || undefined,
          notes: txNotes || undefined,
          currency: user?.currency || 'INR',
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`Transaction "${txTitle}" recorded successfully!`);
        setShowAddModal(false);
        setTxTitle('');
        setTxAmount('');
        setTxMerchant('');
        setTxNotes('');
        fetchData();
        emitDataChange('transactions');
      } else {
        toast.error(json.error?.message || 'Failed to record transaction');
      }
    } catch {
      toast.error('Network error creating transaction');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenEdit = (tx: Transaction) => {
    setEditingTxId(tx.id);
    setEditType(tx.type);
    setEditTitle(tx.title);
    setEditAmount(tx.amount.toString());
    setEditDate(formatDateToInput(tx.date));
    setEditCategory(tx.category);
    setEditPaymentMethod(tx.paymentMethod);
    setEditPaymentChannel(tx.paymentChannel);
    setEditAccountId(tx.accountId || '');
    setEditCreditCardId(tx.creditCardId || '');
    setEditMerchant(tx.merchantOrRecipient || '');
    setEditNotes(tx.notes || '');
    setShowEditModal(true);
  };

  const handleUpdateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTxId || !editTitle || !editAmount || !editCategory) {
      toast.error('Title, amount, and category are required');
      return;
    }

    if (editPaymentMethod === PaymentMethod.CREDIT_CARD) {
      if (!editCreditCardId) {
        toast.error('Please select a credit card');
        return;
      }
    } else if (
      [PaymentMethod.UPI, PaymentMethod.DEBIT_CARD, PaymentMethod.NET_BANKING, PaymentMethod.BANK_TRANSFER].includes(
        editPaymentMethod
      )
    ) {
      if (!editAccountId) {
        toast.error('Please select a bank account');
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/transactions/${editingTxId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          type: editType,
          title: editTitle,
          amount: parseFloat(editAmount),
          date: parseDateInput(editDate).toISOString(),
          category: editCategory,
          paymentMethod: editPaymentMethod,
          paymentChannel: editPaymentChannel,
          accountId: editPaymentMethod === PaymentMethod.CREDIT_CARD ? undefined : (editAccountId || undefined),
          creditCardId: editPaymentMethod === PaymentMethod.CREDIT_CARD ? editCreditCardId : undefined,
          merchantOrRecipient: editMerchant || undefined,
          notes: editNotes || undefined,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`Transaction "${editTitle}" updated successfully!`);
        setShowEditModal(false);
        setEditingTxId(null);
        fetchData();
        emitDataChange('transactions');
      } else {
        toast.error(json.error?.message || 'Failed to update transaction');
      }
    } catch {
      toast.error('Network error updating transaction');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceAccountId || !destAccountId || !transferAmount) {
      toast.error('Source, destination, and amount are required');
      return;
    }
    if (sourceAccountId === destAccountId) {
      toast.error('Source and destination accounts must be different');
      return;
    }

    setSubmitting(true);
    try {
      const idempotencyKey = `transfer-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const res = await fetch(`${getApiUrl()}/api/v1/transactions/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          sourceAccountId,
          destinationAccountId: destAccountId,
          amount: parseFloat(transferAmount),
          date: parseDateInput(new Date()).toISOString(),
          notes: transferNotes || undefined,
          idempotencyKey,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Account transfer completed atomically!');
        setShowTransferModal(false);
        setTransferAmount('');
        setTransferNotes('');
        fetchData();
        emitDataChange('transactions');
      } else {
        toast.error(json.error?.message || 'Transfer failed');
      }
    } catch {
      toast.error('Network error executing transfer');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteTransaction = async (id: string, title: string) => {
    if (!confirm(`Are you sure you want to delete transaction "${title}"? Account balance will be recalculated.`)) return;

    try {
      const res = await fetch(`${getApiUrl()}/api/v1/transactions/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Transaction deleted and balance adjusted');
        fetchData();
        emitDataChange('transactions');
      } else {
        toast.error(json.error?.message || 'Failed to delete transaction');
      }
    } catch {
      toast.error('Network error deleting transaction');
    }
  };

  const handleDuplicate = (tx: Transaction) => {
    setTxType(tx.type);
    setTxTitle(`${tx.title} (Copy)`);
    setTxAmount(tx.amount.toString());
    setTxDate(formatDateToInput(new Date()));
    setTxCategory(tx.category);
    setTxPaymentMethod(tx.paymentMethod);
    setTxPaymentChannel(tx.paymentChannel);
    if (tx.accountId) setTxAccountId(tx.accountId);
    if (tx.creditCardId) setTxCreditCardId(tx.creditCardId);
    if (tx.merchantOrRecipient) setTxMerchant(tx.merchantOrRecipient);
    setShowAddModal(true);
  };

  const filteredCategories = categories.filter((c) =>
    txType === TransactionType.INCOME
      ? c.type === 'income'
      : txType === TransactionType.INVESTMENT
      ? c.type === 'investment'
      : c.type === 'expense'
  );

  const editFilteredCategories = categories.filter((c) =>
    editType === TransactionType.INCOME
      ? c.type === 'income'
      : editType === TransactionType.INVESTMENT
      ? c.type === 'investment'
      : c.type === 'expense'
  );

  const effectiveEditCategories =
    editFilteredCategories.length > 0
      ? editFilteredCategories
      : editType === TransactionType.INVESTMENT
      ? DEFAULT_INVESTMENT_CATEGORIES.map((c) => ({
          id: c.name,
          name: c.name,
          type: 'investment' as const,
          icon: c.icon,
          color: c.color,
          subcategories: [],
          isCustom: false,
        }))
      : [];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Financial Transactions</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manual entry ledger with independent payment methods and channels
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={fetchData} variant="outline" size="sm" className="gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={() => setShowTransferModal(true)} variant="outline" size="sm" className="gap-2">
            <ArrowLeftRight className="h-4 w-4" />
            Transfer
          </Button>
          <Button onClick={() => setShowAddModal(true)} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Post Transaction
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <Card className="border-border/60">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search transactions by title, merchant, or notes..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchData()}
                className="flex h-10 w-full rounded-lg border border-input bg-background pl-9 pr-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="flex h-10 rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="all">All Types</option>
                <option value="income">Income (+)</option>
                <option value="expense">Expense (-)</option>
                <option value="investment">Investment (↗)</option>
                <option value="transfer">Transfers</option>
                <option value="credit_card_payment">Card Repayments</option>
                <option value="credit_card_refund">Card Refunds</option>
              </select>

              <select
                value={accountFilter}
                onChange={(e) => setAccountFilter(e.target.value)}
                className="flex h-10 rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="all">All Accounts</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.accountName}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transactions Ledger Table */}
      <Card className="border-border/60 overflow-hidden">
        <CardHeader className="py-4 px-6 border-b border-border bg-muted/20">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">Ledger Entries</CardTitle>
            <Badge variant="outline">{transactions.length} records</Badge>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : transactions.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={Coins}
                title="No transactions found"
                description="Record income, expenses, or transfers using the manual entry forms above."
                actionLabel="Add Transaction"
                onAction={() => setShowAddModal(true)}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40">
                    <th className="p-3.5">Transaction</th>
                    <th className="p-3.5">Category</th>
                    <th className="p-3.5">Payment Method</th>
                    <th className="p-3.5">Channel</th>
                    <th className="p-3.5">Account / Card</th>
                    <th className="p-3.5 text-right">Amount</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {transactions.map((tx) => {
                    const isIncome = tx.type === TransactionType.INCOME;
                    const isExpense = tx.type === TransactionType.EXPENSE;
                    const isTransfer = tx.type === TransactionType.TRANSFER;
                    const isInvestment = tx.type === TransactionType.INVESTMENT;

                    const associatedAccount = accounts.find((a) => a.id === tx.accountId);
                    const associatedCard = creditCards.find((c) => c.id === tx.creditCardId);
                    const fundingLabel = associatedCard
                      ? `${associatedCard.cardNickname} (•••• ${associatedCard.lastFourDigits || 'Card'})`
                      : associatedAccount
                      ? associatedAccount.accountName
                      : '—';

                    return (
                      <tr key={tx.id} className="hover:bg-muted/30 transition-colors">
                        <td className="p-3.5">
                          <div className="flex items-center gap-3">
                            <div
                              className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                                isIncome
                                  ? 'bg-[#05A100]/10 text-[#05A100]'
                                  : isExpense
                                  ? 'bg-[#CC0000]/10 text-[#CC0000]'
                                  : isInvestment
                                  ? 'bg-purple-500/10 text-purple-500'
                                  : 'bg-blue-500/10 text-blue-500'
                              }`}
                            >
                              {isIncome ? (
                                <ArrowDownLeft className="h-4 w-4" />
                              ) : isExpense ? (
                                <ArrowUpRight className="h-4 w-4" />
                              ) : isInvestment ? (
                                <TrendingUp className="h-4 w-4" />
                              ) : (
                                <ArrowLeftRight className="h-4 w-4" />
                              )}
                            </div>
                            <div>
                              <p className="font-semibold text-foreground leading-tight">{tx.title}</p>
                              <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                                <span>{new Date(tx.date).toLocaleDateString()}</span>
                                {tx.merchantOrRecipient && (
                                  <>
                                    <span>•</span>
                                    <span>{tx.merchantOrRecipient}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="p-3.5">
                          <Badge variant="secondary" className="text-xs">
                            {tx.category}
                          </Badge>
                        </td>

                        <td className="p-3.5">
                          <span className="capitalize text-xs font-medium text-foreground">
                            {tx.paymentMethod.replace('_', ' ')}
                          </span>
                        </td>

                        <td className="p-3.5">
                          <Badge variant="outline" className="capitalize text-[11px]">
                            {tx.paymentChannel}
                          </Badge>
                        </td>

                        <td className="p-3.5 text-xs text-muted-foreground font-medium">
                          {fundingLabel}
                        </td>

                        <td className="p-3.5 text-right font-bold text-sm">
                          <span
                            className={
                              isIncome
                                ? 'text-[#05A100]'
                                : isExpense
                                ? 'text-[#CC0000]'
                                : isInvestment
                                ? 'text-purple-500'
                                : 'text-blue-500'
                            }
                          >
                            {isIncome ? '+' : isExpense ? '-' : isInvestment ? '↗ ' : ''}
                            {formatCurrency(tx.amount, tx.currency)}
                          </span>
                        </td>

                        <td className="p-3.5 text-right space-x-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            title="Edit transaction"
                            onClick={() => handleOpenEdit(tx)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            title="Duplicate as new"
                            onClick={() => handleDuplicate(tx)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            title="Delete transaction"
                            onClick={() => handleDeleteTransaction(tx.id, tx.title)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
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

      {/* Record Transaction Modal */}
      <RecordTransactionModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={fetchData}
      />

      {/* Edit Transaction Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <Card className="w-full max-w-lg shadow-2xl border-border animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle>Edit Transaction</CardTitle>
              <CardDescription>
                Update transaction details. Financial balances and statements will be recalculated automatically.
              </CardDescription>
            </CardHeader>

            <form onSubmit={handleUpdateTransaction}>
              <CardContent className="space-y-4">
                {/* 1. Transaction Type */}
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-muted">
                  <button
                    type="button"
                    onClick={() => setEditType(TransactionType.EXPENSE)}
                    className={`py-2 text-xs font-semibold rounded-md transition-all ${
                      editType === TransactionType.EXPENSE
                        ? 'bg-[#CC0000] text-white shadow'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Expense (-)
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditType(TransactionType.INCOME)}
                    className={`py-2 text-xs font-semibold rounded-md transition-all ${
                      editType === TransactionType.INCOME
                        ? 'bg-[#05A100] text-white shadow'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Income (+)
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditType(TransactionType.INVESTMENT)}
                    className={`py-2 text-xs font-semibold rounded-md transition-all ${
                      editType === TransactionType.INVESTMENT
                        ? 'bg-purple-600 text-white shadow'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Investment (↗)
                  </button>
                </div>

                {/* 2. Title */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Title *
                  </label>
                  <input
                    type="text"
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
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
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono font-bold"
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Date *
                    </label>
                    <DatePicker
                      value={editDate}
                      onChange={setEditDate}
                    />
                  </div>
                </div>

                {/* 5. Category */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Category *
                  </label>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    required
                  >
                    {effectiveEditCategories.map((c) => (
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
                      value={editPaymentMethod}
                      onChange={(e) => handlePaymentMethodChange(e.target.value as PaymentMethod, true)}
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
                      value={editPaymentChannel}
                      onChange={(e) => setEditPaymentChannel(e.target.value as PaymentChannel)}
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
                {editPaymentMethod === PaymentMethod.CREDIT_CARD ? (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                      <span>Credit Card *</span>
                      <Link href="/credit-cards" className="text-[11px] text-primary hover:underline">
                        Manage Cards
                      </Link>
                    </label>
                    {creditCards.length === 0 ? (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
                        No credit cards available. Please add a credit card first.
                      </div>
                    ) : (
                      <select
                        value={editCreditCardId}
                        onChange={(e) => setEditCreditCardId(e.target.value)}
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
                      {editPaymentMethod === PaymentMethod.CASH ? 'Cash / Bank Account (Optional)' : 'Bank Account *'}
                    </label>
                    <select
                      value={editAccountId}
                      onChange={(e) => setEditAccountId(e.target.value)}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      required={editPaymentMethod !== PaymentMethod.CASH}
                    >
                      {editPaymentMethod === PaymentMethod.CASH && <option value="">Cash in Hand (No Bank Debit)</option>}
                      {editPaymentMethod !== PaymentMethod.CASH && <option value="">Select Bank Account *</option>}
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
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={editMerchant}
                    onChange={(e) => setEditMerchant(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Notes (Optional)
                  </label>
                  <textarea
                    className="flex min-h-[60px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                  />
                </div>
              </CardContent>

              <CardFooter className="flex justify-end gap-2 border-t border-border pt-4">
                <Button type="button" variant="outline" onClick={() => setShowEditModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" isLoading={submitting}>
                  Save Changes
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      {/* Account Transfer Modal */}
      {showTransferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <Card className="w-full max-w-lg shadow-2xl border-border animate-in zoom-in-95">
            <CardHeader>
              <CardTitle>Account Transfer</CardTitle>
              <CardDescription>
                Atomically moves funds between accounts without altering net income or expense totals.
              </CardDescription>
            </CardHeader>

            <form onSubmit={handleExecuteTransfer}>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Source Account (-) *
                    </label>
                    <select
                      value={sourceAccountId}
                      onChange={(e) => setSourceAccountId(e.target.value)}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      required
                    >
                      {accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.accountName} {acc.bankName ? `• ${acc.bankName}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Destination Account (+) *
                    </label>
                    <select
                      value={destAccountId}
                      onChange={(e) => setDestAccountId(e.target.value)}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      required
                    >
                      {accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.accountName} {acc.bankName ? `• ${acc.bankName}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Transfer Amount *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono font-bold"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Transfer Notes (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Monthly savings allocation"
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={transferNotes}
                    onChange={(e) => setTransferNotes(e.target.value)}
                  />
                </div>
              </CardContent>

              <CardFooter className="flex justify-end gap-2 border-t border-border pt-4">
                <Button type="button" variant="outline" onClick={() => setShowTransferModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" isLoading={submitting}>
                  Execute Transfer
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
