import { Request, Response } from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { ChitFund, IChitFund } from '../models/ChitFund';
import { ChitFundMember, IChitFundMember } from '../models/ChitFundMember';
import { ChitFundCollection } from '../models/ChitFundCollection';
import { ChitFundPayout } from '../models/ChitFundPayout';
import { ChitFundAdjustment } from '../models/ChitFundAdjustment';
import { ChitFundCycle, IChitFundCycle } from '../models/ChitFundCycle';
import { BankAccount } from '../models/BankAccount';
import { Transaction } from '../models/Transaction';
import { sendSuccess, sendError, AppError } from '../utils/api-response';
import {
  createChitFundSchema,
  updateChitFundSchema,
  createChitFundMemberSchema,
  updateChitFundMemberSchema,
  createChitFundCollectionSchema,
  createChitFundPayoutSchema,
  updateChitFundPayoutSchema,
  createChitFundAdjustmentSchema,
  createChitFundSeparationSchema,
  confirmWinnerSchema,
  correctWinnerSchema,
  resetChitWinnerMonthSchema,
  resetAllChitWinnersSchema,
  getChitCycleInfo,
  getPrizeTakingDateForCycle,
  getRolloverDateForCycle,
  safeAdd,
  safeSubtract,
  safeMultiply,
  TransactionType,
  TransactionStatus,
  PaymentMethod,
  PaymentChannel,
} from '@finora/shared';
import { recalculateAccountBalance, calculateChitFundsHeldInBank, calculateChitCashInHand } from '../services/financial';

/**
 * Ensures a ChitFundCycle document exists for the given period.
 * Idempotent, safe across multiple invocations.
 */
export const ensureCycle = async (
  userId: mongoose.Types.ObjectId,
  chitFundId: mongoose.Types.ObjectId,
  cyclePeriod: string
): Promise<any> => {
  let cycle = await ChitFundCycle.findOne({ userId, chitFundId, cyclePeriod });
  if (!cycle) {
    const parts = cyclePeriod.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const prizeTakingDate = getPrizeTakingDateForCycle(cyclePeriod);
    const rolloverDate = getRolloverDateForCycle(cyclePeriod);

    cycle = await ChitFundCycle.create({
      userId,
      chitFundId,
      cyclePeriod,
      year,
      month,
      prizeTakingDate,
      rolloverDate,
      status: 'collecting',
      payoutStatus: 'none',
    });
  }
  return cycle;
};

/**
 * Gets or auto-initializes the active Chit Fund for the user.
 * Syncs the currentPeriod with the live IST monthly cycle schedule.
 */
export const getOrCreateChitFund = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const activeCycleInfo = getChitCycleInfo(new Date());

  let fund = await ChitFund.findOne({ userId, isActive: true });
  if (!fund) {
    const designatedAccount = await BankAccount.findOne({
      userId,
      isChitFundAccount: true,
      isArchived: false,
    });

    fund = await ChitFund.create({
      userId,
      name: 'Family Chit Fund',
      totalChits: 20,
      defaultContributionPerChit: 5000,
      currency: req.user!.currency || 'INR',
      collectionFrequency: 'monthly',
      startDate: new Date(),
      currentPeriod: activeCycleInfo.cyclePeriod,
      designatedBankAccountId: designatedAccount?._id,
      notes: 'Family managed 20-chit monthly fund',
      isActive: true,
    });
  } else if (fund.currentPeriod !== activeCycleInfo.cyclePeriod) {
    fund.currentPeriod = activeCycleInfo.cyclePeriod;
    await fund.save();
  }

  // Ensure active cycle document exists
  await ensureCycle(userId, fund._id, activeCycleInfo.cyclePeriod);

  sendSuccess(res, fund.toJSON());
};

export const updateChitFund = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;
  const validated = updateChitFundSchema.parse(req.body);

  const fund = await ChitFund.findOne({ _id: id, userId });
  if (!fund) {
    sendError(res, 'Chit fund not found', 404, 'CHIT_FUND_NOT_FOUND');
    return;
  }

  if (validated.name !== undefined) fund.name = validated.name;
  if (validated.totalChits !== undefined) fund.totalChits = validated.totalChits;
  if (validated.defaultContributionPerChit !== undefined) fund.defaultContributionPerChit = validated.defaultContributionPerChit;
  if (validated.collectionFrequency !== undefined) fund.collectionFrequency = validated.collectionFrequency;
  if (validated.currentPeriod !== undefined) fund.currentPeriod = validated.currentPeriod;
  if (validated.notes !== undefined) fund.notes = validated.notes;
  if (validated.isActive !== undefined) fund.isActive = validated.isActive;

  await fund.save();
  sendSuccess(res, fund.toJSON(), 'Chit fund updated successfully');
};

/**
 * Overview & Summary KPIs
 */
export const getChitFundSummary = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;

  const fund = await ChitFund.findOne({ _id: id, userId });
  if (!fund) {
    sendError(res, 'Chit fund not found', 404, 'CHIT_FUND_NOT_FOUND');
    return;
  }

  const activeCycleInfo = getChitCycleInfo(new Date());
  if (fund.currentPeriod !== activeCycleInfo.cyclePeriod) {
    fund.currentPeriod = activeCycleInfo.cyclePeriod;
    await fund.save();
  }

  // Active members and chits
  const members = await ChitFundMember.find({ userId, chitFundId: fund._id, status: 'active' });
  const totalActiveMembers = members.length;
  const totalActiveChits = members.reduce((sum, m) => sum + m.numberOfChits, 0);
  const expectedCollectionPerPeriod = members.reduce((sum, m) => sum + m.totalExpectedPerPeriod, 0);

  // Collections for requested or current period
  const period = (req.query.period as string) || fund.currentPeriod;
  const currentCycle = await ensureCycle(userId, fund._id, period);

  const periodCollections = await ChitFundCollection.find({
    userId,
    chitFundId: fund._id,
    collectionPeriod: period,
  });
  const actualCollectionForPeriod = periodCollections.reduce((sum, c) => sum + c.actualAmountReceived, 0);
  const outstandingForPeriod = Math.max(0, safeSubtract(expectedCollectionPerPeriod, actualCollectionForPeriod));

  // All collections, payouts, and adjustments to compute total chit fund money held
  const [allCollections, allPayouts, allAdjustments] = await Promise.all([
    ChitFundCollection.find({ userId, chitFundId: fund._id }),
    ChitFundPayout.find({ userId, chitFundId: fund._id }),
    ChitFundAdjustment.find({ userId, chitFundId: fund._id }),
  ]);

  const isCashPayment = (c: any) =>
    c.paymentMethod === 'cash_in_hand' || (c.paymentMethod === 'cash' && !c.receivingBankAccountId);

  // Bank vs Cash Collections
  // Note: Already paid collections do not modify active reserves or duplicate balance movements
  const activeCollections = allCollections.filter((c) => !c.isAlreadyPaid);
  const bankCollections = activeCollections.filter((c) => !isCashPayment(c));
  const cashCollections = activeCollections.filter((c) => isCashPayment(c));

  const totalBankCollected = bankCollections.reduce((sum, c) => sum + c.actualAmountReceived, 0);
  const totalCashCollected = cashCollections.reduce((sum, c) => sum + c.actualAmountReceived, 0);
  const totalCollected = safeAdd(totalBankCollected, totalCashCollected);

  // Completed bank payouts vs Completed cash payouts
  // Note: Historical payouts (isHistorical: true) represent prize disbursements before app tracking
  // and must NOT be deducted from active bank or physical cash holdings.
  const completedPayouts = allPayouts.filter((p) => p.status === 'completed');
  const liveCompletedPayouts = completedPayouts.filter((p) => !p.isHistorical);

  const totalBankPayouts = liveCompletedPayouts.reduce((sum, p) => {
    if (p.upiAmount !== undefined || p.cashAmount !== undefined) {
      return sum + (p.upiAmount || 0);
    }
    return sum + (p.sourceBankAccountId ? p.amount : 0);
  }, 0);

  const totalCashPayouts = liveCompletedPayouts.reduce((sum, p) => {
    if (p.upiAmount !== undefined || p.cashAmount !== undefined) {
      return sum + (p.cashAmount || 0);
    }
    return sum + (!p.sourceBankAccountId ? p.amount : 0);
  }, 0);

  const totalCompletedPayouts = completedPayouts.reduce((sum, p) => sum + p.amount, 0);
  const totalPendingPayouts = allPayouts.filter((p) => p.status === 'pending').reduce((sum, p) => sum + p.amount, 0);
  const totalAdjustments = allAdjustments.reduce((sum, a) => sum + a.amount, 0);

  // Designated Bank Account information
  const designatedAccount = await BankAccount.findOne({
    userId,
    isChitFundAccount: true,
    isArchived: false,
  });

  const designatedAccountBalance = designatedAccount ? designatedAccount.currentBalance : 0;
  // Compute using authoritative financial functions (exact parity with Accounts page)
  const chitFundsHeldInBank = await calculateChitFundsHeldInBank(userId, designatedAccount?._id);
  const cashInHandChitFunds = await calculateChitCashInHand(userId, fund._id);
  const totalChitFundMoneyHeld = safeAdd(chitFundsHeldInBank, cashInHandChitFunds);

  // Personal Available Balance: strictly Designated Bank Balance minus Chit Funds Held in Bank!
  // Cash in Hand does NOT decrease the bank balance or personal available bank funds.
  const personalAvailableBalance = designatedAccount ? safeSubtract(designatedAccountBalance, chitFundsHeldInBank) : 0;
  const discrepancy = designatedAccount && chitFundsHeldInBank > designatedAccountBalance
    ? safeSubtract(chitFundsHeldInBank, designatedAccountBalance)
    : 0;

  // Cycle payment breakdown for requested period (Phase 3)
  const periodCash = periodCollections.filter((c) => isCashPayment(c)).reduce((s, c) => s + c.actualAmountReceived, 0);
  const periodUpi = periodCollections.filter((c) => !isCashPayment(c)).reduce((s, c) => s + c.actualAmountReceived, 0);

  let fullyPaidCount = 0;
  let partialCount = 0;
  let unpaidCount = 0;

  for (const m of members) {
    const mCols = periodCollections.filter(
      (c) =>
        c.memberId.toString() === m._id.toString() ||
        (c.memberId as any)?._id?.toString() === m._id.toString()
    );
    const mPaid = mCols.reduce((s, c) => s + c.actualAmountReceived, 0);
    const mDue = m.totalExpectedPerPeriod;
    if (mPaid >= mDue) {
      fullyPaidCount++;
    } else if (mPaid > 0) {
      partialCount++;
    } else {
      unpaidCount++;
    }
  }

  const cyclePaymentBreakdown = {
    totalExpected: expectedCollectionPerPeriod,
    totalCollected: actualCollectionForPeriod,
    remainingDue: outstandingForPeriod,
    totalCash: periodCash,
    totalUpi: periodUpi,
    fullyPaidCount,
    partialCount,
    unpaidCount,
  };

  // Winner status for requested period
  const winnerInfo = currentCycle ? {
    winnerMemberId: currentCycle.winnerMemberId ? currentCycle.winnerMemberId.toString() : undefined,
    winnerMemberName: currentCycle.winnerMemberName,
    winnerConfirmedAt: currentCycle.winnerConfirmedAt ? currentCycle.winnerConfirmedAt.toISOString() : undefined,
    status: currentCycle.status,
    payoutStatus: currentCycle.payoutStatus,
  } : null;

  sendSuccess(res, {
    totalActiveMembers,
    totalActiveChits,
    expectedCollectionPerPeriod,
    actualCollectionForPeriod,
    outstandingForPeriod,
    totalChitFundMoneyHeld,
    chitFundsHeldInBank,
    cashInHandChitFunds,
    totalBankPayouts,
    totalCashPayouts,
    totalPayouts: totalCompletedPayouts,
    totalPendingPayouts,
    designatedAccountId: designatedAccount?._id ? designatedAccount._id.toString() : undefined,
    designatedAccountName: designatedAccount?.accountName,
    designatedAccountBalance,
    personalAvailableBalance,
    discrepancy,
    currentPeriod: period,
    activeCycleInfo,
    currentCycle: winnerInfo,
    cyclePaymentBreakdown,
  });
};

