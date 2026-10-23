'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from '@/components/ui/toast';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Coins,
  Users,
  ArrowDownLeft,
  ArrowUpRight,
  Scale,
  FileText,
  Plus,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Building2,
  Calendar,
  Pencil,
  Trash2,
  Download,
  Printer,
  Wallet,
  Settings,
  ShieldCheck,
  HelpCircle,
  Trophy,
  Dices,
  Sparkles,
  Award,
} from 'lucide-react';
import {
  ChitFund,
  ChitFundMember,
  ChitFundCollection,
  ChitFundPayout,
  ChitFundSummary,
  ChitFundCycleDetails,
  BankAccount,
  formatCurrency,
  formatCyclePillLabel,
  safeSubtract,
} from '@finora/shared';
import { useDataSync, emitDataChange } from '@/lib/data-sync';
import { ChitFundWinnersTab } from '@/components/chit-fund/ChitFundWinnersTab';
import { ChitFundSpinnerWheel } from '@/components/chit-fund/ChitFundSpinnerWheel';
import { ChitFundCollectionsOverview } from '@/components/chit-fund/ChitFundCollectionsOverview';

type ActiveTab = 'overview' | 'members' | 'collections' | 'winners' | 'spinner' | 'payouts' | 'ledger' | 'reconciliation' | 'reports';

