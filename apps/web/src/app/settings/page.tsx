'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import {
  Coins,
  CreditCard,
  Repeat,
  Sliders,
  CheckCircle2,
  XCircle,
  Building2,
  ArrowRight,
  ShieldCheck,
  Wallet,
  Database,
  AlertTriangle,
  Trash2,
  RotateCcw,
  Trophy,
  Sparkles,
  ArrowLeftRight,
  HandCoins,
  Landmark,
  PieChart,
  TrendingUp,
  Percent,
  UserX,
} from 'lucide-react';
import { BankAccount, ModulePreferences } from '@finora/shared';
import { emitDataChange } from '@/lib/data-sync';

const AVAILABLE_TRANSACTION_TYPES = [
  { id: 'income', label: 'Income Transactions', description: 'Salary, freelance, dividends, gifts, and manual income receipts' },
  { id: 'expense', label: 'Expense Transactions', description: 'Daily expenses, household bills, groceries, and cash outlays' },
  { id: 'transfers', label: 'Account Transfers', description: 'Internal funds transferred between bank accounts' },
  { id: 'credit_card_purchases', label: 'Credit Card Purchases', description: 'Card POS swipes, online purchases, fees, and merchant refunds' },
  { id: 'credit_card_repayments', label: 'Credit Card Repayments', description: 'Bank bill payments toward outstanding card balances & generated statements' },
  { id: 'budgets', label: 'Budgets & Spending Targets', description: 'Monthly budget limits, category thresholds, and target tracking' },
  { id: 'recurring', label: 'Recurring Schedules', description: 'Scheduled repeat transactions and automated subscriptions' },
];

