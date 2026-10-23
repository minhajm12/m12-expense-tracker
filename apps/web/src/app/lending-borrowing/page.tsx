'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/components/ui/toast';
import { DatePicker } from '@/components/ui/date-picker';
import {
  HandCoins,
  ArrowUpRight,
  ArrowDownLeft,
  Plus,
  RefreshCw,
  Search,
  Filter,
  Calendar,
  Wallet,
  CheckCircle2,
  Clock,
  Pencil,
  Trash2,
  ChevronRight,
  AlertCircle,
  Banknote,
  Eye,
  X,
} from 'lucide-react';
import {
  LendingBorrowing,
  LendingBorrowingType,
  LendingBorrowingStatus,
  LendingBorrowingSummary,
  LendingRepayment,
  BankAccount,
  formatCurrency,
  formatDateToInput,
} from '@finora/shared';
import { emitDataChange, useDataSync } from '@/lib/data-sync';

export default function LendingBorrowingPage() {
  const { user, isAuthenticated } = useAuth();
  const [records, setRecords] = useState<LendingBorrowing[]>([]);
  const [summary, setSummary] = useState<LendingBorrowingSummary | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // Tab & Filters
  const [activeTab, setActiveTab] = useState<'all' | 'lending' | 'borrowing'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'outstanding' | 'partially_settled' | 'settled'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showRepayModal, setShowRepayModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Selected Record
  const [selectedRecord, setSelectedRecord] = useState<LendingBorrowing | null>(null);

  // Add / Edit Form State
  const [formData, setFormData] = useState({
    type: LendingBorrowingType.LENDING,
    personName: '',
    phoneNumber: '',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    dueDate: '',
    paymentMethod: 'upi' as 'upi' | 'cash',
    bankAccountId: '',
    description: '',
    notes: '',
    isHistorical: false,
    initialSettledAmount: '',
  });

  // Repayment Form State
  const [repayData, setRepayData] = useState({
    amount: '',
    date: new Date().toISOString().split('T')[0],
    paymentMethod: 'upi' as 'upi' | 'cash',
    bankAccountId: '',
    notes: '',
    isHistorical: false,
  });

  const getApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  const fetchData = async () => {
    setLoading(true);
    try {
      const [recRes, sumRes, accRes] = await Promise.all([
        fetch(`${getApiUrl()}/api/v1/lending-borrowing?limit=100`, { credentials: 'include' }),
        fetch(`${getApiUrl()}/api/v1/lending-borrowing/summary`, { credentials: 'include' }),
        fetch(`${getApiUrl()}/api/v1/accounts`, { credentials: 'include' }),
      ]);

      const [recJson, sumJson, accJson] = await Promise.all([
        recRes.json(),
        sumRes.json(),
        accRes.json(),
      ]);

      if (recRes.ok && recJson.success) {
        setRecords(recJson.data || []);
      }
      if (sumRes.ok && sumJson.success) {
        setSummary(sumJson.data || null);
      }
      if (accRes.ok && accJson.success) {
        const activeAccs = (accJson.data || []).filter((a: BankAccount) => !a.isArchived);
        setAccounts(activeAccs);
        if (activeAccs.length > 0 && !formData.bankAccountId) {
          setFormData((prev) => ({ ...prev, bankAccountId: activeAccs[0].id }));
          setRepayData((prev) => ({ ...prev, bankAccountId: activeAccs[0].id }));
        }
      }
    } catch {
      toast.error('Network error loading lending & borrowing records');
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

  useDataSync(fetchData, ['lending', 'accounts', 'all']);

  // Filtered Records
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (activeTab === 'lending' && r.type !== LendingBorrowingType.LENDING) return false;
      if (activeTab === 'borrowing' && r.type !== LendingBorrowingType.BORROWING) return false;

      if (statusFilter !== 'all' && r.status !== statusFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = r.personName?.toLowerCase().includes(q);
        const matchDesc = r.description?.toLowerCase().includes(q);
        const matchNotes = r.notes?.toLowerCase().includes(q);
        const matchPhone = r.phoneNumber?.toLowerCase().includes(q);
        if (!matchName && !matchDesc && !matchNotes && !matchPhone) return false;
      }

      return true;
    });
  }, [records, activeTab, statusFilter, searchQuery]);

  // Form Submit: Create Record
  const handleCreateRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(formData.amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error('Please enter a valid positive amount');
      return;
    }

    if (!formData.isHistorical && formData.paymentMethod === 'upi' && !formData.bankAccountId) {
      toast.error('Please select a bank account for UPI payment');
      return;
    }

    const initialSettledNum = formData.initialSettledAmount ? parseFloat(formData.initialSettledAmount) : 0;
    if (initialSettledNum > amountNum) {
      toast.error('Already repaid amount cannot exceed principal amount');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/lending-borrowing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          type: formData.type,
          personName: formData.personName.trim(),
          phoneNumber: formData.phoneNumber.trim() || undefined,
          amount: amountNum,
          date: formData.date,
          dueDate: formData.dueDate || undefined,
          paymentMethod: formData.paymentMethod,
          bankAccountId: formData.paymentMethod === 'upi' ? formData.bankAccountId : undefined,
          description: formData.description.trim() || undefined,
          notes: formData.notes.trim() || undefined,
          isHistorical: formData.isHistorical,
          accountingMode: formData.isHistorical ? 'historical' : 'live',
          initialSettledAmount: formData.isHistorical && initialSettledNum > 0 ? initialSettledNum : undefined,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(
          formData.isHistorical
            ? `Past loan of ₹${amountNum.toLocaleString()} for ${formData.personName} recorded (no current balance impact)`
            : formData.type === LendingBorrowingType.LENDING
            ? `Lent ₹${amountNum.toLocaleString()} to ${formData.personName}`
            : `Borrowed ₹${amountNum.toLocaleString()} from ${formData.personName}`
        );
        setShowAddModal(false);
        resetFormData();
        fetchData();
        emitDataChange('lending');
        emitDataChange('accounts');
      } else {
        toast.error(json.error?.message || 'Failed to save record');
      }
    } catch {
      toast.error('Network error saving record');
    } finally {
      setSubmitting(false);
    }
  };

  // Form Submit: Update Record
  const handleUpdateRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecord) return;

    const amountNum = parseFloat(formData.amount);
    if (isNaN(amountNum) || amountNum < selectedRecord.settledAmount) {
      toast.error(`Principal cannot be less than settled amount (₹${selectedRecord.settledAmount.toLocaleString()})`);
      return;
    }

    if (!formData.isHistorical && formData.paymentMethod === 'upi' && !formData.bankAccountId) {
      toast.error('Please select a bank account for UPI payment');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/lending-borrowing/${selectedRecord.id || selectedRecord._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          personName: formData.personName.trim(),
          phoneNumber: formData.phoneNumber.trim() || undefined,
          amount: amountNum,
          date: formData.date,
          dueDate: formData.dueDate || undefined,
          paymentMethod: formData.paymentMethod,
          bankAccountId: formData.paymentMethod === 'upi' ? formData.bankAccountId : undefined,
          isHistorical: formData.isHistorical,
          accountingMode: formData.isHistorical ? 'historical' : 'live',
          description: formData.description.trim() || undefined,
          notes: formData.notes.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Record updated successfully');
        setShowEditModal(false);
        setSelectedRecord(json.data);
        fetchData();
        emitDataChange('lending');
        emitDataChange('accounts');
      } else {
        toast.error(json.error?.message || 'Failed to update record');
      }
    } catch {
      toast.error('Network error updating record');
    } finally {
      setSubmitting(false);
    }
  };

  // Record Repayment
  const handleRecordRepayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecord) return;

    const repayNum = parseFloat(repayData.amount);
    if (isNaN(repayNum) || repayNum <= 0) {
      toast.error('Please enter a valid positive repayment amount');
      return;
    }

    if (repayNum > selectedRecord.outstandingAmount) {
      toast.error(`Repayment cannot exceed outstanding balance (₹${selectedRecord.outstandingAmount.toLocaleString()})`);
      return;
    }

    if (!repayData.isHistorical && repayData.paymentMethod === 'upi' && !repayData.bankAccountId) {
      toast.error('Please select a bank account for UPI payment');
      return;
    }

    setSubmitting(true);
    try {
      const recordId = selectedRecord.id || selectedRecord._id;
      const res = await fetch(`${getApiUrl()}/api/v1/lending-borrowing/${recordId}/repayments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          amount: repayNum,
          date: repayData.date,
          paymentMethod: repayData.paymentMethod,
          bankAccountId: (!repayData.isHistorical && repayData.paymentMethod === 'upi') ? repayData.bankAccountId : undefined,
          notes: repayData.notes.trim() || undefined,
          isHistorical: repayData.isHistorical,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(
          repayData.isHistorical
            ? `Historical settlement of ₹${repayNum.toLocaleString()} recorded (no bank/cash balance impact)`
            : `Repayment of ₹${repayNum.toLocaleString()} recorded`
        );
        setShowRepayModal(false);
        setSelectedRecord(json.data);
        resetRepayData();
        fetchData();
        emitDataChange('lending');
        emitDataChange('accounts');
      } else {
        toast.error(json.error?.message || 'Failed to record repayment');
      }
    } catch {
      toast.error('Network error recording repayment');
    } finally {
      setSubmitting(false);
    }
  };

  // Delete Repayment
  const handleDeleteRepayment = async (repaymentId: string) => {
    if (!selectedRecord) return;
    if (!confirm('Are you sure you want to delete this repayment? The balance will automatically reverse.')) return;

    const recordId = selectedRecord.id || selectedRecord._id;
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/lending-borrowing/${recordId}/repayments/${repaymentId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Repayment deleted and balances recalculated');
        setSelectedRecord(json.data);
        fetchData();
        emitDataChange('lending');
        emitDataChange('accounts');
      } else {
        toast.error(json.error?.message || 'Failed to delete repayment');
      }
    } catch {
      toast.error('Network error deleting repayment');
    }
  };

  // Delete Record
  const handleDeleteRecord = async () => {
    if (!selectedRecord) return;
    const recordId = selectedRecord.id || selectedRecord._id;

    setSubmitting(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/lending-borrowing/${recordId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Record and associated disbursements reversed successfully');
        setShowDeleteConfirm(false);
        setShowDetailModal(false);
        setSelectedRecord(null);
        fetchData();
        emitDataChange('lending');
        emitDataChange('accounts');
      } else {
        toast.error(json.error?.message || 'Failed to delete record');
      }
    } catch {
      toast.error('Network error deleting record');
    } finally {
      setSubmitting(false);
    }
  };

  const resetFormData = () => {
    setFormData({
      type: LendingBorrowingType.LENDING,
      personName: '',
      phoneNumber: '',
      amount: '',
      date: new Date().toISOString().split('T')[0],
      dueDate: '',
      paymentMethod: 'upi',
      bankAccountId: accounts[0]?.id || '',
      description: '',
      notes: '',
      isHistorical: false,
      initialSettledAmount: '',
    });
  };

  const resetRepayData = () => {
    setRepayData({
      amount: '',
      date: new Date().toISOString().split('T')[0],
      paymentMethod: 'upi',
      bankAccountId: accounts[0]?.id || '',
      notes: '',
      isHistorical: false,
    });
  };

  const openEditModal = (rec: LendingBorrowing) => {
    setSelectedRecord(rec);
    setFormData({
      type: rec.type,
      personName: rec.personName,
      phoneNumber: rec.phoneNumber || '',
      amount: rec.amount.toString(),
      date: rec.date ? rec.date.split('T')[0] : '',
      dueDate: rec.dueDate ? rec.dueDate.split('T')[0] : '',
      paymentMethod: rec.paymentMethod,
      bankAccountId: rec.bankAccountId || accounts[0]?.id || '',
      description: rec.description || '',
      notes: rec.notes || '',
      isHistorical: Boolean(rec.isHistorical),
      initialSettledAmount: '',
    });
    setShowEditModal(true);
  };

  const openRepayModal = (rec: LendingBorrowing) => {
    setSelectedRecord(rec);
    setRepayData({
      amount: rec.outstandingAmount.toString(),
      date: new Date().toISOString().split('T')[0],
      paymentMethod: 'upi',
      bankAccountId: accounts[0]?.id || '',
      notes: '',
      isHistorical: false,
    });
    setShowRepayModal(true);
  };

  const openDetailModal = (rec: LendingBorrowing) => {
    setSelectedRecord(rec);
    setShowDetailModal(true);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Lending & Borrowing</h1>
            <Badge variant="default">{records.length} Records</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Track money lent to others and borrowed from others without polluting income/expense reports
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={fetchData} variant="outline" size="sm" className="gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            onClick={() => {
              resetFormData();
              setShowAddModal(true);
            }}
            size="sm"
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Record
          </Button>
        </div>
      </div>

      {/* Summary Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Lending Overview Card */}
        <Card className="border-border bg-card shadow-sm">
          <CardHeader className="pb-3 border-b border-border/60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                  <ArrowUpRight className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-bold">Money Lent (Receivables)</CardTitle>
                  <CardDescription className="text-xs">Assets you are owed by other people</CardDescription>
                </div>
              </div>
              <Badge variant="outline" className="font-mono text-xs">Asset</Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Total Lent</p>
                <p className="text-lg font-bold font-mono mt-0.5">
                  {formatCurrency(summary?.totalLent ?? 0, user?.currency || 'INR')}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Received Back</p>
                <p className="text-lg font-bold font-mono mt-0.5 text-foreground/80">
                  {formatCurrency(summary?.lentReceivedBack ?? 0, user?.currency || 'INR')}
                </p>
              </div>
              <div className="p-2.5 rounded-lg bg-primary/5 border border-primary/20">
                <p className="text-[11px] uppercase tracking-wider text-primary font-semibold">Outstanding</p>
                <p className="text-lg font-bold font-mono mt-0.5 text-primary">
                  {formatCurrency(summary?.outstandingLending ?? 0, user?.currency || 'INR')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Borrowing Overview Card */}
        <Card className="border-border bg-card shadow-sm">
          <CardHeader className="pb-3 border-b border-border/60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive/10 text-destructive border border-destructive/20">
                  <ArrowDownLeft className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-bold">Money Borrowed (Payables)</CardTitle>
                  <CardDescription className="text-xs">Liabilities you owe to other people</CardDescription>
                </div>
              </div>
              <Badge variant="outline" className="font-mono text-xs text-destructive border-destructive/30">Liability</Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Total Borrowed</p>
                <p className="text-lg font-bold font-mono mt-0.5">
                  {formatCurrency(summary?.totalBorrowed ?? 0, user?.currency || 'INR')}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Repaid</p>
                <p className="text-lg font-bold font-mono mt-0.5 text-foreground/80">
                  {formatCurrency(summary?.borrowedRepaid ?? 0, user?.currency || 'INR')}
                </p>
              </div>
              <div className="p-2.5 rounded-lg bg-destructive/5 border border-destructive/20">
                <p className="text-[11px] uppercase tracking-wider text-destructive font-semibold">Outstanding</p>
                <p className="text-lg font-bold font-mono mt-0.5 text-destructive">
                  {formatCurrency(summary?.outstandingBorrowing ?? 0, user?.currency || 'INR')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Segmented Controls, Search, and Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Type Tabs */}
        <div className="flex items-center p-1 rounded-xl bg-muted/60 border border-border shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'all'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            All Records ({records.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('lending')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'lending'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Lending (Lent)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('borrowing')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'borrowing'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Borrowing (Borrowed)
          </button>
        </div>

        {/* Search & Status Filter */}
        <div className="flex items-center gap-2 flex-1 sm:max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search person, purpose, phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-input bg-background text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="h-8 px-2.5 rounded-lg border border-input bg-background text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All Statuses</option>
            <option value="outstanding">Outstanding</option>
            <option value="partially_settled">Partially Settled</option>
            <option value="settled">Settled</option>
          </select>
        </div>
      </div>

      {/* Records List / Table */}
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : filteredRecords.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          title="No records found"
          description={
            searchQuery || statusFilter !== 'all' || activeTab !== 'all'
              ? 'Try adjusting your search query or filters to find what you are looking for.'
              : 'Keep track of every rupee you lend or borrow without mixing them into income or expenses.'
          }
          actionLabel="Add First Record"
          onAction={() => {
            resetFormData();
            setShowAddModal(true);
          }}
        />
      ) : (
        <div className="space-y-3">
          {filteredRecords.map((r) => {
            const isLend = r.type === LendingBorrowingType.LENDING;
            const isSettled = r.status === LendingBorrowingStatus.SETTLED;
            const isPartial = r.status === LendingBorrowingStatus.PARTIALLY_SETTLED;

            return (
              <Card
                key={r.id || r._id}
                className="hover:border-primary/40 transition-all cursor-pointer overflow-hidden border-border bg-card"
                onClick={() => openDetailModal(r)}
              >
                <div className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  {/* Left: Info */}
                  <div className="flex items-start sm:items-center gap-3.5">
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${
                        isLend
                          ? 'bg-primary/10 text-primary border-primary/20'
                          : 'bg-destructive/10 text-destructive border-destructive/20'
                      }`}
                    >
                      {isLend ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownLeft className="h-5 w-5" />}
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-base text-foreground">{r.personName}</span>
                        <Badge
                          variant={isSettled ? 'outline' : isPartial ? 'default' : 'secondary'}
                          className={`text-[10px] uppercase font-mono ${
                            isSettled
                              ? 'border-emerald-500/40 text-emerald-500 bg-emerald-500/10'
                              : isPartial
                              ? 'bg-amber-500/10 text-amber-500 border-amber-500/40'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {r.status.replace('_', ' ')}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground">
                          {isLend ? 'Lent' : 'Borrowed'}
                        </Badge>
                        {r.isHistorical && (
                          <Badge variant="outline" className="text-[10px] font-medium border-amber-500/40 text-amber-400 bg-amber-500/10">
                            Past Lending
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(r.date).toLocaleDateString()}
                        </span>
                        {r.dueDate && (
                          <span className="flex items-center gap-1 font-mono">
                            <Clock className="h-3 w-3" />
                            Due: {new Date(r.dueDate).toLocaleDateString()}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          {r.paymentMethod === 'upi' ? (
                            <>
                              <Wallet className="h-3 w-3" />
                              UPI ({r.isHistorical ? 'Pre-tracking' : r.bankAccountName || 'Bank'})
                            </>
                          ) : (
                            <>
                              <Banknote className="h-3 w-3" />
                              Cash in Hand
                            </>
                          )}
                        </span>
                        {r.description && <span className="italic truncate max-w-xs">{r.description}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Right: Amounts & Actions */}
                  <div className="flex items-center justify-between sm:justify-end gap-5">
                    <div className="text-right">
                      <p className="text-sm font-semibold font-mono text-muted-foreground line-through-if-settled">
                        Principal: {formatCurrency(r.amount, user?.currency || 'INR')}
                      </p>
                      <p
                        className={`text-lg font-bold font-mono ${
                          isSettled ? 'text-muted-foreground' : isLend ? 'text-primary' : 'text-destructive'
                        }`}
                      >
                        {formatCurrency(r.outstandingAmount, user?.currency || 'INR')}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {isSettled ? 'Fully Settled' : `Outstanding (${formatCurrency(r.settledAmount, user?.currency || 'INR')} repaid)`}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      {!isSettled && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openRepayModal(r)}
                          className="h-8 px-2.5 text-xs gap-1.5"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                          Repay
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditModal(r)}
                        className="h-8 w-8 p-0"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setSelectedRecord(r);
                          setShowDeleteConfirm(true);
                        }}
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add Record Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <Card className="w-full max-w-lg shadow-2xl border-border animate-in zoom-in-95 max-h-[90vh] flex flex-col">
            <CardHeader className="border-b border-border pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Record Lending or Borrowing</CardTitle>
                  <CardDescription className="text-xs">
                    Disbursements affect bank or physical cash balances directly without counting as income or expense.
                  </CardDescription>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Lend vs Borrow Segmented Switch */}
              <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-muted/60 mt-3 border border-border">
                <button
                  type="button"
                  onClick={() => setFormData((prev) => ({ ...prev, type: LendingBorrowingType.LENDING }))}
                  className={`py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    formData.type === LendingBorrowingType.LENDING
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <ArrowUpRight className="h-3.5 w-3.5 text-primary" />
                  I Lent Money (Gave out)
                </button>
                <button
                  type="button"
                  onClick={() => setFormData((prev) => ({ ...prev, type: LendingBorrowingType.BORROWING }))}
                  className={`py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    formData.type === LendingBorrowingType.BORROWING
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <ArrowDownLeft className="h-3.5 w-3.5 text-destructive" />
                  I Borrowed Money (Received)
                </button>
              </div>
            </CardHeader>

            <form onSubmit={handleCreateRecord} className="overflow-y-auto flex-1">
              <CardContent className="space-y-4 pt-4">
                {/* Past Lending Switch (Only for Lending) */}
                {formData.type === LendingBorrowingType.LENDING && (
                  <div className="p-3.5 rounded-xl border border-border bg-muted/30 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5 pr-2">
                        <label className="text-xs font-bold text-foreground cursor-pointer flex items-center gap-1.5" htmlFor="past-lending-toggle">
                          <span>Past Lending — Record an Existing Loan</span>
                          <Badge variant="outline" className="text-[10px] font-medium border-primary/30 text-primary bg-primary/5">
                            Pre-tracking
                          </Badge>
                        </label>
                        <p className="text-[11px] text-muted-foreground">
                          This loan was made before tracking began. Saving it will not change your current bank or personal cash balance.
                        </p>
                      </div>
                      <input
                        id="past-lending-toggle"
                        type="checkbox"
                        checked={formData.isHistorical}
                        onChange={(e) => setFormData((prev) => ({ ...prev, isHistorical: e.target.checked }))}
                        className="h-4 w-4 rounded border-input text-primary focus:ring-primary cursor-pointer shrink-0"
                      />
                    </div>

                    {formData.isHistorical && (
                      <div className="pt-2 border-t border-border/60 space-y-2 animate-in fade-in">
                        <div className="space-y-1">
                          <label className="text-[11px] font-semibold text-muted-foreground">
                            Already Repaid / Settled Amount (Optional, ₹)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={formData.initialSettledAmount}
                            onChange={(e) => setFormData((prev) => ({ ...prev, initialSettledAmount: e.target.value }))}
                            className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-bold"
                          />
                          <p className="text-[10px] text-muted-foreground">
                            {(() => {
                              const total = parseFloat(formData.amount) || 0;
                              const repaid = parseFloat(formData.initialSettledAmount) || 0;
                              const rem = Math.max(0, total - repaid);
                              return `Current outstanding to be collected: ₹${rem.toLocaleString()}`;
                            })()}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Person Name *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Rahul Sharma"
                      required
                      value={formData.personName}
                      onChange={(e) => setFormData((prev) => ({ ...prev, personName: e.target.value }))}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Phone / Reference (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. +91 9876543210"
                      value={formData.phoneNumber}
                      onChange={(e) => setFormData((prev) => ({ ...prev, phoneNumber: e.target.value }))}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {formData.isHistorical ? 'Original Loan Amount (₹) *' : `Principal Amount (${user?.currency || 'INR'} ₹) *`}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      placeholder="0.00"
                      value={formData.amount}
                      onChange={(e) => setFormData((prev) => ({ ...prev, amount: e.target.value }))}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {formData.isHistorical ? 'Date Originally Lent *' : 'Transaction Date *'}
                    </label>
                    <DatePicker
                      value={formData.date}
                      onChange={(d) => setFormData((prev) => ({ ...prev, date: d }))}
                    />
                  </div>
                </div>

                {/* Payment Method */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Payment Method *
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, paymentMethod: 'upi' }))}
                      className={`py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                        formData.paymentMethod === 'upi'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-background text-muted-foreground'
                      }`}
                    >
                      <Wallet className="h-4 w-4" />
                      UPI / Bank Transfer
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, paymentMethod: 'cash' }))}
                      className={`py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                        formData.paymentMethod === 'cash'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-background text-muted-foreground'
                      }`}
                    >
                      <Banknote className="h-4 w-4" />
                      Cash in Hand
                    </button>
                  </div>
                </div>

                {/* Bank Account Selection (for UPI) */}
                {formData.paymentMethod === 'upi' && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Bank Account {formData.isHistorical ? '(Recorded for Reference)' : '*'}
                    </label>
                    <select
                      required={!formData.isHistorical}
                      value={formData.bankAccountId}
                      onChange={(e) => setFormData((prev) => ({ ...prev, bankAccountId: e.target.value }))}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {accounts.length === 0 ? (
                        <option value="">No bank accounts available</option>
                      ) : (
                        accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.accountName} ({a.bankName}) - Balance: {formatCurrency(a.currentBalance, user?.currency || 'INR')}
                          </option>
                        ))
                      )}
                    </select>
                    <p className="text-[11px] text-muted-foreground">
                      {formData.isHistorical
                        ? 'Past loan reference — funding bank account is recorded without debiting your current balance.'
                        : formData.type === LendingBorrowingType.LENDING
                        ? 'This bank account balance will decrease by the principal amount.'
                        : 'This bank account balance will increase by the principal amount.'}
                    </p>
                  </div>
                )}

                {/* Optional Due Date */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Expected Due Date (Optional)
                  </label>
                  <DatePicker
                    value={formData.dueDate}
                    onChange={(d) => setFormData((prev) => ({ ...prev, dueDate: d }))}
                  />
                </div>

                {/* Purpose / Description */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Purpose / Description (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Travel emergency, project advance, friendly loan"
                    value={formData.description}
                    onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                {/* Notes */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Notes (Optional)
                  </label>
                  <textarea
                    placeholder="Any specific terms, reminders, or references..."
                    value={formData.notes}
                    onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
                    className="flex min-h-[60px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </CardContent>

              <CardFooter className="flex justify-end gap-2 border-t border-border pt-4 bg-muted/20">
                <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" isLoading={submitting}>
                  Save Record
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      {/* Edit Record Modal */}
      {showEditModal && selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <Card className="w-full max-w-lg shadow-2xl border-border animate-in zoom-in-95 max-h-[90vh] flex flex-col">
            <CardHeader className="border-b border-border pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Edit Record</CardTitle>
                  <CardDescription className="text-xs">
                    Update information or principal amount. If changed, balances will recalculate cleanly.
                  </CardDescription>
                </div>
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </CardHeader>

            <form onSubmit={handleUpdateRecord} className="overflow-y-auto flex-1">
              <CardContent className="space-y-4 pt-4">
                {/* Past Lending Switch (Only for Lending) */}
                {selectedRecord.type === LendingBorrowingType.LENDING && (
                  <div className="p-3.5 rounded-xl border border-border bg-muted/30 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5 pr-2">
                        <label className="text-xs font-bold text-foreground cursor-pointer flex items-center gap-1.5" htmlFor="edit-past-lending-toggle">
                          <span>Past Lending — Existing Loan</span>
                          <Badge variant="outline" className="text-[10px] font-medium border-primary/30 text-primary bg-primary/5">
                            Pre-tracking
                          </Badge>
                        </label>
                        <p className="text-[11px] text-muted-foreground">
                          {formData.isHistorical
                            ? 'Marked as a past loan. It does not debit your current bank or cash balance.'
                            : 'Live loan. Debits your bank or cash balance.'}
                        </p>
                      </div>
                      <input
                        id="edit-past-lending-toggle"
                        type="checkbox"
                        checked={formData.isHistorical}
                        onChange={(e) => setFormData((prev) => ({ ...prev, isHistorical: e.target.checked }))}
                        className="h-4 w-4 rounded border-input text-primary focus:ring-primary cursor-pointer shrink-0"
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Person Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.personName}
                      onChange={(e) => setFormData((prev) => ({ ...prev, personName: e.target.value }))}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Phone / Reference
                    </label>
                    <input
                      type="text"
                      value={formData.phoneNumber}
                      onChange={(e) => setFormData((prev) => ({ ...prev, phoneNumber: e.target.value }))}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Principal Amount ({user?.currency || 'INR'} ₹) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min={selectedRecord.settledAmount || 0.01}
                      required
                      value={formData.amount}
                      onChange={(e) => setFormData((prev) => ({ ...prev, amount: e.target.value }))}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono"
                    />
                    {selectedRecord.settledAmount > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        Minimum allowed: ₹{selectedRecord.settledAmount.toLocaleString()} (already settled)
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Transaction Date *
                    </label>
                    <DatePicker
                      value={formData.date}
                      onChange={(d) => setFormData((prev) => ({ ...prev, date: d }))}
                    />
                  </div>
                </div>

                {/* Payment Method Selection */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Payment Method *
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, paymentMethod: 'upi' }))}
                      className={`py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                        formData.paymentMethod === 'upi'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-background text-muted-foreground'
                      }`}
                    >
                      <ArrowUpRight className="h-4 w-4" />
                      UPI / Bank Transfer
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, paymentMethod: 'cash' }))}
                      className={`py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                        formData.paymentMethod === 'cash'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-background text-muted-foreground'
                      }`}
                    >
                      <Banknote className="h-4 w-4" />
                      Cash in Hand
                    </button>
                  </div>
                </div>

                {/* Bank Account Selection (for UPI) */}
                {formData.paymentMethod === 'upi' && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Bank Account {formData.isHistorical ? '(Recorded for Reference)' : '*'}
                    </label>
                    <select
                      required={!formData.isHistorical}
                      value={formData.bankAccountId}
                      onChange={(e) => setFormData((prev) => ({ ...prev, bankAccountId: e.target.value }))}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {accounts.length === 0 ? (
                        <option value="">No bank accounts available</option>
                      ) : (
                        accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.accountName} ({a.bankName}) - Balance: {formatCurrency(a.currentBalance, user?.currency || 'INR')}
                          </option>
                        ))
                      )}
                    </select>
                    <p className="text-[11px] text-muted-foreground">
                      {formData.isHistorical
                        ? 'Past loan reference — funding bank account is recorded without debiting your current balance.'
                        : selectedRecord.type === LendingBorrowingType.LENDING
                        ? 'This bank account balance will decrease by the principal amount.'
                        : 'This bank account balance will increase by the principal amount.'}
                    </p>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Expected Due Date
                  </label>
                  <DatePicker
                    value={formData.dueDate}
                    onChange={(d) => setFormData((prev) => ({ ...prev, dueDate: d }))}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Purpose / Description
                  </label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
                    className="flex min-h-[60px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </CardContent>

              <CardFooter className="flex justify-end gap-2 border-t border-border pt-4 bg-muted/20">
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

      {/* Record Repayment Modal */}
      {showRepayModal && selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <Card className="w-full max-w-md shadow-2xl border-border animate-in zoom-in-95">
            <CardHeader className="border-b border-border pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>
                    {selectedRecord.type === LendingBorrowingType.LENDING
                      ? `Record Receipt from ${selectedRecord.personName}`
                      : `Repay ${selectedRecord.personName}`}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Outstanding balance:{' '}
                    <strong className="text-foreground font-mono">
                      {formatCurrency(selectedRecord.outstandingAmount, user?.currency || 'INR')}
                    </strong>
                  </CardDescription>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRepayModal(false)}
                  className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </CardHeader>

            <form onSubmit={handleRecordRepayment}>
              <CardContent className="space-y-4 pt-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Repayment Amount ({user?.currency || 'INR'} ₹) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={selectedRecord.outstandingAmount}
                    required
                    value={repayData.amount}
                    onChange={(e) => setRepayData((prev) => ({ ...prev, amount: e.target.value }))}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono"
                  />
                  <div className="flex justify-between items-center text-[11px] text-muted-foreground">
                    <span>Max: ₹{selectedRecord.outstandingAmount.toLocaleString()}</span>
                    <button
                      type="button"
                      onClick={() => setRepayData((prev) => ({ ...prev, amount: selectedRecord.outstandingAmount.toString() }))}
                      className="text-primary hover:underline font-semibold"
                    >
                      Fill Full Balance
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Payment Date *
                  </label>
                  <DatePicker
                    value={repayData.date}
                    onChange={(d) => setRepayData((prev) => ({ ...prev, date: d }))}
                  />
                </div>

                {/* Historical Settlement Toggle */}
                <div className="p-3 rounded-xl border border-border bg-muted/30 space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5 pr-2">
                      <label className="text-xs font-bold text-foreground cursor-pointer flex items-center gap-1.5" htmlFor="past-repay-toggle">
                        <span>Past Settlement / Historical Repayment</span>
                      </label>
                      <p className="text-[11px] text-muted-foreground">
                        Check this if this repayment happened before you started tracking. It reduces outstanding balance without touching current bank or cash balances.
                      </p>
                    </div>
                    <input
                      id="past-repay-toggle"
                      type="checkbox"
                      checked={repayData.isHistorical}
                      onChange={(e) => setRepayData((prev) => ({ ...prev, isHistorical: e.target.checked }))}
                      className="h-4 w-4 rounded border-input text-primary focus:ring-primary cursor-pointer shrink-0"
                    />
                  </div>
                </div>

                {/* Repayment Method */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Method *
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRepayData((prev) => ({ ...prev, paymentMethod: 'upi' }))}
                      className={`py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                        repayData.paymentMethod === 'upi'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-background text-muted-foreground'
                      }`}
                    >
                      <Wallet className="h-4 w-4" />
                      UPI / Bank
                    </button>
                    <button
                      type="button"
                      onClick={() => setRepayData((prev) => ({ ...prev, paymentMethod: 'cash' }))}
                      className={`py-2 px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                        repayData.paymentMethod === 'cash'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-background text-muted-foreground'
                      }`}
                    >
                      <Banknote className="h-4 w-4" />
                      Cash in Hand
                    </button>
                  </div>
                </div>

                {/* Bank Account Selection for live UPI */}
                {repayData.paymentMethod === 'upi' && !repayData.isHistorical && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Destination / Source Account *
                    </label>
                    <select
                      required
                      value={repayData.bankAccountId}
                      onChange={(e) => setRepayData((prev) => ({ ...prev, bankAccountId: e.target.value }))}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.accountName} ({a.bankName})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Notes (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Part 1 of 2, via GPay"
                    value={repayData.notes}
                    onChange={(e) => setRepayData((prev) => ({ ...prev, notes: e.target.value }))}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </CardContent>

              <CardFooter className="flex justify-end gap-2 border-t border-border pt-4 bg-muted/20">
                <Button type="button" variant="outline" onClick={() => setShowRepayModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" isLoading={submitting}>
                  Submit Repayment
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      {/* Details & Repayment Trail Modal */}
      {showDetailModal && selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <Card className="w-full max-w-xl shadow-2xl border-border animate-in zoom-in-95 max-h-[90vh] flex flex-col">
            <CardHeader className="border-b border-border pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                      selectedRecord.type === LendingBorrowingType.LENDING
                        ? 'bg-primary/10 text-primary border-primary/20'
                        : 'bg-destructive/10 text-destructive border-destructive/20'
                    }`}
                  >
                    {selectedRecord.type === LendingBorrowingType.LENDING ? (
                      <ArrowUpRight className="h-5 w-5" />
                    ) : (
                      <ArrowDownLeft className="h-5 w-5" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg">{selectedRecord.personName}</CardTitle>
                      {selectedRecord.isHistorical && (
                        <Badge variant="outline" className="text-[10px] font-medium border-amber-500/40 text-amber-400 bg-amber-500/10">
                          Past Lending (Pre-tracking)
                        </Badge>
                      )}
                    </div>
                    <CardDescription className="text-xs">
                      {selectedRecord.type === LendingBorrowingType.LENDING
                        ? 'Money Lent (Asset Receivable)'
                        : 'Money Borrowed (Liability Payable)'}
                    </CardDescription>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDetailModal(false)}
                  className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </CardHeader>

            <CardContent className="space-y-5 pt-4 overflow-y-auto flex-1">
              {/* Financial Snapshot */}
              <div className="grid grid-cols-3 gap-3 p-3.5 rounded-xl bg-muted/30 border border-border text-center">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Principal</p>
                  <p className="text-base font-bold font-mono mt-0.5">
                    {formatCurrency(selectedRecord.amount, user?.currency || 'INR')}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Settled</p>
                  <p className="text-base font-bold font-mono mt-0.5 text-foreground/80">
                    {formatCurrency(selectedRecord.settledAmount, user?.currency || 'INR')}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-primary font-semibold">Outstanding</p>
                  <p className="text-base font-bold font-mono mt-0.5 text-primary">
                    {formatCurrency(selectedRecord.outstandingAmount, user?.currency || 'INR')}
                  </p>
                </div>
              </div>

              {/* Attributes Details */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground block">Disbursement Method:</span>
                  <span className="font-semibold text-foreground">
                    {selectedRecord.paymentMethod === 'upi'
                      ? selectedRecord.bankAccountName
                        ? `UPI (${selectedRecord.bankAccountName})${selectedRecord.isHistorical ? ' — Past Loan' : ''}`
                        : selectedRecord.isHistorical
                        ? 'UPI (Past Loan)'
                        : 'UPI (Bank Account)'
                      : selectedRecord.isHistorical
                      ? 'Cash (Past Loan)'
                      : 'Cash in Hand'}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Transaction Date:</span>
                  <span className="font-semibold text-foreground font-mono">
                    {new Date(selectedRecord.date).toLocaleDateString()}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Due Date:</span>
                  <span className="font-semibold text-foreground font-mono">
                    {selectedRecord.dueDate ? new Date(selectedRecord.dueDate).toLocaleDateString() : 'None set'}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Contact Phone:</span>
                  <span className="font-semibold text-foreground font-mono">
                    {selectedRecord.phoneNumber || 'None'}
                  </span>
                </div>
              </div>

              {selectedRecord.description && (
                <div className="text-xs p-2.5 rounded-lg bg-card border border-border">
                  <span className="text-muted-foreground block mb-0.5 font-semibold">Description / Purpose:</span>
                  <span>{selectedRecord.description}</span>
                </div>
              )}

              {/* Repayments Trail */}
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Repayment Trail ({selectedRecord.repayments?.length || 0})
                  </h4>
                  {selectedRecord.status !== LendingBorrowingStatus.SETTLED && (
                    <Button
                      size="sm"
                      onClick={() => openRepayModal(selectedRecord)}
                      className="h-7 text-xs gap-1"
                    >
                      <Plus className="h-3 w-3" />
                      Add Repayment
                    </Button>
                  )}
                </div>

                {!selectedRecord.repayments || selectedRecord.repayments.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-3 text-center italic bg-muted/20 rounded-lg">
                    No repayments recorded yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {selectedRecord.repayments.map((rep) => (
                      <div
                        key={rep.id || rep._id}
                        className="flex items-center justify-between p-2.5 rounded-lg bg-card border border-border text-xs"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold font-mono text-foreground">
                              {formatCurrency(rep.amount, user?.currency || 'INR')}
                            </span>
                            <Badge variant="outline" className="text-[10px] font-mono">
                              {rep.paymentMethod === 'upi' ? `UPI (${rep.bankAccountName || 'Bank'})` : 'Personal Cash'}
                            </Badge>
                            {rep.isHistorical && (
                              <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-400 bg-amber-500/10 px-1.5 py-0 font-medium">
                                Historical
                              </Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            {new Date(rep.date).toLocaleDateString()}
                            {rep.notes ? ` • ${rep.notes}` : ''}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteRepayment((rep.id || rep._id)!)}
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          title="Delete Repayment"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>

            <CardFooter className="flex justify-between border-t border-border pt-4 bg-muted/20">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setShowDeleteConfirm(true)}
                className="gap-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Record
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => openEditModal(selectedRecord)}
                  className="gap-1.5"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowDetailModal(false)}>
                  Close
                </Button>
              </div>
            </CardFooter>
          </Card>
        </div>
      )}

      {/* Delete Record Confirmation Dialog */}
      {showDeleteConfirm && selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in">
          <Card className="w-full max-w-md shadow-2xl border-destructive/40 animate-in zoom-in-95">
            <CardHeader>
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <CardTitle className="text-lg">Delete Record?</CardTitle>
              </div>
              <CardDescription className="text-xs text-muted-foreground pt-1">
                Are you sure you want to delete this record for <strong>{selectedRecord.personName}</strong>?
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              {selectedRecord.isHistorical ? (
                <p>
                  This is a <strong>past loan</strong>. Deleting it will not alter your current bank accounts or Cash in Hand for the principal amount (since it was never debited). Any live repayments will be safely reversed.
                </p>
              ) : (
                <p>
                  Deleting this record will automatically and cleanly reverse all associated disbursements and live repayments from your bank balance and Cash in Hand.
                </p>
              )}
            </CardContent>
            <CardFooter className="flex justify-end gap-2 border-t border-border pt-4">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleDeleteRecord}
                isLoading={submitting}
              >
                Yes, Delete & Reverse
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
    </div>
  );
}
