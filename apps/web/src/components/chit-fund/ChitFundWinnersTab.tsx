'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
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
  Trophy,
  Users,
  Calendar,
  ArrowUpRight,
  Sparkles,
  CheckCircle2,
  Clock,
  Search,
  Filter,
  ShieldAlert,
  AlertCircle,
  HelpCircle,
  Dices,
  Award,
  Lock,
  UserCheck,
  Edit2,
  RefreshCw,
} from 'lucide-react';
import {
  ChitFundMember,
  ChitFundCycleDetails,
  formatCurrency,
  formatCyclePillLabel,
  ChitCycleInfo,
} from '@finora/shared';

interface WinnersTabProps {
  fundId: string;
  currency: string;
  currentCyclePeriod: string;
  cycleInfo?: ChitCycleInfo | null;
  cycles: ChitFundCycleDetails[];
  members: ChitFundMember[];
  onOpenSpinner: (cyclePeriod?: string) => void;
  onOpenRecordPayout: (period: string, memberName?: string, memberId?: string) => void;
  onRefresh: () => void;
}

export function ChitFundWinnersTab({
  fundId,
  currency,
  currentCyclePeriod,
  cycleInfo,
  cycles,
  members,
  onOpenSpinner,
  onOpenRecordPayout,
  onRefresh,
}: WinnersTabProps) {
  const [selectedCyclePill, setSelectedCyclePill] = useState<string>(currentCyclePeriod);
  const [selectedYear, setSelectedYear] = useState<string>(
    currentCyclePeriod ? currentCyclePeriod.slice(0, 4) : '2026'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'paid' | 'pending'>('all');

  // Manual Winner Assignment Modal State
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignMemberId, setAssignMemberId] = useState('');
  const [alreadyPaidOut, setAlreadyPaidOut] = useState(false);
  const [assigning, setAssigning] = useState(false);

  // Correct Winner Modal State
  const [showCorrectModal, setShowCorrectModal] = useState(false);
  const [correctMemberId, setCorrectMemberId] = useState('');
  const [correctReason, setCorrectReason] = useState('');
  const [correcting, setCorrecting] = useState(false);

  const getApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  // Active members
  const activeMembers = useMemo(() => members.filter((m) => m.status === 'active'), [members]);

  // Generate 20 monthly cycles starting from fund creation/current
  const timelineCycles = useMemo(() => {
    const cycleMap = new Map<string, ChitFundCycleDetails | null>();
    cycles.forEach((c) => {
      cycleMap.set(c.cyclePeriod, c);
    });

    // Generate continuous sequence of 20 months
    const baseDate = new Date('2026-10-01');
    const list: string[] = [];
    for (let i = 0; i < 20; i++) {
      const d = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, 1);
      const p = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      list.push(p);
    }
    return list;
  }, [cycles]);

  // Selected cycle details
  const selectedCycleDetail = useMemo(() => {
    return cycles.find((c) => c.cyclePeriod === selectedCyclePill) || null;
  }, [cycles, selectedCyclePill]);

  // All past confirmed winners + members with hasPreviouslyWon = true (Phase 5 Requirement)
  const consolidatedWinners = useMemo(() => {
    const winnerMap = new Map<string, any>();

    // 1. Add cycle confirmed winners
    cycles.forEach((c) => {
      if (c.winnerMemberId || c.winnerMemberName) {
        winnerMap.set(`cycle_${c.cyclePeriod}`, {
          id: c.id,
          cyclePeriod: c.cyclePeriod,
          memberId: c.winnerMemberId ? c.winnerMemberId.toString() : undefined,
          memberName: c.winnerMemberName || 'Confirmed Winner',
          winDate: c.prizeTakingDate || `${c.cyclePeriod}-15`,
          payoutAmount: c.payoutAmount,
          payoutStatus: c.payoutStatus || 'none',
          notes: c.winnerNotes,
          isCycleWinner: true,
        });
      }
    });

    // 2. Add members marked with hasPreviouslyWon whose win was not in a cycle document
    members.forEach((m) => {
      if (m.hasPreviouslyWon) {
        const hasExistingEntry = Array.from(winnerMap.values()).some(
          (w) => w.memberId === m.id || w.memberName === m.name
        );

        if (!hasExistingEntry) {
          winnerMap.set(`member_${m.id}`, {
            id: `member_${m.id}`,
            cyclePeriod: m.previousWinCycle || 'Prior / Historical',
            memberId: m.id,
            memberName: m.name,
            winDate: m.previousWinDate || m.startDate || 'Historical',
            payoutAmount: undefined,
            payoutStatus: 'completed',
            notes: m.previousWinNotes || m.notes || 'Marked as previous winner',
            isCycleWinner: false,
          });
        }
      }
    });

    return Array.from(winnerMap.values()).sort((a, b) => {
      if (a.cyclePeriod.startsWith('20') && b.cyclePeriod.startsWith('20')) {
        return b.cyclePeriod.localeCompare(a.cyclePeriod);
      }
      return -1;
    });
  }, [cycles, members]);

  // Remaining eligible members
  const wonMemberIds = useMemo(() => {
    const ids = new Set<string>();
    members.forEach((m) => {
      if (m.hasPreviouslyWon) ids.add(m.id);
    });
    cycles.forEach((c) => {
      if (c.winnerMemberId) ids.add(c.winnerMemberId.toString());
    });
    return ids;
  }, [members, cycles]);

  const remainingEligibleMembers = useMemo(() => {
    return activeMembers.filter((m) => !wonMemberIds.has(m.id));
  }, [activeMembers, wonMemberIds]);

  // Filtered winner history
  const filteredHistory = useMemo(() => {
    return consolidatedWinners.filter((item) => {
      const nameMatch =
        item.memberName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.cyclePeriod.toLowerCase().includes(searchQuery.toLowerCase());

      if (!nameMatch) return false;

      if (statusFilter === 'paid') return item.payoutStatus === 'completed';
      if (statusFilter === 'pending') return item.payoutStatus === 'pending' || item.payoutStatus === 'none';
      return true;
    });
  }, [consolidatedWinners, searchQuery, statusFilter]);

  // Manual Winner Confirmation
  const handleAssignWinner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignMemberId) {
      toast.error('Please select an eligible member');
      return;
    }

    setAssigning(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/chit-funds/${fundId}/cycles/${selectedCyclePill}/confirm-winner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          memberId: assignMemberId,
          alreadyPaidOut,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`Winner confirmed for ${formatCyclePillLabel(selectedCyclePill)}!`);
        setShowAssignModal(false);
        setAssignMemberId('');
        setAlreadyPaidOut(false);
        onRefresh();
      } else {
        toast.error(json.error?.message || 'Failed to confirm winner');
      }
    } catch {
      toast.error('Network error confirming winner');
    } finally {
      setAssigning(false);
    }
  };

  // Correct Winner Submission
  const handleCorrectWinner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctMemberId) {
      toast.error('Please select replacement member');
      return;
    }
    if (!correctReason.trim()) {
      toast.error('Reason for correction is required');
      return;
    }

    setCorrecting(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/chit-funds/${fundId}/cycles/${selectedCyclePill}/correct-winner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          newMemberId: correctMemberId,
          reason: correctReason.trim(),
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`Winner for ${formatCyclePillLabel(selectedCyclePill)} corrected successfully!`);
        setShowCorrectModal(false);
        setCorrectMemberId('');
        setCorrectReason('');
        onRefresh();
      } else {
        toast.error(json.error?.message || 'Failed to correct winner');
      }
    } catch {
      toast.error('Network error correcting winner');
    } finally {
      setCorrecting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ======================================================== */}
      {/* PHASE 6: COMPACT MONTH-AND-YEAR PILL SELECTOR           */}
      {/* ======================================================== */}
      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="pb-3 border-b border-border/60">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Calendar className="h-4 w-4 text-[#05A100]" />
                Chit Cycle Timeline & Winner Selection
              </CardTitle>
              <CardDescription className="text-xs">
                Select a month pill to inspect confirmed winners, launch the prize lot wheel, or assign winners
              </CardDescription>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground font-mono">
                Active Cycle: <strong className="text-foreground">{formatCyclePillLabel(currentCyclePeriod)}</strong>
              </span>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4 space-y-4">
          {/* Year Selector & 12 Month Pills Grid */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Select Chit Year & Cycle Month
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-medium">Year:</span>
                <Select
                  value={selectedYear}
                  onValueChange={(yr) => {
                    setSelectedYear(yr);
                    const currentMonth = selectedCyclePill ? selectedCyclePill.slice(5, 7) : '10';
                    setSelectedCyclePill(`${yr}-${currentMonth}`);
                  }}
                >
                  <SelectTrigger className="h-8 w-[90px] text-xs font-bold font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['2024', '2025', '2026', '2027', '2028'].map((y) => (
                      <SelectItem key={y} value={y}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 12 Compact Month Pills (JAN - DEC) */}
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-12 gap-1.5">
              {['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].map((monthName, idx) => {
                const monthNum = String(idx + 1).padStart(2, '0');
                const cyc = `${selectedYear}-${monthNum}`;
                const isSelected = selectedCyclePill === cyc;
                const isCurrent = currentCyclePeriod === cyc;
                const cycDetail = cycles.find((c) => c.cyclePeriod === cyc);
                const hasWinner = Boolean(cycDetail?.winnerMemberId || cycDetail?.winnerMemberName);

                return (
                  <button
                    key={cyc}
                    type="button"
                    onClick={() => setSelectedCyclePill(cyc)}
                    className={`px-2 py-2 rounded-xl text-xs font-bold transition-all flex flex-col items-center justify-center gap-1 border ${
                      isSelected
                        ? 'bg-[#05A100] text-white border-[#05A100] shadow-md shadow-emerald-500/20'
                        : hasWinner
                        ? 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:border-amber-400'
                        : 'bg-muted/40 text-muted-foreground border-border hover:text-foreground hover:bg-muted'
                    }`}
                    title={`${monthName} ${selectedYear} (${cyc})`}
                  >
                    <div className="flex items-center gap-1">
                      {hasWinner ? (
                        <Trophy className={`h-3 w-3 ${isSelected ? 'text-white' : 'text-amber-400'}`} />
                      ) : (
                        <Calendar className={`h-3 w-3 ${isSelected ? 'text-white' : 'text-muted-foreground'}`} />
                      )}
                      <span>{monthName}</span>
                    </div>
                    {isCurrent && (
                      <span
                        className={`text-[9px] px-1 rounded-sm uppercase tracking-wider font-mono font-normal ${
                          isSelected ? 'bg-white/20 text-white' : 'bg-[#05A100]/20 text-[#05A100]'
                        }`}
                      >
                        Active
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected Cycle Status Card */}
          <div className="p-4 rounded-xl bg-muted/30 border border-border flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold font-mono text-muted-foreground uppercase tracking-wider">
                  Selected Cycle:
                </span>
                <Badge className="bg-[#05A100]/20 text-[#05A100] border-[#05A100]/40 font-bold font-mono">
                  {formatCyclePillLabel(selectedCyclePill)} ({selectedCyclePill})
                </Badge>
                {selectedCyclePill === currentCyclePeriod && (
                  <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">
                    Current Active Cycle
                  </Badge>
                )}
              </div>

              {selectedCycleDetail?.winnerMemberName ? (
                <div className="flex items-center gap-2 pt-1">
                  <Trophy className="h-5 w-5 text-amber-400 shrink-0" />
                  <div>
                    <span className="text-base font-bold text-foreground">
                      Winner: {selectedCycleDetail.winnerMemberName}
                    </span>
                    <p className="text-[11px] text-muted-foreground">
                      Winning Date: 15/{selectedCyclePill.split('-')[1] || '10'}/{selectedCyclePill.split('-')[0] || '2026'}
                      {' • '}
                      Payout Status:{' '}
                      <strong className="text-foreground capitalize font-mono">
                        {selectedCycleDetail.payoutStatus || 'Pending'}
                      </strong>
                    </p>
                  </div>
                </div>
              ) : (
                <div className="pt-1">
                  <p className="text-sm font-semibold text-foreground">
                    No winner confirmed yet for {formatCyclePillLabel(selectedCyclePill)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Scheduled prize-taking date: 15th of the month. Use the Lot Spinner or assign an eligible member manually.
                  </p>
                </div>
              )}
            </div>

            {/* Action Buttons for Selected Cycle */}
            <div className="flex items-center gap-2 flex-wrap">
              {selectedCycleDetail?.winnerMemberName ? (
                <>
                  {selectedCycleDetail.payoutStatus !== 'completed' && (
                    <Button
                      size="sm"
                      onClick={() =>
                        onOpenRecordPayout(
                          selectedCyclePill,
                          selectedCycleDetail.winnerMemberName,
                          selectedCycleDetail.winnerMemberId ? selectedCycleDetail.winnerMemberId.toString() : undefined
                        )
                      }
                      className="gap-1.5 bg-[#05A100] hover:bg-[#048700] text-white text-xs font-bold"
                    >
                      <ArrowUpRight className="h-3.5 w-3.5" />
                      Record Payout
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setCorrectMemberId('');
                      setCorrectReason('');
                      setShowCorrectModal(true);
                    }}
                    className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                    Correct Winner
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    onClick={() => onOpenSpinner(selectedCyclePill)}
                    className="gap-1.5 bg-[#05A100] hover:bg-[#048700] text-white text-xs font-bold shadow-sm"
                  >
                    <Dices className="h-3.5 w-3.5" />
                    Spin Winner Wheel
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setAssignMemberId('');
                      setAlreadyPaidOut(false);
                      setShowAssignModal(true);
                    }}
                    className="gap-1.5 text-xs border-border text-foreground hover:bg-muted"
                  >
                    <UserCheck className="h-3.5 w-3.5 text-emerald-400" />
                    Assign Manually
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Content: Winner History (Phase 5) & Remaining Eligible Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Confirmed Winners History (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          <Card className="border-border bg-card">
            <CardHeader className="pb-3 border-b border-border/60">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-amber-400" />
                    Chit Winner History & Payout Status
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Consolidated record of all confirmed monthly winners and prior winning members
                  </CardDescription>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Search Input */}
                  <div className="relative">
                    <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Search winners..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="text-xs pl-8 pr-3 py-1.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary w-36 sm:w-44"
                    />
                  </div>

                  {/* Status Filter */}
                  <Select
                    value={statusFilter}
                    onValueChange={(val: any) => setStatusFilter(val)}
                  >
                    <SelectTrigger className="text-xs h-8 w-[140px]">
                      <SelectValue placeholder="All Payouts" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Payouts</SelectItem>
                      <SelectItem value="paid">Payout Completed</SelectItem>
                      <SelectItem value="pending">Payout Pending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/40 border-b border-border text-muted-foreground font-semibold">
                    <tr>
                      <th className="py-2.5 px-4">Cycle</th>
                      <th className="py-2.5 px-4">Winner Name</th>
                      <th className="py-2.5 px-4">Win Date</th>
                      <th className="py-2.5 px-4">Payout Status</th>
                      <th className="py-2.5 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredHistory.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-muted-foreground">
                          No winner records match the specified query.
                        </td>
                      </tr>
                    ) : (
                      filteredHistory.map((item) => {
                        const pill = item.cyclePeriod.startsWith('20')
                          ? formatCyclePillLabel(item.cyclePeriod)
                          : item.cyclePeriod;
                        const isPaid = item.payoutStatus === 'completed';

                        return (
                          <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                            <td className="py-3 px-4 font-mono font-bold text-foreground">
                              <Badge className="bg-amber-500/10 text-amber-300 border-amber-500/30 font-mono text-[11px]">
                                {pill}
                              </Badge>
                            </td>
                            <td className="py-3 px-4">
                              <div className="font-semibold text-foreground flex items-center gap-1.5">
                                <Award className="h-3.5 w-3.5 text-amber-400" />
                                {item.memberName}
                              </div>
                              {item.notes && item.notes.startsWith('Corrected from ') && (
                                <p className="text-[10px] text-muted-foreground truncate max-w-xs mt-0.5">
                                  {item.notes}
                                </p>
                              )}
                            </td>
                            <td className="py-3 px-4 text-muted-foreground font-mono text-xs">
                              {(() => {
                                if (item.cyclePeriod && /^\d{4}-\d{2}$/.test(item.cyclePeriod)) {
                                  const [y, m] = item.cyclePeriod.split('-');
                                  return `15/${m}/${y}`;
                                }
                                if (item.winDate instanceof Date) {
                                  const day = String(item.winDate.getDate()).padStart(2, '0');
                                  const month = String(item.winDate.getMonth() + 1).padStart(2, '0');
                                  const year = item.winDate.getFullYear();
                                  return `${day}/${month}/${year}`;
                                }
                                if (typeof item.winDate === 'string' && /^\d{4}-\d{2}/.test(item.winDate)) {
                                  const [y, m] = item.winDate.slice(0, 7).split('-');
                                  return `15/${m}/${y}`;
                                }
                                return String(item.winDate).slice(0, 10);
                              })()}
                            </td>
                            <td className="py-3 px-4">
                              <Badge
                                variant="outline"
                                className={`text-[10px] ${
                                  isPaid
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                    : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                }`}
                              >
                                {isPaid ? 'Completed' : 'Pending'}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 text-right">
                              {!isPaid && item.isCycleWinner ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    onOpenRecordPayout(
                                      item.cyclePeriod,
                                      item.memberName,
                                      item.memberId
                                    )
                                  }
                                  className="h-7 text-[11px] gap-1 border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10"
                                >
                                  <ArrowUpRight className="h-3 w-3" />
                                  Pay Prize
                                </Button>
                              ) : (
                                <span className="text-[11px] text-emerald-500 font-medium">
                                  ✓ Recorded
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Remaining Eligible Members (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          <Card className="border-border bg-card">
            <CardHeader className="pb-3 border-b border-border/60">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <Users className="h-4 w-4 text-[#05A100]" />
                    Remaining Eligible Members
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Members eligible for upcoming prize draws
                  </CardDescription>
                </div>
                <Badge variant="outline" className="font-mono text-xs font-bold text-[#05A100] border-[#05A100]/30">
                  {remainingEligibleMembers.length}
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="space-y-2 max-h-[460px] overflow-y-auto p-4 pr-2">
              {remainingEligibleMembers.length === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-6 w-6 text-[#05A100] mx-auto mb-2" />
                  All 20 chit fund members have won a prize! The chit cycle is complete.
                </div>
              ) : (
                remainingEligibleMembers.map((m) => (
                  <div
                    key={m.id}
                    className="p-2.5 rounded-lg bg-muted/40 border border-border/60 flex items-center justify-between text-xs hover:border-border transition-colors"
                  >
                    <div>
                      <span className="font-semibold text-foreground block">{m.name}</span>
                      <p className="text-[10px] text-muted-foreground">
                        Monthly contribution: {formatCurrency(m.contributionPerChit || 5000, currency)}
                      </p>
                    </div>
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]">
                      Eligible
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>

            <CardFooter className="pt-2 border-t border-border/60">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenSpinner(selectedCyclePill)}
                className="w-full gap-1.5 text-xs border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
              >
                <Dices className="h-3.5 w-3.5" />
                Launch Lot Spinner Wheel
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>

      {/* ======================================================== */}
      {/* MODAL 1: MANUAL WINNER ASSIGNMENT MODAL                 */}
      {/* ======================================================== */}
      <Dialog open={showAssignModal} onOpenChange={setShowAssignModal}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-[#05A100]" />
              <span>Assign Winner for {formatCyclePillLabel(selectedCyclePill)}</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Select an eligible member to mark as the confirmed winner for cycle {selectedCyclePill}. This locks the cycle.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAssignWinner} className="space-y-4 pt-2">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Select Eligible Member *
                </label>
                <Select
                  value={assignMemberId || undefined}
                  onValueChange={(val) => setAssignMemberId(val)}
                >
                  <SelectTrigger className="h-10 w-full text-sm">
                    <SelectValue placeholder="-- Choose Member --" />
                  </SelectTrigger>
                  <SelectContent>
                    {remainingEligibleMembers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name} ({formatCurrency(m.contributionPerChit || 5000, currency)}/mo)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card/60">
                <div className="space-y-0.5 pr-2">
                  <label htmlFor="already-paid-out-toggle" className="text-xs font-semibold text-foreground cursor-pointer block">
                    Already Paid Out (Historical)
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    For historical winners before app tracking. Marks prize payout as Completed (₹1,00,000) without altering current bank or cash balances.
                  </p>
                </div>
                <input
                  id="already-paid-out-toggle"
                  type="checkbox"
                  checked={alreadyPaidOut}
                  onChange={(e) => setAlreadyPaidOut(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer shrink-0"
                />
              </div>

              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Confirming this winner will permanently exclude them from future prize draws. Duplicate confirmations for this cycle will be locked.
                </span>
              </div>
            </div>

            <DialogFooter className="pt-4 border-t border-border">
              <Button type="button" variant="outline" onClick={() => setShowAssignModal(false)}>
                Cancel
              </Button>
              <Button type="submit" isLoading={assigning} className="bg-[#05A100] hover:bg-[#048700] text-white font-bold">
                Confirm Winner
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ======================================================== */}
      {/* MODAL 2: WINNER CORRECTION MODAL (ADMIN OVERRIDE)       */}
      {/* ======================================================== */}
      <Dialog open={showCorrectModal} onOpenChange={setShowCorrectModal}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Edit2 className="h-5 w-5 text-amber-400" />
              <span>Correct Winner for {formatCyclePillLabel(selectedCyclePill)}</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Administrative workflow to reassign the winner for cycle {selectedCyclePill}. Requires an audit trail reason.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCorrectWinner} className="space-y-4 pt-2">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  New Winner Member *
                </label>
                <Select
                  value={correctMemberId || undefined}
                  onValueChange={(val) => setCorrectMemberId(val)}
                >
                  <SelectTrigger className="h-10 w-full text-sm">
                    <SelectValue placeholder="-- Choose New Winner --" />
                  </SelectTrigger>
                  <SelectContent>
                    {remainingEligibleMembers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name} ({formatCurrency(m.contributionPerChit || 5000, currency)}/mo)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Reason for Correction *
                </label>
                <textarea
                  placeholder="Explain why the winner is being re-assigned..."
                  value={correctReason}
                  onChange={(e) => setCorrectReason(e.target.value)}
                  className="flex min-h-[70px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  required
                />
              </div>
            </div>

            <DialogFooter className="pt-4 border-t border-border">
              <Button type="button" variant="outline" onClick={() => setShowCorrectModal(false)}>
                Cancel
              </Button>
              <Button type="submit" isLoading={correcting} className="bg-amber-500 hover:bg-amber-600 text-black font-bold">
                Save Correction
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