/**
 * Members Management
 */
export const listMembers = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;
  const includeArchived = req.query.includeArchived === 'true';

  const query: Record<string, any> = { userId, chitFundId: id };
  if (!includeArchived) {
    query.status = { $ne: 'archived' };
  }

  const members = await ChitFundMember.find(query).sort({ name: 1 });
  sendSuccess(res, members.map((m) => m.toJSON()));
};

export const createMember = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;
  const validated = createChitFundMemberSchema.parse(req.body);

  const fund = await ChitFund.findOne({ _id: id, userId });
  if (!fund) {
    sendError(res, 'Chit fund not found', 404, 'CHIT_FUND_NOT_FOUND');
    return;
  }

  // Priority 8: Each member holds exactly 1 chit
  const numberOfChits = 1;
  const totalExpectedPerPeriod =
    validated.monthlyContribution ?? validated.contributionPerChit ?? fund.defaultContributionPerChit ?? 5000;
  const contributionPerChit = totalExpectedPerPeriod;

  const member = await ChitFundMember.create({
    userId,
    chitFundId: fund._id,
    name: validated.name,
    numberOfChits: 1,
    contributionPerChit,
    totalExpectedPerPeriod,
    phone: validated.phone,
    email: validated.email,
    startDate: validated.startDate ? new Date(validated.startDate) : new Date(),
    status: 'active',
    hasPreviouslyWon: validated.hasPreviouslyWon || false,
    previousWinDate: validated.previousWinDate ? new Date(validated.previousWinDate) : undefined,
    previousWinCycle: validated.previousWinCycle || undefined,
    previousWinNotes: validated.previousWinNotes || undefined,
    notes: validated.notes,
  });

  sendSuccess(res, member.toJSON(), 'Member added successfully', 201);
};

export const updateMember = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id, memberId } = req.params;
  const validated = updateChitFundMemberSchema.parse(req.body);

  const member = await ChitFundMember.findOne({ _id: memberId, chitFundId: id, userId });
  if (!member) {
    sendError(res, 'Member not found', 404, 'MEMBER_NOT_FOUND');
    return;
  }

  if (validated.name !== undefined) member.name = validated.name;
  member.numberOfChits = 1; // Priority 8: Exactly 1 chit per member

  // Monthly contribution replacement: replaces the configured amount without multiplying or doubling
  if (validated.monthlyContribution !== undefined) {
    member.totalExpectedPerPeriod = validated.monthlyContribution;
    member.contributionPerChit = validated.monthlyContribution;
  } else if (validated.contributionPerChit !== undefined) {
    member.contributionPerChit = validated.contributionPerChit;
    member.totalExpectedPerPeriod = validated.contributionPerChit;
  }

  if (validated.phone !== undefined) member.phone = validated.phone;
  if (validated.email !== undefined) member.email = validated.email;
  if (validated.status !== undefined) member.status = validated.status;
  if (validated.notes !== undefined) member.notes = validated.notes;

  // Priority 4: Fix winner checkbox and spinner synchronization
  if (validated.hasPreviouslyWon !== undefined) {
    member.hasPreviouslyWon = validated.hasPreviouslyWon;
    if (validated.hasPreviouslyWon) {
      if (validated.previousWinDate !== undefined) {
        member.previousWinDate = validated.previousWinDate ? new Date(validated.previousWinDate) : undefined;
      }
      if (validated.previousWinCycle !== undefined) member.previousWinCycle = validated.previousWinCycle;
      if (validated.previousWinNotes !== undefined) member.previousWinNotes = validated.previousWinNotes;
    } else {
      // Unchecked: remove the manually assigned prior-winner exclusion (Priority 4.2)
      member.previousWinDate = undefined;
      member.previousWinCycle = undefined;
      member.previousWinNotes = undefined;

      // Remove any stale, manually generated cycle entries that were created solely by manual flag
      // Real confirmed cycle winners (with winnerConfirmedBy) are NOT deleted merely by unchecking the checkbox.
      await ChitFundCycle.updateMany(
        {
          userId,
          chitFundId: member.chitFundId,
          winnerMemberId: member._id,
          $or: [{ winnerConfirmedBy: { $exists: false } }, { winnerConfirmedBy: null }],
        },
        {
          $unset: {
            winnerMemberId: 1,
            winnerMemberName: 1,
            winnerConfirmedAt: 1,
          },
          $set: { status: 'collecting' },
        }
      );
    }
  }

  await member.save();

  sendSuccess(res, member.toJSON(), 'Member updated successfully');
};

