'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { DatePicker } from '@/components/ui/date-picker';
import { MonthYearPicker } from '@/components/ui/month-year-picker';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Plus,
  Send,
  Search,
  Filter,
  RefreshCw,
  Wallet,
  Clock,
  CheckCircle2,
  AlertCircle,
  Building2,
  Calendar,
  X,
  ChevronRight,
  Info,
} from 'lucide-react';
import {
  formatCurrency,
  PassThroughRecordItem,
  PassThroughOverview,
  PassThroughStatus,
  BankAccount,
} from '@finora/shared';
import { authFetch, getApiUrl } from '@/lib/api-client';
import { emitDataChange, useDataSync } from '@/lib/data-sync';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function PassThroughPage() {
  const [records, setRecords] = useState<PassThroughRecordItem[]>([]);
  const [overview, setOverview] = useState<PassThroughOverview>({
    totalReceived: 0,
    totalSent: 0,
    totalOutstanding: 0,
    openCount: 0,
    completedCount: 0,
  });
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<string>('');

  // Modals state
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [isSendModalOpen, setIsSendModalOpen] = useState(false);
  const [activeSendRecord, setActiveSendRecord] = useState<PassThroughRecordItem | null>(null);
  const [viewingRecord, setViewingRecord] = useState<PassThroughRecordItem | null>(null);

  // Form state: Record Received
  const [receiveSender, setReceiveSender] = useState('');
  const [receiveAmount, setReceiveAmount] = useState('');
  const [receiveDate, setReceiveDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [receiveAccountId, setReceiveAccountId] = useState('');
  const [receiveReference, setReceiveReference] = useState('');
  const [receiveNotes, setReceiveNotes] = useState('');
  const [submittingReceive, setSubmittingReceive] = useState(false);

  // Form state: Record Send
  const [sendRecipient, setSendRecipient] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendDate, setSendDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [sendAccountId, setSendAccountId] = useState('');
  const [sendReference, setSendReference] = useState('');
  const [sendNotes, setSendNotes] = useState('');
  const [submittingSend, setSubmittingSend] = useState(false);

  // Fetch accounts
  const fetchAccounts = async () => {
    try {
      const res = await authFetch(`${getApiUrl()}/api/v1/accounts`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setBankAccounts(json.data);
          if (json.data.length > 0 && !receiveAccountId) {
            setReceiveAccountId(json.data[0].id || (json.data[0] as any)._id);
          }
        }
      }
    } catch {
      // Ignore
    }
  };

  // Fetch pass-through records
  const fetchPassThrough = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter);
      if (searchTerm.trim()) params.set('search', searchTerm.trim());
      if (selectedMonth) params.set('month', selectedMonth);

      const url = `${getApiUrl()}/api/v1/pass-through?${params.toString()}`;
      const res = await authFetch(url);
      if (!res.ok) {
        throw new Error('Failed to load pass-through records');
      }
      const json = await res.json();
      if (json.success && json.data) {
        setRecords(json.data.records || []);
        if (json.data.overview) {
          setOverview(json.data.overview);
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'Error fetching pass-through money records');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  useEffect(() => {
    fetchPassThrough();
  }, [statusFilter, selectedMonth]);

  useDataSync(() => {
    fetchAccounts();
    fetchPassThrough();
  }, ['accounts']);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchPassThrough();
  };

  // Submit Received Money
  const handleReceiveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(receiveAmount);
    if (!receiveSender.trim()) {
      toast.error('Sender name is required');
      return;
    }
    if (isNaN(amt) || amt <= 0) {
      toast.error('Please enter a valid positive amount received');
      return;
    }
    if (!receiveAccountId) {
      toast.error('Please select destination bank account');
      return;
    }

    setSubmittingReceive(true);
    try {
      const res = await authFetch(`${getApiUrl()}/api/v1/pass-through`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderName: receiveSender.trim(),
          receivedAmount: amt,
          receivedDate: receiveDate,
          receivingBankAccountId: receiveAccountId,
          reference: receiveReference.trim() || undefined,
          notes: receiveNotes.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || 'Failed to record received money');
      }

      toast.success(`Recorded ₹${amt.toLocaleString()} received from ${receiveSender}`);
      setIsReceiveModalOpen(false);
      setReceiveSender('');
      setReceiveAmount('');
      setReceiveReference('');
      setReceiveNotes('');
      emitDataChange('accounts');
      fetchPassThrough();
    } catch (err: any) {
      toast.error(err.message || 'Error recording received money');
    } finally {
      setSubmittingReceive(false);
    }
  };

  // Open Send Modal for a specific record
  const handleOpenSendModal = (record: PassThroughRecordItem) => {
    setActiveSendRecord(record);
    setSendRecipient(record.sends?.[0]?.recipientName || '');
    setSendAmount(record.outstandingAmount > 0 ? record.outstandingAmount.toString() : '');
    setSendAccountId(record.receivingBankAccountId);
    setSendDate(new Date().toISOString().split('T')[0]);
    setSendReference('');
    setSendNotes('');
    setIsSendModalOpen(true);
  };

  // Submit Sent Money
  const handleSendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSendRecord) return;

    const amt = parseFloat(sendAmount);
    if (!sendRecipient.trim()) {
      toast.error('Recipient name is required');
      return;
    }
    if (isNaN(amt) || amt <= 0) {
      toast.error('Please enter a valid positive amount sent');
      return;
    }
    if (amt > activeSendRecord.outstandingAmount) {
      toast.error(
        `Amount sent (₹${amt.toLocaleString()}) cannot exceed outstanding amount (₹${activeSendRecord.outstandingAmount.toLocaleString()})`
      );
      return;
    }
    if (!sendAccountId) {
      toast.error('Please select sending bank account');
      return;
    }

    setSubmittingSend(true);
    try {
      const recId = activeSendRecord.id || (activeSendRecord as any)._id;
      const res = await authFetch(`${getApiUrl()}/api/v1/pass-through/${recId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientName: sendRecipient.trim(),
          amount: amt,
          date: sendDate,
          bankAccountId: sendAccountId,
          reference: sendReference.trim() || undefined,
          notes: sendNotes.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || 'Failed to record money sent');
      }

      toast.success(`Recorded ₹${amt.toLocaleString()} sent to ${sendRecipient}`);
      setIsSendModalOpen(false);
      setActiveSendRecord(null);
      emitDataChange('accounts');
      fetchPassThrough();
    } catch (err: any) {
      toast.error(err.message || 'Error recording sent money');
    } finally {
      setSubmittingSend(false);
    }
  };

  const getStatusBadge = (status: PassThroughStatus) => {
    switch (status) {
      case 'completed':
        return (
          <Badge variant="outline" className="text-emerald-700 bg-emerald-500/10 border-emerald-500/20 text-[10px] font-medium gap-1">
            <CheckCircle2 className="h-3 w-3" /> Completed
          </Badge>
        );
      case 'partially_sent':
        return (
          <Badge variant="outline" className="text-amber-700 bg-amber-500/10 border-amber-500/20 text-[10px] font-medium gap-1">
            <Clock className="h-3 w-3" /> Partially Sent
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-muted-foreground bg-muted text-[10px] font-medium gap-1">
            <Clock className="h-3 w-3" /> Pending
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ArrowDownLeft className="h-6 w-6 text-foreground" />
            Pass-Through Money
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage money received on behalf of others and transferred to recipients without inflating personal income or expenses
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          <Button
            size="sm"
            onClick={() => setIsReceiveModalOpen(true)}
            className="text-xs gap-1.5 h-9"
          >
            <Plus className="h-4 w-4" /> Record Received Money
          </Button>

          <Button
            variant="outline"
            size="icon"
            onClick={fetchPassThrough}
            className="h-9 w-9"
            title="Refresh"
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Info Notice Banner */}
      <div className="p-3.5 rounded-lg border border-border bg-muted/20 text-xs text-muted-foreground flex items-start gap-3">
        <Info className="h-4 w-4 shrink-0 text-foreground mt-0.5" />
        <div className="space-y-0.5">
          <p className="font-semibold text-foreground">Isolated Balance Accounting</p>
          <p>
            Pass-Through Money adjusts actual bank account balances as funds arrive and depart, but is strictly isolated from normal income, expense, and investment reports. Funds held on behalf of others are automatically excluded from your personal available spending balance.
          </p>
        </div>
      </div>

      {/* Overview Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        <Card className="shadow-sm border-border bg-card">
          <CardHeader className="pb-1.5 pt-3 px-4">
            <CardTitle className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Total Received
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-xl font-bold tracking-tight text-foreground font-mono">
              {formatCurrency(overview.totalReceived)}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Lifetime pass-through</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-border bg-card">
          <CardHeader className="pb-1.5 pt-3 px-4">
            <CardTitle className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Total Sent
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-xl font-bold tracking-tight text-foreground font-mono">
              {formatCurrency(overview.totalSent)}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Disbursed to recipients</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-border bg-card">
          <CardHeader className="pb-1.5 pt-3 px-4">
            <CardTitle className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Outstanding Held
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-xl font-bold tracking-tight text-foreground font-mono">
              {formatCurrency(overview.totalOutstanding)}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Awaiting transfer</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-border bg-card">
          <CardHeader className="pb-1.5 pt-3 px-4">
            <CardTitle className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Open Records
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-xl font-bold tracking-tight text-foreground font-mono">
              {overview.openCount}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Pending or partial</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-border bg-card">
          <CardHeader className="pb-1.5 pt-3 px-4">
            <CardTitle className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Completed
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-xl font-bold tracking-tight text-foreground font-mono">
              {overview.completedCount}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">Fully transferred</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Status Tabs */}
          <div className="flex rounded-lg border border-border p-0.5 bg-muted/40 text-xs">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                statusFilter === 'all'
                  ? 'bg-card text-foreground shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('pending')}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                statusFilter === 'pending'
                  ? 'bg-card text-foreground shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Pending
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('partially_sent')}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                statusFilter === 'partially_sent'
                  ? 'bg-card text-foreground shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Partial
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('completed')}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                statusFilter === 'completed'
                  ? 'bg-card text-foreground shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Completed
            </button>
          </div>

          {/* Month Filter */}
          <div className="flex items-center gap-1.5">
            <MonthYearPicker
              value={selectedMonth}
              onChange={(m) => setSelectedMonth(m)}
              placeholder="All Months"
              className="w-[140px] h-8 text-xs"
            />
            {selectedMonth && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelectedMonth('')}
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                title="Clear month filter"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Search */}
        <form onSubmit={handleSearchSubmit} className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search sender, recipient, ref..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 h-9 text-xs"
          />
        </form>
      </div>

      {/* Records Table / List */}
      <Card className="shadow-sm border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-foreground">
            Pass-Through Records ({records.length})
          </CardTitle>
          <CardDescription className="text-xs">
            Review money held on behalf of other parties and dispatch transfers
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : records.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground space-y-2">
              <ArrowDownLeft className="h-8 w-8 mx-auto opacity-30 text-muted-foreground" />
              <p className="font-medium text-foreground">No pass-through records found</p>
              <p className="max-w-sm mx-auto">
                Use "Record Received Money" when funds are deposited into your bank account on behalf of someone else.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {records.map((rec) => {
                const recId = rec.id || (rec as any)._id;
                const isComplete = rec.status === 'completed';
                const percentSent =
                  rec.receivedAmount > 0
                    ? Math.min(100, Math.round((rec.totalSentAmount / rec.receivedAmount) * 100))
                    : 100;

                return (
                  <div
                    key={recId}
                    className="p-3.5 rounded-lg border border-border bg-muted/10 hover:bg-muted/20 transition-all text-xs space-y-2"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-foreground/10 text-foreground shrink-0">
                          <ArrowDownLeft className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-foreground text-sm">
                              From: {rec.senderName}
                            </span>
                            {getStatusBadge(rec.status)}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                            <span>
                              Received:{' '}
                              {new Date(rec.receivedDate).toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </span>
                            <span>• {rec.receivingBankAccountName}</span>
                            {rec.reference && <span>• Ref: {rec.reference}</span>}
                          </div>
                        </div>
                      </div>

                      {/* Amounts Summary & Actions */}
                      <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-0 border-border/60">
                        <div className="text-left sm:text-right">
                          <div className="flex items-baseline gap-1.5 sm:justify-end">
                            <span className="text-[11px] text-muted-foreground">Received:</span>
                            <span className="font-mono font-bold text-foreground">
                              {formatCurrency(rec.receivedAmount)}
                            </span>
                          </div>
                          <div className="flex items-baseline gap-1.5 sm:justify-end text-[11px]">
                            <span className="text-muted-foreground">Outstanding:</span>
                            <span
                              className={`font-mono font-semibold ${
                                rec.outstandingAmount > 0 ? 'text-destructive font-bold' : 'text-muted-foreground'
                              }`}
                            >
                              {formatCurrency(rec.outstandingAmount)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {!isComplete && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenSendModal(rec)}
                              className="text-xs h-8 gap-1 border-foreground/30 hover:bg-foreground hover:text-background"
                            >
                              <Send className="h-3 w-3" /> Send
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setViewingRecord(rec)}
                            className="text-xs h-8 text-muted-foreground hover:text-foreground"
                          >
                            Details
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Progress Bar of Transfer */}
                    <div className="flex items-center gap-2 pt-1">
                      <div className="h-1.5 w-full bg-muted/60 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-foreground rounded-full transition-all duration-300"
                          style={{ width: `${percentSent}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                        {percentSent}% Sent ({formatCurrency(rec.totalSentAmount)})
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal 1: Record Received Money */}
      <Dialog open={isReceiveModalOpen} onOpenChange={setIsReceiveModalOpen}>
        <DialogContent className="max-w-md">
          <form onSubmit={handleReceiveSubmit}>
            <DialogHeader>
              <DialogTitle className="text-base font-semibold">Record Received Pass-Through Money</DialogTitle>
              <DialogDescription className="text-xs">
                Log money deposited into your bank account on behalf of someone else.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-3 text-xs">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Sender Name / Entity</label>
                <Input
                  type="text"
                  placeholder="e.g. Ramesh Sharma"
                  value={receiveSender}
                  onChange={(e) => setReceiveSender(e.target.value)}
                  className="h-8 text-xs"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Amount Received (₹)</label>
                  <Input
                    type="number"
                    step="any"
                    min="1"
                    placeholder="10000"
                    value={receiveAmount}
                    onChange={(e) => setReceiveAmount(e.target.value)}
                    className="h-8 text-xs font-mono"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Date Received</label>
                  <DatePicker
                    value={receiveDate}
                    onChange={(d) => setReceiveDate(d)}
                    className="w-full h-8 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Destination Bank Account</label>
                <Select
                  value={receiveAccountId}
                  onValueChange={(val) => setReceiveAccountId(val)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select Bank Account" />
                  </SelectTrigger>
                  <SelectContent>
                    {bankAccounts.map((acc) => {
                      const id = acc.id || (acc as any)._id;
                      return (
                        <SelectItem key={id} value={id}>
                          {acc.accountName} ({acc.bankName})
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  The selected account's balance will increase by this amount.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Reference / Transaction ID (Optional)</label>
                <Input
                  type="text"
                  placeholder="e.g. IMPS/12345678"
                  value={receiveReference}
                  onChange={(e) => setReceiveReference(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Notes / Purpose (Optional)</label>
                <Input
                  type="text"
                  placeholder="e.g. Received to pay vendor for building supplies"
                  value={receiveNotes}
                  onChange={(e) => setReceiveNotes(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsReceiveModalOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                isLoading={submittingReceive}
                className="text-xs gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" /> Save Receipt
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal 2: Record Money Sent */}
      <Dialog open={isSendModalOpen} onOpenChange={setIsSendModalOpen}>
        <DialogContent className="max-w-md">
          <form onSubmit={handleSendSubmit}>
            <DialogHeader>
              <DialogTitle className="text-base font-semibold">Record Money Sent to Recipient</DialogTitle>
              <DialogDescription className="text-xs">
                Transfer funds from this pass-through receipt to its intended recipient.
              </DialogDescription>
            </DialogHeader>

            {activeSendRecord && (
              <div className="p-3 rounded-lg bg-muted/30 border border-border text-xs space-y-1 mb-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">From Sender:</span>
                  <span className="font-semibold text-foreground">{activeSendRecord.senderName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Original Received:</span>
                  <span className="font-mono">{formatCurrency(activeSendRecord.receivedAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Remaining Outstanding:</span>
                  <span className="font-mono font-bold text-destructive">
                    {formatCurrency(activeSendRecord.outstandingAmount)}
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-3 py-1 text-xs">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Recipient Name</label>
                <Input
                  type="text"
                  placeholder="e.g. Suresh Hardware"
                  value={sendRecipient}
                  onChange={(e) => setSendRecipient(e.target.value)}
                  className="h-8 text-xs"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Amount Sent (₹)</label>
                  <Input
                    type="number"
                    step="any"
                    min="1"
                    max={activeSendRecord?.outstandingAmount}
                    placeholder="5000"
                    value={sendAmount}
                    onChange={(e) => setSendAmount(e.target.value)}
                    className="h-8 text-xs font-mono"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Date Sent</label>
                  <DatePicker
                    value={sendDate}
                    onChange={(d) => setSendDate(d)}
                    className="w-full h-8 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Sending Bank Account</label>
                <Select
                  value={sendAccountId}
                  onValueChange={(val) => setSendAccountId(val)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select Sending Account" />
                  </SelectTrigger>
                  <SelectContent>
                    {bankAccounts.map((acc) => {
                      const id = acc.id || (acc as any)._id;
                      return (
                        <SelectItem key={id} value={id}>
                          {acc.accountName} ({acc.bankName})
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  The selected account's balance will decrease by this amount.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Reference / Transaction ID (Optional)</label>
                <Input
                  type="text"
                  placeholder="e.g. UPI/56789123"
                  value={sendReference}
                  onChange={(e) => setSendReference(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Notes / Purpose (Optional)</label>
                <Input
                  type="text"
                  placeholder="e.g. Part 1 payment for invoice #104"
                  value={sendNotes}
                  onChange={(e) => setSendNotes(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsSendModalOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                isLoading={submittingSend}
                className="text-xs gap-1.5"
              >
                <Send className="h-3.5 w-3.5" /> Confirm Transfer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal 3: View Record Details and Complete History Timeline */}
      <Dialog
        open={Boolean(viewingRecord)}
        onOpenChange={(open) => !open && setViewingRecord(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Pass-Through Record Timeline</DialogTitle>
            <DialogDescription className="text-xs">
              Complete audit history for funds received and dispatched
            </DialogDescription>
          </DialogHeader>

          {viewingRecord && (
            <div className="space-y-4 py-2 text-xs">
              {/* Receipt Header Card */}
              <div className="p-3 rounded-lg border border-border bg-muted/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">From Sender</span>
                    <p className="font-bold text-sm text-foreground">{viewingRecord.senderName}</p>
                  </div>
                  {getStatusBadge(viewingRecord.status)}
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border/60">
                  <div>
                    <span className="text-[10px] text-muted-foreground block">Received</span>
                    <span className="font-mono font-semibold text-foreground">
                      {formatCurrency(viewingRecord.receivedAmount)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground block">Sent</span>
                    <span className="font-mono font-semibold text-foreground">
                      {formatCurrency(viewingRecord.totalSentAmount)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground block">Outstanding</span>
                    <span
                      className={`font-mono font-bold ${
                        viewingRecord.outstandingAmount > 0 ? 'text-destructive' : 'text-muted-foreground'
                      }`}
                    >
                      {formatCurrency(viewingRecord.outstandingAmount)}
                    </span>
                  </div>
                </div>

                <div className="text-[11px] text-muted-foreground pt-1 flex items-center gap-2">
                  <span>
                    Received Date:{' '}
                    {new Date(viewingRecord.receivedDate).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                  <span>• {viewingRecord.receivingBankAccountName}</span>
                </div>
              </div>

              {/* Sent Transfers Timeline */}
              <div className="space-y-2">
                <h4 className="font-semibold text-foreground flex items-center gap-1.5">
                  <Send className="h-3.5 w-3.5 text-foreground" />
                  Transfers Sent ({viewingRecord.sends?.length || 0})
                </h4>

                {!viewingRecord.sends || viewingRecord.sends.length === 0 ? (
                  <div className="p-4 rounded-lg border border-dashed border-border text-center text-muted-foreground">
                    No transfers dispatched yet against this receipt.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                    {viewingRecord.sends.map((s, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-lg border border-border bg-card flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground">To: {s.recipientName}</span>
                            {s.reference && (
                              <span className="text-[10px] text-muted-foreground">Ref: {s.reference}</span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {new Date(s.date).toLocaleDateString('en-IN', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}{' '}
                            • {s.bankAccountName || 'Bank Account'}
                            {s.notes && ` • "${s.notes}"`}
                          </div>
                        </div>

                        <span className="font-mono font-bold text-foreground">
                          {formatCurrency(s.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {viewingRecord.status !== 'completed' && (
                <div className="pt-2 flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => {
                      setViewingRecord(null);
                      handleOpenSendModal(viewingRecord);
                    }}
                    className="text-xs gap-1.5"
                  >
                    <Send className="h-3.5 w-3.5" /> Send Money Now
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