function ChitFundContent() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as ActiveTab) || 'overview';

  const { user, isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab);
  const [loading, setLoading] = useState(true);

  // Core Data
  const [fund, setFund] = useState<ChitFund | null>(null);
  const [summary, setSummary] = useState<ChitFundSummary | null>(null);
  const [members, setMembers] = useState<ChitFundMember[]>([]);
  const [collections, setCollections] = useState<ChitFundCollection[]>([]);
  const [payouts, setPayouts] = useState<ChitFundPayout[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [reconciliation, setReconciliation] = useState<any | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [cycles, setCycles] = useState<ChitFundCycleDetails[]>([]);

  // Period Filter for Collections
  const [periodFilter, setPeriodFilter] = useState<string>('');

  // Modals
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [showEditMemberModal, setShowEditMemberModal] = useState(false);
  const [showRecordCollectionModal, setShowRecordCollectionModal] = useState(false);
  const [showRecordPayoutModal, setShowRecordPayoutModal] = useState(false);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form States - Member
  const [editingMember, setEditingMember] = useState<ChitFundMember | null>(null);
  const [memberName, setMemberName] = useState('');
  const [memberContributionPerChit, setMemberContributionPerChit] = useState('5000');
  const [memberPhone, setMemberPhone] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberNotes, setMemberNotes] = useState('');
  const [memberStatus, setMemberStatus] = useState<'active' | 'inactive' | 'archived'>('active');
  const [memberHasPreviouslyWon, setMemberHasPreviouslyWon] = useState(false);
  const [memberPreviousWinCycle, setMemberPreviousWinCycle] = useState('');
  const [winCycleYear, setWinCycleYear] = useState('2026');

  // Form States - Collection
  const [collectionMemberId, setCollectionMemberId] = useState('');
  const [collectionPeriod, setCollectionPeriod] = useState(
    new Date().toISOString().slice(0, 7) // e.g. "2026-10"
  );
  const [collectionChitsCovered, setCollectionChitsCovered] = useState(1);
  const [collectionExpectedAmount, setCollectionExpectedAmount] = useState('5000');
  const [collectionActualAmount, setCollectionActualAmount] = useState('5000');
  const [collectionDate, setCollectionDate] = useState(new Date().toISOString().slice(0, 10));
  const [collectionBankAccountId, setCollectionBankAccountId] = useState('');
  const [collectionSourceAccountId, setCollectionSourceAccountId] = useState('');
  const [collectionPaymentMethod, setCollectionPaymentMethod] = useState<'cash_in_hand' | 'upi'>('upi');
  const [collectionIsAlreadyPaid, setCollectionIsAlreadyPaid] = useState(false);
  const [collectionConfirmationStep, setCollectionConfirmationStep] = useState(false);
  const [collectionReference, setCollectionReference] = useState('');
  const [collectionNotes, setCollectionNotes] = useState('');

  // Form States - Payout
  const [payoutRecipientName, setPayoutRecipientName] = useState('');
  const [payoutMemberId, setPayoutMemberId] = useState('');
  const [payoutPeriod, setPayoutPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [payoutAmount, setPayoutAmount] = useState('100000');
  const [payoutCashAmount, setPayoutCashAmount] = useState('0');
  const [payoutUpiAmount, setPayoutUpiAmount] = useState('100000');
  const [payoutDate, setPayoutDate] = useState(new Date().toISOString().slice(0, 10));
  const [payoutBankAccountId, setPayoutBankAccountId] = useState('');
  const [payoutReference, setPayoutReference] = useState('');
  const [payoutNotes, setPayoutNotes] = useState('');
  const [payoutStatus, setPayoutStatus] = useState<'completed' | 'pending'>('completed');

  // Form States - Adjustment
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('Cash Deposit Reconciliation');
  const [adjustmentNotes, setAdjustmentNotes] = useState('');
  const [adjustmentDate, setAdjustmentDate] = useState(new Date().toISOString().slice(0, 10));


  const getApiUrl = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

  // Listen to live data sync
  useDataSync(() => {
    loadChitFundData();
  });

  // Sync tab with URL if changed externally
  useEffect(() => {
    const tab = searchParams.get('tab') as ActiveTab;
    if (tab && ['overview', 'members', 'collections', 'winners', 'spinner', 'payouts', 'ledger', 'reconciliation', 'reports'].includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  // Load Chit Fund & Master Data
  const loadChitFundData = async () => {
    setLoading(true);
    try {
      // 1. Get or Create Chit Fund
      const fundRes = await fetch(`${getApiUrl()}/api/v1/chit-funds`, { credentials: 'include' });
      const fundJson = await fundRes.json();
      if (!fundRes.ok || !fundJson.success) {
        toast.error('Failed to load Chit Fund');
        setLoading(false);
        return;
      }

      const activeFund: ChitFund = fundJson.data;
      setFund(activeFund);

      // 2. Fetch parallel fund metrics
      const [summaryRes, membersRes, collectionsRes, payoutsRes, ledgerRes, reconRes, accountsRes, cyclesRes] =
        await Promise.all([
          fetch(`${getApiUrl()}/api/v1/chit-funds/${activeFund.id}/summary`, { credentials: 'include' }),
          fetch(`${getApiUrl()}/api/v1/chit-funds/${activeFund.id}/members`, { credentials: 'include' }),
          fetch(`${getApiUrl()}/api/v1/chit-funds/${activeFund.id}/collections`, { credentials: 'include' }),
          fetch(`${getApiUrl()}/api/v1/chit-funds/${activeFund.id}/payouts`, { credentials: 'include' }),
          fetch(`${getApiUrl()}/api/v1/chit-funds/${activeFund.id}/ledger`, { credentials: 'include' }),
          fetch(`${getApiUrl()}/api/v1/chit-funds/${activeFund.id}/reconciliation`, { credentials: 'include' }),
          fetch(`${getApiUrl()}/api/v1/accounts`, { credentials: 'include' }),
          fetch(`${getApiUrl()}/api/v1/chit-funds/${activeFund.id}/cycles`, { credentials: 'include' }),
        ]);

      const [summaryJson, membersJson, collectionsJson, payoutsJson, ledgerJson, reconJson, accountsJson, cyclesJson] =
        await Promise.all([
          summaryRes.json(),
          membersRes.json(),
          collectionsRes.json(),
          payoutsRes.json(),
          ledgerRes.json(),
          reconRes.json(),
          accountsRes.json(),
          cyclesRes.json(),
        ]);

      if (summaryJson.success) setSummary(summaryJson.data);
      if (membersJson.success) setMembers(membersJson.data || []);
      if (collectionsJson.success) setCollections(collectionsJson.data || []);
      if (payoutsJson.success) setPayouts(payoutJsonFormat(payoutsJson.data || []));
      if (ledgerJson.success) setLedger(ledgerJson.data || []);
      if (reconJson.success) setReconciliation(reconJson.data || null);
      if (cyclesJson.success) setCycles(cyclesJson.data || []);
      if (accountsJson.success) {
        const accs: BankAccount[] = accountsJson.data || [];
        setBankAccounts(accs);
        // Pre-select designated bank account in forms if present
        const designated = accs.find((a) => a.isChitFundAccount);
        if (designated) {
          setCollectionBankAccountId(designated.id);
          setPayoutBankAccountId(designated.id);
        }
      }
    } catch (err) {
      toast.error('Network error loading Chit Fund details');
    } finally {
      setLoading(false);
    }
  };

  const payoutJsonFormat = (list: any[]) => list;

  useEffect(() => {
    if (isAuthenticated) {
      loadChitFundData();
    } else {
      setLoading(false);
    }
  }, [isAuthenticated]);

  // Handle Member Form Changes
  const calculatedMemberExpected = useMemo(() => {
    return parseFloat(memberContributionPerChit) || 5000;
  }, [memberContributionPerChit]);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fund) return;
    if (!memberName.trim()) {
      toast.error('Member name is required');
      return;
    }

    setSubmitting(true);
    try {
      const amountVal = parseFloat(memberContributionPerChit) || 5000;
      const res = await fetch(`${getApiUrl()}/api/v1/chit-funds/${fund.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: memberName.trim(),
          numberOfChits: 1, // Priority 8: Each member holds 1 chit
          monthlyContribution: amountVal,
          contributionPerChit: amountVal,
          phone: memberPhone.trim() || undefined,
          email: memberEmail.trim() || undefined,
          hasPreviouslyWon: memberHasPreviouslyWon,
          previousWinCycle: memberHasPreviouslyWon ? (memberPreviousWinCycle.trim() || undefined) : undefined,
          notes: memberNotes.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`Member "${memberName}" added successfully!`);
        setShowAddMemberModal(false);
        setMemberName('');
        setMemberContributionPerChit('5000');
        setMemberPhone('');
        setMemberEmail('');
        setMemberNotes('');
        setMemberHasPreviouslyWon(false);
        setMemberPreviousWinCycle('');
        loadChitFundData();
      } else {
        toast.error(json.error?.message || 'Failed to add member');
      }
    } catch {
      toast.error('Network error adding member');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenEditMember = (m: ChitFundMember) => {
    setEditingMember(m);
    setMemberName(m.name);
    setMemberContributionPerChit((m.totalExpectedPerPeriod || m.contributionPerChit || 5000).toString());
    setMemberPhone(m.phone || '');
    setMemberEmail(m.email || '');
    setMemberStatus(m.status);
    setMemberHasPreviouslyWon(Boolean(m.hasPreviouslyWon));
    const priorCycle = (m as any).previousWinCycle || '';
    setMemberPreviousWinCycle(priorCycle);
    if (priorCycle && priorCycle.length >= 4) {
      setWinCycleYear(priorCycle.slice(0, 4));
    }
    setMemberNotes(m.notes || '');
    setShowEditMemberModal(true);
  };

  const handleUpdateMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fund || !editingMember) return;
    if (!memberName.trim()) {
      toast.error('Member name is required');
      return;
    }

    setSubmitting(true);
    try {
      const amountVal = parseFloat(memberContributionPerChit) || 5000;
      const res = await fetch(`${getApiUrl()}/api/v1/chit-funds/${fund.id}/members/${editingMember.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: memberName.trim(),
          numberOfChits: 1, // Priority 8: Exactly 1 chit per member
          monthlyContribution: amountVal,
          contributionPerChit: amountVal,
          phone: memberPhone.trim() || undefined,
          email: memberEmail.trim() || undefined,
          status: memberStatus,
          hasPreviouslyWon: memberHasPreviouslyWon,
          previousWinCycle: memberHasPreviouslyWon ? (memberPreviousWinCycle.trim() || undefined) : undefined,
          notes: memberNotes.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`Member "${memberName}" updated!`);
        setShowEditMemberModal(false);
        setEditingMember(null);
        loadChitFundData();
      } else {
        toast.error(json.error?.message || 'Failed to update member');
      }
    } catch {
      toast.error('Network error updating member');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteMember = async (m: ChitFundMember) => {
    if (!fund) return;
    if (
      !confirm(
        `Are you sure you want to delete member "${m.name}"?\n\n` +
        `• If "${m.name}" has no financial history, they will be permanently deleted.\n` +
        `• If "${m.name}" has existing contributions or payouts, their membership will be safely archived to preserve financial records.\n` +
        `• If they have pending payout obligations, deletion will be blocked.`
      )
    )
      return;

    try {
      const res = await fetch(`${getApiUrl()}/api/v1/chit-funds/${fund.id}/members/${m.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(json.data?.message || `Member "${m.name}" deleted successfully`);
        loadChitFundData();
        emitDataChange('all');
      } else {
        toast.error(json.error?.message || 'Failed to delete member');
      }
    } catch {
      toast.error('Network error deleting member');
    }
  };

  // Calculate outstanding member dues for the selected collection cycle (Requirement 3.2)
  const outstandingMembersForCollection = useMemo(() => {
    return members
      .filter((m) => m.status === 'active')
      .map((m) => {
        const collectionsForPeriod = collections.filter(
          (c) =>
            c.collectionPeriod === collectionPeriod &&
            ((c.memberId as any)?.id === m.id ||
              (c.memberId as any)?._id === m.id ||
              (c.memberId as any) === m.id ||
              c.memberId === m.id ||
              (Boolean(c.memberName) && c.memberName === m.name))
        );
        const totalPaid = collectionsForPeriod.reduce(
          (sum, c) => sum + (c.actualAmountReceived || 0),
          0
        );
        const due = Math.max(0, m.totalExpectedPerPeriod - totalPaid);
        return {
          member: m,
          totalPaid,
          due,
          isFullyPaid: due <= 0,
        };
      });
  }, [members, collections, collectionPeriod]);

  // Handle Collection Recording
  const handleSelectMemberForCollection = (mId: string) => {
    setCollectionMemberId(mId);
    const item = outstandingMembersForCollection.find((i) => i.member.id === mId);
    if (item) {
      setCollectionChitsCovered(item.member.numberOfChits || 1);
      // Autofill with the remaining outstanding due for this cycle
      const defaultAmt = item.due > 0 ? item.due : (item.member.totalExpectedPerPeriod || 5000);
      setCollectionExpectedAmount(defaultAmt.toString());
      setCollectionActualAmount(defaultAmt.toString());
    } else {
      const m = members.find((item) => item.id === mId);
      if (m) {
        setCollectionChitsCovered(m.numberOfChits || 1);
        const defaultAmt = m.totalExpectedPerPeriod || m.contributionPerChit || 5000;
        setCollectionExpectedAmount(defaultAmt.toString());
        setCollectionActualAmount(defaultAmt.toString());
      }
    }
  };

  const handleOpenRecordCollectionModal = (mId?: string, period?: string) => {
    if (period) {
      setCollectionPeriod(period);
    }
    if (mId) {
      handleSelectMemberForCollection(mId);
    } else {
      setCollectionMemberId('');
      setCollectionExpectedAmount('5000');
      setCollectionActualAmount('5000');
    }
    // Set default payment method and bank account
    if (!collectionPaymentMethod) {
      setCollectionPaymentMethod('upi');
    }
    setCollectionIsAlreadyPaid(false);
    setCollectionConfirmationStep(false);
    const designated = bankAccounts.find((a) => a.isChitFundAccount);
    if (designated) {
      setCollectionBankAccountId(designated.id);
      setCollectionSourceAccountId(designated.id);
    } else if (bankAccounts.length > 0) {
      setCollectionBankAccountId(bankAccounts[0].id);
      setCollectionSourceAccountId(bankAccounts[0].id);
    }
    setShowRecordCollectionModal(true);
  };

  const handleRecordCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fund) return;
    if (!collectionMemberId) {
      toast.error('Please select a member');
      return;
    }

    const actual = parseFloat(collectionActualAmount) || 0;
    const expected = parseFloat(collectionExpectedAmount) || 0;
    if (actual <= 0) {
      toast.error('Please enter a valid amount received');
      return;
    }

    if (collectionPaymentMethod === 'upi' && !collectionBankAccountId) {
      const designated = bankAccounts.find((a) => a.isChitFundAccount);
      if (designated) {
        setCollectionBankAccountId(designated.id);
      } else if (bankAccounts.length > 0) {
        setCollectionBankAccountId(bankAccounts[0].id);
      } else if (!collectionIsAlreadyPaid) {
        toast.error('Please select a receiving bank account for UPI payment');
        return;
      }
    }

    // Step 1: Require review and confirmation step
    if (!collectionConfirmationStep) {
      setCollectionConfirmationStep(true);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/chit-funds/${fund.id}/collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          memberId: collectionMemberId,
          collectionPeriod,
          chitsCovered: collectionChitsCovered || 1,
          expectedAmount: expected,
          actualAmountReceived: actual,
          isAlreadyPaid: collectionIsAlreadyPaid,
          collectionDate: new Date(collectionDate).toISOString(),
          receivingBankAccountId: collectionPaymentMethod === 'upi' ? (collectionBankAccountId || undefined) : undefined,
          paymentMethod: collectionPaymentMethod,
          reference: collectionReference.trim() || undefined,
          notes: collectionNotes.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`Collection recorded successfully!`);
        setShowRecordCollectionModal(false);
        setCollectionConfirmationStep(false);
        setCollectionIsAlreadyPaid(false);
        setCollectionMemberId(''); // Member immediately disappears from dropdown
        setCollectionReference('');
        setCollectionNotes('');
        await loadChitFundData();
        emitDataChange('accounts');
        emitDataChange('all');
      } else {
        toast.error(json.error?.message || 'Failed to record collection');
      }
    } catch {
      toast.error('Network error recording collection');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteCollection = async (cId: string) => {
    if (!fund) return;
    if (!confirm('Are you sure you want to delete this collection entry? Any bank balance deposit will be safely reversed.'))
      return;

    try {
      const res = await fetch(`${getApiUrl()}/api/v1/chit-funds/${fund.id}/collections/${cId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Collection entry deleted');
        loadChitFundData();
      } else {
        toast.error(json.error?.message || 'Failed to delete collection');
      }
    } catch {
      toast.error('Network error deleting collection');
    }
  };

  // Handle Payout Recording
  const handleSelectMemberForPayout = (mId: string) => {
    setPayoutMemberId(mId);
    const m = members.find((item) => item.id === mId);
    if (m) {
      setPayoutRecipientName(m.name);
    }
  };

  const handleRecordPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fund) return;
    if (!payoutRecipientName.trim()) {
      toast.error('Recipient name is required');
      return;
    }
    const amt = parseFloat(payoutAmount);
    if (!amt || amt <= 0) {
      toast.error('Please enter a valid payout amount');
      return;
    }

    const cash = parseFloat(payoutCashAmount || '0') || 0;
    const upi = parseFloat(payoutUpiAmount || '0') || 0;
    if (Math.round((cash + upi) * 100) / 100 !== Math.round(amt * 100) / 100) {
      toast.error(
        `The sum of Cash (₹${cash.toLocaleString()}) and UPI / Bank Transfer (₹${upi.toLocaleString()}) must equal the Total Payout (₹${amt.toLocaleString()}).`
      );
      return;
    }

    if (upi > 0 && !payoutBankAccountId) {
      toast.error('Please select a source bank account for the UPI / Bank Transfer portion');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/chit-funds/${fund.id}/payouts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          recipientName: payoutRecipientName.trim(),
          memberId: payoutMemberId || undefined,
          payoutPeriod,
          amount: amt,
          cashAmount: cash,
          upiAmount: upi,
          payoutDate: new Date(payoutDate).toISOString(),
          sourceBankAccountId: upi > 0 ? payoutBankAccountId : undefined,
          status: payoutStatus,
          reference: payoutReference.trim() || undefined,
          notes: payoutNotes.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`Payout of ${formatCurrency(amt, fund.currency)} (${payoutStatus}) recorded!`);
        setShowRecordPayoutModal(false);
        setPayoutRecipientName('');
        setPayoutAmount('100000');
        setPayoutCashAmount('0');
        setPayoutUpiAmount('100000');
        setPayoutReference('');
        setPayoutNotes('');
        setPayoutStatus('completed');
        loadChitFundData();
        emitDataChange('accounts');
        emitDataChange('all');
      } else {
        toast.error(json.error?.message || 'Failed to record payout');
      }
    } catch {
      toast.error('Network error recording payout');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeletePayout = async (pId: string) => {
    if (!fund) return;
    if (!confirm('Are you sure you want to delete this payout entry? The source bank account balance will be restored.'))
      return;

    try {
      const res = await fetch(`${getApiUrl()}/api/v1/chit-funds/${fund.id}/payouts/${pId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Payout deleted and balance safely restored');
        loadChitFundData();
      } else {
        toast.error(json.error?.message || 'Failed to delete payout');
      }
    } catch {
      toast.error('Network error deleting payout');
    }
  };

  // Handle Manual Adjustment
  const handleRecordAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fund) return;
    const amt = parseFloat(adjustmentAmount);
    if (isNaN(amt) || amt === 0) {
      toast.error('Please enter a non-zero adjustment amount (+ for credit, - for debit)');
      return;
    }
    if (!adjustmentReason.trim()) {
      toast.error('Reason for adjustment is required');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/chit-funds/${fund.id}/adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          amount: amt,
          reason: adjustmentReason.trim(),
          notes: adjustmentNotes.trim() || undefined,
          date: new Date(adjustmentDate).toISOString(),
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Manual reconciliation adjustment recorded!');
        setShowAdjustmentModal(false);
        setAdjustmentAmount('');
        setAdjustmentNotes('');
        loadChitFundData();
      } else {
        toast.error(json.error?.message || 'Failed to record adjustment');
      }
    } catch {
      toast.error('Network error recording adjustment');
    } finally {
      setSubmitting(false);
    }
  };


  // Filter collections by period if specified
  const filteredCollections = useMemo(() => {
    if (!periodFilter) return collections;
    return collections.filter((c) => c.collectionPeriod === periodFilter);
  }, [collections, periodFilter]);

  // Export report as CSV
  const handleExportCSV = () => {
    if (!fund || members.length === 0) return;
    const headers = ['Member Name', 'Monthly Contribution', 'Status', 'Phone'];
    const rows = members.map((m) => [
      `"${m.name}"`,
      m.totalExpectedPerPeriod,
      m.status,
      `"${m.phone || ''}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Chit_Fund_Members_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Disabled Module Warning
  if (user?.modulePreferences?.chitFund === false) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Chit Fund Management</h1>
        </div>
        <Card className="border-border bg-card p-8 text-center max-w-xl mx-auto shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground mx-auto mb-4 border border-border">
            <Coins className="h-6 w-6" />
          </div>
          <h3 className="text-lg font-bold">Chit Fund Module is Disabled</h3>
          <p className="text-sm text-muted-foreground mt-2">
            The Chit Fund module is currently turned off in your account preferences. You can enable it anytime in Settings without losing any past collections or ledger records.
          </p>
          <div className="mt-6 flex justify-center">
            <Link href="/settings">
              <Button className="gap-2">
                <Settings className="h-4 w-4" />
                Go to Module Settings
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Chit Fund Management</h1>
            <Badge variant="outline" className="text-indigo-400 bg-indigo-500/10 border-indigo-500/30 gap-1">
              <Coins className="h-3 w-3" />
              {fund ? fund.name : 'Family Fund'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            20-person monthly pool, multi-chit member tracking, and liquid bank reserve reconciliation
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={loadChitFundData} variant="outline" size="sm" className="gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={() => handleOpenRecordCollectionModal()} size="sm" className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
            <ArrowDownLeft className="h-4 w-4" />
            Record Collection
          </Button>
          <Button onClick={() => setShowRecordPayoutModal(true)} size="sm" className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white">
            <ArrowUpRight className="h-4 w-4" />
            Record Payout
          </Button>
        </div>
      </div>

      {/* Discrepancy Banner (High Visibility if Active) */}
      {summary && (summary.discrepancy || 0) > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/10 shadow-sm animate-in fade-in">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-amber-500">
                  Chit Fund Reserve Discrepancy Detected
                </p>
                <p className="text-xs text-amber-500/90 mt-0.5">
                  Chit Fund Money Held ({formatCurrency(summary.totalChitFundMoneyHeld, fund?.currency || 'INR')})
                  exceeds the recorded balance of your designated bank account (
                  {formatCurrency(summary.designatedAccountBalance || 0, fund?.currency || 'INR')}) by{' '}
                  <span className="font-mono font-bold">
                    {formatCurrency(summary.discrepancy || 0, fund?.currency || 'INR')}
                  </span>
                  .
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setActiveTab('reconciliation')}
              className="border-amber-500/40 text-amber-500 hover:bg-amber-500/20 shrink-0 text-xs"
            >
              Resolve in Reconciliation →
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Tabs Navigation */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border pb-2 scrollbar-none">
        {[
          { id: 'overview', label: 'Overview', icon: Coins },
          { id: 'members', label: `Members (${members.length})`, icon: Users },
          { id: 'collections', label: 'Collections', icon: ArrowDownLeft },
          { id: 'winners', label: 'Winners', icon: Trophy },
          { id: 'spinner', label: 'Chit Lot Spinner', icon: Dices },
          { id: 'payouts', label: 'Payouts', icon: ArrowUpRight },
          { id: 'ledger', label: 'Fund Ledger', icon: Scale },
          { id: 'reconciliation', label: 'Reconciliation', icon: ShieldCheck },
          { id: 'reports', label: 'Reports', icon: FileText },
        ].map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as ActiveTab)}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg transition-all shrink-0 ${isActive
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6 animate-in fade-in">
          {/* Top KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-border bg-card">
              <CardContent className="p-4 space-y-1">
                <p className="text-xs text-muted-foreground uppercase font-semibold">Active Members</p>
                <div className="flex items-baseline justify-between">
                  <h3 className="text-2xl font-bold">{summary?.totalActiveMembers ?? members.length}</h3>
                  <span className="text-xs text-muted-foreground font-medium">
                    {summary?.totalActiveChits ?? members.length} Total Chits
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">Standard ₹5,000 / chit / mo</p>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardContent className="p-4 space-y-1">
                <p className="text-xs text-muted-foreground uppercase font-semibold">Expected / Period</p>
                <h3 className="text-2xl font-bold">
                  {formatCurrency(summary?.expectedCollectionPerPeriod ?? 0, fund?.currency || 'INR')}
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Actual: {formatCurrency(summary?.actualCollectionForPeriod ?? 0, fund?.currency || 'INR')}
                </p>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardContent className="p-4 space-y-1">
                <p className="text-xs text-muted-foreground uppercase font-semibold">Total Chit Funds Held</p>
                <h3 className="text-2xl font-bold text-indigo-400">
                  {formatCurrency(summary?.totalChitFundMoneyHeld ?? 0, fund?.currency || 'INR')}
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Bank: {formatCurrency(summary?.chitFundsHeldInBank ?? summary?.totalChitFundMoneyHeld ?? 0, fund?.currency || 'INR')} | Chit Cash: {formatCurrency(summary?.cashInHandChitFunds ?? 0, fund?.currency || 'INR')}
                </p>
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardContent className="p-4 space-y-1">
                <p className="text-xs text-muted-foreground uppercase font-semibold">Total Payouts</p>
                <h3 className="text-2xl font-bold">
                  {formatCurrency(summary?.totalPayouts ?? 0, fund?.currency || 'INR')}
                </h3>
                <p className="text-[11px] text-muted-foreground">Disbursed to winning members</p>
              </CardContent>
            </Card>
          </div>

          {/* Designated Bank Account Integration Summary Banner */}
          <Card className="border-border bg-gradient-to-r from-card to-card/60 shadow-sm overflow-hidden relative">
            <div className="absolute top-0 left-0 right-0 h-1 bg-brand-gradient" />
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-primary" />
                    Designated Bank Account Integration
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Clear separation between Chit Fund liabilities and your personal spendable balance
                  </CardDescription>
                </div>
                {summary?.designatedAccountId ? (
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-xs w-fit">
                    Active: {summary.designatedAccountName}
                  </Badge>
                ) : (
                  <Link href="/accounts">
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30 text-xs w-fit cursor-pointer hover:bg-amber-500/20">
                      ⚠️ No Account Designated — Configure in Accounts
                    </Badge>
                  </Link>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-xl bg-muted/30 border border-border/60">
                <div>
                  <span className="text-xs text-muted-foreground uppercase font-semibold block">
                    Total Bank Balance
                  </span>
                  <p className="text-2xl font-extrabold text-foreground mt-0.5">
                    {formatCurrency(summary?.designatedAccountBalance ?? 0, fund?.currency || 'INR')}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Total liquid cash in designated bank</p>
                </div>

                <div>
                  <span className="text-xs text-muted-foreground uppercase font-semibold block">
                    Chit Funds Held in Bank
                  </span>
                  <p className="text-2xl font-bold text-indigo-400 mt-0.5">
                    {formatCurrency(summary?.chitFundsHeldInBank ?? summary?.totalChitFundMoneyHeld ?? 0, fund?.currency || 'INR')}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {summary?.cashInHandChitFunds ? `+ ${formatCurrency(summary.cashInHandChitFunds, fund?.currency || 'INR')} held physically as Chit Cash in Hand` : 'Bank-held member liabilities'}
                  </p>
                </div>

                <div>
                  <span className="text-xs text-muted-foreground uppercase font-semibold block">
                    Personal Available Balance
                  </span>
                  <p className={`text-2xl font-extrabold mt-0.5 ${(summary?.personalAvailableBalance ?? 0) >= 0 ? 'text-[#05A100]' : 'text-[#CC0000]'
                    }`}>
                    {formatCurrency(Math.max(0, summary?.personalAvailableBalance ?? 0), fund?.currency || 'INR')}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Bank Balance - Chit Funds Held in Bank</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions & Recent Collections */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="border-border bg-card lg:col-span-1 space-y-4 p-5">
              <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                Fund Quick Actions
              </h4>
              <div className="space-y-2">
                <Button
                  onClick={() => handleOpenRecordCollectionModal()}
                  className="w-full justify-start gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-10"
                >
                  <ArrowDownLeft className="h-4 w-4" />
                  Record Member Contribution
                </Button>
                <Button
                  onClick={() => setShowRecordPayoutModal(true)}
                  className="w-full justify-start gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-10"
                >
                  <ArrowUpRight className="h-4 w-4" />
                  Disburse Member Payout
                </Button>
                <Button
                  onClick={() => setShowAddMemberModal(true)}
                  variant="outline"
                  className="w-full justify-start gap-2 text-xs h-10"
                >
                  <Plus className="h-4 w-4" />
                  Add New Fund Member
                </Button>
                <Button
                  onClick={() => setActiveTab('reconciliation')}
                  variant="outline"
                  className="w-full justify-start gap-2 text-xs h-10"
                >
                  <Scale className="h-4 w-4" />
                  Audit & Reconciliation
                </Button>
              </div>

              <div className="pt-4 border-t border-border space-y-2 text-xs text-muted-foreground">
                <p className="font-semibold text-foreground">Fund Rules & Standards:</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>20-chit capacity with support for multi-chit holders.</li>
                  <li>₹5,000 default contribution per chit.</li>
                  <li>Collections credit bank balance without triggering personal income.</li>
                  <li>Payouts debit bank balance without triggering personal expenses.</li>
                </ul>
              </div>
            </Card>

            <Card className="border-border bg-card lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div>
                  <CardTitle className="text-base font-bold">Recent Collections</CardTitle>
                  <CardDescription className="text-xs">Latest member contributions received</CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveTab('collections')}
                  className="text-xs"
                >
                  View All ({collections.length}) →
                </Button>
              </CardHeader>
              <CardContent className="pt-0">
                {collections.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-6 text-center">No collections recorded yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                        <tr>
                          <th className="py-2.5">Date</th>
                          <th className="py-2.5">Member</th>
                          <th className="py-2.5">Period</th>
                          <th className="py-2.5 text-right">Received</th>
                          <th className="py-2.5 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {collections.slice(0, 5).map((c) => (
                          <tr key={c.id} className="hover:bg-muted/40 transition-colors">
                            <td className="py-2.5 font-mono text-muted-foreground">
                              {new Date(c.collectionDate).toLocaleDateString()}
                            </td>
                            <td className="py-2.5 font-medium text-foreground">{c.memberName || 'Member'}</td>
                            <td className="py-2.5 text-muted-foreground font-mono">{c.collectionPeriod}</td>
                            <td className="py-2.5 text-right font-bold text-[#05A100]">
                              {formatCurrency(c.actualAmountReceived, fund?.currency || 'INR')}
                            </td>
                            <td className="py-2.5 text-right">
                              <Badge
                                variant="outline"
                                className={`text-[10px] capitalize ${c.status === 'completed'
                                  ? 'text-[#05A100] border-emerald-500/30 bg-emerald-500/10'
                                  : c.status === 'partial'
                                    ? 'text-amber-500 border-amber-500/30 bg-amber-500/10'
                                    : 'text-muted-foreground'
                                  }`}
                              >
                                {c.status}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* TAB 2: MEMBERS */}
      {activeTab === 'members' && (
        <div className="space-y-4 animate-in fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Fund Members ({members.length})</h2>
              <p className="text-xs text-muted-foreground">
                Manage participants, monthly contributions, and winner eligibility
              </p>
            </div>
            <Button onClick={() => setShowAddMemberModal(true)} size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              Add Member
            </Button>
          </div>

          <Card className="border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40 border-b border-border">
                  <tr>
                    <th className="py-3 px-4">Member Name</th>
                    <th className="py-3 px-4 text-right">Monthly Contribution</th>
                    <th className="py-3 px-4 text-center">Winner Status</th>
                    <th className="py-3 px-4">Contact</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {members.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-muted-foreground">
                        No members added yet. Click &apos;Add Member&apos; to configure your 20-person pool.
                      </td>
                    </tr>
                  ) : (
                    members.map((m) => {
                      const hasWon = m.hasPreviouslyWon;
                      let winBadgeLabel = 'Won';
                      if (hasWon) {
                        if ((m as any).previousWinCycle) {
                          winBadgeLabel = formatCyclePillLabel((m as any).previousWinCycle);
                        } else {
                          const cycleWin = cycles.find((c) => c.winnerMemberId === m.id);
                          if (cycleWin) {
                            winBadgeLabel = formatCyclePillLabel(cycleWin.cyclePeriod);
                          } else {
                            winBadgeLabel = 'Past Winner';
                          }
                        }
                      }

                      return (
                        <tr key={m.id} className="hover:bg-muted/40 transition-colors">
                          <td className="py-3 px-4 font-semibold text-foreground">{m.name}</td>
                          <td className="py-3 px-4 text-right font-bold text-foreground font-mono">
                            {formatCurrency(m.totalExpectedPerPeriod || m.contributionPerChit || 5000, fund?.currency || 'INR')}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {hasWon ? (
                              <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 gap-1 font-mono text-[11px] font-semibold">
                                <Trophy className="h-3 w-3 text-amber-400" />
                                {winBadgeLabel}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 bg-emerald-500/10 gap-1 text-[11px]">
                                <Sparkles className="h-3 w-3 text-emerald-400" />
                                Eligible
                              </Badge>
                            )}
                          </td>
                          <td className="py-3 px-4 text-muted-foreground">
                            {m.phone || m.email || <span className="italic text-muted-foreground/60">—</span>}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <Badge
                              className={`text-[10px] capitalize ${m.status === 'active'
                                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                : 'bg-muted text-muted-foreground border-border'
                                }`}
                            >
                              {m.status}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenEditMember(m)}
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                                title="Edit Member"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              {m.status === 'active' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDeleteMember(m)}
                                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                  title="Deactivate Member"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* TAB 3: COLLECTIONS */}
      {activeTab === 'collections' && fund && (
        <ChitFundCollectionsOverview
          fundId={fund.id}
          currency={fund.currency}
          members={members}
          collections={collections}
          summary={summary}
          activeCyclePeriod={summary?.currentPeriod || new Date().toISOString().slice(0, 7)}
          onOpenRecordCollection={(memberId, period) => handleOpenRecordCollectionModal(memberId, period)}
          onDeleteCollection={(collectionId) => handleDeleteCollection(collectionId)}
        />
      )}

      {/* TAB: WINNERS */}
      {activeTab === 'winners' && fund && (
        <ChitFundWinnersTab
          fundId={fund.id}
          currency={fund.currency}
          currentCyclePeriod={summary?.currentPeriod || new Date().toISOString().slice(0, 7)}
          cycleInfo={(summary as any)?.activeCycleInfo}
          cycles={cycles}
          members={members}
          onOpenSpinner={() => setActiveTab('spinner')}
          onOpenRecordPayout={(period, memberName, memberId) => {
            setPayoutPeriod(period);
            if (memberName) setPayoutRecipientName(memberName);
            if (memberId) setPayoutMemberId(memberId);
            setShowRecordPayoutModal(true);
          }}
          onRefresh={loadChitFundData}
        />
      )}

      {/* TAB: CHIT LOT SPINNER */}
      {activeTab === 'spinner' && fund && (
        <ChitFundSpinnerWheel
          fundId={fund.id}
          currency={fund.currency}
          currentCyclePeriod={summary?.currentPeriod || new Date().toISOString().slice(0, 7)}
          cycleInfo={(summary as any)?.activeCycleInfo}
          confirmedWinner={
            (summary as any)?.currentCycle?.winnerMemberName
              ? {
                name: (summary as any).currentCycle.winnerMemberName,
                confirmedAt: (summary as any).currentCycle.winnerConfirmedAt,
              }
              : null
          }
          onWinnerConfirmed={() => {
            loadChitFundData();
            setActiveTab('winners');
          }}
        />
      )}

      {/* TAB 4: PAYOUTS */}
      {activeTab === 'payouts' && (
        <div className="space-y-4 animate-in fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Payouts Disbursed</h2>
              <p className="text-xs text-muted-foreground">
                All winning prize pool amounts disbursed to members from bank reserves
              </p>
            </div>
            <Button
              onClick={() => setShowRecordPayoutModal(true)}
              size="sm"
              className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              <Plus className="h-4 w-4" />
              Record Payout
            </Button>
          </div>

          <Card className="border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40 border-b border-border">
                  <tr>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Recipient</th>
                    <th className="py-3 px-4">Payout Period</th>
                    <th className="py-3 px-4 text-right">Amount</th>
                    <th className="py-3 px-4">Source Bank Account</th>
                    <th className="py-3 px-4">Reference</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {payouts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted-foreground">
                        No payouts disbursed yet. When a member takes the chit pot, record the payout here.
                      </td>
                    </tr>
                  ) : (
                    payouts.map((p) => (
                      <tr key={p.id} className="hover:bg-muted/40 transition-colors">
                        <td className="py-3 px-4 font-mono text-muted-foreground">
                          {new Date(p.payoutDate).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4 font-semibold text-foreground">{p.recipientName}</td>
                        <td className="py-3 px-4 font-mono text-muted-foreground">{p.payoutPeriod}</td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-[#CC0000]">
                          {formatCurrency(p.amount, fund?.currency || 'INR')}
                        </td>
                        <td className="py-3 px-4 text-muted-foreground">{p.sourceAccountName || 'Cash / External'}</td>
                        <td className="py-3 px-4 font-mono text-muted-foreground">{p.reference || '—'}</td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeletePayout(p.id)}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                            title="Delete payout entry"
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
          </Card>
        </div>
      )}

      {/* TAB 5: FUND LEDGER */}
      {activeTab === 'ledger' && (
        <div className="space-y-4 animate-in fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Fund Ledger & Audit Log</h2>
              <p className="text-xs text-muted-foreground">
                Chronological double-entry record of collections (credit), payouts (debit), and running balance
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAdjustmentModal(true)}
                className="gap-2 text-xs"
              >
                <Scale className="h-4 w-4" />
                Record Adjustment
              </Button>
            </div>
          </div>

          <Card className="border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40 border-b border-border">
                  <tr>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Description</th>
                    <th className="py-3 px-4">Reference</th>
                    <th className="py-3 px-4 text-right">Credit (+)</th>
                    <th className="py-3 px-4 text-right">Debit (-)</th>
                    <th className="py-3 px-4 text-right">Running Fund Liability</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {ledger.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted-foreground">
                        Ledger is empty. As collections and payouts occur, chronological entries will populate here.
                      </td>
                    </tr>
                  ) : (
                    ledger.map((item) => (
                      <tr key={item.id} className="hover:bg-muted/40 transition-colors">
                        <td className="py-3 px-4 font-mono text-muted-foreground">
                          {new Date(item.date).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4">
                          <Badge
                            variant="outline"
                            className={`text-[10px] capitalize ${item.type === 'collection'
                              ? 'text-[#05A100] border-emerald-500/30 bg-emerald-500/10'
                              : item.type === 'payout'
                                ? 'text-[#CC0000] border-rose-500/30 bg-rose-500/10'
                                : 'text-indigo-400 border-indigo-500/30 bg-indigo-500/10'
                              }`}
                          >
                            {item.type}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 font-medium text-foreground">{item.description}</td>
                        <td className="py-3 px-4 font-mono text-muted-foreground">{item.reference || '—'}</td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-[#05A100]">
                          {item.credit > 0 ? formatCurrency(item.credit, fund?.currency || 'INR') : '—'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-[#CC0000]">
                          {item.debit > 0 ? formatCurrency(item.debit, fund?.currency || 'INR') : '—'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-extrabold text-foreground">
                          {formatCurrency(item.balance, fund?.currency || 'INR')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* TAB 6: RECONCILIATION */}
      {activeTab === 'reconciliation' && (
        <div className="space-y-6 animate-in fade-in">
          <div>
            <h2 className="text-lg font-bold">Bank Reserve Reconciliation</h2>
            <p className="text-xs text-muted-foreground">
              Verify that the liquid bank balance on deposit matches or exceeds the Chit Fund pool liability
            </p>
          </div>

          {/* 3-Way Reconciliation Comparison Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="border-border bg-card p-5 space-y-2">
              <span className="text-xs text-muted-foreground uppercase font-semibold">
                1. Recorded Bank Balance
              </span>
              <h3 className="text-2xl font-extrabold text-foreground">
                {formatCurrency(reconciliation?.recordedBankBalance ?? 0, fund?.currency || 'INR')}
              </h3>
              <p className="text-xs text-muted-foreground">
                Account: {reconciliation?.designatedAccount?.accountName || 'None Designated'}
              </p>
            </Card>

            <Card className="border-border bg-card p-5 space-y-2">
              <span className="text-xs text-muted-foreground uppercase font-semibold">
                2. Chit Fund Ledger Liability
              </span>
              <h3 className="text-2xl font-extrabold text-indigo-400">
                {formatCurrency(reconciliation?.chitFundLedgerBalance ?? 0, fund?.currency || 'INR')}
              </h3>
              <p className="text-xs text-muted-foreground">Cumulative pool collections minus payouts</p>
            </Card>

            <Card className="border-border bg-card p-5 space-y-2">
              <span className="text-xs text-muted-foreground uppercase font-semibold">
                3. Personal Available Balance
              </span>
              <h3 className={`text-2xl font-extrabold ${(reconciliation?.expectedPersonalAvailableBalance ?? 0) >= 0 ? 'text-[#05A100]' : 'text-[#CC0000]'
                }`}>
                {formatCurrency(
                  Math.max(0, reconciliation?.expectedPersonalAvailableBalance ?? 0),
                  fund?.currency || 'INR'
                )}
              </h3>
              <p className="text-xs text-muted-foreground">
                {`Bank Balance (${formatCurrency(reconciliation?.recordedBankBalance ?? 0, fund?.currency || 'INR')}) - Chit Fund Liability (${formatCurrency(reconciliation?.chitFundLedgerBalance ?? 0, fund?.currency || 'INR')})`}
              </p>
            </Card>
          </div>

          {/* Status Verdict */}
          {reconciliation?.hasDiscrepancy ? (
            <Card className="border-amber-500/40 bg-amber-500/10 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-6 w-6 text-amber-500 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-amber-500">
                    Discrepancy: Chit Fund Liabilities Exceed Bank Balance
                  </h4>
                  <p className="text-xs text-amber-500/90 leading-relaxed">
                    The Chit Fund ledger balance is higher than the recorded bank account balance by{' '}
                    <span className="font-bold font-mono">
                      {formatCurrency(reconciliation.discrepancyAmount, fund?.currency || 'INR')}
                    </span>
                    . This typically occurs when collections are received in cash and not yet deposited, payouts were made from personal funds, or bank adjustments are pending.
                  </p>
                  <div className="pt-2">
                    <Button
                      size="sm"
                      onClick={() => setShowAdjustmentModal(true)}
                      className="bg-amber-600 hover:bg-amber-700 text-white text-xs gap-1.5"
                    >
                      <Scale className="h-3.5 w-3.5" />
                      Record Reconciliation Adjustment
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="border-emerald-500/30 bg-emerald-500/10 p-5">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-6 w-6 text-emerald-400 shrink-0" />
                <div>
                  <h4 className="text-sm font-bold text-emerald-400">Fully Reconciled & Backed by Bank Reserves</h4>
                  <p className="text-xs text-emerald-400/90 mt-0.5">
                    Your designated bank balance exceeds or matches all active Chit Fund pool liabilities. Personal and chit fund assets are segregated cleanly.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* Diagnostics Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="border-border bg-card p-5 space-y-3">
              <h4 className="text-sm font-bold flex items-center gap-2">
                <Coins className="h-4 w-4 text-primary" />
                Unrouted / Cash Collections
              </h4>
              <p className="text-xs text-muted-foreground">
                Collections recorded as cash or routed outside the designated account:
              </p>
              <div className="flex justify-between items-center text-xs py-2 border-t border-border">
                <span className="text-muted-foreground">Transactions Count:</span>
                <span className="font-mono font-semibold">{reconciliation?.cashCollectionsCount || 0}</span>
              </div>
              <div className="flex justify-between items-center text-xs py-2 border-t border-border">
                <span className="text-muted-foreground">Total Cash Value:</span>
                <span className="font-mono font-bold text-[#05A100]">
                  {formatCurrency(reconciliation?.cashCollectionsAmount || 0, fund?.currency || 'INR')}
                </span>
              </div>
            </Card>

            <Card className="border-border bg-card p-5 space-y-3">
              <h4 className="text-sm font-bold flex items-center gap-2">
                <ArrowUpRight className="h-4 w-4 text-indigo-400" />
                Unrouted / Cash Payouts
              </h4>
              <p className="text-xs text-muted-foreground">
                Payouts disbursed via cash or unlinked accounts:
              </p>
              <div className="flex justify-between items-center text-xs py-2 border-t border-border">
                <span className="text-muted-foreground">Transactions Count:</span>
                <span className="font-mono font-semibold">{reconciliation?.cashPayoutsCount || 0}</span>
              </div>
              <div className="flex justify-between items-center text-xs py-2 border-t border-border">
                <span className="text-muted-foreground">Total Cash Value:</span>
                <span className="font-mono font-bold text-[#CC0000]">
                  {formatCurrency(reconciliation?.cashPayoutsAmount || 0, fund?.currency || 'INR')}
                </span>
              </div>
            </Card>
          </div>

          {/* Outstanding Member Dues for Current Period */}
          {reconciliation?.outstandingMemberDues && reconciliation.outstandingMemberDues.length > 0 && (
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Outstanding Dues for Current Period ({fund?.currentPeriod})
                </CardTitle>
                <CardDescription className="text-xs">
                  Active members with pending or partial contributions
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                      <tr>
                        <th className="py-2.5">Member</th>
                        <th className="py-2.5 text-right">Expected</th>
                        <th className="py-2.5 text-right">Paid</th>
                        <th className="py-2.5 text-right">Amount Due</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {reconciliation.outstandingMemberDues.map((due: any) => (
                        <tr key={due.memberId} className="hover:bg-muted/40">
                          <td className="py-2.5 font-semibold text-foreground">{due.memberName}</td>
                          <td className="py-2.5 text-right font-mono text-muted-foreground">
                            {formatCurrency(due.expected, fund?.currency || 'INR')}
                          </td>
                          <td className="py-2.5 text-right font-mono text-[#05A100]">
                            {formatCurrency(due.received, fund?.currency || 'INR')}
                          </td>
                          <td className="py-2.5 text-right font-mono font-bold text-[#CC0000]">
                            {formatCurrency(due.outstanding, fund?.currency || 'INR')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* TAB 7: REPORTS */}
      {activeTab === 'reports' && (
        <div className="space-y-6 animate-in fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Chit Fund Summary & Member Report</h2>
              <p className="text-xs text-muted-foreground">
                Export and print shareable statements for family and pool members
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={handleExportCSV} variant="outline" size="sm" className="gap-2 text-xs">
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
              <Button onClick={() => window.print()} variant="outline" size="sm" className="gap-2 text-xs">
                <Printer className="h-4 w-4" />
                Print Statement
              </Button>
            </div>
          </div>

          <Card className="border-border bg-card p-6 space-y-6">
            <div className="border-b border-border pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3 className="text-xl font-bold">{fund?.name || 'M12 Expense Tracker Chit Fund'}</h3>
                <p className="text-xs text-muted-foreground">
                  Monthly Contribution Pool — Generated {new Date().toLocaleDateString()}
                </p>
              </div>
              <Badge className="bg-indigo-500/15 text-indigo-400 border-indigo-500/30 text-xs">
                {fund?.collectionFrequency || 'Monthly'} Cycle
              </Badge>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div className="p-3 rounded-lg bg-muted/40 border border-border">
                <span className="text-muted-foreground block">Active Members:</span>
                <span className="text-lg font-bold text-foreground">{members.length}</span>
              </div>
              <div className="p-3 rounded-lg bg-muted/40 border border-border">
                <span className="text-muted-foreground block">Total Chits:</span>
                <span className="text-lg font-bold text-foreground">
                  {members.length}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-muted/40 border border-border">
                <span className="text-muted-foreground block">Total Collections:</span>
                <span className="text-lg font-bold text-[#05A100]">
                  {formatCurrency(
                    collections.reduce((s, c) => s + c.actualAmountReceived, 0),
                    fund?.currency || 'INR'
                  )}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-muted/40 border border-border">
                <span className="text-muted-foreground block">Total Payouts:</span>
                <span className="text-lg font-bold text-[#CC0000]">
                  {formatCurrency(
                    payouts.reduce((s, p) => s + p.amount, 0),
                    fund?.currency || 'INR'
                  )}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-bold">Member Contribution Roster</h4>
              <div className="overflow-x-auto border border-border rounded-lg">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    <tr>
                      <th className="py-2.5 px-3">#</th>
                      <th className="py-2.5 px-3">Member Name</th>
                      <th className="py-2.5 px-3 text-right">Expected / Month</th>
                      <th className="py-2.5 px-3 text-right">Total Contributed</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {members.map((m, idx) => {
                      const totalPaid = collections
                        .filter((c) => (c.memberId as any)?._id === m.id || c.memberId === m.id || c.memberName === m.name)
                        .reduce((s, c) => s + c.actualAmountReceived, 0);

                      return (
                        <tr key={m.id} className="hover:bg-muted/40">
                          <td className="py-2.5 px-3 font-mono text-muted-foreground">{idx + 1}</td>
                          <td className="py-2.5 px-3 font-semibold text-foreground">{m.name}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-medium">
                            {formatCurrency(m.totalExpectedPerPeriod, fund?.currency || 'INR')}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-[#05A100]">
                            {formatCurrency(totalPaid, fund?.currency || 'INR')}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <Badge
                              className={`text-[10px] capitalize ${m.status === 'active'
                                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                : 'bg-muted text-muted-foreground'
                                }`}
                            >
                              {m.status}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ========================================================== */}
      {/* MODAL 1: ADD MEMBER */}
      {/* ========================================================== */}
      {showAddMemberModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <Card className="w-full max-w-md shadow-2xl border-border animate-in zoom-in-95">
            <CardHeader>
              <CardTitle>Add Chit Fund Member</CardTitle>
              <CardDescription>
                Add a participant to the family chit fund pool (standard ₹5,000 monthly contribution).
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleAddMember}>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Member Full Name *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Ramesh Kumar"
                    value={memberName}
                    onChange={(e) => setMemberName(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Monthly Contribution Amount (₹) *
                  </label>
                  <input
                    type="number"
                    step="100"
                    placeholder="5000"
                    value={memberContributionPerChit}
                    onChange={(e) => setMemberContributionPerChit(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Standard monthly contribution is ₹5,000 (or ₹10,000 for 2-chit capacity).
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Phone Number (Optional)
                    </label>
                    <input
                      type="tel"
                      placeholder="+91 98765 43210"
                      value={memberPhone}
                      onChange={(e) => setMemberPhone(e.target.value)}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Email (Optional)
                    </label>
                    <input
                      type="email"
                      placeholder="member@example.com"
                      value={memberEmail}
                      onChange={(e) => setMemberEmail(e.target.value)}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Notes (Optional)
                  </label>
                  <textarea
                    placeholder="e.g. Relative / neighbor..."
                    value={memberNotes}
                    onChange={(e) => setMemberNotes(e.target.value)}
                    className="flex min-h-[60px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-3">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={memberHasPreviouslyWon}
                      onChange={(e) => setMemberHasPreviouslyWon(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    />
                    <div>
                      <span className="text-xs font-bold text-foreground block">
                        Already Won a Chit
                      </span>
                      <span className="text-[11px] text-muted-foreground block mt-0.5">
                        Mark if this member has already won a prize pot in the past. Excludes them from the spinner and registers them in Chit Winner History.
                      </span>
                    </div>
                  </label>

                  {memberHasPreviouslyWon && (
                    <div className="pt-2 border-t border-amber-500/20 space-y-2 animate-in fade-in">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">
                          Winning Cycle (Year & Month)
                        </label>
                        <select
                          value={winCycleYear}
                          onChange={(e) => setWinCycleYear(e.target.value)}
                          className="h-7 rounded border border-amber-500/40 bg-background px-2 text-xs font-mono text-foreground focus:outline-none"
                        >
                          {['2024', '2025', '2026', '2027', '2028'].map((y) => (
                            <option key={y} value={y}>{y}</option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-6 sm:grid-cols-12 gap-1">
                        {['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].map((mName, idx) => {
                          const monthStr = String(idx + 1).padStart(2, '0');
                          const cycleVal = `${winCycleYear}-${monthStr}`;
                          const isSelected = memberPreviousWinCycle === cycleVal;
                          return (
                            <button
                              key={mName}
                              type="button"
                              onClick={() => setMemberPreviousWinCycle(isSelected ? '' : cycleVal)}
                              className={`py-1 rounded text-[11px] font-mono font-bold border transition-colors ${isSelected
                                ? 'bg-amber-500 text-black border-amber-500'
                                : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                                }`}
                            >
                              {mName}
                            </button>
                          );
                        })}
                      </div>
                      {memberPreviousWinCycle && (
                        <div className="text-[11px] text-amber-400/90 flex items-center justify-between font-mono">
                          <span>Selected Cycle: {memberPreviousWinCycle}</span>
                          <button
                            type="button"
                            onClick={() => setMemberPreviousWinCycle('')}
                            className="text-[10px] text-muted-foreground hover:underline"
                          >
                            Clear Selection
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>

              <CardFooter className="flex justify-end gap-2 border-t border-border pt-4">
                <Button type="button" variant="outline" onClick={() => setShowAddMemberModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" isLoading={submitting}>
                  Save Member
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      {/* ========================================================== */}
      {/* MODAL 2: EDIT MEMBER */}
      {/* ========================================================== */}
      {showEditMemberModal && editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <Card className="w-full max-w-md shadow-2xl border-border animate-in zoom-in-95">
            <CardHeader>
              <CardTitle>Edit Chit Fund Member</CardTitle>
              <CardDescription>Update member contribution or contact details</CardDescription>
            </CardHeader>
            <form onSubmit={handleUpdateMember}>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Member Full Name *
                  </label>
                  <input
                    type="text"
                    value={memberName}
                    onChange={(e) => setMemberName(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Monthly Contribution Amount (₹) *
                  </label>
                  <input
                    type="number"
                    step="100"
                    value={memberContributionPerChit}
                    onChange={(e) => setMemberContributionPerChit(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Status
                    </label>
                    <select
                      value={memberStatus}
                      onChange={(e) => setMemberStatus(e.target.value as any)}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      value={memberPhone}
                      onChange={(e) => setMemberPhone(e.target.value)}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Email
                  </label>
                  <input
                    type="email"
                    value={memberEmail}
                    onChange={(e) => setMemberEmail(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Notes (Optional)
                  </label>
                  <textarea
                    value={memberNotes}
                    onChange={(e) => setMemberNotes(e.target.value)}
                    className="flex min-h-[60px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-3">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={memberHasPreviouslyWon}
                      onChange={(e) => setMemberHasPreviouslyWon(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    />
                    <div>
                      <span className="text-xs font-bold text-foreground block">
                        Already Won a Chit
                      </span>
                      <span className="text-[11px] text-muted-foreground block mt-0.5">
                        Mark if this member has already won a prize pot. Excludes them from future lot spinner selections.
                      </span>
                    </div>
                  </label>

                  {memberHasPreviouslyWon && (
                    <div className="pt-2 border-t border-amber-500/20 space-y-2 animate-in fade-in">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">
                          Winning Cycle (Year & Month)
                        </label>
                        <select
                          value={winCycleYear}
                          onChange={(e) => setWinCycleYear(e.target.value)}
                          className="h-7 rounded border border-amber-500/40 bg-background px-2 text-xs font-mono text-foreground focus:outline-none"
                        >
                          {['2024', '2025', '2026', '2027', '2028'].map((y) => (
                            <option key={y} value={y}>{y}</option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-6 sm:grid-cols-12 gap-1">
                        {['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].map((mName, idx) => {
                          const monthStr = String(idx + 1).padStart(2, '0');
                          const cycleVal = `${winCycleYear}-${monthStr}`;
                          const isSelected = memberPreviousWinCycle === cycleVal;
                          return (
                            <button
                              key={mName}
                              type="button"
                              onClick={() => setMemberPreviousWinCycle(isSelected ? '' : cycleVal)}
                              className={`py-1 rounded text-[11px] font-mono font-bold border transition-colors ${isSelected
                                ? 'bg-amber-500 text-black border-amber-500'
                                : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                                }`}
                            >
                              {mName}
                            </button>
                          );
                        })}
                      </div>
                      {memberPreviousWinCycle && (
                        <div className="text-[11px] text-amber-400/90 flex items-center justify-between font-mono">
                          <span>Selected Cycle: {memberPreviousWinCycle}</span>
                          <button
                            type="button"
                            onClick={() => setMemberPreviousWinCycle('')}
                            className="text-[10px] text-muted-foreground hover:underline"
                          >
                            Clear Selection
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>

              <CardFooter className="flex justify-end gap-2 border-t border-border pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowEditMemberModal(false);
                    setEditingMember(null);
                  }}
                >
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

      {/* ========================================================== */}
      {/* MODAL 3: RECORD COLLECTION */}
      {/* ========================================================== */}
      {showRecordCollectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <Card className="w-full max-w-lg shadow-2xl border-border animate-in zoom-in-95 max-h-[92vh] flex flex-col">
            <CardHeader className="pb-3 border-b border-border">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <ArrowDownLeft className="h-5 w-5 text-emerald-400" />
                  Record Member Collection
                </CardTitle>
                <Badge variant="outline" className="text-xs bg-indigo-500/10 text-indigo-400 border-indigo-500/30">
                  {formatCyclePillLabel(collectionPeriod)}
                </Badge>
              </div>
              <CardDescription className="text-xs">
                Record a monthly member contribution. Chit Cash in Hand is physical cash held for chit fund; UPI deposits into your designated bank account as Chit Fund money.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleRecordCollection} className="flex-1 overflow-y-auto">
              <CardContent className="space-y-4 pt-4">
                {collectionConfirmationStep ? (
                  /* ========================================================== */
                  /* CONFIRMATION POPUP STEP (Section 10 Requirement)           */
                  /* ========================================================== */
                  <div className="space-y-4 animate-in fade-in zoom-in-95">
                    <div className="p-4 rounded-xl border border-border bg-card space-y-3">
                      <div className="flex items-center justify-between border-b border-border pb-2.5">
                        <span className="text-xs text-muted-foreground uppercase font-semibold">Confirmation Overview</span>
                        <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                          Ready to Record
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <span className="text-muted-foreground block text-[11px]">Member Name</span>
                          <span className="font-bold text-foreground">
                            {outstandingMembersForCollection.find((m) => m.member.id === collectionMemberId)?.member.name || 'Selected Member'}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-[11px]">Selected Cycle</span>
                          <span className="font-mono font-bold text-foreground">{collectionPeriod}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-[11px]">Expected Contribution</span>
                          <span className="font-mono font-bold text-foreground">
                            {formatCurrency(parseFloat(collectionExpectedAmount) || 0, fund?.currency || 'INR')}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-[11px]">Amount to Record</span>
                          <span className="font-mono font-bold text-emerald-400 text-sm">
                            {formatCurrency(parseFloat(collectionActualAmount) || 0, fund?.currency || 'INR')}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-[11px]">Payment Method</span>
                          <span className="font-semibold text-foreground">
                            {collectionPaymentMethod === 'cash_in_hand'
                              ? 'Cash in Hand'
                              : 'UPI / Bank'}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-[11px]">Already Paid Option</span>
                          <Badge variant={collectionIsAlreadyPaid ? 'default' : 'secondary'} className="text-[10px]">
                            {collectionIsAlreadyPaid ? 'Already Paid (Reserve / History)' : 'Standard Payment'}
                          </Badge>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-[11px]">Previously Recorded</span>
                          <span className="font-mono text-muted-foreground">
                            {formatCurrency(
                              (() => {
                                const m = outstandingMembersForCollection.find((item) => item.member.id === collectionMemberId);
                                return m ? m.totalPaid : 0;
                              })(),
                              fund?.currency || 'INR'
                            )}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-[11px]">Remaining After This</span>
                          <span className="font-mono font-bold text-foreground">
                            {formatCurrency(
                              (() => {
                                const m = outstandingMembersForCollection.find((item) => item.member.id === collectionMemberId);
                                const due = m ? m.due : 0;
                                return Math.max(0, due - (parseFloat(collectionActualAmount) || 0));
                              })(),
                              fund?.currency || 'INR'
                            )}
                          </span>
                        </div>
                      </div>

                      {/* Accounting explanation */}
                      <div className="pt-2 border-t border-border text-[11px] text-muted-foreground space-y-1">
                        <span className="font-semibold text-foreground block">Accounting Impact:</span>
                        {collectionIsAlreadyPaid ? (
                          collectionPaymentMethod === 'upi' ? (
                            <p className="text-amber-400 bg-amber-500/10 p-2 rounded-lg border border-amber-500/20">
                              🛡️ <strong>Already Paid (Bank Reserve Reclassification):</strong> Allocates {formatCurrency(parseFloat(collectionActualAmount) || 0, fund?.currency || 'INR')} of personal bank funds to the chit fund reserve. Personal Available Balance decreases by {formatCurrency(parseFloat(collectionActualAmount) || 0, fund?.currency || 'INR')} and Chit Reserve increases. Actual bank balance stays unchanged with no duplicate transaction.
                            </p>
                          ) : (
                            <p className="text-amber-400 bg-amber-500/10 p-2 rounded-lg border border-amber-500/20">
                              🛡️ <strong>Already Paid (Historical Cash):</strong> Records member contribution completed prior to app tracking. Does not alter current physical Chit Cash in Hand.
                            </p>
                          )
                        ) : collectionPaymentMethod === 'cash_in_hand' ? (
                          <p className="text-emerald-400 bg-emerald-500/10 p-2 rounded-lg border border-emerald-500/20">
                            💵 <strong>Cash in Hand:</strong> Physical cash received and tracked in Chit Cash in Hand. Bank accounts and personal cash remain untouched.
                          </p>
                        ) : (
                          <p className="text-blue-400 bg-blue-500/10 p-2 rounded-lg border border-blue-500/20">
                            📱 <strong>UPI:</strong> Increases bank balance and chit funds held in bank without counting as personal income.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ========================================================== */
                  /* FORM INPUTS STEP                                           */
                  /* ========================================================== */
                  <>
                    {/* 1. Chit Fund Name */}
                    <div className="p-3 rounded-lg bg-muted/40 border border-border flex items-center justify-between text-xs">
                      <span className="text-muted-foreground font-medium">Chit Fund Pool:</span>
                      <span className="font-bold text-foreground flex items-center gap-1.5">
                        <Coins className="h-3.5 w-3.5 text-primary" />
                        {fund?.name || 'M12 Expense Tracker Chit Fund'}
                      </span>
                    </div>

                    {/* 2. Cycle Month & Year */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Cycle Month & Year (YYYY-MM) *
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. 2026-10"
                        value={collectionPeriod}
                        onChange={(e) => setCollectionPeriod(e.target.value)}
                        className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        required
                      />
                    </div>

                    {/* 3. Member Dropdown (Filtered to unpaid) */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Member *
                        </label>
                        <span className="text-[11px] text-muted-foreground font-mono">
                          Unpaid for {collectionPeriod}
                        </span>
                      </div>
                      <select
                        value={collectionMemberId}
                        onChange={(e) => handleSelectMemberForCollection(e.target.value)}
                        className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        required
                      >
                        <option value="">-- Select Member with Outstanding Dues --</option>
                        {outstandingMembersForCollection
                          .filter((item) => !item.isFullyPaid || item.member.id === collectionMemberId)
                          .map((item) => (
                            <option key={item.member.id} value={item.member.id}>
                              {item.member.name} (Due: {formatCurrency(item.due, fund?.currency || 'INR')})
                            </option>
                          ))}
                      </select>
                      {outstandingMembersForCollection.filter((item) => !item.isFullyPaid).length === 0 && (
                        <p className="text-[11px] text-emerald-400">
                          ✓ All active members have fully recorded their contributions for {collectionPeriod}.
                        </p>
                      )}
                    </div>

                    {/* 4. Payment Method: Cash in Hand vs UPI (Section 10 Requirement) */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Payment Method *
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setCollectionPaymentMethod('cash_in_hand');
                            setCollectionBankAccountId('');
                          }}
                          className={`flex items-center justify-center gap-1.5 p-2.5 rounded-lg border text-xs font-semibold transition-all ${collectionPaymentMethod === 'cash_in_hand'
                            ? 'border-emerald-500 bg-emerald-500/15 text-emerald-400 shadow-sm'
                            : 'border-border bg-card text-muted-foreground hover:bg-muted/40'
                            }`}
                        >
                          <Coins className="h-3.5 w-3.5" />
                          Cash in Hand
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCollectionPaymentMethod('upi');
                            const designated = bankAccounts.find((a) => a.isChitFundAccount);
                            if (designated) setCollectionBankAccountId(designated.id);
                            else if (bankAccounts.length > 0) setCollectionBankAccountId(bankAccounts[0].id);
                          }}
                          className={`flex items-center justify-center gap-1.5 p-2.5 rounded-lg border text-xs font-semibold transition-all ${collectionPaymentMethod === 'upi'
                            ? 'border-indigo-500 bg-indigo-500/15 text-indigo-400 shadow-sm'
                            : 'border-border bg-card text-muted-foreground hover:bg-muted/40'
                            }`}
                        >
                          <ArrowDownLeft className="h-3.5 w-3.5" />
                          UPI / Bank
                        </button>
                      </div>

                      {/* Payment Method Explanations */}
                      {collectionPaymentMethod === 'cash_in_hand' && (
                        <p className="text-[11px] text-muted-foreground bg-muted/40 p-2.5 rounded-lg border border-border">
                          💵 Physical Cash: Stored physically in hand. Does <strong className="text-foreground">not</strong> touch or increase your bank account balance, and does not count as personal income.
                        </p>
                      )}
                      {collectionPaymentMethod === 'upi' && (
                        <p className="text-[11px] text-muted-foreground bg-muted/40 p-2.5 rounded-lg border border-border">
                          📱 UPI / Bank Deposit: Increases designated bank balance and chit funds held in bank without counting as personal income.
                        </p>
                      )}
                    </div>

                    {/* Receiving Bank Account (Only for UPI) */}
                    {collectionPaymentMethod === 'upi' && (
                      <div className="space-y-1.5 animate-in fade-in">
                        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Receiving Bank Account *
                        </label>
                        <select
                          value={collectionBankAccountId}
                          onChange={(e) => setCollectionBankAccountId(e.target.value)}
                          className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          required
                        >
                          <option value="">-- Select Bank Account --</option>
                          {bankAccounts.map((acc) => (
                            <option key={acc.id} value={acc.id}>
                              {acc.accountName} {acc.isChitFundAccount ? '(Chit Fund Account)' : ''} (Balance: {formatCurrency(acc.currentBalance, fund?.currency || 'INR')})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* 5. Contribution Amount */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Contribution Amount Received *
                        </label>
                        {parseFloat(collectionActualAmount) < parseFloat(collectionExpectedAmount) && (
                          <span className="text-[11px] text-amber-500 font-semibold">
                            Partial payment
                          </span>
                        )}
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        value={collectionActualAmount}
                        onChange={(e) => setCollectionActualAmount(e.target.value)}
                        className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        required
                      />
                    </div>

                    {/* 6. Collection Date */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Collection Date *
                      </label>
                      <DatePicker
                        value={collectionDate}
                        onChange={setCollectionDate}
                      />
                    </div>

                    {/* 7. Already Paid Option (Section 10 Requirement) */}
                    <div className="p-3 rounded-lg border border-border/80 bg-muted/30 flex items-start gap-3">
                      <input
                        type="checkbox"
                        id="colAlreadyPaid"
                        checked={collectionIsAlreadyPaid}
                        onChange={(e) => setCollectionIsAlreadyPaid(e.target.checked)}
                        className="mt-0.5 rounded border-input text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                      />
                      <div className="space-y-0.5">
                        <label htmlFor="colAlreadyPaid" className="text-xs font-bold text-foreground cursor-pointer select-none block">
                          Already Paid (Prior or Historical Payment)
                        </label>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          Check this if payment has already happened. The system will record member contribution without creating duplicate bank or cash movements.
                        </p>
                      </div>
                    </div>

                    {/* 8. Notes / Reference */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Reference / UTR # (Optional)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. UPI/123456789"
                          value={collectionReference}
                          onChange={(e) => setCollectionReference(e.target.value)}
                          className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Notes (Optional)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Oct collection"
                          value={collectionNotes}
                          onChange={(e) => setCollectionNotes(e.target.value)}
                          className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      </div>
                    </div>
                  </>
                )}
              </CardContent>

              <CardFooter className="flex justify-end gap-2 border-t border-border pt-4 mt-2">
                {collectionConfirmationStep ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setCollectionConfirmationStep(false)}
                      disabled={submitting}
                    >
                      Back to Edit
                    </Button>
                    <Button
                      type="submit"
                      disabled={submitting}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                    >
                      {submitting ? 'Recording...' : 'Confirm & Save Collection'}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button type="button" variant="outline" onClick={() => setShowRecordCollectionModal(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
                      Review &amp; Confirm
                    </Button>
                  </>
                )}
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      {/* ========================================================== */}
      {/* MODAL 4: RECORD PAYOUT */}
      {/* ========================================================== */}
      {showRecordPayoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <Card className="w-full max-w-lg shadow-2xl border-border animate-in zoom-in-95">
            <CardHeader>
              <CardTitle>Record Chit Fund Payout</CardTitle>
              <CardDescription>
                Disburse pool funds to the winning bidder/recipient. Debiting from the bank account settles pool liabilities without counting as a personal expense.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleRecordPayout}>
              <CardContent className="space-y-4 h-[60vh] overflow-y-auto">
                {/* Winner Autofill Banner if cycle has a confirmed winner */}
                {(() => {
                  const matchedCycle = cycles.find((c) => c.cyclePeriod === payoutPeriod);
                  if (!matchedCycle?.winnerMemberName) return null;
                  return (
                    <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between text-xs">
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Confirmed Winner for {payoutPeriod}:</span>
                        <span className="font-bold text-emerald-400 text-sm">{matchedCycle.winnerMemberName}</span>
                      </div>
                      {payoutRecipientName !== matchedCycle.winnerMemberName && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setPayoutRecipientName(matchedCycle.winnerMemberName || '');
                            if (matchedCycle.winnerMemberId) {
                              setPayoutMemberId(matchedCycle.winnerMemberId.toString());
                            }
                          }}
                          className="text-[11px] h-7 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/20"
                        >
                          Use Confirmed Winner
                        </Button>
                      )}
                    </div>
                  );
                })()}

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Select Recipient Member (Optional helper)
                  </label>
                  <select
                    value={payoutMemberId}
                    onChange={(e) => handleSelectMemberForPayout(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">-- Or type recipient name manually below --</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Recipient Full Name *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Ramesh Kumar"
                    value={payoutRecipientName}
                    onChange={(e) => setPayoutRecipientName(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Payout Status *
                  </label>
                  <select
                    value={payoutStatus}
                    onChange={(e: any) => setPayoutStatus(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    required
                  >
                    <option value="completed">Completed (Paid out now — debits bank account)</option>
                    <option value="pending">Pending (Prize awarded — bank balance unaffected until disbursed)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Payout Period *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 2026-10"
                      value={payoutPeriod}
                      onChange={(e) => setPayoutPeriod(e.target.value)}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Payout Date *
                    </label>
                    <DatePicker
                      value={payoutDate}
                      onChange={setPayoutDate}
                    />
                  </div>
                </div>

                {/* Total Payout Amount */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Total Payout Amount *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="e.g. 100000"
                    value={payoutAmount}
                    onChange={(e) => {
                      const val = e.target.value;
                      setPayoutAmount(val);
                      setPayoutUpiAmount(val);
                      setPayoutCashAmount('0');
                    }}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    required
                  />
                </div>

                {/* Split Disbursement Breakdown: Cash in Hand + UPI */}
                <div className="p-3.5 rounded-xl border border-border bg-muted/20 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-foreground block">
                        Disbursement Split (Cash + UPI)
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Specify how much is paid from physical cash vs bank transfer
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setPayoutCashAmount('0');
                          setPayoutUpiAmount(payoutAmount);
                        }}
                        className="text-[10px] px-2 py-0.5 rounded border border-border bg-card hover:bg-muted font-medium text-foreground"
                      >
                        All UPI
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPayoutCashAmount(payoutAmount);
                          setPayoutUpiAmount('0');
                        }}
                        className="text-[10px] px-2 py-0.5 rounded border border-border bg-card hover:bg-muted font-medium text-foreground"
                      >
                        All Cash
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const half = ((parseFloat(payoutAmount) || 100000) / 2).toString();
                          setPayoutCashAmount(half);
                          setPayoutUpiAmount(half);
                        }}
                        className="text-[10px] px-2 py-0.5 rounded border border-border bg-card hover:bg-muted font-medium text-foreground"
                      >
                        50 / 50
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                        <Coins className="h-3 w-3 text-amber-400" />
                        Chit Cash in Hand (₹)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0"
                        value={payoutCashAmount}
                        onChange={(e) => setPayoutCashAmount(e.target.value)}
                        className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-mono font-bold text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                      <span className="text-[10px] text-muted-foreground block">Deducts Chit Cash in Hand</span>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                        <Building2 className="h-3 w-3 text-indigo-400" />
                        UPI / Bank Transfer (₹)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0"
                        value={payoutUpiAmount}
                        onChange={(e) => setPayoutUpiAmount(e.target.value)}
                        className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-mono font-bold text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                      <span className="text-[10px] text-muted-foreground block">Debits bank account</span>
                    </div>
                  </div>

                  {/* Live Validation Indicator */}
                  {(() => {
                    const total = parseFloat(payoutAmount) || 0;
                    const cash = parseFloat(payoutCashAmount || '0') || 0;
                    const upi = parseFloat(payoutUpiAmount || '0') || 0;
                    const sum = Math.round((cash + upi) * 100) / 100;
                    const matches = Math.round(total * 100) / 100 === sum;

                    return (
                      <div className={`p-2 rounded-lg text-[11px] flex items-center gap-1.5 border ${matches
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : 'bg-destructive/10 text-destructive border-destructive/30'
                        }`}>
                        {matches ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            <span>Breakdown matches Total Payout: ₹{sum.toLocaleString()}</span>
                          </>
                        ) : (
                          <>
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            <span>Sum is ₹{sum.toLocaleString()} — must equal Total Payout ₹{total.toLocaleString()}</span>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Source Bank Account (Required if UPI > 0) */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Source Bank Account {parseFloat(payoutUpiAmount || '0') > 0 ? '*' : '(Optional)'}
                    </label>
                    {parseFloat(payoutUpiAmount || '0') === 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        Not required for 100% Cash payout
                      </span>
                    )}
                  </div>
                  <select
                    value={payoutBankAccountId}
                    onChange={(e) => setPayoutBankAccountId(e.target.value)}
                    disabled={parseFloat(payoutUpiAmount || '0') === 0}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    required={parseFloat(payoutUpiAmount || '0') > 0}
                  >
                    <option value="">-- Select Bank Account --</option>
                    {bankAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.accountName} {acc.isChitFundAccount ? '(Chit Fund Account)' : ''} (Balance: {formatCurrency(acc.currentBalance, fund?.currency || 'INR')})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Reference / Cheque # (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. CHQ-88992"
                      value={payoutReference}
                      onChange={(e) => setPayoutReference(e.target.value)}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Notes (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Winner at ₹5,000 dividend"
                      value={payoutNotes}
                      onChange={(e) => setPayoutNotes(e.target.value)}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                </div>
              </CardContent>

              <CardFooter className="flex justify-end gap-2 border-t border-border pt-4">
                <Button type="button" variant="outline" onClick={() => setShowRecordPayoutModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" isLoading={submitting} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                  Post Payout
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}

      {/* ========================================================== */}
      {/* MODAL 5: RECONCILIATION ADJUSTMENT */}
      {/* ========================================================== */}
      {showAdjustmentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <Card className="w-full max-w-md shadow-2xl border-border animate-in zoom-in-95">
            <CardHeader>
              <CardTitle>Record Manual Adjustment</CardTitle>
              <CardDescription>
                Correct historical discrepancy between liquid bank reserves and Chit Fund pool ledger.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleRecordAdjustment}>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Adjustment Amount (+ for Credit, - for Debit) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="e.g. 5000 or -5000"
                    value={adjustmentAmount}
                    onChange={(e) => setAdjustmentAmount(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    required
                  />
                  <span className="text-[11px] text-muted-foreground block">
                    Positive amount increases fund pool liability; negative decreases it.
                  </span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Reason for Adjustment *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Cash pool deposited to bank / Bank charge resolution"
                    value={adjustmentReason}
                    onChange={(e) => setAdjustmentReason(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Adjustment Date *
                  </label>
                  <DatePicker
                    value={adjustmentDate}
                    onChange={setAdjustmentDate}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Explanatory Audit Notes (Optional)
                  </label>
                  <textarea
                    placeholder="Explain audit reason for this ledger reconciliation entry..."
                    value={adjustmentNotes}
                    onChange={(e) => setAdjustmentNotes(e.target.value)}
                    className="flex min-h-[70px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </CardContent>

              <CardFooter className="flex justify-end gap-2 border-t border-border pt-4">
                <Button type="button" variant="outline" onClick={() => setShowAdjustmentModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" isLoading={submitting}>
                  Save Adjustment
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function ChitFundPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4 p-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <ChitFundContent />
    </Suspense>
  );
}