export const deleteMember = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id, memberId } = req.params;

  const member = await ChitFundMember.findOne({ _id: memberId, chitFundId: id, userId });
  if (!member) {
    sendError(res, 'Member not found', 404, 'MEMBER_NOT_FOUND');
    return;
  }

  // Priority 2 Requirement: Block deletion if pending/unresolved payouts exist
  const pendingPayout = await ChitFundPayout.findOne({
    userId,
    chitFundId: member.chitFundId,
    memberId: member._id,
    status: 'pending',
  });

  if (pendingPayout) {
    sendError(
      res,
      `Cannot delete member ${member.name} because they have an unresolved pending payout of ₹${pendingPayout.amount.toLocaleString()}. Disburse or cancel the payout first.`,
      400,
      'MEMBER_HAS_PENDING_OBLIGATION'
    );
    return;
  }

  // Check if member has historical collections, payouts, or confirmed cycle wins
  const [colCount, payCount, cycleWinCount] = await Promise.all([
    ChitFundCollection.countDocuments({ userId, chitFundId: member.chitFundId, memberId: member._id }),
    ChitFundPayout.countDocuments({ userId, chitFundId: member.chitFundId, memberId: member._id }),
    ChitFundCycle.countDocuments({ userId, chitFundId: member.chitFundId, winnerMemberId: member._id }),
  ]);

  const dependencyCount = colCount + payCount + cycleWinCount;

  if (dependencyCount === 0) {
    // Safe to permanently delete
    await member.deleteOne();
    sendSuccess(res, { permanentlyDeleted: true, message: `Member ${member.name} was permanently deleted.` });
  } else {
    // Preserve financial and audit history by safely archiving
    member.status = 'archived';
    await member.save();
    sendSuccess(
      res,
      {
        permanentlyDeleted: false,
        archived: true,
        member: member.toJSON(),
        message: `Member ${member.name} has ${dependencyCount} historical financial/draw records and was safely archived to preserve audit history.`,
      }
    );
  }
};

/**
 * Collections Management
 */
export const listCollections = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;
  const period = req.query.period as string | undefined;

  const filter: Record<string, unknown> = { userId, chitFundId: id };
  if (period) {
    filter.collectionPeriod = period;
  }

  const collections = await ChitFundCollection.find(filter)
    .populate('memberId', 'name numberOfChits')
    .populate('receivingBankAccountId', 'accountName bankName')
    .sort({ collectionDate: -1 });

  const result = collections.map((c) => {
    const json = c.toJSON() as any;
    const m = c.memberId as any;
    const b = c.receivingBankAccountId as any;
    json.memberName = m ? m.name : 'Unknown Member';
    json.memberId = m ? (m._id?.toString() || m.id?.toString()) : (json.memberId || c.get('memberId')?.toString());
    json.receivingAccountName = b ? b.accountName : undefined;
    json.receivingBankAccountId = b ? (b._id?.toString() || b.id?.toString()) : json.receivingBankAccountId;
    json.outstandingAmount = Math.max(0, safeSubtract(c.expectedAmount, c.actualAmountReceived));
    return json;
  });

  sendSuccess(res, result);
};

export const recordCollection = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;
  const validated = createChitFundCollectionSchema.parse(req.body);

  const fund = await ChitFund.findOne({ _id: id, userId });
  if (!fund) {
    sendError(res, 'Chit fund not found', 404, 'CHIT_FUND_NOT_FOUND');
    return;
  }

  const member = await ChitFundMember.findOne({ _id: validated.memberId, chitFundId: id, userId });
  if (!member) {
    sendError(res, 'Member not found', 404, 'MEMBER_NOT_FOUND');
    return;
  }

  const isCash =
    validated.paymentMethod === 'cash_in_hand' ||
    (validated.paymentMethod === 'cash' && !validated.receivingBankAccountId);
  const isSelfPay = validated.paymentMethod === 'self_pay';
  const isAlreadyPaid = validated.isAlreadyPaid === true;

  // Calculate existing payments for this member & cycle to determine completion status
  const existingMemberCollections = await ChitFundCollection.find({
    userId,
    chitFundId: fund._id,
    memberId: member._id,
    collectionPeriod: validated.collectionPeriod,
  });
  const alreadyPaid = existingMemberCollections.reduce((sum, c) => sum + (c.actualAmountReceived || 0), 0);

  const effectiveExpectedAmount =
    validated.expectedAmount ??
    (member.totalExpectedPerPeriod || safeMultiply(validated.chitsCovered, member.contributionPerChit));

  // Priority 3: Duplicate collection prevention
  if (alreadyPaid >= effectiveExpectedAmount) {
    sendError(
      res,
      `Member ${member.name} has already contributed the full expected amount of ₹${effectiveExpectedAmount.toLocaleString()} for cycle ${validated.collectionPeriod}.`,
      400,
      'CONTRIBUTION_ALREADY_COMPLETED'
    );
    return;
  }

  const totalAfterThisPayment = safeAdd(alreadyPaid, validated.actualAmountReceived);
  const status =
    totalAfterThisPayment >= effectiveExpectedAmount
      ? 'completed'
      : totalAfterThisPayment > 0
      ? 'partial'
      : 'pending';

  // =========================================================================
  // Self Pay is Deprecated (Phase 1 Requirement)
  // =========================================================================
  if (isSelfPay) {
    sendError(
      res,
      'Self Pay is deprecated and no longer supported. Please record using UPI or Cash in Hand with the Already Paid option.',
      400,
      'SELF_PAY_DEPRECATED'
    );
    return;
  }

  // =========================================================================
  // Standard Collection Workflow (UPI or Cash in Hand)
  // =========================================================================
  let bankAccount = null;
  if (!isCash) {
    const targetAccountId = validated.receivingBankAccountId || fund.designatedBankAccountId;
    if (targetAccountId) {
      bankAccount = await BankAccount.findOne({ _id: targetAccountId, userId, isArchived: false });
      if (!bankAccount && validated.receivingBankAccountId && !isAlreadyPaid) {
        sendError(res, 'Receiving bank account not found or is archived', 404, 'ACCOUNT_NOT_FOUND');
        return;
      }
    }
    // If target account not found but user has a designated or active bank account, fallback to it
    if (!bankAccount) {
      bankAccount = await BankAccount.findOne({ userId, isChitFundAccount: true, isArchived: false });
      if (!bankAccount) {
        bankAccount = await BankAccount.findOne({ userId, isArchived: false });
      }
    }
  }

  const collection = await ChitFundCollection.create({
    userId,
    chitFundId: fund._id,
    memberId: member._id,
    collectionPeriod: validated.collectionPeriod,
    chitsCovered: 1, // Priority 8: 1 chit per member
    expectedAmount: effectiveExpectedAmount,
    actualAmountReceived: validated.actualAmountReceived,
    isSeparation: false,
    isAlreadyPaid,
    collectionDate: new Date(validated.collectionDate),
    receivingBankAccountId: bankAccount ? bankAccount._id : (fund.designatedBankAccountId || undefined),
    paymentMethod: validated.paymentMethod,
    reference: validated.reference,
    notes: validated.notes,
    status,
  });

  // If receiving account was selected, NOT already paid, and NOT Cash in Hand, recalculate balance
  // Note: Already Paid reclassifies existing bank funds into chit reserve without modifying bank balance!
  if (bankAccount && validated.actualAmountReceived > 0 && !isCash && !isAlreadyPaid) {
    await recalculateAccountBalance(bankAccount._id, userId);
  }

  // Ensure cycle exists for this period
  await ensureCycle(userId, fund._id, validated.collectionPeriod);

  sendSuccess(res, collection.toJSON(), 'Chit fund collection recorded successfully', 201);
};

export const deleteCollection = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id, collectionId } = req.params;

  const collection = await ChitFundCollection.findOne({ _id: collectionId, chitFundId: id, userId });
  if (!collection) {
    sendError(res, 'Collection record not found', 404, 'COLLECTION_NOT_FOUND');
    return;
  }

  const receivingAccountId = collection.receivingBankAccountId;
  const sourceAccountId = collection.sourceAccountId;
  const transactionId = collection.transactionId;
  const wasSeparation = collection.isSeparation === true;
  const wasAlreadyPaid = collection.isAlreadyPaid === true;
  const wasCash =
    collection.paymentMethod === 'cash_in_hand' ||
    (collection.paymentMethod === 'cash' && !collection.receivingBankAccountId);

  // If linked to Chit Separation transaction, delete it
  if (transactionId) {
    await Transaction.deleteOne({ _id: transactionId, userId });
  }

  await collection.deleteOne();

  // If source account was involved (Self Pay) and was not already paid, recompute balance
  if (sourceAccountId && !wasAlreadyPaid) {
    await recalculateAccountBalance(sourceAccountId, userId);
  }

  // If receiving bank account was involved and was NOT separation and NOT Cash in Hand and NOT already paid, authoritatively recompute balance
  if (receivingAccountId && !wasSeparation && !wasCash && !wasAlreadyPaid) {
    await recalculateAccountBalance(receivingAccountId, userId);
  }

  sendSuccess(res, null, 'Collection deleted and balance safely adjusted');
};

/**
 * Payouts Management
 */
export const listPayouts = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;

  const payouts = await ChitFundPayout.find({ userId, chitFundId: id })
    .populate('sourceBankAccountId', 'accountName bankName')
    .sort({ payoutDate: -1 });

  const result = payouts.map((p) => {
    const json = p.toJSON() as any;
    const b = p.sourceBankAccountId as any;
    json.sourceAccountName = b ? b.accountName : undefined;
    return json;
  });

  sendSuccess(res, result);
};