export default function SettingsPage() {
  const router = useRouter();
  const { user, refreshUser, logout } = useAuth();
  const [expenseTracker, setExpenseTracker] = useState(true);
  const [emi, setEmi] = useState(true);
  const [lendingBorrowing, setLendingBorrowing] = useState(true);
  const [budget, setBudget] = useState(true);
  const [recurringTransactions, setRecurringTransactions] = useState(true);
  const [creditCards, setCreditCards] = useState(true);
  const [chitFund, setChitFund] = useState(true);
  const [investment, setInvestment] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  // Feature availability derived from user saved configuration as single source of truth
  const isChitFundEnabled = user?.modulePreferences?.chitFund !== false;
  const isInvestmentEnabled = user?.modulePreferences?.investment !== false;
  const isLendingBorrowingEnabled = user?.modulePreferences?.lendingBorrowing !== false;
  const isEmiEnabled = user?.modulePreferences?.emi !== false;

  // Investment Reset State
  const [investmentsList, setInvestmentsList] = useState<any[]>([]);
  const [loadingInvestmentsList, setLoadingInvestmentsList] = useState(false);
  const [selectedInvestmentId, setSelectedInvestmentId] = useState<string>('');
  const [showResetSingleInvestmentModal, setShowResetSingleInvestmentModal] = useState(false);
  const [isResettingSingleInvestment, setIsResettingSingleInvestment] = useState(false);
  const [showResetAllInvestmentsModal, setShowResetAllInvestmentsModal] = useState(false);
  const [confirmationPhraseInvestments, setConfirmationPhraseInvestments] = useState('');
  const [isResettingAllInvestments, setIsResettingAllInvestments] = useState(false);

  // Chit Fund & Cycle Reset State
  const [fund, setFund] = useState<any>(null);
  const [cycles, setCycles] = useState<any[]>([]);
  const [loadingCycles, setLoadingCycles] = useState(false);
  const [selectedCyclePeriod, setSelectedCyclePeriod] = useState<string>('');
  const [resetReason, setResetReason] = useState<string>('');
  const [showResetCycleModal, setShowResetCycleModal] = useState(false);
  const [isResettingCycleWinner, setIsResettingCycleWinner] = useState(false);

  // Reset All Winners (Option B for Chit Winner Reset)
  const [showResetAllWinnersModal, setShowResetAllWinnersModal] = useState(false);
  const [confirmationPhraseWinners, setConfirmationPhraseWinners] = useState('');
  const [isResettingAllWinners, setIsResettingAllWinners] = useState(false);

  // Reset Chit Fund Financial Data State
  const [showChitFundResetModal, setShowChitFundResetModal] = useState(false);
  const [chitFundResetPreview, setChitFundResetPreview] = useState<any>(null);
  const [loadingChitFundResetPreview, setLoadingChitFundResetPreview] = useState(false);
  const [confirmationPhraseChitFund, setConfirmationPhraseChitFund] = useState('');
  const [isResettingChitFund, setIsResettingChitFund] = useState(false);

  // Reset Selected Transactions State
  const [selectedTypesA, setSelectedTypesA] = useState<Set<string>>(new Set(['income', 'expense']));
  const [showOptionAModal, setShowOptionAModal] = useState(false);
  const [confirmationPhraseA, setConfirmationPhraseA] = useState('');
  const [isResettingA, setIsResettingA] = useState(false);

  // Option B State (Reset All Financial Data)
  const [showOptionBModal, setShowOptionBModal] = useState(false);
  const [confirmationPhraseB, setConfirmationPhraseB] = useState('');
  const [passwordB, setPasswordB] = useState('');
  const [isResettingB, setIsResettingB] = useState(false);

  // Permanent Account Deletion State
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [confirmationPhraseDeleteAccount, setConfirmationPhraseDeleteAccount] = useState('');
  const [deleteAccountPassword, setDeleteAccountPassword] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  // Lending & Borrowing Reset State
  const [showResetLendingModal, setShowResetLendingModal] = useState(false);
  const [confirmationPhraseLending, setConfirmationPhraseLending] = useState('');
  const [isResettingLending, setIsResettingLending] = useState(false);

  // EMI Reset State
  const [showResetEmiModal, setShowResetEmiModal] = useState(false);
  const [confirmationPhraseEmi, setConfirmationPhraseEmi] = useState('');
  const [isResettingEmi, setIsResettingEmi] = useState(false);

  const getApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  useEffect(() => {
    if (user?.modulePreferences) {
      setExpenseTracker(user.modulePreferences.expenseTracker !== false);
      setEmi(user.modulePreferences.emi !== false);
      setLendingBorrowing(user.modulePreferences.lendingBorrowing !== false);
      setBudget(user.modulePreferences.budget !== false);
      setRecurringTransactions(user.modulePreferences.recurringTransactions !== false);
      setCreditCards(user.modulePreferences.creditCards !== false);
      setChitFund(user.modulePreferences.chitFund !== false);
      setInvestment(user.modulePreferences.investment !== false);
    }
  }, [user]);

  const fetchAccounts = async () => {
    setLoadingAccounts(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/accounts`, { credentials: 'include' });
      const json = await res.json();
      if (json.success) {
        setAccounts(json.data || []);
      }
    } catch {
      // Ignored
    } finally {
      setLoadingAccounts(false);
    }
  };

  const formatCyclePill = (period: string) => {
    if (!period) return '';
    const [year, month] = period.split('-');
    if (!year || !month) return period;
    const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const mIdx = parseInt(month, 10) - 1;
    const shortYear = year.slice(2);
    return `${monthNames[mIdx] || month} ${shortYear}`;
  };

  const fetchChitFundAndCycles = async () => {
    setLoadingCycles(true);
    try {
      const fundRes = await fetch(`${getApiUrl()}/api/v1/chit-funds`, { credentials: 'include' });
      const fundJson = await fundRes.json();
      if (fundRes.ok && fundJson.success && fundJson.data) {
        const activeFund = fundJson.data;
        setFund(activeFund);
        const cyclesRes = await fetch(`${getApiUrl()}/api/v1/chit-funds/${activeFund.id}/cycles`, { credentials: 'include' });
        const cyclesJson = await cyclesRes.json();
        if (cyclesRes.ok && cyclesJson.success) {
          const list = cyclesJson.data || [];
          setCycles(list);
          if (list.length > 0 && !selectedCyclePeriod) {
            const withWinner = list.find((c: any) => c.winnerMemberId || c.winnerMemberName);
            setSelectedCyclePeriod(withWinner ? withWinner.cyclePeriod : list[0].cyclePeriod);
          }
        }
      }
    } catch {
      // Ignored
    } finally {
      setLoadingCycles(false);
    }
  };

  const fetchInvestmentsList = async () => {
    setLoadingInvestmentsList(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/investments`, { credentials: 'include' });
      const json = await res.json();
      if (res.ok && json.success) {
        setInvestmentsList(json.data || []);
      }
    } catch {
      // Ignored
    } finally {
      setLoadingInvestmentsList(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
    fetchChitFundAndCycles();
    fetchInvestmentsList();
  }, []);

  const handleResetCycleWinner = async () => {
    if (!selectedCyclePeriod) return;
    setIsResettingCycleWinner(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/settings/reset-chit-winner-month`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          chitFundId: fund?.id,
          cyclePeriod: selectedCyclePeriod,
          reason: resetReason.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(json.message || `Winner for ${selectedCyclePeriod} reset successfully`);
        setShowResetCycleModal(false);
        setResetReason('');
        setCycles((prev) =>
          prev.map((c) =>
            c.cyclePeriod === selectedCyclePeriod
              ? { ...c, winnerMemberId: undefined, winnerMemberName: undefined, status: 'upcoming', winnerNotes: undefined, notes: undefined }
              : c
          )
        );
        setSelectedCyclePeriod('');
        fetchChitFundAndCycles();
        emitDataChange('all');
      } else {
        toast.error(json.error?.message || 'Failed to reset cycle winner');
      }
    } catch {
      toast.error('Network error resetting cycle winner');
    } finally {
      setIsResettingCycleWinner(false);
    }
  };

  const handleResetAllWinners = async () => {
    if (confirmationPhraseWinners !== 'RESET WINNERS') {
      toast.error('Please type RESET WINNERS to confirm');
      return;
    }
    setIsResettingAllWinners(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/settings/reset-all-chit-winners`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          chitFundId: fund?.id,
          confirmationPhrase: confirmationPhraseWinners,
          reason: resetReason.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(json.message || 'All chit winner assignments safely reset');
        setShowResetAllWinnersModal(false);
        setConfirmationPhraseWinners('');
        setResetReason('');
        setCycles((prev) =>
          prev.map((c) => ({
            ...c,
            winnerMemberId: undefined,
            winnerMemberName: undefined,
            status: 'upcoming',
            winnerNotes: undefined,
            notes: undefined,
          }))
        );
        setSelectedCyclePeriod('');
        fetchChitFundAndCycles();
        emitDataChange('all');
      } else {
        toast.error(json.error?.message || 'Failed to reset all winners');
      }
    } catch {
      toast.error('Network error resetting all winners');
    } finally {
      setIsResettingAllWinners(false);
    }
  };

  const fetchChitFundResetPreview = async () => {
    setLoadingChitFundResetPreview(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/settings/chit-fund-reset-preview`, { credentials: 'include' });
      const json = await res.json();
      if (res.ok && json.success) {
        setChitFundResetPreview(json.data);
        setShowChitFundResetModal(true);
      } else {
        toast.error(json.error?.message || 'Failed to fetch chit fund reset preview');
      }
    } catch {
      toast.error('Network error fetching reset preview');
    } finally {
      setLoadingChitFundResetPreview(false);
    }
  };

  const handleExecuteResetChitFundFinancials = async () => {
    if (confirmationPhraseChitFund !== 'RESET CHIT FINANCIALS') {
      toast.error('Please type RESET CHIT FINANCIALS to confirm');
      return;
    }
    setIsResettingChitFund(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/settings/reset-chit-fund-financials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          confirmationPhrase: confirmationPhraseChitFund,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(json.message || 'Chit fund financials successfully reset. Members and bank balances preserved.');
        setShowChitFundResetModal(false);
        setConfirmationPhraseChitFund('');
        setChitFundResetPreview(null);
        fetchChitFundAndCycles();
        fetchAccounts();
        emitDataChange('all');
      } else {
        toast.error(json.error?.message || 'Failed to reset chit fund financials');
      }
    } catch {
      toast.error('Network error during chit fund reset');
    } finally {
      setIsResettingChitFund(false);
    }
  };

  const toggleTypeA = (id: string) => {
    setSelectedTypesA((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllA = () => {
    setSelectedTypesA(new Set(AVAILABLE_TRANSACTION_TYPES.map((t) => t.id)));
  };

  const handleDeselectAllA = () => {
    setSelectedTypesA(new Set());
  };

  const handleExecuteResetA = async () => {
    if (confirmationPhraseA !== 'RESET MY DATA') {
      toast.error('Please type RESET MY DATA to confirm');
      return;
    }
    if (selectedTypesA.size === 0) {
      toast.error('Please select at least one transaction type to reset');
      return;
    }

    setIsResettingA(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/settings/reset-transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          confirmationPhrase: confirmationPhraseA,
          selectedTypes: Array.from(selectedTypesA),
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(json.message || 'Selected records successfully reset');
        setShowOptionAModal(false);
        setConfirmationPhraseA('');
        fetchAccounts();
        emitDataChange('all');
      } else {
        toast.error(json.error?.message || 'Failed to reset records');
      }
    } catch {
      toast.error('Network error during reset operation');
    } finally {
      setIsResettingA(false);
    }
  };

  const handleExecuteResetB = async () => {
    if (confirmationPhraseB !== 'RESET MY DATA') {
      toast.error('Please type RESET MY DATA to confirm');
      return;
    }

    setIsResettingB(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/settings/reset-all-financial-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          confirmationPhrase: confirmationPhraseB,
          password: passwordB || undefined,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(json.message || 'All financial data has been wiped. Account preserved.');
        setShowOptionBModal(false);
        setConfirmationPhraseB('');
        setPasswordB('');
        fetchAccounts();
        emitDataChange('all');
      } else {
        toast.error(json.error?.message || 'Failed to reset all data');
      }
    } catch {
      toast.error('Network error during complete reset');
    } finally {
      setIsResettingB(false);
    }
  };

  const getAuthHeaders = () => {
    const token = typeof window !== 'undefined'
      ? localStorage.getItem('m12_expense_tracker_token') || localStorage.getItem('finora_token')
      : null;
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  const handleDeleteAccountPermanently = async () => {
    if (confirmationPhraseDeleteAccount !== 'DELETE') {
      toast.error('Please type DELETE to confirm permanent account deletion');
      return;
    }

    setIsDeletingAccount(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/settings/delete-account`, {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          confirmationPhrase: 'DELETE',
          password: deleteAccountPassword || undefined,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Your account and all associated data have been permanently deleted.');
        setShowDeleteAccountModal(false);
        setConfirmationPhraseDeleteAccount('');
        setDeleteAccountPassword('');
        if (typeof window !== 'undefined') {
          localStorage.removeItem('m12_expense_tracker_token');
          localStorage.removeItem('finora_token');
          sessionStorage.clear();
        }
        await logout();
        router.replace('/register');
      } else {
        toast.error(json.error?.message || 'Failed to delete account');
      }
    } catch {
      toast.error('Network error during permanent account deletion');
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handleExecuteResetLending = async () => {
    if (confirmationPhraseLending !== 'RESET LENDING DATA') {
      toast.error('Please type RESET LENDING DATA to confirm');
      return;
    }

    setIsResettingLending(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/settings/reset-lending-borrowing`, {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          confirmationPhrase: 'RESET LENDING DATA',
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(json.message || 'All lending and borrowing records have been reset');
        setShowResetLendingModal(false);
        setConfirmationPhraseLending('');
        fetchAccounts();
        emitDataChange('all');
        await refreshUser();
      } else {
        toast.error(json.error?.message || 'Failed to reset lending and borrowing data');
      }
    } catch {
      toast.error('Network error during lending and borrowing reset');
    } finally {
      setIsResettingLending(false);
    }
  };

  const handleExecuteResetEmi = async () => {
    if (confirmationPhraseEmi !== 'RESET EMI DATA') {
      toast.error('Please type RESET EMI DATA to confirm');
      return;
    }

    setIsResettingEmi(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/settings/reset-emi`, {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          confirmationPhrase: 'RESET EMI DATA',
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(json.message || 'All EMI data and schedule occurrences have been reset');
        setShowResetEmiModal(false);
        setConfirmationPhraseEmi('');
        fetchAccounts();
        emitDataChange('all');
        await refreshUser();
      } else {
        toast.error(json.error?.message || 'Failed to reset EMI data');
      }
    } catch {
      toast.error('Network error during EMI reset');
    } finally {
      setIsResettingEmi(false);
    }
  };

  const handleResetSingleInvestment = async () => {
    if (!selectedInvestmentId) {
      toast.error('Please select an investment to delete');
      return;
    }
    setIsResettingSingleInvestment(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/investments/${selectedInvestmentId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(json.message || 'Investment deleted and schedule cleaned up successfully');
        setShowResetSingleInvestmentModal(false);
        setSelectedInvestmentId('');
        fetchInvestmentsList();
        fetchAccounts();
        emitDataChange('all');
      } else {
        toast.error(json.error?.message || 'Failed to delete investment');
      }
    } catch {
      toast.error('Network error deleting investment');
    } finally {
      setIsResettingSingleInvestment(false);
    }
  };

  const handleResetAllInvestments = async () => {
    if (confirmationPhraseInvestments !== 'RESET INVESTMENTS') {
      toast.error('Please type RESET INVESTMENTS to confirm');
      return;
    }
    setIsResettingAllInvestments(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/investments/reset-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          confirmationPhrase: confirmationPhraseInvestments,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(json.message || 'All investments reset successfully');
        setShowResetAllInvestmentsModal(false);
        setConfirmationPhraseInvestments('');
        setSelectedInvestmentId('');
        fetchInvestmentsList();
        fetchAccounts();
        emitDataChange('all');
      } else {
        toast.error(json.error?.message || 'Failed to reset investments');
      }
    } catch {
      toast.error('Network error resetting investments');
    } finally {
      setIsResettingAllInvestments(false);
    }
  };

  const handleSavePreferences = async (updates: Partial<ModulePreferences>) => {
    setSaving(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/settings/modules`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Module preferences updated successfully');
        await refreshUser();
        emitDataChange('all');
      } else {
        toast.error(json.error?.message || 'Failed to save module preferences');
      }
    } catch {
      toast.error('Network error saving preferences');
    } finally {
      setSaving(false);
    }
  };

  const toggleModule = (key: keyof ModulePreferences) => {
    const currentValues: ModulePreferences = {
      expenseTracker,
      emi,
      lendingBorrowing,
      budget,
      recurringTransactions,
      creditCards,
      chitFund,
      investment,
    };
    const newVal = !currentValues[key];
    const updated = { ...currentValues, [key]: newVal };

    if (key === 'expenseTracker') setExpenseTracker(newVal);
    if (key === 'emi') setEmi(newVal);
    if (key === 'lendingBorrowing') setLendingBorrowing(newVal);
    if (key === 'budget') setBudget(newVal);
    if (key === 'recurringTransactions') setRecurringTransactions(newVal);
    if (key === 'creditCards') setCreditCards(newVal);
    if (key === 'chitFund') setChitFund(newVal);
    if (key === 'investment') setInvestment(newVal);

    handleSavePreferences(updated);
  };

  const designatedChitFundAccount = accounts.find((a) => a.isChitFundAccount && !a.isArchived);

  return (
    <div className="space-y-8 max-w-4xl animate-in fade-in duration-300">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow">
            <Sliders className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Application Settings</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Customize modular workspaces, feature visibility, and designated fund accounts
            </p>
          </div>
        </div>
      </div>

      {/* Features & Modules Card */}
      <Card className="border-border shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Features & Modules</CardTitle>
              <CardDescription>
                Enable or disable modular workspaces independently for your account. All underlying records, accounts, and transactions remain securely preserved when a module is disabled.
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-xs">
              Per-User Storage
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="divide-y divide-border/60">
          {[
            {
              key: 'expenseTracker' as const,
              title: 'Expense Tracker — Transactions',
              description: 'Record income, expenses, and financial transactions.',
              icon: ArrowLeftRight,
              colorClass: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
              enabled: expenseTracker,
            },
            {
              key: 'emi' as const,
              title: 'EMI Management',
              description: 'Track EMI schedules, payments, and remaining installments.',
              icon: Landmark,
              colorClass: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
              enabled: emi,
            },
            {
              key: 'lendingBorrowing' as const,
              title: 'Lending & Borrowing',
              description: 'Track money lent to others and money borrowed.',
              icon: HandCoins,
              colorClass: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
              enabled: lendingBorrowing,
            },
            {
              key: 'budget' as const,
              title: 'Budget Management',
              description: 'Set category budgets and monitor spending.',
              icon: PieChart,
              colorClass: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
              enabled: budget,
            },
            {
              key: 'recurringTransactions' as const,
              title: 'Recurring Transactions',
              description: 'Manage subscriptions, bills, and recurring payments.',
              icon: Repeat,
              colorClass: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20',
              enabled: recurringTransactions,
            },
            {
              key: 'creditCards' as const,
              title: 'Credit Card Management',
              description: 'Track card expenses, outstanding balances, and repayments.',
              icon: CreditCard,
              colorClass: 'bg-[#CC0000]/10 text-[#CC0000] border-[#CC0000]/20',
              enabled: creditCards,
            },
            {
              key: 'chitFund' as const,
              title: 'Chit Fund Management',
              description: 'Manage chit members, collections, winners, payouts, and balances.',
              icon: Coins,
              colorClass: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
              enabled: chitFund,
            },
            {
              key: 'investment' as const,
              title: 'Investment Management',
              description: 'Track capital investments, mutual funds, stocks, and external chit funds.',
              icon: TrendingUp,
              colorClass: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
              enabled: investment,
            },
          ].map((m) => {
            const Icon = m.icon;
            return (
              <div key={m.key} className="py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-bold border ${m.colorClass}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-foreground">{m.title}</h3>
                      <Badge variant={m.enabled ? 'success' : 'secondary'} className="text-[10px]">
                        {m.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed max-w-lg">
                      {m.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-center">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={m.enabled}
                      onChange={() => toggleModule(m.key)}
                      disabled={saving}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                  </label>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Chit Fund Bank Account Designation Card (Only when Chit Fund is enabled) */}
      {isChitFundEnabled && (
        <Card className="border-border shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Designated Chit Fund Bank Account</CardTitle>
                <CardDescription>
                  Identifies the single bank account designated to receive and hold chit fund pool money.
                </CardDescription>
              </div>
              <Link href="/accounts">
                <Button size="sm" variant="outline" className="gap-2">
                  <Wallet className="h-3.5 w-3.5" />
                  Manage Accounts
                </Button>
              </Link>
            </div>
          </CardHeader>

          <CardContent>
            {loadingAccounts ? (
              <p className="text-xs text-muted-foreground">Checking designated accounts...</p>
            ) : designatedChitFundAccount ? (
              <div className="flex items-center justify-between p-4 rounded-xl border border-primary/20 bg-primary/5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-foreground">
                        {designatedChitFundAccount.accountName}
                      </p>
                      <Badge variant="success" className="text-[10px]">
                        Designated Account
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {designatedChitFundAccount.bankName} • Account Balance: ₹
                      {designatedChitFundAccount.currentBalance.toLocaleString()}
                    </p>
                  </div>
                </div>

                <Link href="/accounts">
                  <Button size="sm" variant="ghost" className="gap-1 text-xs">
                    <span>Reassign</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="p-4 rounded-xl border border-dashed border-border text-center space-y-2">
                <p className="text-sm font-medium text-muted-foreground">
                  No bank account is currently designated for Chit Fund.
                </p>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  Designate an account in the Accounts section by checking "Use this account for Chit Fund". Only one account can be designated at a time.
                </p>
                <Link href="/accounts" className="inline-block pt-1">
                  <Button size="sm" variant="outline">
                    Designate Bank Account
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Investment Management Section (Only when Investment is enabled) */}
      {isInvestmentEnabled && (
        <div className="pt-6 border-t border-border/80">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-sm border border-primary/20">
              <TrendingUp className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-foreground">Investment Management</h2>
              <p className="text-xs text-muted-foreground">
                Manage and reset investment records and contribution schedules without altering unrelated bank accounts, chit fund records, or EMI loans
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6">
            <Card className="border-border shadow-sm overflow-hidden">
              <CardHeader className="bg-muted/30 border-b border-border/60 pb-4">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    Investment Data Reset
                  </CardTitle>
                  <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/30">
                    Safe &amp; Isolated
                  </Badge>
                </div>
                <CardDescription className="text-xs mt-1">
                  Manage and reset investment records and schedules without altering unrelated bank accounts, chit fund records, or EMI loans.
                </CardDescription>
              </CardHeader>

              <CardContent className="p-6 space-y-6">
                {/* Option 1: Reset Single Investment */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                    Option 1: Reset / Delete Single Investment
                  </h4>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Permanently remove an individual investment (stocks, mutual funds, gold, or external chit) and all its associated contribution schedule entries and linked transactions.
                  </p>

                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 pt-1">
                    <select
                      value={selectedInvestmentId}
                      onChange={(e) => setSelectedInvestmentId(e.target.value)}
                      disabled={loadingInvestmentsList || investmentsList.length === 0}
                      className="flex h-9 w-full sm:w-72 rounded-lg border border-input bg-background px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">
                        {loadingInvestmentsList
                          ? 'Loading investments...'
                          : investmentsList.length === 0
                            ? 'No investments found'
                            : 'Select an investment to reset...'}
                      </option>
                      {investmentsList.map((inv) => (
                        <option key={inv.id || inv._id} value={inv.id || inv._id}>
                          {inv.name} ({inv.category}) — ₹{(inv.totalInvested || inv.totalContributed || 0).toLocaleString()}
                        </option>
                      ))}
                    </select>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!selectedInvestmentId}
                      onClick={() => setShowResetSingleInvestmentModal(true)}
                      className="border-destructive/40 text-destructive hover:bg-destructive/10 text-xs shrink-0 gap-1.5"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Reset Selected Investment
                    </Button>
                  </div>
                </div>

                {/* Option 2: Reset All Investments */}
                <div className="pt-5 border-t border-border/60 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="space-y-1 max-w-xl">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-destructive flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Option 2: Reset All Investments
                      </h4>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Wipes all investments, contribution schedules, and investment transaction history. Bank accounts, personal chit fund, EMIs, and user credentials remain strictly preserved.
                      </p>
                    </div>

                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => setShowResetAllInvestmentsModal(true)}
                      className="text-xs shrink-0 gap-1.5 bg-destructive hover:bg-destructive/90"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Reset All Investments
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Chit Fund Management Section (Only when Chit Fund is enabled) */}
      {isChitFundEnabled && (
        <div className="pt-6 border-t border-border/80">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 shadow-sm border border-amber-500/20">
              <Coins className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-foreground">Chit Fund Management</h2>
              <p className="text-xs text-muted-foreground">
                Reset monthly winner assignments or wipe historical collections and payouts while preserving member registrations
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6">
            {/* Card 1: Reset Chit Winner (MUST BE FIRST) */}
            <Card className="border-border shadow-sm overflow-hidden">
              <CardHeader className="bg-muted/30 border-b border-border/60 pb-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base font-bold flex items-center gap-2">
                        <Trophy className="h-4 w-4 text-amber-500" />
                        Reset Chit Winner
                      </CardTitle>
                      <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500/30">
                        Winner Eligibility Control
                      </Badge>
                    </div>
                    <CardDescription className="text-xs mt-1">
                      Reset confirmed winners for individual months or all cycles. Restores member eligibility for future lot spins while protecting completed financial payouts.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-6 space-y-6">
                {/* Reset Winner for Selected Month */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                      Reset Winner for a Selected Month
                    </h4>
                    <span className="text-[11px] text-muted-foreground">
                      Click a month pill to inspect or reset its winner
                    </span>
                  </div>

                  {loadingCycles ? (
                    <p className="text-xs text-muted-foreground">Loading chit cycles...</p>
                  ) : (() => {
                    const winnerCycles = cycles.filter((c: any) => Boolean(c.winnerMemberId || c.winnerMemberName));
                    if (winnerCycles.length === 0) {
                      return (
                        <div className="p-4 rounded-xl border border-dashed border-border text-center text-xs text-muted-foreground">
                          No months currently have confirmed winners to reset.
                        </div>
                      );
                    }

                    const activeCyclePeriod = winnerCycles.some((c: any) => c.cyclePeriod === selectedCyclePeriod)
                      ? selectedCyclePeriod
                      : winnerCycles[0]?.cyclePeriod;
                    const currentSelectedCycle = winnerCycles.find((c: any) => c.cyclePeriod === activeCyclePeriod);

                    return (
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          {winnerCycles.map((c: any) => {
                            const isSelected = activeCyclePeriod === c.cyclePeriod;
                            return (
                              <button
                                key={c.cyclePeriod}
                                type="button"
                                onClick={() => setSelectedCyclePeriod(c.cyclePeriod)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all flex items-center gap-1.5 border ${isSelected
                                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
                                  }`}
                              >
                                <span>{formatCyclePill(c.cyclePeriod)}</span>
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-amber-400'
                                    }`}
                                />
                              </button>
                            );
                          })}
                        </div>

                        {currentSelectedCycle && (
                          <div className="p-4 rounded-xl border border-border bg-card/60 space-y-3">
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold text-foreground">
                                    Cycle {currentSelectedCycle.cyclePeriod} ({formatCyclePill(currentSelectedCycle.cyclePeriod)})
                                  </span>
                                  <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                                    Winner Confirmed
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Confirmed Winner:{' '}
                                  <strong className="text-foreground">
                                    {currentSelectedCycle.winnerMemberName || 'Member'}
                                  </strong>
                                </p>
                              </div>

                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                onClick={() => {
                                  setSelectedCyclePeriod(currentSelectedCycle.cyclePeriod);
                                  setShowResetCycleModal(true);
                                }}
                                className="text-xs gap-1.5 shrink-0"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                Reset Winner for {formatCyclePill(currentSelectedCycle.cyclePeriod)}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Option B: Reset All Chit Winner Assignments */}
                <div className="pt-5 border-t border-border/60 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="space-y-1 max-w-xl">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-destructive flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Reset All Chit Winner Assignments
                      </h4>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Clears confirmed winner assignments across all cycles in this chit fund. All members will become eligible for future spins again. Blocked if any completed payouts exist.
                      </p>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowResetAllWinnersModal(true)}
                      className="border-destructive/40 text-destructive hover:bg-destructive/10 text-xs shrink-0 gap-1.5"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Reset All Winners
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Card 2: Reset Chit Fund Data (MUST BE SECOND) */}
            <Card className="border-border shadow-sm overflow-hidden">
              <CardHeader className="bg-muted/30 border-b border-border/60 pb-4">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <Coins className="h-4 w-4 text-primary" />
                    Reset Chit Fund Data
                  </CardTitle>
                  <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/30">
                    Preserves Members &amp; Bank Balance
                  </Badge>
                </div>
                <CardDescription className="text-xs mt-1">
                  Completely wipes all historical chit collections, payouts, winner history, and derived chit balances while strictly preserving all members (standardized to ₹5,000/mo) and starting bank balances.
                </CardDescription>
              </CardHeader>

              <CardContent className="p-6 space-y-4">
                <div className="p-3.5 rounded-lg bg-muted/40 border border-border text-xs text-muted-foreground space-y-1.5">
                  <p className="font-semibold text-foreground flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-emerald-500" />
                    Strict Preservation Guarantee:
                  </p>
                  <p className="text-[11px] leading-relaxed">
                    All active chit members, member identities, and personal accounts are preserved intact. Legacy members are standardized to exactly 1 chit @ ₹5,000/month. The designated bank account's current balance is untouched. An audit snapshot is created prior to deletion.
                  </p>
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={fetchChitFundResetPreview}
                    disabled={loadingChitFundResetPreview}
                    className="gap-2 text-xs"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Preview &amp; Reset Chit Fund Data
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Lending & Borrowing Management Section (Only when Lending & Borrowing is enabled) */}
      {isLendingBorrowingEnabled && (
        <div className="pt-6 border-t border-border/80">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500 shadow-sm border border-blue-500/20">
              <HandCoins className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-foreground">Lending &amp; Borrowing Management</h2>
              <p className="text-xs text-muted-foreground">
                Manage and reset personal loan records and repayments while preserving bank accounts and updating balances
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6">
            <Card className="border-border shadow-sm overflow-hidden">
              <CardHeader className="bg-muted/30 border-b border-border/60 pb-4">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <HandCoins className="h-4 w-4 text-blue-500" />
                    Reset Lending &amp; Borrowing Data
                  </CardTitle>
                  <Badge variant="outline" className="text-[10px] text-blue-500 border-blue-500/30">
                    Recalculates Balances
                  </Badge>
                </div>
                <CardDescription className="text-xs mt-1">
                  Wipes all active and settled lending, borrowing, and repayment records while automatically updating affected bank account and cash balances.
                </CardDescription>
              </CardHeader>

              <CardContent className="p-6 space-y-4">
                <div className="p-3.5 rounded-lg bg-muted/40 border border-border text-xs text-muted-foreground space-y-1.5">
                  <p className="font-semibold text-foreground flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-emerald-500" />
                    Safe &amp; Isolated Balance Adjustment:
                  </p>
                  <p className="text-[11px] leading-relaxed">
                    All lending and borrowing entries and repayment logs belonging to you will be permanently cleared. Bank accounts and cash in hand remain active and their available balances will be recalculated to reflect the removal of these entries.
                  </p>
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setConfirmationPhraseLending('');
                      setShowResetLendingModal(true);
                    }}
                    className="gap-2 text-xs"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset Lending &amp; Borrowing Data
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* EMI Management Section (Only when EMI Management is enabled) */}
      {isEmiEnabled && (
        <div className="pt-6 border-t border-border/80">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-500 shadow-sm border border-purple-500/20">
              <Percent className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-foreground">EMI Management</h2>
              <p className="text-xs text-muted-foreground">
                Manage and reset active loan schedules, installment occurrences, and forecasts without altering other modules
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6">
            <Card className="border-border shadow-sm overflow-hidden">
              <CardHeader className="bg-muted/30 border-b border-border/60 pb-4">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <Percent className="h-4 w-4 text-purple-500" />
                    Reset EMI Data
                  </CardTitle>
                  <Badge variant="outline" className="text-[10px] text-purple-500 border-purple-500/30">
                    Safe &amp; Isolated
                  </Badge>
                </div>
                <CardDescription className="text-xs mt-1">
                  Wipes all EMI loan rules, installments, and schedule occurrences without altering unrelated chit funds or investments.
                </CardDescription>
              </CardHeader>

              <CardContent className="p-6 space-y-4">
                <div className="p-3.5 rounded-lg bg-muted/40 border border-border text-xs text-muted-foreground space-y-1.5">
                  <p className="font-semibold text-foreground flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-emerald-500" />
                    Isolated Loan Reset:
                  </p>
                  <p className="text-[11px] leading-relaxed">
                    Clears all active and completed EMI rules, monthly amortization records, and linked payment occurrences. Bank account and credit card balances will be reconciled, while chit funds, budgets, and investments remain untouched.
                  </p>
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setConfirmationPhraseEmi('');
                      setShowResetEmiModal(true);
                    }}
                    className="gap-2 text-xs"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset EMI Data
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Data Management Section (Always at the end of Settings) */}
      <div className="pt-6 border-t border-border/80">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive shadow-sm border border-destructive/20">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">Data Management</h2>
            <p className="text-xs text-muted-foreground">
              Wipe all financial records, manage account lifecycle, or selectively reset transaction activity
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6">
          {/* 1. Reset Selected Transactions & Entries */}
          <Card className="border-border shadow-sm overflow-hidden">
            <CardHeader className="bg-muted/30 border-b border-border/60 pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-bold">Reset Selected Transactions &amp; Entries</CardTitle>
                    <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500/30">
                      Preserves Setup &amp; Balances
                    </Badge>
                  </div>
                  <CardDescription className="text-xs mt-1">
                    Selectively remove personal financial transaction activity while retaining bank accounts, credit cards, chit members, opening balances, and recalculating remaining balances.
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs h-8"
                    onClick={handleSelectAllA}
                  >
                    Select All
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs h-8"
                    onClick={handleDeselectAllA}
                  >
                    Clear
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {AVAILABLE_TRANSACTION_TYPES.map((item) => {
                  const isChecked = selectedTypesA.has(item.id);
                  return (
                    <div
                      key={item.id}
                      onClick={() => toggleTypeA(item.id)}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${isChecked
                        ? 'border-primary/50 bg-primary/5 text-foreground'
                        : 'border-border/60 bg-card hover:bg-muted/40 text-muted-foreground'
                        }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => { }}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                      />
                      <div className="space-y-0.5">
                        <p className={`text-xs font-semibold ${isChecked ? 'text-foreground' : ''}`}>
                          {item.label}
                        </p>
                        <p className="text-[11px] text-muted-foreground leading-tight">
                          {item.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-3.5 rounded-lg bg-muted/40 border border-border text-xs text-muted-foreground space-y-1.5">
                <p className="font-semibold text-foreground flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                  Preserved Financial Setup:
                </p>
                <p className="text-[11px] leading-relaxed">
                  Bank accounts, masked account numbers, credit cards, chit-fund records, module preferences, registered credentials, and initial opening balances are <strong>never deleted</strong> by this reset. Remaining balances are authoritatively recomputed.
                </p>
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={selectedTypesA.size === 0}
                  onClick={() => setShowOptionAModal(true)}
                  className="gap-2 text-xs"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset Selected Entries ({selectedTypesA.size})
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 2. Reset All Financial Data */}
          <Card className="border-destructive/40 shadow-sm overflow-hidden bg-destructive/[0.02]">
            <CardHeader className="bg-destructive/10 border-b border-destructive/20 pb-4">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-bold text-destructive">Reset All Financial Data</CardTitle>
                <Badge variant="destructive" className="text-[10px]">
                  Complete Financial Wipe
                </Badge>
              </div>
              <CardDescription className="text-xs text-destructive/80 mt-1">
                Wipes all financial records, bank accounts, credit cards, chit members, transactions, and budgets. Your registered login account and system administrator status will be strictly preserved.
              </CardDescription>
            </CardHeader>

            <CardContent className="p-6 space-y-4">
              <div className="p-3.5 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs space-y-2">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>Permanent Action — Retains Login Account Only</span>
                </div>
                <p className="text-[11px] text-destructive/90 leading-relaxed">
                  This will completely clear your financial workspace so you can begin setup again from scratch. It wipes all accounts, credit cards, transactions, chit funds, and budgets belonging to you.
                </p>
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => setShowOptionBModal(true)}
                  className="gap-2 text-xs font-semibold bg-destructive hover:bg-destructive/90"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Reset All Financial Data
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 3. Delete Account Permanently (Immediately after Reset All Financial Data) */}
          <Card className="border-destructive/60 shadow-md overflow-hidden bg-destructive/[0.04] ring-1 ring-destructive/20">
            <CardHeader className="bg-destructive/15 border-b border-destructive/25 pb-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base font-bold text-destructive flex items-center gap-2">
                    <UserX className="h-4 w-4 text-destructive" />
                    Delete Account Permanently
                  </CardTitle>
                  <Badge variant="destructive" className="text-[10px] font-mono tracking-wider">
                    Irreversible • Account Removal
                  </Badge>
                </div>
              </div>
              <CardDescription className="text-xs text-destructive/90 mt-1">
                Permanently closes and erases your user account, login credentials, and all personal and financial data. Unlike resetting financial data, your account login and access will be completely terminated.
              </CardDescription>
            </CardHeader>

            <CardContent className="p-6 space-y-4">
              <div className="p-3.5 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs space-y-2">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>Difference from "Reset All Financial Data":</span>
                </div>
                <p className="text-[11px] text-destructive/90 leading-relaxed">
                  <strong>Reset All Financial Data</strong> wipes your financial ledger and entries while keeping your login account and credentials active.
                  <br />
                  <strong>Permanent Account Deletion</strong> completely deletes your login credentials, email address, password, session tokens, personal records, and all accounts from the system. You will be logged out and cannot log in again.
                </p>
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setConfirmationPhraseDeleteAccount('');
                    setDeleteAccountPassword('');
                    setShowDeleteAccountModal(true);
                  }}
                  className="gap-2 text-xs font-semibold bg-destructive hover:bg-destructive/90 text-white"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete My Account Permanently
                </Button>
              </div>
            </CardContent>
          </Card>


        </div>
      </div>

      {/* Reset Selected Transactions Confirmation Modal */}
      {showOptionAModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-card w-full max-w-md rounded-2xl border border-border shadow-2xl p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500 font-bold border border-amber-500/30">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">Confirm Selective Data Reset</h3>
                <p className="text-xs text-muted-foreground">Reset Selected Transactions &amp; Entries</p>
              </div>
            </div>

            <div className="space-y-2 text-xs text-muted-foreground">
              <p>
                You are about to delete <strong className="text-foreground">{selectedTypesA.size} categories</strong> of financial activity.
              </p>
              <div className="p-2.5 rounded bg-muted/50 border border-border text-[11px] space-y-1">
                <p className="font-semibold text-foreground">Selected to delete:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {Array.from(selectedTypesA).map((typeId) => (
                    <li key={typeId}>
                      {AVAILABLE_TRANSACTION_TYPES.find((t) => t.id === typeId)?.label || typeId}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-emerald-500 font-medium pt-1">
                ✓ Bank accounts, credit cards, chit members, and opening balances will be preserved.
              </p>
            </div>

            <div className="space-y-1.5 pt-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Type <span className="text-foreground font-mono font-bold select-all">RESET MY DATA</span> to confirm
              </label>
              <input
                type="text"
                value={confirmationPhraseA}
                onChange={(e) => setConfirmationPhraseA(e.target.value)}
                placeholder="RESET MY DATA"
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowOptionAModal(false);
                  setConfirmationPhraseA('');
                }}
                disabled={isResettingA}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleExecuteResetA}
                isLoading={isResettingA}
                disabled={confirmationPhraseA !== 'RESET MY DATA' || isResettingA}
                className="gap-2 text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Confirm Reset
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Option B Confirmation Modal */}
      {showOptionBModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-card w-full max-w-md rounded-2xl border border-destructive/40 shadow-2xl p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/15 text-destructive font-bold border border-destructive/30">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-destructive">Wipe All Financial Data</h3>
                <p className="text-xs text-muted-foreground">Option B: Start Financial Setup Again</p>
              </div>
            </div>

            <div className="space-y-2 text-xs text-muted-foreground">
              <p className="text-destructive font-medium">
                This will delete all your accounts, credit cards, chit fund records, transactions, and budgets.
              </p>
              <p className="text-foreground font-semibold">
                Your registered user account, email, password, and administrator role will NOT be deleted.
              </p>
            </div>

            <div className="space-y-3 pt-1">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Type <span className="text-destructive font-mono font-bold select-all">RESET MY DATA</span> to confirm
                </label>
                <input
                  type="text"
                  value={confirmationPhraseB}
                  onChange={(e) => setConfirmationPhraseB(e.target.value)}
                  placeholder="RESET MY DATA"
                  className="flex h-10 w-full rounded-lg border border-destructive/40 bg-background px-3 py-2 text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Account Password (Optional Re-authentication)
                </label>
                <input
                  type="password"
                  value={passwordB}
                  onChange={(e) => setPasswordB(e.target.value)}
                  placeholder="Enter current password"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowOptionBModal(false);
                  setConfirmationPhraseB('');
                  setPasswordB('');
                }}
                disabled={isResettingB}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleExecuteResetB}
                isLoading={isResettingB}
                disabled={confirmationPhraseB !== 'RESET MY DATA' || isResettingB}
                className="gap-2 text-xs bg-destructive hover:bg-destructive/90"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Permanently Wipe Data
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Chit Winner Month Reset Modal */}
      {showResetCycleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-card w-full max-w-md rounded-2xl border border-border shadow-2xl p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500 font-bold border border-amber-500/30">
                <RotateCcw className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">
                  Reset Winner for {formatCyclePill(selectedCyclePeriod)}
                </h3>
                <p className="text-xs text-muted-foreground">Cycle Period: {selectedCyclePeriod}</p>
              </div>
            </div>

            <div className="space-y-3 text-xs text-muted-foreground">
              {(() => {
                const c = cycles.find((x: any) => x.cyclePeriod === selectedCyclePeriod);
                return (
                  <div className="p-3 rounded-lg bg-muted/50 border border-border space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span>Confirmed Winner:</span>
                      <strong className="text-foreground">{c?.winnerMemberName || 'Member'}</strong>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Current Status:</span>
                      <span className="text-amber-400 capitalize">{c?.status || 'winner_selected'}</span>
                    </div>
                  </div>
                );
              })()}

              <p className="leading-relaxed">
                Resetting will clear the winner assignment for this monthly cycle and make the member eligible again for future lot selections (unless they have won in another cycle).
              </p>

              <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-400 space-y-1">
                <p className="font-semibold">Financial Safety Guard:</p>
                <p>
                  If a payout has already been completed for this cycle, the reset will be rejected to protect accounting records.
                </p>
              </div>

              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Reason for Reset (Optional)
                </label>
                <input
                  type="text"
                  value={resetReason}
                  onChange={(e) => setResetReason(e.target.value)}
                  placeholder="e.g. Winner unable to claim or test lot draw reset"
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowResetCycleModal(false);
                  setResetReason('');
                }}
                disabled={isResettingCycleWinner}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleResetCycleWinner}
                isLoading={isResettingCycleWinner}
                disabled={isResettingCycleWinner}
                className="gap-2 text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Confirm Reset Winner
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Chit Reset All Winners Modal (Option B) */}
      {showResetAllWinnersModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-card w-full max-w-md rounded-2xl border border-destructive/40 shadow-2xl p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/15 text-destructive font-bold border border-destructive/30">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-destructive">Reset All Chit Winners</h3>
                <p className="text-xs text-muted-foreground">Option B: Clear All Winner Assignments</p>
              </div>
            </div>

            <div className="space-y-2 text-xs text-muted-foreground">
              <p className="text-destructive font-medium">
                This will clear confirmed winner assignments across all cycles of this chit fund.
              </p>
              <p className="text-foreground leading-relaxed">
                All affected members will regain eligibility for upcoming lot spinner selections (unless they have historical pre-system wins recorded).
              </p>
              <div className="p-2.5 rounded bg-destructive/10 border border-destructive/30 text-[11px] text-destructive space-y-1">
                <p className="font-semibold">Safety Requirement:</p>
                <p>
                  If any completed payouts exist, this action is safely blocked to protect your financial integrity.
                </p>
              </div>
            </div>

            <div className="space-y-3 pt-1">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Type <span className="text-destructive font-mono font-bold select-all">RESET WINNERS</span> to confirm
                </label>
                <input
                  type="text"
                  value={confirmationPhraseWinners}
                  onChange={(e) => setConfirmationPhraseWinners(e.target.value)}
                  placeholder="RESET WINNERS"
                  className="flex h-10 w-full rounded-lg border border-destructive/40 bg-background px-3 py-2 text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Reason for Reset (Optional)
                </label>
                <input
                  type="text"
                  value={resetReason}
                  onChange={(e) => setResetReason(e.target.value)}
                  placeholder="e.g. Reinitializing annual chit fund cycle"
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowResetAllWinnersModal(false);
                  setConfirmationPhraseWinners('');
                  setResetReason('');
                }}
                disabled={isResettingAllWinners}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleResetAllWinners}
                isLoading={isResettingAllWinners}
                disabled={confirmationPhraseWinners !== 'RESET WINNERS' || isResettingAllWinners}
                className="gap-2 text-xs bg-destructive hover:bg-destructive/90"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Confirm Reset All Winners
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Chit Fund Financial Reset Modal */}
      {showChitFundResetModal && chitFundResetPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-card w-full max-w-lg rounded-2xl border border-destructive/40 shadow-2xl p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/15 text-destructive font-bold border border-destructive/30">
                <Coins className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-destructive">Reset Chit Fund Financial Data</h3>
                <p className="text-xs text-muted-foreground">Start chit fund fresh with preserved members</p>
              </div>
            </div>

            <div className="space-y-3 text-xs text-muted-foreground">
              <div className="p-3 rounded-lg bg-muted/50 border border-border space-y-2">
                <p className="font-semibold text-foreground">Records to be cleared:</p>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2 rounded bg-card border border-border/60">
                    <span className="text-muted-foreground">Collections:</span>
                    <strong className="block text-foreground text-sm font-mono">{chitFundResetPreview.collectionsCount}</strong>
                  </div>
                  <div className="p-2 rounded bg-card border border-border/60">
                    <span className="text-muted-foreground">Payouts:</span>
                    <strong className="block text-foreground text-sm font-mono">{chitFundResetPreview.payoutsCount}</strong>
                  </div>
                  <div className="p-2 rounded bg-card border border-border/60">
                    <span className="text-muted-foreground">Cycles Reset:</span>
                    <strong className="block text-foreground text-sm font-mono">{chitFundResetPreview.cyclesCount}</strong>
                  </div>
                  <div className="p-2 rounded bg-card border border-border/60">
                    <span className="text-muted-foreground">Ledger Entries:</span>
                    <strong className="block text-foreground text-sm font-mono">{chitFundResetPreview.ledgerEntriesCount}</strong>
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-400 space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                  Preserved Without Changes:
                </p>
                <p>
                  • <strong>{chitFundResetPreview.membersPreserved} Members</strong> preserved (each standardized to 1 chit @ ₹5,000/mo).
                </p>
                <p>
                  • Designated Bank Account:{' '}
                  <strong>
                    {chitFundResetPreview.designatedAccount
                      ? `${chitFundResetPreview.designatedAccount.accountName} (₹${chitFundResetPreview.designatedAccount.currentBalance.toLocaleString()} preserved)`
                      : 'None designated'}
                  </strong>
                </p>
                <p>• An audit snapshot ({chitFundResetPreview.backupSnapshotCollection}) will be saved before deletion.</p>
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Type <span className="text-destructive font-mono font-bold select-all">RESET CHIT FINANCIALS</span> to confirm
              </label>
              <input
                type="text"
                value={confirmationPhraseChitFund}
                onChange={(e) => setConfirmationPhraseChitFund(e.target.value)}
                placeholder="RESET CHIT FINANCIALS"
                className="flex h-10 w-full rounded-lg border border-destructive/40 bg-background px-3 py-2 text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowChitFundResetModal(false);
                  setConfirmationPhraseChitFund('');
                }}
                disabled={isResettingChitFund}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleExecuteResetChitFundFinancials}
                isLoading={isResettingChitFund}
                disabled={confirmationPhraseChitFund !== 'RESET CHIT FINANCIALS' || isResettingChitFund}
                className="gap-2 text-xs bg-destructive hover:bg-destructive/90"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Confirm Reset Chit Financials
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Single Investment Modal */}
      {showResetSingleInvestmentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-card w-full max-w-md rounded-2xl border border-destructive/40 shadow-2xl p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/15 text-destructive font-bold border border-destructive/30">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-destructive">Delete Selected Investment</h3>
                <p className="text-xs text-muted-foreground">Remove investment and associated schedule</p>
              </div>
            </div>

            <div className="space-y-3 text-xs text-muted-foreground">
              {(() => {
                const inv = investmentsList.find((i) => (i.id || i._id) === selectedInvestmentId);
                return (
                  <div className="p-3 rounded-lg bg-muted/50 border border-border space-y-1.5">
                    <p className="font-semibold text-foreground text-sm">{inv?.name || 'Selected Investment'}</p>
                    <p>Category: <strong className="text-foreground">{inv?.category}</strong></p>
                    <p>Total Contributed: <strong className="text-foreground font-mono">₹{(inv?.totalInvested || inv?.totalContributed || 0).toLocaleString()}</strong></p>
                  </div>
                );
              })()}
              <div className="p-2.5 rounded bg-destructive/10 border border-destructive/30 text-[11px] text-destructive">
                This will delete the investment, its entire monthly contribution schedule, and any linked transactions. Bank balances debited for past payments will be safely restored.
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowResetSingleInvestmentModal(false)}
                disabled={isResettingSingleInvestment}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleResetSingleInvestment}
                isLoading={isResettingSingleInvestment}
                disabled={isResettingSingleInvestment}
                className="gap-2 text-xs bg-destructive hover:bg-destructive/90"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Confirm Delete Investment
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Reset All Investments Modal */}
      {showResetAllInvestmentsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-card w-full max-w-lg rounded-2xl border border-destructive/40 shadow-2xl p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/15 text-destructive font-bold border border-destructive/30">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-destructive">Reset All Investments</h3>
                <p className="text-xs text-muted-foreground">Clear all investment portfolios and schedules</p>
              </div>
            </div>

            <div className="space-y-3 text-xs text-muted-foreground">
              <div className="p-3.5 rounded-lg bg-muted/50 border border-border space-y-2">
                <p className="font-semibold text-foreground">Action Summary:</p>
                <p>
                  • Deletes all {investmentsList.length} investments (stocks, mutual funds, gold, fixed deposits, external chits).
                </p>
                <p>• Cleans up all monthly contribution cycles and upcoming investment payment obligations.</p>
                <p>• Linked bank payments are reversed, safely restoring account balances.</p>
              </div>

              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-400 space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                  Preserved Without Changes:
                </p>
                <p>• Bank accounts, initial balances, and regular transactions remain intact.</p>
                <p>• EMI loans and Chit Fund modules remain completely unaffected.</p>
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Type <span className="text-destructive font-mono font-bold select-all">RESET INVESTMENTS</span> to confirm
              </label>
              <input
                type="text"
                value={confirmationPhraseInvestments}
                onChange={(e) => setConfirmationPhraseInvestments(e.target.value)}
                placeholder="RESET INVESTMENTS"
                className="flex h-10 w-full rounded-lg border border-destructive/40 bg-background px-3 py-2 text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
              >
              </input>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowResetAllInvestmentsModal(false);
                  setConfirmationPhraseInvestments('');
                }}
                disabled={isResettingAllInvestments}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleResetAllInvestments}
                isLoading={isResettingAllInvestments}
                disabled={confirmationPhraseInvestments !== 'RESET INVESTMENTS' || isResettingAllInvestments}
                className="gap-2 text-xs bg-destructive hover:bg-destructive/90"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Confirm Reset All Investments
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Permanently Confirmation Modal */}
      {showDeleteAccountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-card w-full max-w-md rounded-2xl border border-destructive/60 shadow-2xl p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/20 text-destructive font-bold border border-destructive/40">
                <UserX className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-destructive">Delete My Account Permanently</h3>
                <p className="text-xs text-muted-foreground">Irreversible Account Termination</p>
              </div>
            </div>

            <div className="space-y-3 text-xs text-muted-foreground">
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-[11px] text-destructive space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Warning: This action cannot be undone!
                </p>
                <p>
                  Your account ({user?.email}), credentials, session tokens, bank accounts, credit cards, transactions, chit funds, investments, and all personal records will be permanently purged from the database.
                </p>
              </div>
              <p className="text-foreground font-medium">
                Once deleted, you will not be able to log in or restore any historical data.
              </p>
            </div>

            <div className="space-y-3 pt-1">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Type <span className="text-destructive font-mono font-bold select-all">DELETE</span> to confirm
                </label>
                <input
                  type="text"
                  value={confirmationPhraseDeleteAccount}
                  onChange={(e) => setConfirmationPhraseDeleteAccount(e.target.value)}
                  placeholder="DELETE"
                  className="flex h-10 w-full rounded-lg border border-destructive/50 bg-background px-3 py-2 text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Account Password (Optional Re-authentication)
                </label>
                <input
                  type="password"
                  value={deleteAccountPassword}
                  onChange={(e) => setDeleteAccountPassword(e.target.value)}
                  placeholder="Enter current password"
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowDeleteAccountModal(false);
                  setConfirmationPhraseDeleteAccount('');
                  setDeleteAccountPassword('');
                }}
                disabled={isDeletingAccount}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleDeleteAccountPermanently}
                isLoading={isDeletingAccount}
                disabled={confirmationPhraseDeleteAccount !== 'DELETE' || isDeletingAccount}
                className="gap-2 text-xs bg-destructive hover:bg-destructive/90 text-white font-semibold"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete My Account Permanently (Irreversible)
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Lending & Borrowing Confirmation Modal */}
      {showResetLendingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-card w-full max-w-md rounded-2xl border border-destructive/40 shadow-2xl p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/15 text-destructive font-bold border border-destructive/30">
                <HandCoins className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-destructive">Reset Lending &amp; Borrowing Data</h3>
                <p className="text-xs text-muted-foreground">Clear all loans and repayments</p>
              </div>
            </div>

            <div className="space-y-2 text-xs text-muted-foreground">
              <p className="text-destructive font-medium">
                This will permanently delete all lending, borrowing, and repayment history for your account.
              </p>
              <p className="text-foreground">
                Bank account balances and cash-in-hand totals will be automatically recalculated to reflect the removal of these entries.
              </p>
            </div>

            <div className="space-y-1.5 pt-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Type <span className="text-destructive font-mono font-bold select-all">RESET LENDING DATA</span> to confirm
              </label>
              <input
                type="text"
                value={confirmationPhraseLending}
                onChange={(e) => setConfirmationPhraseLending(e.target.value)}
                placeholder="RESET LENDING DATA"
                className="flex h-10 w-full rounded-lg border border-destructive/40 bg-background px-3 py-2 text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowResetLendingModal(false);
                  setConfirmationPhraseLending('');
                }}
                disabled={isResettingLending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleExecuteResetLending}
                isLoading={isResettingLending}
                disabled={confirmationPhraseLending !== 'RESET LENDING DATA' || isResettingLending}
                className="gap-2 text-xs bg-destructive hover:bg-destructive/90"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Confirm Reset Lending Data
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Reset EMI Data Confirmation Modal */}
      {showResetEmiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-card w-full max-w-md rounded-2xl border border-destructive/40 shadow-2xl p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/15 text-destructive font-bold border border-destructive/30">
                <Percent className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-destructive">Reset EMI Management Data</h3>
                <p className="text-xs text-muted-foreground">Clear loan rules and installment schedules</p>
              </div>
            </div>

            <div className="space-y-2 text-xs text-muted-foreground">
              <p className="text-destructive font-medium">
                This will permanently delete all active and completed EMI loan rules, scheduled installments, and linked transactions.
              </p>
              <p className="text-foreground">
                Bank account and credit card balances will be reconciled, while chit funds and investments remain untouched.
              </p>
            </div>

            <div className="space-y-1.5 pt-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Type <span className="text-destructive font-mono font-bold select-all">RESET EMI DATA</span> to confirm
              </label>
              <input
                type="text"
                value={confirmationPhraseEmi}
                onChange={(e) => setConfirmationPhraseEmi(e.target.value)}
                placeholder="RESET EMI DATA"
                className="flex h-10 w-full rounded-lg border border-destructive/40 bg-background px-3 py-2 text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowResetEmiModal(false);
                  setConfirmationPhraseEmi('');
                }}
                disabled={isResettingEmi}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleExecuteResetEmi}
                isLoading={isResettingEmi}
                disabled={confirmationPhraseEmi !== 'RESET EMI DATA' || isResettingEmi}
                className="gap-2 text-xs bg-destructive hover:bg-destructive/90"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Confirm Reset EMI Data
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
