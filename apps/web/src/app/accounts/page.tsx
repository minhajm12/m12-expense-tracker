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
  Wallet,
  Building2,
  Plus,
  RefreshCw,
  Archive,
  Pencil,
  Sparkles,
  AlertTriangle,
  Coins,
  Banknote,
  ArrowDownLeft,
  ArrowUpRight,
  History,
  CheckCircle2,
  Landmark,
} from 'lucide-react';
import { BankAccount, AccountType, formatCurrency, ChitFundSummary, TotalCashSummary } from '@finora/shared';
import { emitDataChange, useDataSync } from '@/lib/data-sync';

export default function AccountsPage() {
  const { user, isAuthenticated } = useAuth();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [chitFundSummary, setChitFundSummary] = useState<ChitFundSummary | null>(null);
  const [totalCashSummary, setTotalCashSummary] = useState<TotalCashSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showCashModal, setShowCashModal] = useState(false);
  const [cashAdjType, setCashAdjType] = useState<'set_balance' | 'add_cash' | 'remove_cash'>('add_cash');
  const [cashAddSource, setCashAddSource] = useState<'bank_account' | 'person' | 'manual'>('bank_account');
  const [cashAddBankId, setCashAddBankId] = useState('');
  const [cashAddPersonName, setCashAddPersonName] = useState('');
  const [cashAdjAmount, setCashAdjAmount] = useState('');
  const [cashAdjDate, setCashAdjDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [cashAdjDescription, setCashAdjDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Add Form State
  const [accountName, setAccountName] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountType, setAccountType] = useState<AccountType>(AccountType.SAVINGS);
  const [openingBalance, setOpeningBalance] = useState('0');
  const [accountNumberMasked, setAccountNumberMasked] = useState('');
  const [color, setColor] = useState('#000000');
  const [isChitFundAccount, setIsChitFundAccount] = useState(false);
  const [notes, setNotes] = useState('');

  // Edit Form State
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editAccountName, setEditAccountName] = useState('');
  const [editBankName, setEditBankName] = useState('');
  const [editAccountType, setEditAccountType] = useState<AccountType>(AccountType.SAVINGS);
  const [editOpeningBalance, setEditOpeningBalance] = useState('0');
  const [editAccountNumberMasked, setEditAccountNumberMasked] = useState('');
  const [editColor, setEditColor] = useState('#000000');
  const [editIsChitFundAccount, setEditIsChitFundAccount] = useState(false);
  const [editNotes, setEditNotes] = useState('');

  // Reassignment conflict dialog state
  const [reassignPrompt, setReassignPrompt] = useState<{
    isOpen: boolean;
    message: string;
    existingAccountName: string;
    action: 'create' | 'update';
  } | null>(null);

  const getApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const fetchChitFundSummary = async () => {
    try {
      const fundRes = await fetch(`${getApiUrl()}/api/v1/chit-funds`, { credentials: 'include' });
      const fundJson = await fundRes.json();
      if (fundRes.ok && fundJson.success && fundJson.data?.id) {
        const summaryRes = await fetch(`${getApiUrl()}/api/v1/chit-funds/${fundJson.data.id}/summary`, {
          credentials: 'include',
        });
        const summaryJson = await summaryRes.json();
        if (summaryRes.ok && summaryJson.success) {
          setChitFundSummary(summaryJson.data);
        }
      }
    } catch {
      // Non-critical if chit fund module is disabled or not initialized
    }
  };

  const fetchTotalCash = async () => {
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/accounts/total-cash`, {
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setTotalCashSummary(json.data);
      }
    } catch {
      // Non-critical fallback
    }
  };

  const handleAdjustCash = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(cashAdjAmount);
    if (isNaN(amountNum) || amountNum < 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    if (cashAdjType !== 'set_balance' && amountNum <= 0) {
      toast.error('Adjustment amount must be positive');
      return;
    }

    const currentCash = totalCashSummary?.personalCashInHand ?? totalCashSummary?.cashInHand ?? 0;
    if (cashAdjType === 'remove_cash' && amountNum > currentCash) {
      toast.error(`Withdrawal amount (₹${amountNum.toLocaleString()}) cannot exceed available Cash in Hand (₹${currentCash.toLocaleString()})`);
      return;
    }

    if (cashAdjType === 'add_cash' && cashAddSource === 'bank_account' && !cashAddBankId) {
      toast.error('Please select a funding bank account');
      return;
    }

    setSubmitting(true);
    try {
      const body: any = {
        type: cashAdjType,
        amount: amountNum,
        date: cashAdjDate,
        description: cashAdjDescription.trim() || undefined,
      };

      if (cashAdjType === 'add_cash') {
        body.source = cashAddSource;
        if (cashAddSource === 'bank_account') {
          body.bankAccountId = cashAddBankId;
        } else if (cashAddSource === 'person') {
          body.personName = cashAddPersonName.trim() || undefined;
        }
      }

      const res = await fetch(`${getApiUrl()}/api/v1/accounts/cash-in-hand/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(
          cashAdjType === 'set_balance'
            ? 'Cash in Hand opening balance set successfully'
            : cashAdjType === 'add_cash'
            ? (cashAddSource === 'bank_account'
                ? 'Cash withdrawal from bank recorded successfully'
                : 'Cash received into Cash in Hand')
            : 'Cash withdrawn from Cash in Hand'
        );
        setTotalCashSummary(json.data);
        setShowCashModal(false);
        setCashAdjAmount('');
        setCashAdjDescription('');
        setCashAddPersonName('');
        fetchAccounts();
        emitDataChange('accounts');
      } else {
        toast.error(json.error?.message || 'Failed to adjust Cash in Hand');
      }
    } catch {
      toast.error('Network error adjusting Cash in Hand');
    } finally {
      setSubmitting(false);
    }
  };

  const fetchAccounts = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/accounts`, {
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setAccounts(json.data || []);
        if (json.data?.length > 0 && !cashAddBankId) {
          setCashAddBankId(json.data[0].id);
        }
      } else {
        toast.error(json.error?.message || 'Failed to fetch accounts');
      }
      await Promise.all([fetchChitFundSummary(), fetchTotalCash()]);
    } catch {
      toast.error('Network error loading accounts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchAccounts();
    } else {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useDataSync(fetchAccounts, ['accounts', 'transactions', 'lending']);

  const submitCreateAccount = async (confirmReassign = false) => {
    setSubmitting(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          accountName,
          bankName,
          accountType,
          openingBalance: parseFloat(openingBalance) || 0,
          openingBalanceDate: new Date().toISOString(),
          accountNumberMasked,
          color,
          isChitFundAccount,
          confirmReassign,
          notes,
          currency: user?.currency || 'INR',
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`Bank account "${accountName}" created!`);
        setShowAddModal(false);
        setReassignPrompt(null);
        setAccountName('');
        setBankName('');
        setOpeningBalance('0');
        setAccountNumberMasked('');
        setIsChitFundAccount(false);
        setNotes('');
        fetchAccounts();
        emitDataChange('accounts');
      } else if (res.status === 409 && json.error?.code === 'CHIT_FUND_ACCOUNT_EXISTS') {
        setReassignPrompt({
          isOpen: true,
          message: json.error.message,
          existingAccountName: json.error.details?.existingAccountName || 'Another account',
          action: 'create',
        });
      } else {
        toast.error(json.error?.message || 'Failed to create account');
      }
    } catch {
      toast.error('Network error creating account');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountName || !bankName) {
      toast.error('Account name and bank name are required');
      return;
    }
    await submitCreateAccount(false);
  };

  const handleOpenEdit = (acc: BankAccount) => {
    setEditingAccountId(acc.id);
    setEditAccountName(acc.accountName);
    setEditBankName(acc.bankName);
    setEditAccountType(acc.accountType);
    setEditOpeningBalance(acc.openingBalance.toString());
    setEditAccountNumberMasked(acc.accountNumberMasked || '');
    setEditColor(acc.color || '#000000');
    setEditIsChitFundAccount(Boolean(acc.isChitFundAccount));
    setEditNotes(acc.notes || '');
    setShowEditModal(true);
  };

  const submitUpdateAccount = async (confirmReassign = false) => {
    if (!editingAccountId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/accounts/${editingAccountId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          accountName: editAccountName,
          bankName: editBankName,
          accountType: editAccountType,
          openingBalance: parseFloat(editOpeningBalance) || 0,
          accountNumberMasked: editAccountNumberMasked || undefined,
          color: editColor,
          isChitFundAccount: editIsChitFundAccount,
          confirmReassign,
          notes: editNotes || undefined,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`Account "${editAccountName}" updated successfully!`);
        setShowEditModal(false);
        setReassignPrompt(null);
        setEditingAccountId(null);
        fetchAccounts();
        emitDataChange('accounts');
      } else if (res.status === 409 && json.error?.code === 'CHIT_FUND_ACCOUNT_EXISTS') {
        setReassignPrompt({
          isOpen: true,
          message: json.error.message,
          existingAccountName: json.error.details?.existingAccountName || 'Another account',
          action: 'update',
        });
      } else {
        toast.error(json.error?.message || 'Failed to update account');
      }
    } catch {
      toast.error('Network error updating account');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccountId || !editAccountName || !editBankName) {
      toast.error('Account name and bank name are required');
      return;
    }
    await submitUpdateAccount(false);
  };

  const handleConfirmReassign = async () => {
    if (!reassignPrompt) return;
    if (reassignPrompt.action === 'create') {
      await submitCreateAccount(true);
    } else {
      await submitUpdateAccount(true);
    }
  };

  const handleArchiveAccount = async (accountId: string, name: string) => {
    if (!confirm(`Are you sure you want to archive "${name}"?`)) return;

    try {
      const res = await fetch(`${getApiUrl()}/api/v1/accounts/${accountId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`Account "${name}" archived`);
        fetchAccounts();
        emitDataChange('accounts');
      } else {
        toast.error(json.error?.message || 'Failed to archive account');
      }
    } catch {
      toast.error('Network error archiving account');
    }
  };

  const totalBalance = accounts.reduce((sum, acc) => sum + (acc.currentBalance || 0), 0);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Bank Accounts</h1>
            <Badge variant="default">{accounts.length} Active</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your liquid bank accounts, salary accounts, cash reserves, and digital wallets
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={fetchAccounts} variant="outline" size="sm" className="gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={() => setShowAddModal(true)} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Add Account
          </Button>
        </div>
      </div>

      {/* Aggregate Balance Banner */}
      <Card className="border-border bg-card shadow-sm">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="text-xs uppercase font-semibold tracking-wider text-muted-foreground">
                Total Liquid Bank Balance
              </p>
              {loading ? (
                <Skeleton className="h-9 w-48 mt-1" />
              ) : (
                <h2 className="text-3xl font-extrabold tracking-tight text-foreground mt-1">
                  {formatCurrency(totalBalance, user?.currency || 'INR')}
                </h2>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                Aggregated across all verified active accounts with decimal precision
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-foreground border border-border">
                <Wallet className="h-6 w-6" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Total Cash Overview */}
      <Card className="border-border bg-card shadow-sm overflow-hidden">
        <CardHeader className="bg-muted/30 pb-4 border-b border-border">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                <Banknote className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  Total Cash Overview
                  <Badge variant="outline" className="text-xs font-mono font-normal">
                    Authoritative
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  Reconciled cash in hand, liquid bank holdings, and peer receivables/payables
                </CardDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCashAdjType('add_cash');
                setCashAdjAmount('');
                setCashAdjDescription('');
                setCashAdjDate(new Date().toISOString().split('T')[0]);
                setShowCashModal(true);
              }}
              className="gap-2 shrink-0"
            >
              <Pencil className="h-3.5 w-3.5" />
              Adjust Cash
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {/* Designated Chit Account Configuration Warning if not set */}
          {totalCashSummary && !totalCashSummary.isChitAccountConfigured && (
            <div className="flex items-center gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                Designated chit fund bank account not set. Set a chit bank account in Chit Fund or Bank Accounts settings to properly track personal available balances.
              </span>
            </div>
          )}

          {/* Main Key Figures Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Total Personal Available Balance */}
            <div className="p-4 rounded-xl bg-muted/20 border border-border space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                <span>Personal Available</span>
                <span className="text-[10px] font-mono lowercase text-muted-foreground bg-muted px-1.5 py-0.5 rounded">B_avail</span>
              </p>
              {loading || !totalCashSummary ? (
                <Skeleton className="h-8 w-28 my-1" />
              ) : (
                <p className={`text-2xl font-bold tracking-tight font-mono ${(totalCashSummary.totalPersonalAvailableBalance ?? totalBalance) < 0 ? 'text-rose-400' : 'text-foreground'}`}>
                  {formatCurrency(totalCashSummary.totalPersonalAvailableBalance ?? totalBalance, user?.currency || 'INR')}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Personal bank liquidity after excluding reserved chit pool
              </p>
            </div>

            {/* Total Available Money */}
            <div className="p-4 rounded-xl bg-muted/20 border border-border space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                <span>Total Available Money</span>
                <span className="text-[10px] font-mono lowercase text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Bank + C</span>
              </p>
              {loading || !totalCashSummary ? (
                <Skeleton className="h-8 w-28 my-1" />
              ) : (
                <p className="text-2xl font-bold tracking-tight text-foreground font-mono">
                  {formatCurrency(totalCashSummary.totalAvailableMoney ?? totalBalance, user?.currency || 'INR')}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Immediate liquid funds (Personal Bank + Cash in Hand)
              </p>
            </div>

            {/* Total Financial Assets Tracked */}
            <div className="p-4 rounded-xl bg-muted/20 border border-border space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                <span>Total Assets Tracked</span>
                <span className="text-[10px] font-mono lowercase text-muted-foreground bg-muted px-1.5 py-0.5 rounded">C + L + Bank</span>
              </p>
              {loading || !totalCashSummary ? (
                <Skeleton className="h-8 w-28 my-1" />
              ) : (
                <p className="text-2xl font-bold tracking-tight text-foreground font-mono">
                  {formatCurrency(totalCashSummary.totalFinancialAssetsTracked ?? totalBalance, user?.currency || 'INR')}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Available liquidity plus outstanding lending
              </p>
            </div>

            {/* Total Outstanding Debt */}
            <div className="p-4 rounded-xl bg-destructive/5 border border-destructive/20 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-destructive flex items-center justify-between">
                <span>Total Debt</span>
                <span className="text-[10px] font-mono lowercase text-destructive bg-destructive/10 px-1.5 py-0.5 rounded">D_borrowed + D_cc</span>
              </p>
              {loading || !totalCashSummary ? (
                <Skeleton className="h-8 w-28 my-1" />
              ) : (
                <p className="text-2xl font-bold tracking-tight text-destructive font-mono">
                  {formatCurrency(totalCashSummary.totalOutstandingDebt ?? totalCashSummary.outstandingBorrowing ?? 0, user?.currency || 'INR')}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Total liabilities (Personal Borrowing + Credit Cards)
              </p>
            </div>

            {/* Net Tracked Position */}
            <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center justify-between">
                <span>Net Tracked Position</span>
                <span className="text-[10px] font-mono lowercase text-primary bg-primary/10 px-1.5 py-0.5 rounded">Assets - Debt</span>
              </p>
              {loading || !totalCashSummary ? (
                <Skeleton className="h-8 w-28 my-1" />
              ) : (
                <p className="text-2xl font-bold tracking-tight text-foreground font-mono">
                  {formatCurrency(totalCashSummary.netTrackedPosition ?? totalBalance, user?.currency || 'INR')}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Assets minus total liabilities tracked
              </p>
            </div>
          </div>

          {/* Component Breakdown Pills */}
          <div className="pt-2 border-t border-border/60">
            <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
              Component Balances Breakdown
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3 text-sm">
              <div className="flex flex-col p-3 rounded-lg bg-card border border-border">
                <span className="text-xs text-muted-foreground">Total Liquid Bank (B)</span>
                <span className="font-semibold font-mono text-base mt-0.5">
                  {formatCurrency(totalCashSummary?.totalBankBalance ?? totalBalance, user?.currency || 'INR')}
                </span>
                <span className="text-[10px] text-muted-foreground">Across verified bank accounts</span>
              </div>
              <div className="flex flex-col p-3 rounded-lg bg-card border border-border">
                <span className="text-xs text-muted-foreground">Chit Reserve Held (R_chit)</span>
                <span className="font-semibold font-mono text-base mt-0.5 text-indigo-400">
                  {formatCurrency(totalCashSummary?.chitReserveHeldInBank ?? 0, user?.currency || 'INR')}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {totalCashSummary?.isChitAccountConfigured
                    ? `Held in ${totalCashSummary.designatedBankAccountName || 'Chit Bank'}`
                    : 'No chit bank set'}
                </span>
              </div>
              <div className="flex flex-col p-3 rounded-lg bg-card border border-border">
                <span className="text-xs text-muted-foreground">Personal Available Bank</span>
                <span className={`font-semibold font-mono text-base mt-0.5 ${(totalCashSummary?.totalPersonalAvailableBalance ?? 0) < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {formatCurrency(totalCashSummary?.totalPersonalAvailableBalance ?? totalBalance, user?.currency || 'INR')}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  (B_chit - R_chit) + B_other
                </span>
              </div>
              <div className="flex flex-col p-3 rounded-lg bg-card border border-border">
                <span className="text-xs text-muted-foreground">Cash in Hand (C)</span>
                <span className="font-semibold font-mono text-base mt-0.5 text-foreground">
                  {formatCurrency(totalCashSummary?.personalCashInHand ?? totalCashSummary?.cashInHand ?? 0, user?.currency || 'INR')}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Strictly personal • Chit cash excluded
                </span>
              </div>
              <div className="flex flex-col p-3 rounded-lg bg-card border border-border">
                <span className="text-xs text-muted-foreground">Outstanding Lending (L)</span>
                <span className="font-semibold font-mono text-base mt-0.5 text-foreground">
                  {formatCurrency(totalCashSummary?.outstandingLending ?? 0, user?.currency || 'INR')}
                </span>
                <span className="text-[10px] text-muted-foreground">Receivable from others</span>
              </div>
              <div className="flex flex-col p-3 rounded-lg bg-card border border-border">
                <span className="text-xs text-muted-foreground">Personal Borrowing (D_borrowed)</span>
                <span className="font-semibold font-mono text-base mt-0.5 text-rose-400">
                  {formatCurrency(totalCashSummary?.personalBorrowingOutstanding ?? totalCashSummary?.outstandingBorrowing ?? 0, user?.currency || 'INR')}
                </span>
                <span className="text-[10px] text-muted-foreground">Owed to people (excl. cards)</span>
              </div>
              <div className="flex flex-col p-3 rounded-lg bg-card border border-border">
                <span className="text-xs text-muted-foreground">Credit Card Debt (D_cc)</span>
                <span className="font-semibold font-mono text-base mt-0.5 text-amber-400">
                  {formatCurrency(totalCashSummary?.creditCardOutstanding ?? 0, user?.currency || 'INR')}
                </span>
                <span className="text-[10px] text-muted-foreground">Active credit card balances</span>
              </div>
              <div className="flex flex-col p-3 rounded-lg bg-card border border-border">
                <span className="text-xs text-muted-foreground">Total Outstanding Debt</span>
                <span className="font-semibold font-mono text-base mt-0.5 text-destructive">
                  {formatCurrency(totalCashSummary?.totalOutstandingDebt ?? totalCashSummary?.outstandingBorrowing ?? 0, user?.currency || 'INR')}
                </span>
                <span className="text-[10px] text-muted-foreground">D_borrowed + D_cc</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dedicated Personal Cash in Hand Asset Card */}
      <Card className="border-border bg-gradient-to-r from-card to-card/60 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1 bg-emerald-500" />
        <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Banknote className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-bold">Cash in Hand</CardTitle>
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px] font-medium">
                  Physical Cash Asset
                </Badge>
              </div>
              <CardDescription className="text-xs">
                Physical currency in your wallet or home safe. Strictly separate from Chit Fund cash.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCashAdjType('add_cash');
                setCashAdjAmount('');
                setCashAdjDescription('');
                setCashAdjDate(new Date().toISOString().split('T')[0]);
                setShowCashModal(true);
              }}
              className="gap-1.5 text-xs"
            >
              <Plus className="h-3.5 w-3.5 text-emerald-400" />
              Add Cash
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCashAdjType('remove_cash');
                setCashAdjAmount('');
                setCashAdjDescription('');
                setCashAdjDate(new Date().toISOString().split('T')[0]);
                setShowCashModal(true);
              }}
              className="gap-1.5 text-xs"
            >
              <ArrowUpRight className="h-3.5 w-3.5 text-amber-400" />
              Withdraw Cash
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setCashAdjType('set_balance');
                setCashAdjAmount((totalCashSummary?.openingCashBalance ?? 0).toString());
                setCashAdjDescription('');
                setCashAdjDate(new Date().toISOString().split('T')[0]);
                setShowCashModal(true);
              }}
              className="gap-1.5 text-xs"
            >
              <Pencil className="h-3.5 w-3.5" />
              Set Opening
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-xl bg-muted/20 border border-border/60">
            <div>
              <span className="text-xs text-muted-foreground uppercase font-semibold block">
                Current Available Cash
              </span>
              <p className="text-2xl font-extrabold text-foreground font-mono mt-0.5">
                {formatCurrency(totalCashSummary?.personalCashInHand ?? totalCashSummary?.cashInHand ?? 0, user?.currency || 'INR')}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Reconciled physical cash balance</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase font-semibold block">
                Opening Balance
              </span>
              <p className="text-lg font-bold text-foreground font-mono mt-1">
                {formatCurrency(totalCashSummary?.openingCashBalance ?? 0, user?.currency || 'INR')}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Starting cash recorded</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase font-semibold block">
                Latest Activity
              </span>
              <p className="text-sm font-medium text-foreground mt-1.5">
                {totalCashSummary?.latestAdjustmentDate
                  ? new Date(totalCashSummary.latestAdjustmentDate).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })
                  : 'Configured'}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {totalCashSummary?.adjustments?.length ?? 0} manual adjustment(s) recorded
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Accounts Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No bank accounts added"
          description="Create your first bank account to begin tracking manual income, expenses, and transfers."
          actionLabel="Add Bank Account"
          onAction={() => setShowAddModal(true)}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {accounts.map((acc) => (
            <Card key={acc.id} className="relative overflow-hidden group hover:border-primary/50 transition-all">
              <div
                className="absolute top-0 left-0 right-0 h-1 bg-brand-gradient"
              />
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-lg font-bold">{acc.accountName}</CardTitle>
                    {acc.isChitFundAccount && (
                      <Badge className="bg-indigo-500/15 text-indigo-400 border-indigo-500/30 text-[10px] gap-1 px-1.5 py-0.5 font-medium">
                        <Coins className="h-3 w-3" />
                        Chit Fund
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5" />
                    {acc.bankName}
                  </p>
                </div>
                <Badge variant="secondary" className="capitalize text-[11px]">
                  {acc.accountType}
                </Badge>
              </CardHeader>

              <CardContent className="space-y-4 pt-2">
                {acc.isChitFundAccount ? (
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                        Total Bank Balance
                      </p>
                      <p className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
                        {formatCurrency(acc.currentBalance, acc.currency)}
                      </p>
                    </div>

                    {(() => {
                      const chitFundsInBank = totalCashSummary?.chitReserveHeldInBank ?? chitFundSummary?.chitFundsHeldInBank ?? 0;
                      const personalAvail = acc.currentBalance - chitFundsInBank;
                      const isDeficit = chitFundsInBank > acc.currentBalance;

                      return (
                        <>
                          <div className="p-3 rounded-lg bg-muted/40 border border-border/70 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground font-medium">Personal Available Balance:</span>
                              <span className={`font-bold font-mono ${
                                personalAvail >= 0
                                  ? 'text-[#05A100]'
                                  : 'text-[#CC0000]'
                              }`}>
                                {formatCurrency(
                                  personalAvail,
                                  acc.currency
                                )}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-xs pt-1.5 border-t border-border/50">
                              <span className="text-muted-foreground">Chit Funds Held in Bank:</span>
                              <span className="font-semibold text-foreground font-mono">
                                {formatCurrency(chitFundsInBank, acc.currency)}
                              </span>
                            </div>
                          </div>

                          {isDeficit && (
                            <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500 text-xs flex items-start gap-2">
                              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                              <div className="space-y-1">
                                <p className="font-semibold text-[11px]">Chit Fund Liability Exceeds Bank Balance</p>
                                <p className="text-[11px] text-amber-500/90 leading-tight">
                                  Deficit of{' '}
                                  <span className="font-bold font-mono">
                                    {formatCurrency(
                                      chitFundsInBank - acc.currentBalance,
                                      acc.currency
                                    )}
                                  </span>
                                  .
                                </p>
                                <Link
                                  href="/chit-fund?tab=reconciliation"
                                  className="inline-block text-[11px] underline font-medium hover:text-amber-400"
                                >
                                  Check Reconciliation →
                                </Link>
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                      Current Balance
                    </p>
                    <p className="text-2xl font-bold tracking-tight text-foreground mt-0.5">
                      {formatCurrency(acc.currentBalance, acc.currency)}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-border">
                  <div>
                    <span className="text-muted-foreground">Opening:</span>
                    <p className="font-medium text-foreground">{formatCurrency(acc.openingBalance, acc.currency)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Masked:</span>
                    <p className="font-mono text-foreground">{acc.accountNumberMasked || 'Not set'}</p>
                  </div>
                </div>
              </CardContent>

              <CardFooter className="flex justify-between items-center pt-0 border-t border-border/50 py-3 text-xs">
                <span className="text-muted-foreground text-[11px]">
                  Added {new Date(acc.createdAt).toLocaleDateString()}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenEdit(acc)}
                    className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1 px-2"
                    title="Edit account details"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleArchiveAccount(acc.id, acc.accountName)}
                    className="h-7 text-xs text-muted-foreground hover:text-destructive gap-1 px-2"
                    title="Archive account"
                  >
                    <Archive className="h-3.5 w-3.5" />
                    Archive
                  </Button>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* Add Account Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <Card className="w-full max-w-lg shadow-2xl border-border animate-in zoom-in-95">
            <CardHeader>
              <CardTitle>Add Bank Account</CardTitle>
              <CardDescription>
                Record a new financial account. M12 Expense Tracker works purely with manual entries; no bank passwords required.
              </CardDescription>
            </CardHeader>

            <form onSubmit={handleCreateAccount}>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Account Nickname *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Salary Account"
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={accountName}
                      onChange={(e) => setAccountName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Bank Name *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. HDFC Bank, Chase, Cash"
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Account Type
                    </label>
                    <select
                      value={accountType}
                      onChange={(e) => setAccountType(e.target.value as AccountType)}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {Object.values(AccountType).map((t) => (
                        <option key={t} value={t}>
                          {t.charAt(0).toUpperCase() + t.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Opening Balance *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono"
                      value={openingBalance}
                      onChange={(e) => setOpeningBalance(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Masked Identifier (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. •••• 9876"
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono"
                      value={accountNumberMasked}
                      onChange={(e) => setAccountNumberMasked(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Theme Color
                    </label>
                    <div className="flex items-center gap-2 h-10">
                      <input
                        type="color"
                        value={color}
                        onChange={(e) => setColor(e.target.value)}
                        className="h-10 w-14 rounded cursor-pointer border border-input bg-transparent"
                      />
                      <span className="text-xs font-mono text-muted-foreground">{color}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Notes (Optional)
                  </label>
                  <textarea
                    placeholder="Primary salary credit account..."
                    className="flex min-h-[60px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>

                <div className="pt-2 border-t border-border">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isChitFundAccount}
                      onChange={(e) => setIsChitFundAccount(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-ring"
                    />
                    <div>
                      <span className="text-sm font-medium text-foreground block">
                        Use this account for Chit Fund
                      </span>
                      <span className="text-xs text-muted-foreground block">
                        Designates this account for chit fund collections and payouts. Only one bank account can be designated at a time.
                      </span>
                    </div>
                  </label>
                </div>
              </CardContent>

              <CardFooter className="flex justify-end gap-2 border-t border-border pt-4">
                <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" isLoading={submitting}>
                  Save Bank Account
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      {/* Edit Account Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <Card className="w-full max-w-lg shadow-2xl border-border animate-in zoom-in-95">
            <CardHeader>
              <CardTitle>Edit Bank Account</CardTitle>
              <CardDescription>
                Update bank account attributes. If opening balance is modified, the current derived balance will be recalculated.
              </CardDescription>
            </CardHeader>

            <form onSubmit={handleUpdateAccount}>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Account Nickname *
                    </label>
                    <input
                      type="text"
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={editAccountName}
                      onChange={(e) => setEditAccountName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Bank Name *
                    </label>
                    <input
                      type="text"
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={editBankName}
                      onChange={(e) => setEditBankName(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Account Type
                    </label>
                    <select
                      value={editAccountType}
                      onChange={(e) => setEditAccountType(e.target.value as AccountType)}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {Object.values(AccountType).map((t) => (
                        <option key={t} value={t}>
                          {t.charAt(0).toUpperCase() + t.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Opening Balance *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono"
                      value={editOpeningBalance}
                      onChange={(e) => setEditOpeningBalance(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Masked Identifier (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. •••• 9876"
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono"
                      value={editAccountNumberMasked}
                      onChange={(e) => setEditAccountNumberMasked(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Theme Color
                    </label>
                    <div className="flex items-center gap-2 h-10">
                      <input
                        type="color"
                        value={editColor}
                        onChange={(e) => setEditColor(e.target.value)}
                        className="h-10 w-14 rounded cursor-pointer border border-input bg-transparent"
                      />
                      <span className="text-xs font-mono text-muted-foreground">{editColor}</span>
                    </div>
                  </div>
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

                <div className="pt-2 border-t border-border">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editIsChitFundAccount}
                      onChange={(e) => setEditIsChitFundAccount(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-ring"
                    />
                    <div>
                      <span className="text-sm font-medium text-foreground block">
                        Use this account for Chit Fund
                      </span>
                      <span className="text-xs text-muted-foreground block">
                        Designates this account for chit fund collections and payouts. Only one bank account can be designated at a time.
                      </span>
                    </div>
                  </label>
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

      {/* Reassign Chit Fund Account Confirmation Modal */}
      {reassignPrompt?.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in">
          <Card className="w-full max-w-md shadow-2xl border-amber-500/40 animate-in zoom-in-95">
            <CardHeader>
              <div className="flex items-center gap-2 text-amber-500">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <CardTitle className="text-lg">Reassign Chit Fund Account?</CardTitle>
              </div>
              <CardDescription className="text-xs text-muted-foreground pt-1">
                {reassignPrompt.message}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-foreground/80">
              <p>
                Only one bank account can be designated for Chit Fund operations. If you proceed:
              </p>
              <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                <li>
                  <strong className="text-foreground">{reassignPrompt.existingAccountName}</strong> will no longer be designated as the Chit Fund account.
                </li>
                <li>Future chit fund collections and payouts will route through this newly designated account.</li>
                <li>All existing ledger records and balance histories remain secure.</li>
              </ul>
            </CardContent>
            <CardFooter className="flex justify-end gap-2 border-t border-border pt-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setReassignPrompt(null)}
              >
                Keep Existing Account
              </Button>
              <Button
                type="button"
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white"
                onClick={handleConfirmReassign}
                isLoading={submitting}
              >
                Yes, Reassign Chit Fund
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}

      {/* Personal Cash in Hand Adjustment Modal */}
      {showCashModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <Card className="w-full max-w-lg shadow-2xl border-border animate-in zoom-in-95 max-h-[90vh] flex flex-col">
            <CardHeader className="pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Banknote className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-base font-bold">Adjust Cash in Hand</CardTitle>
                  <CardDescription className="text-xs">
                    Deposit, withdraw, or set opening baseline. Independent from Chit Fund money.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <form onSubmit={handleAdjustCash} className="flex-1 overflow-y-auto">
              <CardContent className="space-y-4 pt-4">
                {/* Current Cash Balance Callout */}
                <div className="p-3 rounded-lg bg-muted/40 border border-border flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-medium">Current Available Cash:</span>
                  <span className="font-bold text-foreground font-mono text-sm">
                    {formatCurrency(totalCashSummary?.personalCashInHand ?? totalCashSummary?.cashInHand ?? 0, user?.currency || 'INR')}
                  </span>
                </div>

                {/* Adjustment Type Selector */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Action Type *
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setCashAdjType('add_cash')}
                      className={`flex flex-col items-center justify-center p-2.5 rounded-lg border text-xs font-semibold transition-all ${
                        cashAdjType === 'add_cash'
                          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-400 shadow-sm'
                          : 'border-border bg-card text-muted-foreground hover:bg-muted/40'
                      }`}
                    >
                      <Plus className="h-4 w-4 mb-1" />
                      <span>Add Cash</span>
                      <span className="text-[10px] font-normal opacity-80">ATM / Deposit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCashAdjType('remove_cash')}
                      className={`flex flex-col items-center justify-center p-2.5 rounded-lg border text-xs font-semibold transition-all ${
                        cashAdjType === 'remove_cash'
                          ? 'border-amber-500 bg-amber-500/15 text-amber-400 shadow-sm'
                          : 'border-border bg-card text-muted-foreground hover:bg-muted/40'
                      }`}
                    >
                      <ArrowUpRight className="h-4 w-4 mb-1" />
                      <span>Remove Cash</span>
                      <span className="text-[10px] font-normal opacity-80">Spend / Bank</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCashAdjType('set_balance');
                        setCashAdjAmount((totalCashSummary?.openingCashBalance ?? 0).toString());
                      }}
                      className={`flex flex-col items-center justify-center p-2.5 rounded-lg border text-xs font-semibold transition-all ${
                        cashAdjType === 'set_balance'
                          ? 'border-primary bg-primary/15 text-primary shadow-sm'
                          : 'border-border bg-card text-muted-foreground hover:bg-muted/40'
                      }`}
                    >
                      <Pencil className="h-4 w-4 mb-1" />
                      <span>Set Opening</span>
                      <span className="text-[10px] font-normal opacity-80">Baseline</span>
                    </button>
                  </div>
                </div>

                {/* Cash Funding Source (Only for Add Cash) */}
                {cashAdjType === 'add_cash' && (
                  <div className="space-y-2 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                      Cash Funding Source *
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setCashAddSource('bank_account')}
                        className={`flex flex-col p-2.5 rounded-lg border text-left transition-all ${
                          cashAddSource === 'bank_account'
                            ? 'border-emerald-500 bg-emerald-500/15 text-emerald-400 shadow-sm font-semibold'
                            : 'border-border bg-card text-muted-foreground hover:bg-muted/40'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <Landmark className="h-4 w-4" />
                          <span className="text-xs">From Bank Account</span>
                        </div>
                        <span className="text-[10px] font-normal opacity-80">Cash Withdrawal (ATM / Branch)</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setCashAddSource('person')}
                        className={`flex flex-col p-2.5 rounded-lg border text-left transition-all ${
                          cashAddSource === 'person'
                            ? 'border-emerald-500 bg-emerald-500/15 text-emerald-400 shadow-sm font-semibold'
                            : 'border-border bg-card text-muted-foreground hover:bg-muted/40'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <Plus className="h-4 w-4" />
                          <span className="text-xs">Cash In by Person</span>
                        </div>
                        <span className="text-[10px] font-normal opacity-80">Direct cash (0 bank impact)</span>
                      </button>
                    </div>

                    {cashAddSource === 'bank_account' && (
                      <div className="space-y-1.5 pt-1">
                        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                          Select Debited Bank Account *
                        </label>
                        <select
                          value={cashAddBankId}
                          onChange={(e) => setCashAddBankId(e.target.value)}
                          required
                          className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.accountName} (Balance: ₹{a.currentBalance.toLocaleString()})
                            </option>
                          ))}
                        </select>
                        <p className="text-[10px] text-muted-foreground">
                          Debits this bank account and credits Cash in Hand. Recorded as an internal transfer with ₹0 impact on income, expense, or total tracked assets.
                        </p>
                      </div>
                    )}

                    {cashAddSource === 'person' && (
                      <div className="space-y-1.5 pt-1">
                        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                          Person / Cash Provider Name *
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. John Doe, Cash gift, Manual deposit..."
                          value={cashAddPersonName}
                          onChange={(e) => setCashAddPersonName(e.target.value)}
                          className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                        <p className="text-[10px] text-muted-foreground">
                          Credits Cash in Hand directly. No bank account is debited.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Amount */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {cashAdjType === 'set_balance' ? 'Opening Cash Amount (₹) *' : 'Amount (₹) *'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono font-bold"
                    value={cashAdjAmount}
                    onChange={(e) => setCashAdjAmount(e.target.value)}
                    required
                  />
                  {cashAdjType === 'remove_cash' && parseFloat(cashAdjAmount) > (totalCashSummary?.personalCashInHand ?? totalCashSummary?.cashInHand ?? 0) && (
                    <p className="text-[11px] text-destructive flex items-center gap-1 font-medium">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      Amount exceeds current available Cash in Hand (₹{(totalCashSummary?.personalCashInHand ?? totalCashSummary?.cashInHand ?? 0).toLocaleString()})
                    </p>
                  )}
                </div>

                {/* Date */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Date *
                  </label>
                  <DatePicker
                    value={cashAdjDate}
                    onChange={setCashAdjDate}
                  />
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Description / Note (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder={
                      cashAdjType === 'add_cash'
                        ? 'e.g. Withdrew ₹2,000 from ATM'
                        : cashAdjType === 'remove_cash'
                        ? 'e.g. Paid cash for groceries'
                        : 'Starting cash in wallet'
                    }
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={cashAdjDescription}
                    onChange={(e) => setCashAdjDescription(e.target.value)}
                  />
                </div>

                {/* Recent Adjustments Audit Trail */}
                {totalCashSummary?.adjustments && totalCashSummary.adjustments.length > 0 && (
                  <div className="pt-3 border-t border-border space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <History className="h-3.5 w-3.5" />
                      Recent Cash Adjustments ({totalCashSummary.adjustments.length})
                    </span>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {totalCashSummary.adjustments.slice(-5).reverse().map((adj, i) => (
                        <div
                          key={adj.id || i}
                          className="flex items-center justify-between p-2 rounded-lg bg-muted/30 border border-border/50 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={`text-[10px] font-medium ${
                                adj.type === 'add_cash'
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                  : adj.type === 'remove_cash'
                                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                  : 'bg-primary/10 text-primary border-primary/30'
                              }`}
                            >
                              {adj.type === 'add_cash' ? '+ Added' : adj.type === 'remove_cash' ? '- Withdrawn' : 'Opening'}
                            </Badge>
                            <span className="text-muted-foreground text-[11px] truncate max-w-[140px]">
                              {adj.description || (adj.type === 'set_balance' ? 'Opening balance' : 'Manual adjustment')}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="font-mono font-semibold text-foreground">
                              {formatCurrency(adj.amount, user?.currency || 'INR')}
                            </span>
                            <span className="text-[10px] text-muted-foreground block">
                              {new Date(adj.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>

              <CardFooter className="flex justify-end gap-2 border-t border-border pt-4">
                <Button type="button" variant="outline" onClick={() => setShowCashModal(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  isLoading={submitting}
                  disabled={
                    submitting ||
                    (cashAdjType === 'remove_cash' &&
                      parseFloat(cashAdjAmount) >
                        (totalCashSummary?.personalCashInHand ?? totalCashSummary?.cashInHand ?? 0))
                  }
                >
                  Confirm Adjustment
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}