export const recordPayout = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;
  const validated = createChitFundPayoutSchema.parse(req.body);

  const fund = await ChitFund.findOne({ _id: id, userId });
  if (!fund) {
    sendError(res, 'Chit fund not found', 404, 'CHIT_FUND_NOT_FOUND');
    return;
  }

  // Ensure cycle
  const cycle = await ensureCycle(userId, fund._id, validated.payoutPeriod);

  // Prevent duplicate payouts for the same cycle
  const existingPayout = await ChitFundPayout.findOne({
    userId,
    chitFundId: fund._id,
    payoutPeriod: validated.payoutPeriod,
  });
  if (existingPayout) {
    sendError(
      res,
      `A payout record for cycle ${validated.payoutPeriod} already exists. Duplicate payouts for the same cycle are rejected.`,
      400,
      'PAYOUT_ALREADY_EXISTS'
    );
    return;
  }

  const isHistorical = Boolean(validated.isHistorical);

  // Validate split amounts
  let cashAmount = validated.cashAmount;
  let upiAmount = validated.upiAmount;

  if (isHistorical) {
    cashAmount = 0;
    upiAmount = 0;
  } else if (cashAmount !== undefined && upiAmount !== undefined) {
    // Both explicitly provided
    const splitTotal = safeAdd(cashAmount, upiAmount);
    if (splitTotal !== validated.amount) {
      sendError(
        res,
        `Total payout amount (₹${validated.amount.toLocaleString()}) must equal the sum of Cash (₹${cashAmount.toLocaleString()}) and UPI / Bank Transfer (₹${upiAmount.toLocaleString()}). Sum is ₹${splitTotal.toLocaleString()}.`,
        400,
        'INVALID_SPLIT_PAYOUT'
      );
      return;
    }
  } else if (cashAmount !== undefined && upiAmount === undefined) {
    upiAmount = Math.max(0, safeSubtract(validated.amount, cashAmount));
  } else if (upiAmount !== undefined && cashAmount === undefined) {
    cashAmount = Math.max(0, safeSubtract(validated.amount, upiAmount));
  } else {
    // Neither split field provided -> legacy fallback
    if (validated.sourceBankAccountId) {
      upiAmount = validated.amount;
      cashAmount = 0;
    } else {
      cashAmount = validated.amount;
      upiAmount = 0;
    }
  }

  let sourceAccount = null;
  const targetAccountId = validated.sourceBankAccountId || (upiAmount > 0 ? fund.designatedBankAccountId : undefined);
  if (targetAccountId) {
    sourceAccount = await BankAccount.findOne({ _id: targetAccountId, userId, isArchived: false });
    if (!sourceAccount && validated.sourceBankAccountId) {
      sendError(res, 'Source bank account not found or is archived', 404, 'ACCOUNT_NOT_FOUND');
      return;
    }
  }

  const payoutStatus = validated.status || 'completed';

  const payout = await ChitFundPayout.create({
    userId,
    chitFundId: fund._id,
    recipientName: validated.recipientName,
    memberId: validated.memberId || cycle.winnerMemberId,
    payoutPeriod: validated.payoutPeriod,
    amount: validated.amount,
    cashAmount,
    upiAmount,
    isHistorical,
    payoutDate: new Date(validated.payoutDate),
    sourceBankAccountId: sourceAccount ? sourceAccount._id : undefined,
    reference: validated.reference,
    notes: validated.notes,
    status: payoutStatus,
  });

  // Link payout to cycle
  cycle.payoutId = payout._id;
  cycle.payoutStatus = payoutStatus;
  cycle.payoutAmount = payout.amount;
  if (payoutStatus === 'completed') {
    cycle.status = 'completed';
  } else {
    cycle.status = 'payout_pending';
  }
  await cycle.save();

  // If source bank account was selected and status is completed and not historical, debit only upiAmount authoritatively
  if (sourceAccount && upiAmount > 0 && payoutStatus === 'completed' && !isHistorical) {
    await recalculateAccountBalance(sourceAccount._id, userId);
  }

  sendSuccess(res, payout.toJSON(), 'Chit fund payout posted successfully', 201);
};

export const deletePayout = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id, payoutId } = req.params;

  const payout = await ChitFundPayout.findOne({ _id: payoutId, chitFundId: id, userId });
  if (!payout) {
    sendError(res, 'Payout record not found', 404, 'PAYOUT_NOT_FOUND');
    return;
  }

  // Unlink from cycle
  await ChitFundCycle.updateMany(
    { userId, chitFundId: id, payoutId: payout._id },
    { $set: { payoutId: null, payoutStatus: 'none', payoutAmount: 0, status: 'winner_selected' } }
  );

  const sourceAccountId = payout.sourceBankAccountId;
  const wasCompleted = payout.status === 'completed';
  const wasHistorical = payout.isHistorical;
  await payout.deleteOne();

  // If source bank account was involved and was completed and not historical, authoritatively recompute its balance
  if (sourceAccountId && wasCompleted && !wasHistorical) {
    await recalculateAccountBalance(sourceAccountId, userId);
  }

  sendSuccess(res, null, 'Payout record deleted and source account balance restored');
};

export const updatePayout = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id, payoutId } = req.params;
  const validated = updateChitFundPayoutSchema.parse(req.body);

  const payout = await ChitFundPayout.findOne({ _id: payoutId, chitFundId: id, userId });
  if (!payout) {
    sendError(res, 'Payout record not found', 404, 'PAYOUT_NOT_FOUND');
    return;
  }

  const prevAccountId = payout.sourceBankAccountId;

  if (validated.recipientName !== undefined) payout.recipientName = validated.recipientName;
  if (validated.memberId !== undefined) payout.memberId = validated.memberId as any;
  if (validated.payoutPeriod !== undefined) payout.payoutPeriod = validated.payoutPeriod;
  if (validated.amount !== undefined) payout.amount = validated.amount;
  if (validated.cashAmount !== undefined) payout.cashAmount = validated.cashAmount;
  if (validated.upiAmount !== undefined) payout.upiAmount = validated.upiAmount;
  if (validated.isHistorical !== undefined) payout.isHistorical = validated.isHistorical;
  if (validated.payoutDate !== undefined) payout.payoutDate = new Date(validated.payoutDate);
  if (validated.sourceBankAccountId !== undefined) payout.sourceBankAccountId = validated.sourceBankAccountId as any;
  if (validated.status !== undefined) payout.status = validated.status;
  if (validated.reference !== undefined) payout.reference = validated.reference;
  if (validated.notes !== undefined) payout.notes = validated.notes;

  await payout.save();

  // Sync with cycle if status or amount changed
  if (validated.status !== undefined || validated.amount !== undefined) {
    const cycle = await ChitFundCycle.findOne({ userId, chitFundId: id, cyclePeriod: payout.payoutPeriod });
    if (cycle) {
      cycle.payoutStatus = payout.status;
      cycle.payoutAmount = payout.amount;
      cycle.status = payout.status === 'completed' ? 'completed' : 'payout_pending';
      await cycle.save();
    }
  }

  // Recalculate bank balance if status or amount or account changed
  const accountsToRecompute = new Set<string>();
  if (prevAccountId) accountsToRecompute.add(prevAccountId.toString());
  if (payout.sourceBankAccountId) accountsToRecompute.add(payout.sourceBankAccountId.toString());

  for (const accId of accountsToRecompute) {
    await recalculateAccountBalance(accId as any, userId);
  }

  sendSuccess(res, payout.toJSON(), 'Payout updated successfully');
};

/**
 * Cycles & Winner Management
 */
