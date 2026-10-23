'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Users,
  CheckCircle2,
  Clock,
  AlertCircle,
  Plus,
  Trash2,
  Coins,
  Building,
  CreditCard,
  Search,
  ArrowRight,
  Filter,
} from 'lucide-react';
import {
  ChitFundMember,
  ChitFundCollection,
  ChitFundSummary,
  formatCurrency,
  formatCyclePillLabel,
} from '@finora/shared';

interface CollectionsOverviewProps {
  fundId: string;
  currency: string;
  members: ChitFundMember[];
  collections: ChitFundCollection[];
  summary: ChitFundSummary | null;
  activeCyclePeriod: string;
  onOpenRecordCollection: (memberId?: string, period?: string) => void;
  onDeleteCollection: (collectionId: string) => void;
}

export function ChitFundCollectionsOverview({
  fundId,
  currency,
  members,
  collections,
  summary,
  activeCyclePeriod,
  onOpenRecordCollection,
  onDeleteCollection,
}: CollectionsOverviewProps) {
  const [selectedCycle, setSelectedCycle] = useState<string>(activeCyclePeriod);
  const [subTab, setSubTab] = useState<'remaining' | 'paid' | 'all'>('remaining');
  const [searchQuery, setSearchQuery] = useState('');

  // Extract all distinct cycles from collections or current period
  const availableCycles = useMemo(() => {
    const cycleSet = new Set<string>();
    cycleSet.add(activeCyclePeriod);
    collections.forEach((c) => {
      if (c.collectionPeriod) cycleSet.add(c.collectionPeriod);
    });
    // Add current month and past/future 3 months if not present
    const baseDate = new Date();
    for (let i = -3; i <= 6; i++) {
      const d = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, 1);
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      cycleSet.add(period);
    }
    return Array.from(cycleSet).sort().reverse();
  }, [collections, activeCyclePeriod]);

  // Active members
  const activeMembers = useMemo(() => {
    return members.filter((m) => m.status === 'active');
  }, [members]);

  // Collections for the selected cycle
  const cycleCollections = useMemo(() => {
    return collections.filter((c) => c.collectionPeriod === selectedCycle);
  }, [collections, selectedCycle]);

  const isCashPayment = (m?: string) => m === 'cash' || m === 'cash_in_hand';

  // Metrics for selected cycle
  const totalExpectedAmount = useMemo(() => {
    return activeMembers.reduce((sum, m) => sum + (m.totalExpectedPerPeriod || 5000), 0);
  }, [activeMembers]);

  const totalCollectedAmount = useMemo(() => {
    return cycleCollections.reduce((sum, c) => sum + (c.actualAmountReceived || 0), 0);
  }, [cycleCollections]);

  const remainingAmountDue = Math.max(0, totalExpectedAmount - totalCollectedAmount);

  const cashCollectionsAmount = useMemo(() => {
    return cycleCollections
      .filter((c) => isCashPayment(c.paymentMethod))
      .reduce((sum, c) => sum + (c.actualAmountReceived || 0), 0);
  }, [cycleCollections]);

  const upiCollectionsAmount = useMemo(() => {
    return cycleCollections
      .filter((c) => !isCashPayment(c.paymentMethod))
      .reduce((sum, c) => sum + (c.actualAmountReceived || 0), 0);
  }, [cycleCollections]);

  // Member breakdown for selected cycle
  const memberPaymentStatusList = useMemo(() => {
    return activeMembers.map((m) => {
      const memberCols = cycleCollections.filter(
        (c) =>
          c.memberId === m.id ||
          (c.memberId as any)?.id === m.id ||
          (c.memberId as any)?._id === m.id
      );

      const totalPaid = memberCols.reduce((sum, c) => sum + (c.actualAmountReceived || 0), 0);
      const expected = m.totalExpectedPerPeriod || 5000;
      const due = Math.max(0, expected - totalPaid);

      let status: 'completed' | 'partial' | 'pending' = 'pending';
      if (totalPaid >= expected) {
        status = 'completed';
      } else if (totalPaid > 0) {
        status = 'partial';
      }

      // Last payment info
      const lastCol = memberCols[memberCols.length - 1];

      return {
        member: m,
        expected,
        totalPaid,
        due,
        status,
        collections: memberCols,
        lastPaymentDate: lastCol?.collectionDate,
        lastPaymentMethod: lastCol?.paymentMethod,
        isFullyPaid: status === 'completed',
      };
    });
  }, [activeMembers, cycleCollections]);

  const fullyPaidMembers = useMemo(() => {
    return memberPaymentStatusList.filter((m) => m.isFullyPaid);
  }, [memberPaymentStatusList]);

  const remainingMembers = useMemo(() => {
    return memberPaymentStatusList.filter((m) => !m.isFullyPaid);
  }, [memberPaymentStatusList]);

  const partiallyPaidMembers = useMemo(() => {
    return memberPaymentStatusList.filter((m) => m.status === 'partial');
  }, [memberPaymentStatusList]);

  const unpaidMembers = useMemo(() => {
    return memberPaymentStatusList.filter((m) => m.status === 'pending');
  }, [memberPaymentStatusList]);

  // Filtered lists by search query
  const filteredRemaining = useMemo(() => {
    return remainingMembers.filter((item) =>
      item.member.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [remainingMembers, searchQuery]);

  const filteredPaid = useMemo(() => {
    return fullyPaidMembers.filter((item) =>
      item.member.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [fullyPaidMembers, searchQuery]);

  const filteredCollections = useMemo(() => {
    return cycleCollections.filter((c) => {
      const memberName = c.memberName || '';
      return memberName.toLowerCase().includes(searchQuery.toLowerCase());
    });
  }, [cycleCollections, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Top Header & Cycle Selection */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">Monthly Collections Register</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Track member contributions, Cash in Hand, UPI deposits, and real-time payment status
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-1.5 bg-muted/40 p-1 rounded-xl border border-border">
            <span className="text-[11px] font-semibold text-muted-foreground px-2">Cycle:</span>
            <select
              value={selectedCycle}
              onChange={(e) => setSelectedCycle(e.target.value)}
              className="text-xs font-bold font-mono px-2.5 py-1.5 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {availableCycles.map((cyc) => (
                <option key={cyc} value={cyc}>
                  {formatCyclePillLabel(cyc)} ({cyc})
                </option>
              ))}
            </select>
          </div>

          <Button
            onClick={() => onOpenRecordCollection(undefined, selectedCycle)}
            size="sm"
            className="gap-2 bg-[#05A100] hover:bg-[#048700] text-white font-bold shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Record Collection
          </Button>
        </div>
      </div>

      {/* KPI Grid (Phase 3 Requirement) */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {/* Expected */}
        <Card className="border-border bg-card p-3.5 space-y-1">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
            Expected Collection
          </span>
          <div className="text-base font-bold text-foreground font-mono">
            {formatCurrency(totalExpectedAmount, currency)}
          </div>
          <span className="text-[10px] text-muted-foreground">
            {activeMembers.length} active members
          </span>
        </Card>

        {/* Collected */}
        <Card className="border-border bg-card p-3.5 space-y-1">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
            Total Collected
          </span>
          <div className="text-base font-bold text-[#05A100] font-mono">
            {formatCurrency(totalCollectedAmount, currency)}
          </div>
          <span className="text-[10px] text-[#05A100] font-medium">
            {fullyPaidMembers.length} fully paid
          </span>
        </Card>

        {/* Remaining Due */}
        <Card className="border-border bg-card p-3.5 space-y-1">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
            Remaining Due
          </span>
          <div className="text-base font-bold text-[#BF0000] font-mono">
            {formatCurrency(remainingAmountDue, currency)}
          </div>
          <span className="text-[10px] text-[#BF0000] font-medium">
            {remainingMembers.length} pending
          </span>
        </Card>

        {/* UPI Collected */}
        <Card className="border-border bg-card p-3.5 space-y-1">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block flex items-center gap-1">
            <Building className="h-3 w-3 text-sky-400" />
            UPI Received
          </span>
          <div className="text-base font-bold text-foreground font-mono">
            {formatCurrency(upiCollectionsAmount, currency)}
          </div>
          <span className="text-[10px] text-muted-foreground">
            Deposited in Bank
          </span>
        </Card>

        {/* Cash in Hand */}
        <Card className="border-border bg-card p-3.5 space-y-1">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block flex items-center gap-1">
            <Coins className="h-3 w-3 text-amber-400" />
            Cash in Hand
          </span>
          <div className="text-base font-bold text-foreground font-mono">
            {formatCurrency(cashCollectionsAmount, currency)}
          </div>
          <span className="text-[10px] text-amber-400 font-medium">
            Held Physically
          </span>
        </Card>

        {/* Total Held Balances */}
        <Card className="border-border bg-card p-3.5 space-y-1">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
            Chit Held Summary
          </span>
          <div className="text-xs space-y-0.5 font-mono">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bank:</span>
              <span className="font-bold text-foreground">
                {formatCurrency(summary?.chitFundsHeldInBank || 0, currency)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cash:</span>
              <span className="font-bold text-amber-400">
                {formatCurrency(summary?.cashInHandChitFunds || 0, currency)}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Main Container: Sub-tabs and lists */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-3 border-b border-border/60">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            {/* View Sub-Tabs */}
            <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-xl border border-border/80 self-start">
              <button
                type="button"
                onClick={() => setSubTab('remaining')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  subTab === 'remaining'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Clock className="h-3.5 w-3.5 text-amber-400" />
                Remaining Members ({remainingMembers.length})
              </button>

              <button
                type="button"
                onClick={() => setSubTab('paid')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  subTab === 'paid'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-[#05A100]" />
                Paid Members ({fullyPaidMembers.length})
              </button>

              <button
                type="button"
                onClick={() => setSubTab('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                  subTab === 'all'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <CreditCard className="h-3.5 w-3.5 text-sky-400" />
                All Collections Ledger ({cycleCollections.length})
              </button>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search member name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="text-xs pl-8 pr-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary w-48 sm:w-56"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {/* TAB 1: REMAINING MEMBERS */}
          {subTab === 'remaining' && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/40 border-b border-border text-muted-foreground font-semibold">
                  <tr>
                    <th className="py-2.5 px-4">Member Name</th>
                    <th className="py-2.5 px-4 text-right">Expected Total</th>
                    <th className="py-2.5 px-4 text-right">Amount Paid</th>
                    <th className="py-2.5 px-4 text-right">Remaining Due</th>
                    <th className="py-2.5 px-4 text-center">Status</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredRemaining.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-10 text-muted-foreground">
                        <CheckCircle2 className="h-8 w-8 text-[#05A100] mx-auto mb-2" />
                        <span className="font-bold text-foreground block text-sm">
                          All members have fully contributed for {formatCyclePillLabel(selectedCycle)}!
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          Zero outstanding dues remaining for this monthly collection cycle.
                        </span>
                      </td>
                    </tr>
                  ) : (
                    filteredRemaining.map((item) => (
                      <tr key={item.member.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-4">
                          <span className="font-bold text-foreground text-sm block">
                            {item.member.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {item.member.phone || 'No phone recorded'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-muted-foreground">
                          {formatCurrency(item.expected, currency)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-foreground">
                          {formatCurrency(item.totalPaid, currency)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-[#BF0000]">
                          {formatCurrency(item.due, currency)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              item.status === 'partial'
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                : 'bg-red-500/10 text-red-400 border-red-500/30'
                            }`}
                          >
                            {item.status === 'partial' ? 'Partially Paid' : 'Pending'}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            size="sm"
                            onClick={() => onOpenRecordCollection(item.member.id, selectedCycle)}
                            className="h-7 text-xs gap-1 bg-[#05A100] hover:bg-[#048700] text-white font-bold"
                          >
                            <Plus className="h-3 w-3" />
                            Record Payment
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 2: PAID MEMBERS */}
          {subTab === 'paid' && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/40 border-b border-border text-muted-foreground font-semibold">
                  <tr>
                    <th className="py-2.5 px-4">Member Name</th>
                    <th className="py-2.5 px-4 text-right">Expected</th>
                    <th className="py-2.5 px-4 text-right">Amount Received</th>
                    <th className="py-2.5 px-4">Payment Method</th>
                    <th className="py-2.5 px-4">Collection Date</th>
                    <th className="py-2.5 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredPaid.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-muted-foreground">
                        No fully paid member records found for {formatCyclePillLabel(selectedCycle)}.
                      </td>
                    </tr>
                  ) : (
                    filteredPaid.map((item) => (
                      <tr key={item.member.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-4 font-bold text-foreground">
                          {item.member.name}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-muted-foreground">
                          {formatCurrency(item.expected, currency)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-[#05A100]">
                          {formatCurrency(item.totalPaid, currency)}
                        </td>
                        <td className="py-3 px-4">
                          <Badge
                            variant="outline"
                            className={`text-[10px] uppercase font-mono ${
                              item.lastPaymentMethod === 'cash' || item.lastPaymentMethod === 'cash_in_hand'
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                : 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                            }`}
                          >
                            {item.lastPaymentMethod === 'cash' || item.lastPaymentMethod === 'cash_in_hand'
                              ? 'Cash in Hand'
                              : 'UPI'}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-muted-foreground font-mono">
                          {item.lastPaymentDate ? new Date(item.lastPaymentDate).toLocaleDateString() : '—'}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]">
                            Fully Paid
                          </Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 3: ALL COLLECTIONS LEDGER */}
          {subTab === 'all' && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/40 border-b border-border text-muted-foreground font-semibold">
                  <tr>
                    <th className="py-2.5 px-4">Date</th>
                    <th className="py-2.5 px-4">Member</th>
                    <th className="py-2.5 px-4 text-right">Amount Received</th>
                    <th className="py-2.5 px-4">Payment Method</th>
                    <th className="py-2.5 px-4">Receiving Account</th>
                    <th className="py-2.5 px-4">Reference / Notes</th>
                    <th className="py-2.5 px-4 text-center">Status</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredCollections.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-muted-foreground">
                        No collections recorded for {formatCyclePillLabel(selectedCycle)}.
                      </td>
                    </tr>
                  ) : (
                    filteredCollections.map((c) => (
                      <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-4 font-mono text-muted-foreground">
                          {new Date(c.collectionDate).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4 font-semibold text-foreground">
                          {c.memberName || 'Member'}
                          {c.isSeparation && (
                            <Badge variant="outline" className="ml-1.5 text-[9px] bg-purple-500/10 text-purple-400 border-purple-500/30">
                              Separated
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-[#05A100]">
                          {formatCurrency(c.actualAmountReceived, currency)}
                        </td>
                        <td className="py-3 px-4">
                          <Badge
                            variant="outline"
                            className={`text-[10px] uppercase font-mono ${
                              c.paymentMethod === 'cash' || c.paymentMethod === 'cash_in_hand'
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                : 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                            }`}
                          >
                            {c.paymentMethod === 'cash' || c.paymentMethod === 'cash_in_hand'
                              ? 'Cash in Hand'
                              : 'UPI'}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-muted-foreground">
                          {c.paymentMethod === 'cash' || c.paymentMethod === 'cash_in_hand'
                            ? 'Held in Hand'
                            : c.receivingAccountName || 'Bank Account'}
                        </td>
                        <td className="py-3 px-4 text-muted-foreground truncate max-w-xs">
                          {c.notes || c.reference || '—'}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Badge
                            variant="outline"
                            className={`text-[10px] capitalize ${
                              c.status === 'completed'
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                            }`}
                          >
                            {c.status}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onDeleteCollection(c.id)}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-[#BF0000]"
                            title="Delete collection"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