export const listCycles = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;

  const fund = await ChitFund.findOne({ _id: id, userId });
  if (!fund) {
    sendError(res, 'Chit fund not found', 404, 'CHIT_FUND_NOT_FOUND');
    return;
  }

  // Ensure current active cycle exists
  const activeCycleInfo = getChitCycleInfo(new Date());
  await ensureCycle(userId, fund._id, activeCycleInfo.cyclePeriod);

  if (fund.currentPeriod !== activeCycleInfo.cyclePeriod) {
    fund.currentPeriod = activeCycleInfo.cyclePeriod;
    await fund.save();
  }

  const cycles = await ChitFundCycle.find({ userId, chitFundId: fund._id })
    .populate('winnerMemberId', 'name numberOfChits contributionPerChit totalExpectedPerPeriod')
    .sort({ cyclePeriod: -1 });

  const allCollections = await ChitFundCollection.find({ userId, chitFundId: fund._id });
  const allPayouts = await ChitFundPayout.find({ userId, chitFundId: fund._id });
  const activeMembers = await ChitFundMember.find({ userId, chitFundId: fund._id, status: 'active' });
  const totalExpectedPerPeriod = activeMembers.reduce((sum, m) => sum + m.totalExpectedPerPeriod, 0);

  const result = cycles.map((cyc) => {
    const json = cyc.toJSON() as any;
    const collectionsForCycle = allCollections.filter((c) => c.collectionPeriod === cyc.cyclePeriod);
    const totalCollected = collectionsForCycle.reduce((s, c) => s + c.actualAmountReceived, 0);
    const totalSeparated = collectionsForCycle.filter((c) => c.isSeparation).reduce((s, c) => s + c.actualAmountReceived, 0);
    const outstanding = Math.max(0, safeSubtract(totalExpectedPerPeriod, totalCollected));

    const payoutForCycle = allPayouts.find((p) => p.payoutPeriod === cyc.cyclePeriod);

    json.totalExpectedCollection = totalExpectedPerPeriod;
    json.totalCollected = totalCollected;
    json.totalSeparated = totalSeparated;
    json.outstandingCollection = outstanding;
    json.collectionsCount = collectionsForCycle.length;
    json.membersCount = activeMembers.length;
    if (payoutForCycle) {
      json.payoutId = payoutForCycle._id.toString();
      json.payoutStatus = payoutForCycle.status;
      json.payoutAmount = payoutForCycle.amount;
    }

    return json;
  });

  sendSuccess(res, result);
};

export const getCycleDetails = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id, cyclePeriod } = req.params;

  const fund = await ChitFund.findOne({ _id: id, userId });
  if (!fund) {
    sendError(res, 'Chit fund not found', 404, 'CHIT_FUND_NOT_FOUND');
    return;
  }

  const cycle = await ensureCycle(userId, fund._id, cyclePeriod);
  const collections = await ChitFundCollection.find({
    userId,
    chitFundId: fund._id,
    collectionPeriod: cyclePeriod,
  }).populate('memberId', 'name numberOfChits');

  const payout = await ChitFundPayout.findOne({
    userId,
    chitFundId: fund._id,
    payoutPeriod: cyclePeriod,
  });

  const activeMembers = await ChitFundMember.find({ userId, chitFundId: fund._id, status: 'active' });
  const totalExpected = activeMembers.reduce((sum, m) => sum + m.totalExpectedPerPeriod, 0);
  const totalCollected = collections.reduce((s, c) => s + c.actualAmountReceived, 0);
  const totalSeparated = collections.filter((c) => c.isSeparation).reduce((s, c) => s + c.actualAmountReceived, 0);

  const isCashPayment = (method?: string) => method === 'cash' || method === 'cash_in_hand';
  const totalCash = collections.filter((c) => isCashPayment(c.paymentMethod)).reduce((s, c) => s + c.actualAmountReceived, 0);
  const totalUpi = collections.filter((c) => !isCashPayment(c.paymentMethod)).reduce((s, c) => s + c.actualAmountReceived, 0);

  const paidMembers: any[] = [];
  const remainingMembers: any[] = [];
  let fullyPaidMembersCount = 0;
  let partialMembersCount = 0;
  let unpaidMembersCount = 0;

  for (const m of activeMembers) {
    const mCols = collections.filter(
      (c) =>
        c.memberId.toString() === m._id.toString() ||
        (c.memberId as any)?._id?.toString() === m._id.toString()
    );
    const amountReceived = mCols.reduce((s, c) => s + c.actualAmountReceived, 0);
    const expected = m.totalExpectedPerPeriod;
    const remainingDue = Math.max(0, safeSubtract(expected, amountReceived));

    if (amountReceived >= expected) {
      fullyPaidMembersCount++;
      paidMembers.push({
        member: m.toJSON(),
        expectedAmount: expected,
        actualAmountReceived: amountReceived,
        remainingDue: 0,
        status: 'completed',
        collections: mCols.map((c) => c.toJSON()),
        lastPaymentDate: mCols[mCols.length - 1]?.collectionDate,
        paymentMethod: mCols[mCols.length - 1]?.paymentMethod,
      });
    } else if (amountReceived > 0) {
      partialMembersCount++;
      paidMembers.push({
        member: m.toJSON(),
        expectedAmount: expected,
        actualAmountReceived: amountReceived,
        remainingDue,
        status: 'partial',
        collections: mCols.map((c) => c.toJSON()),
        lastPaymentDate: mCols[mCols.length - 1]?.collectionDate,
        paymentMethod: mCols[mCols.length - 1]?.paymentMethod,
      });
      remainingMembers.push({
        member: m.toJSON(),
        expectedAmount: expected,
        amountAlreadyReceived: amountReceived,
        remainingDue,
        status: 'partial',
      });
    } else {
      unpaidMembersCount++;
      remainingMembers.push({
        member: m.toJSON(),
        expectedAmount: expected,
        amountAlreadyReceived: 0,
        remainingDue: expected,
        status: 'pending',
      });
    }
  }

  const json = cycle.toJSON() as any;
  json.totalExpectedCollection = totalExpected;
  json.totalCollected = totalCollected;
  json.totalSeparated = totalSeparated;
  json.outstandingCollection = Math.max(0, safeSubtract(totalExpected, totalCollected));
  json.totalCashCollected = totalCash;
  json.totalUpiCollected = totalUpi;
  json.fullyPaidMembersCount = fullyPaidMembersCount;
  json.partialMembersCount = partialMembersCount;
  json.unpaidMembersCount = unpaidMembersCount;
  json.paidMembers = paidMembers;
  json.remainingMembers = remainingMembers;
  json.collections = collections.map((c) => c.toJSON());
  json.payout = payout ? payout.toJSON() : null;

  sendSuccess(res, json);
};

/**
 * Server-Side Random Spinner Preview
 * Selects an eligible member using Node.js crypto.randomInt for complete fairness.
 * DOES NOT mutate any records or confirm the winner.
 */
export const getSpinPreview = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id, cyclePeriod } = req.params;

  const fund = await ChitFund.findOne({ _id: id, userId });
  if (!fund) {
    sendError(res, 'Chit fund not found', 404, 'CHIT_FUND_NOT_FOUND');
    return;
  }

  // If this cycle already has a confirmed winner, lock the spinner
  const currentCycle = await ChitFundCycle.findOne({ userId, chitFundId: fund._id, cyclePeriod });
  if (currentCycle && currentCycle.winnerMemberId) {
    sendError(
      res,
      `Cycle ${cyclePeriod} already has a confirmed winner (${currentCycle.winnerMemberName || 'Confirmed Winner'}).`,
      400,
      'WINNER_ALREADY_CONFIRMED'
    );
    return;
  }

  // Find all active members
  const members = await ChitFundMember.find({
    userId,
    chitFundId: fund._id,
    status: 'active',
  });

  // Find all past confirmed winners across all cycles of this fund
  const pastCycles = await ChitFundCycle.find({
    userId,
    chitFundId: fund._id,
    winnerMemberId: { $exists: true, $ne: null },
  });
  const pastWinnerMemberIds = new Set(pastCycles.map((c) => c.winnerMemberId!.toString()));

  // Filter eligible members:
  // Must NOT have hasPreviouslyWon === true, and must not be in pastWinnerMemberIds
  const eligibleMembers = members.filter(
    (m) => !m.hasPreviouslyWon && !pastWinnerMemberIds.has(m._id.toString())
  );

  if (eligibleMembers.length === 0) {
    sendError(res, 'No eligible members remain for this chit fund', 400, 'NO_ELIGIBLE_MEMBERS');
    return;
  }

  // Server-side unbiased random selection via crypto.randomInt
  const selectedIndex = crypto.randomInt(0, eligibleMembers.length);
  const selectedMember = eligibleMembers[selectedIndex];

  sendSuccess(res, {
    cyclePeriod,
    selectedMember: {
      id: selectedMember._id.toString(),
      name: selectedMember.name,
      numberOfChits: selectedMember.numberOfChits,
      contributionPerChit: selectedMember.contributionPerChit,
      totalExpectedPerPeriod: selectedMember.totalExpectedPerPeriod,
    },
    eligibleMembers: eligibleMembers.map((m) => ({
      id: m._id.toString(),
      name: m.name,
      numberOfChits: m.numberOfChits,
      contributionPerChit: m.contributionPerChit,
      totalExpectedPerPeriod: m.totalExpectedPerPeriod,
    })),
    eligibleCount: eligibleMembers.length,
    generatedAt: new Date().toISOString(),
  });
};

/**
 * Confirm Winner for a Cycle
 * Locks the cycle against duplicate winner selection and updates the member winner status.
 */
export const confirmCycleWinner = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id, cyclePeriod } = req.params;
  const validated = confirmWinnerSchema.parse(req.body);

  const fund = await ChitFund.findOne({ _id: id, userId });
  if (!fund) {
    sendError(res, 'Chit fund not found', 404, 'CHIT_FUND_NOT_FOUND');
    return;
  }

  // Ensure or get cycle
  let cycle: any = await ChitFundCycle.findOne({ userId, chitFundId: fund._id, cyclePeriod });
  if (!cycle) {
    cycle = await ensureCycle(userId, fund._id, cyclePeriod);
  }

  if (!cycle) {
    sendError(res, 'Failed to initialize chit cycle', 500, 'CYCLE_INIT_FAILED');
    return;
  }

  // Check if winner is already confirmed for this cycle
  if (cycle.winnerMemberId) {
    sendError(
      res,
      `A winner (${cycle.winnerMemberName || 'Confirmed Winner'}) has already been confirmed for cycle ${cyclePeriod}. Duplicate confirmations are locked.`,
      400,
      'WINNER_ALREADY_CONFIRMED'
    );
    return;
  }

  // Find member
  const member = await ChitFundMember.findOne({
    _id: validated.memberId,
    chitFundId: fund._id,
    userId,
  });

  if (!member) {
    sendError(res, 'Member not found', 404, 'MEMBER_NOT_FOUND');
    return;
  }

  if (member.status !== 'active') {
    sendError(res, 'Inactive members are not eligible to win', 400, 'MEMBER_INACTIVE');
    return;
  }

  if (member.hasPreviouslyWon) {
    sendError(res, `${member.name} has already won a chit prize previously and is not eligible`, 400, 'MEMBER_ALREADY_WON');
    return;
  }

  // Atomic update: ensure cycle still has no winner (protects against race conditions)
  const updatedCycle = await ChitFundCycle.findOneAndUpdate(
    { _id: cycle._id, $or: [{ winnerMemberId: { $exists: false } }, { winnerMemberId: null }] },
    {
      $set: {
        winnerMemberId: member._id,
        winnerMemberName: member.name,
        winnerConfirmedAt: new Date(),
        winnerConfirmedBy: userId,
        winnerNotes: validated.notes,
        status: 'winner_selected',
      },
    },
    { new: true }
  );

  if (!updatedCycle) {
    sendError(res, `Cycle ${cyclePeriod} already has a confirmed winner.`, 400, 'WINNER_ALREADY_CONFIRMED');
    return;
  }

  // Update member winner status
  member.hasPreviouslyWon = true;
  member.previousWinCycle = cyclePeriod;
  member.previousWinDate = cycle.prizeTakingDate || getPrizeTakingDateForCycle(cyclePeriod);
  if (validated.notes) member.previousWinNotes = validated.notes;
  await member.save();

  // If alreadyPaidOut is checked (historical assignment before app tracking)
  if (validated.alreadyPaidOut) {
    const potAmount = fund.totalChits ? fund.totalChits * (fund.defaultContributionPerChit || 5000) : 100000;
    const historicalPayout = await ChitFundPayout.create({
      userId,
      chitFundId: fund._id,
      recipientName: member.name,
      memberId: member._id,
      payoutPeriod: cyclePeriod,
      amount: potAmount,
      cashAmount: 0,
      upiAmount: 0,
      isHistorical: true,
      payoutDate: cycle.prizeTakingDate || getPrizeTakingDateForCycle(cyclePeriod),
      status: 'completed',
      notes: validated.notes || 'Historical winner payout - prior to app tracking',
    });

    updatedCycle.payoutId = historicalPayout._id;
    updatedCycle.payoutStatus = 'completed';
    updatedCycle.payoutAmount = potAmount;
    updatedCycle.status = 'completed';
    await updatedCycle.save();
  }

  sendSuccess(res, updatedCycle.toJSON(), `Confirmed ${member.name} as the winner for ${cyclePeriod}`, 200);
};

/**
 * Free Trial Spin Preview (Optionally invoked for animation testing; never mutates official records)
 */
export const getTrialSpinPreview = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id, cyclePeriod } = req.params;

  const fund = await ChitFund.findOne({ _id: id, userId });
  if (!fund) {
    sendError(res, 'Chit fund not found', 404, 'CHIT_FUND_NOT_FOUND');
    return;
  }

  const members = await ChitFundMember.find({
    userId,
    chitFundId: fund._id,
    status: 'active',
  });

  const pastCycles = await ChitFundCycle.find({
    userId,
    chitFundId: fund._id,
    winnerMemberId: { $exists: true, $ne: null },
  });
  const pastWinnerMemberIds = new Set(pastCycles.map((c) => c.winnerMemberId!.toString()));

  const eligibleMembers = members.filter(
    (m) => !m.hasPreviouslyWon && !pastWinnerMemberIds.has(m._id.toString())
  );

  if (eligibleMembers.length === 0) {
    sendError(res, 'No eligible members available for trial preview', 400, 'NO_ELIGIBLE_MEMBERS');
    return;
  }

  // Unbiased trial selection via crypto.randomInt
  const selectedIndex = crypto.randomInt(0, eligibleMembers.length);
  const selectedMember = eligibleMembers[selectedIndex];

  sendSuccess(res, {
    isTrial: true,
    cyclePeriod,
    selectedMember: {
      id: selectedMember._id.toString(),
      name: selectedMember.name,
      numberOfChits: selectedMember.numberOfChits,
      contributionPerChit: selectedMember.contributionPerChit,
      totalExpectedPerPeriod: selectedMember.totalExpectedPerPeriod,
    },
    eligibleMembers: eligibleMembers.map((m) => ({
      id: m._id.toString(),
      name: m.name,
      numberOfChits: m.numberOfChits,
      contributionPerChit: m.contributionPerChit,
      totalExpectedPerPeriod: m.totalExpectedPerPeriod,
    })),
    eligibleCount: eligibleMembers.length,
    generatedAt: new Date().toISOString(),
  });
};

/**
 * Correct Winner for a Cycle (Administrative Correction Workflow)
 */
export const correctCycleWinner = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id, cyclePeriod } = req.params;
  const validated = correctWinnerSchema.parse(req.body);

  const fund = await ChitFund.findOne({ _id: id, userId });
  if (!fund) {
    sendError(res, 'Chit fund not found', 404, 'CHIT_FUND_NOT_FOUND');
    return;
  }

  const cycle = await ChitFundCycle.findOne({ userId, chitFundId: fund._id, cyclePeriod });
  if (!cycle) {
    sendError(res, 'Cycle not found', 404, 'CYCLE_NOT_FOUND');
    return;
  }

  const newMember = await ChitFundMember.findOne({
    _id: validated.newMemberId,
    chitFundId: fund._id,
    userId,
    status: 'active',
  });
  if (!newMember) {
    sendError(res, 'New member not found or is inactive', 404, 'MEMBER_NOT_FOUND');
    return;
  }

  // If old winner exists and is different, revert their hasPreviouslyWon flag if not won elsewhere
  const oldWinnerId = cycle.winnerMemberId;
  const oldWinnerName = cycle.winnerMemberName;
  if (oldWinnerId && oldWinnerId.toString() !== newMember._id.toString()) {
    const wonOtherCycles = await ChitFundCycle.findOne({
      userId,
      chitFundId: fund._id,
      winnerMemberId: oldWinnerId,
      cyclePeriod: { $ne: cyclePeriod },
    });
    if (!wonOtherCycles) {
      await ChitFundMember.updateOne(
        { _id: oldWinnerId, userId },
        { $set: { hasPreviouslyWon: false, previousWinCycle: null, previousWinDate: null } }
      );
    }
  }

  // Update new member
  newMember.hasPreviouslyWon = true;
  newMember.previousWinCycle = cyclePeriod;
  newMember.previousWinDate = cycle.prizeTakingDate;
  await newMember.save();

  // Update cycle
  cycle.winnerMemberId = newMember._id;
  cycle.winnerMemberName = newMember.name;
  cycle.winnerConfirmedAt = new Date();
  cycle.winnerNotes = `Corrected from ${oldWinnerName || 'none'}. Reason: ${validated.reason}`;
  await cycle.save();

  sendSuccess(res, cycle.toJSON(), `Corrected winner for ${cyclePeriod} to ${newMember.name}`);
};

/**
 * Reset Winner for a Selected Month (Option A)
 */
export const resetCycleWinner = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;
  const cyclePeriod = req.params.cyclePeriod || req.body.cyclePeriod;
  const { reason } = req.body;

  if (!cyclePeriod) {
    sendError(res, 'Cycle period is required', 400, 'CYCLE_PERIOD_REQUIRED');
    return;
  }

  const fund = await ChitFund.findOne({ _id: id, userId });
  if (!fund) {
    sendError(res, 'Chit fund not found', 404, 'CHIT_FUND_NOT_FOUND');
    return;
  }

  const cycle = await ChitFundCycle.findOne({ userId, chitFundId: fund._id, cyclePeriod });
  if (!cycle) {
    sendError(res, `Cycle ${cyclePeriod} not found`, 404, 'CYCLE_NOT_FOUND');
    return;
  }

  if (!cycle.winnerMemberId) {
    sendError(res, `Cycle ${cyclePeriod} does not have a confirmed winner to reset`, 400, 'NO_CONFIRMED_WINNER');
    return;
  }

  // Financial safety check: Has a payout already been completed for this winner/cycle?
  const completedPayout = await ChitFundPayout.findOne({
    userId,
    chitFundId: fund._id,
    payoutPeriod: cyclePeriod,
    status: 'completed',
  });

  if (completedPayout) {
    if (completedPayout.isHistorical) {
      await completedPayout.deleteOne();
      cycle.payoutId = undefined;
      cycle.payoutStatus = 'none';
      cycle.payoutAmount = 0;
    } else {
      sendError(
        res,
        `Cannot reset winner for ${cyclePeriod}: A payout of ₹${completedPayout.amount.toLocaleString()} has already been completed for this cycle. Reconcile or correct the payout record first to protect financial integrity.`,
        400,
        'PAYOUT_ALREADY_COMPLETED'
      );
      return;
    }
  }

  const winningMemberId = cycle.winnerMemberId;

  // Reset cycle winner fields
  cycle.winnerMemberId = undefined;
  cycle.winnerMemberName = undefined;
  cycle.winnerConfirmedAt = undefined;
  cycle.winnerConfirmedBy = undefined;
  cycle.winnerNotes = undefined;
  cycle.notes = undefined;
  cycle.status = 'collecting';
  await cycle.save();

  // Restore winning member's eligibility only if they have no other winning cycles
  if (winningMemberId) {
    const member = await ChitFundMember.findOne({ _id: winningMemberId, chitFundId: fund._id, userId });
    if (member) {
      const otherWinCycle = await ChitFundCycle.findOne({
        userId,
        chitFundId: fund._id,
        winnerMemberId: member._id,
        cyclePeriod: { $ne: cyclePeriod },
      });

      if (!otherWinCycle) {
        if (!member.previousWinCycle || member.previousWinCycle === cyclePeriod) {
          member.hasPreviouslyWon = false;
          member.previousWinCycle = undefined;
          member.previousWinDate = undefined;
          member.previousWinNotes = undefined;
          await member.save();
        }
      }
    }
  }

  sendSuccess(res, cycle.toJSON(), `Winner for cycle ${cyclePeriod} has been safely reset`);
};

/**
 * Reset All Chit Winner Assignments for a Chit Fund (Option B)
 */
export const resetAllWinners = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;
  const { confirmationPhrase, reason } = req.body;

  if (confirmationPhrase !== 'RESET WINNERS') {
    sendError(res, 'Confirmation phrase must be exactly "RESET WINNERS"', 400, 'INVALID_CONFIRMATION_PHRASE');
    return;
  }

  const fund = await ChitFund.findOne({ _id: id, userId });
  if (!fund) {
    sendError(res, 'Chit fund not found', 404, 'CHIT_FUND_NOT_FOUND');
    return;
  }

  // Safety check: verify no live completed payouts exist
  const liveCompletedPayouts = await ChitFundPayout.find({
    userId,
    chitFundId: fund._id,
    status: 'completed',
    isHistorical: { $ne: true },
  });

  if (liveCompletedPayouts.length > 0) {
    sendError(
      res,
      `Cannot reset all winners: ${liveCompletedPayouts.length} live completed payout(s) exist for this chit fund. Please reconcile or correct completed payouts before resetting all winners.`,
      400,
      'PAYOUT_ALREADY_COMPLETED'
    );
    return;
  }

  // Safely remove any historical payout records associated with reset winners
  await ChitFundPayout.deleteMany({
    userId,
    chitFundId: fund._id,
    isHistorical: true,
  });

  // Find all cycles with confirmed winners
  const cyclesWithWinners = await ChitFundCycle.find({
    userId,
    chitFundId: fund._id,
    winnerMemberId: { $exists: true, $ne: null },
  });

  const affectedWinnerMemberIds = new Set<string>();
  for (const c of cyclesWithWinners) {
    if (c.winnerMemberId) {
      affectedWinnerMemberIds.add(c.winnerMemberId.toString());
    }
    c.winnerMemberId = undefined;
    c.winnerMemberName = undefined;
    c.winnerConfirmedAt = undefined;
    c.winnerConfirmedBy = undefined;
    c.winnerNotes = undefined;
    c.notes = undefined;
    c.payoutId = undefined;
    c.payoutStatus = 'none';
    c.payoutAmount = 0;
    c.status = 'collecting';
    await c.save();
  }

  // Restore eligibility for affected members whose wins were solely from these system cycles
  for (const memberId of affectedWinnerMemberIds) {
    const member = await ChitFundMember.findOne({ _id: memberId, chitFundId: fund._id, userId });
    if (member) {
      const wasWinFromResetCycle = cyclesWithWinners.some((c) => c.cyclePeriod === member.previousWinCycle);
      if (wasWinFromResetCycle || !member.previousWinCycle) {
        member.hasPreviouslyWon = false;
        member.previousWinCycle = undefined;
        member.previousWinDate = undefined;
        member.previousWinNotes = undefined;
        await member.save();
      }
    }
  }

  sendSuccess(res, { resetCyclesCount: cyclesWithWinners.length }, 'All chit winner assignments have been safely reset');
};

/**
 * Remaining Eligible Members Query
 */
export const getRemainingEligibleMembers = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;

  const fund = await ChitFund.findOne({ _id: id, userId });
  if (!fund) {
    sendError(res, 'Chit fund not found', 404, 'CHIT_FUND_NOT_FOUND');
    return;
  }

  const members = await ChitFundMember.find({ userId, chitFundId: fund._id, status: 'active' }).sort({ name: 1 });
  const pastCycles = await ChitFundCycle.find({
    userId,
    chitFundId: fund._id,
    winnerMemberId: { $exists: true, $ne: null },
  });
  const pastWinnerMemberIds = new Set(pastCycles.map((c) => c.winnerMemberId!.toString()));

  const eligible = members.filter(
    (m) => !m.hasPreviouslyWon && !pastWinnerMemberIds.has(m._id.toString())
  );
  const pastWinners = members.filter(
    (m) => m.hasPreviouslyWon || pastWinnerMemberIds.has(m._id.toString())
  );

  sendSuccess(res, {
    totalActiveMembers: members.length,
    eligibleCount: eligible.length,
    pastWinnersCount: pastWinners.length,
    eligible: eligible.map((m) => m.toJSON()),
    eligibleMembers: eligible.map((m) => m.toJSON()),
    previouslyWon: pastWinners.map((m) => m.toJSON()),
    pastWinners: pastWinners.map((m) => m.toJSON()),
  });
};

/**
 * Unified Fund Ledger
 */
export const getChitFundLedger = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;

  const [collections, payouts, adjustments] = await Promise.all([
    ChitFundCollection.find({ userId, chitFundId: id }).populate('memberId', 'name'),
    ChitFundPayout.find({ userId, chitFundId: id }),
    ChitFundAdjustment.find({ userId, chitFundId: id }),
  ]);

  const entries: Array<{
    id: string;
    type: 'collection' | 'payout' | 'adjustment' | 'separation';
    date: Date;
    description: string;
    credit: number;
    debit: number;
    reference?: string;
    notes?: string;
  }> = [];

  for (const c of collections) {
    const m = c.memberId as any;
    const isSep = c.isSeparation === true;
    entries.push({
      id: c._id.toString(),
      type: isSep ? 'separation' : 'collection',
      date: c.collectionDate,
      description: isSep
        ? `Separation: ${m ? m.name : 'Member'} (${c.collectionPeriod})`
        : `Collection: ${m ? m.name : 'Member'} (${c.collectionPeriod})`,
      credit: c.actualAmountReceived,
      debit: 0,
      reference: c.reference,
      notes: c.notes,
    });
  }

  for (const p of payouts) {
    if (p.status === 'completed') {
      entries.push({
        id: p._id.toString(),
        type: 'payout',
        date: p.payoutDate,
        description: `Payout: ${p.recipientName} (${p.payoutPeriod})`,
        credit: 0,
        debit: p.amount,
        reference: p.reference,
        notes: p.notes,
      });
    }
  }

  for (const a of adjustments) {
    const isSeparation = a.entryType === 'separation';
    entries.push({
      id: a._id.toString(),
      type: isSeparation ? 'separation' : 'adjustment',
      date: a.date,
      description: isSeparation ? `Separated Existing Money: ${a.reason}` : `Adjustment: ${a.reason}`,
      credit: a.amount > 0 ? a.amount : 0,
      debit: a.amount < 0 ? Math.abs(a.amount) : 0,
      reference: a.reference,
      notes: a.notes,
    });
  }

  // Sort ascending by date to compute running balance
  entries.sort((a, b) => a.date.getTime() - b.date.getTime());

  let runningBalance = 0;
  const ledger = entries.map((e) => {
    runningBalance = safeAdd(runningBalance, safeSubtract(e.credit, e.debit));
    return {
      ...e,
      date: e.date.toISOString(),
      balance: runningBalance,
    };
  });

  // Return descending for UI presentation
  sendSuccess(res, ledger.reverse());
};

/**
 * Manual Adjustment with Explanatory Notes
 */
export const recordAdjustment = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;
  const validated = createChitFundAdjustmentSchema.parse(req.body);

  const fund = await ChitFund.findOne({ _id: id, userId });
  if (!fund) {
    sendError(res, 'Chit fund not found', 404, 'CHIT_FUND_NOT_FOUND');
    return;
  }

  const adjustment = await ChitFundAdjustment.create({
    userId,
    chitFundId: fund._id,
    entryType: 'adjustment',
    amount: validated.amount,
    reason: validated.reason,
    notes: validated.notes,
    date: validated.date ? new Date(validated.date) : new Date(),
  });

  sendSuccess(res, adjustment.toJSON(), 'Chit fund adjustment recorded', 201);
};

/**
 * Separate Existing Money as Chit-Fund Money (Reclassification)
 */
export const separateExistingMoney = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;
  const validated = createChitFundSeparationSchema.parse(req.body);

  const fund = await ChitFund.findOne({ _id: id, userId });
  if (!fund) {
    sendError(res, 'Chit fund not found', 404, 'CHIT_FUND_NOT_FOUND');
    return;
  }

  // Find designated chit fund bank account
  const designatedAccount = await BankAccount.findOne({
    userId,
    isChitFundAccount: true,
    isArchived: false,
  });

  if (!designatedAccount) {
    sendError(
      res,
      'No bank account is currently designated as the Chit Fund account. Please designate an account in Bank Accounts first.',
      400,
      'NO_DESIGNATED_ACCOUNT'
    );
    return;
  }

  // Calculate current Chit Fund Money Held and Personal Available Balance
  const [allCollections, allPayouts, allAdjustments] = await Promise.all([
    ChitFundCollection.find({ userId, chitFundId: fund._id }),
    ChitFundPayout.find({ userId, chitFundId: fund._id }),
    ChitFundAdjustment.find({ userId, chitFundId: fund._id }),
  ]);

  const totalCollected = allCollections.reduce((sum, c) => sum + c.actualAmountReceived, 0);
  const totalPayouts = allPayouts.filter((p) => p.status === 'completed').reduce((sum, p) => sum + p.amount, 0);
  const totalAdjustments = allAdjustments.reduce((sum, a) => sum + a.amount, 0);
  const totalChitFundMoneyHeld = Math.max(0, safeAdd(safeSubtract(totalCollected, totalPayouts), totalAdjustments));

  const currentBankBalance = designatedAccount.currentBalance;
  const personalAvailableBalance = safeSubtract(currentBankBalance, totalChitFundMoneyHeld);

  if (validated.amount > personalAvailableBalance) {
    sendError(
      res,
      `Cannot separate ₹${validated.amount.toLocaleString()}. Available personal balance is only ₹${personalAvailableBalance.toLocaleString()}.`,
      400,
      'INSUFFICIENT_PERSONAL_FUNDS'
    );
    return;
  }

  const separation = await ChitFundAdjustment.create({
    userId,
    chitFundId: fund._id,
    bankAccountId: designatedAccount._id,
    entryType: 'separation',
    amount: validated.amount,
    reason: validated.description || 'Existing chit-fund money separated from personal balance',
    notes: validated.notes,
    date: validated.date ? new Date(validated.date) : new Date(),
  });

  const newChitFundMoneyHeld = safeAdd(totalChitFundMoneyHeld, validated.amount);
  const newPersonalAvailable = safeSubtract(currentBankBalance, newChitFundMoneyHeld);

  sendSuccess(
    res,
    {
      separation: separation.toJSON(),
      balances: {
        totalBankBalance: currentBankBalance,
        chitFundMoneyHeld: newChitFundMoneyHeld,
        personalAvailableBalance: newPersonalAvailable,
      },
    },
    'Existing money successfully separated into Chit Fund pool',
    201
  );
};

export const listSeparations = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;

  const separations = await ChitFundAdjustment.find({
    userId,
    chitFundId: id,
    entryType: 'separation',
  }).sort({ date: -1 });

  sendSuccess(res, separations.map((s) => s.toJSON()));
};

export const deleteSeparation = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id, separationId } = req.params;

  const separation = await ChitFundAdjustment.findOne({
    _id: separationId,
    chitFundId: id,
    userId,
    entryType: 'separation',
  });

  if (!separation) {
    sendError(res, 'Separation record not found', 404, 'SEPARATION_NOT_FOUND');
    return;
  }

  await separation.deleteOne();
  sendSuccess(res, null, 'Separation entry removed and personal available balance restored');
};

/**
 * Reconciliation Analysis
 */
export const getReconciliation = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;

  const fund = await ChitFund.findOne({ _id: id, userId });
  if (!fund) {
    sendError(res, 'Chit fund not found', 404, 'CHIT_FUND_NOT_FOUND');
    return;
  }

  const designatedAccount = await BankAccount.findOne({
    userId,
    isChitFundAccount: true,
    isArchived: false,
  });

  const [allCollections, allPayouts, allAdjustments, activeMembers] = await Promise.all([
    ChitFundCollection.find({ userId, chitFundId: fund._id }).populate('memberId', 'name'),
    ChitFundPayout.find({ userId, chitFundId: fund._id }),
    ChitFundAdjustment.find({ userId, chitFundId: fund._id }),
    ChitFundMember.find({ userId, chitFundId: fund._id, status: 'active' }),
  ]);

  const totalCollected = allCollections.reduce((sum, c) => sum + c.actualAmountReceived, 0);
  const totalPayouts = allPayouts.filter((p) => p.status === 'completed').reduce((sum, p) => sum + p.amount, 0);
  const totalAdjustments = allAdjustments.reduce((sum, a) => sum + a.amount, 0);
  const chitFundLedgerBalance = Math.max(0, safeAdd(safeSubtract(totalCollected, totalPayouts), totalAdjustments));

  const recordedBankBalance = designatedAccount ? designatedAccount.currentBalance : 0;
  const expectedPersonalAvailableBalance = designatedAccount
    ? safeSubtract(recordedBankBalance, chitFundLedgerBalance)
    : 0;

  const discrepancy = designatedAccount && chitFundLedgerBalance > recordedBankBalance
    ? safeSubtract(chitFundLedgerBalance, recordedBankBalance)
    : 0;

  // Unmatched / cash collections (not routed through designated account)
  const cashCollections = allCollections.filter(
    (c) => !c.receivingBankAccountId || (designatedAccount && c.receivingBankAccountId.toString() !== designatedAccount._id.toString())
  );
  const cashPayouts = allPayouts.filter(
    (p) => !p.sourceBankAccountId || (designatedAccount && p.sourceBankAccountId.toString() !== designatedAccount._id.toString())
  );

  // Outstanding member dues for current period
  const periodCollections = allCollections.filter((c) => c.collectionPeriod === fund.currentPeriod);
  const memberDues = activeMembers.map((m) => {
    const paid = periodCollections
      .filter((c) => (c.memberId as any)?._id?.toString() === m._id.toString() || c.memberId?.toString() === m._id.toString())
      .reduce((sum, c) => sum + c.actualAmountReceived, 0);
    const due = Math.max(0, safeSubtract(m.totalExpectedPerPeriod, paid));
    return {
      memberId: m._id.toString(),
      memberName: m.name,
      numberOfChits: m.numberOfChits,
      expected: m.totalExpectedPerPeriod,
      received: paid,
      outstanding: due,
    };
  }).filter((m) => m.outstanding > 0);

  sendSuccess(res, {
    designatedAccount: designatedAccount ? designatedAccount.toJSON() : null,
    recordedBankBalance,
    chitFundLedgerBalance,
    expectedPersonalAvailableBalance,
    hasDiscrepancy: discrepancy > 0,
    discrepancyAmount: discrepancy,
    cashCollectionsCount: cashCollections.length,
    cashCollectionsAmount: cashCollections.reduce((s, c) => s + c.actualAmountReceived, 0),
    cashPayoutsCount: cashPayouts.length,
    cashPayoutsAmount: cashPayouts.reduce((s, p) => s + p.amount, 0),
    outstandingMemberDues: memberDues,
  });
};
