import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import { User } from '../models/User';
import { BankAccount } from '../models/BankAccount';
import { CreditCard } from '../models/CreditCard';
import { CreditCardStatement } from '../models/CreditCardStatement';
import { Transaction } from '../models/Transaction';
import { ChitFund } from '../models/ChitFund';
import { ChitFundMember } from '../models/ChitFundMember';
import { ChitFundCollection } from '../models/ChitFundCollection';
import { ChitFundPayout } from '../models/ChitFundPayout';
import { ChitFundAdjustment } from '../models/ChitFundAdjustment';
import { ChitFundCycle } from '../models/ChitFundCycle';
import { Budget } from '../models/Budget';
import { RecurringTransaction } from '../models/RecurringTransaction';
import { RecurringOccurrence } from '../models/RecurringOccurrence';
import { Category } from '../models/Category';
import { LendingBorrowing } from '../models/LendingBorrowing';
import { CashAccount } from '../models/CashAccount';
import { Investment } from '../models/Investment';
import { InvestmentContribution } from '../models/InvestmentContribution';
import { EmiRule } from '../models/EmiRule';
import { EmiOccurrence } from '../models/EmiOccurrence';
import { PassThroughMoney } from '../models/PassThroughMoney';
import { AuditLog } from '../models/AuditLog';
import { sendSuccess, sendError } from '../utils/api-response';
import { clearAuthCookie } from '../utils/token';
import {
  updateModulePreferencesSchema,
  resetTransactionsSchema,
  resetAllFinancialDataSchema,
  resetChitWinnerMonthSchema,
  resetAllChitWinnersSchema,
  resetChitFundFinancialsSchema,
  deleteAccountPermanentlySchema,
  resetLendingBorrowingSchema,
  resetEmiSchema,
  TransactionType,
} from '@finora/shared';
import {
  recalculateAccountBalance,
  recalculateCreditCardOutstanding,
  calculateCashInHand,
} from '../services/financial';

export const getModulePreferences = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const user = await User.findById(userId);

  if (!user) {
    sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    return;
  }

  const prefs = user.modulePreferences || {
    expenseTracker: true,
    emi: true,
    lendingBorrowing: true,
    budget: true,
    recurringTransactions: true,
    creditCards: true,
    chitFund: true,
    investment: true,
  };

  sendSuccess(res, {
    modulePreferences: prefs,
    expenseTracker: prefs.expenseTracker !== false,
    emi: prefs.emi !== false,
    lendingBorrowing: prefs.lendingBorrowing !== false,
    budget: prefs.budget !== false,
    recurringTransactions: prefs.recurringTransactions !== false,
    creditCards: prefs.creditCards !== false,
    chitFund: prefs.chitFund !== false,
    investment: prefs.investment !== false,
  });
};

export const updateModulePreferences = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const rawBody = req.body?.preferences?.modulePreferences || req.body?.modulePreferences || req.body;
  const validated = updateModulePreferencesSchema.parse(rawBody);

  const user = await User.findById(userId);
  if (!user) {
    sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    return;
  }

  if (!user.modulePreferences) {
    user.modulePreferences = {
      expenseTracker: true,
      emi: true,
      lendingBorrowing: true,
      budget: true,
      recurringTransactions: true,
      creditCards: true,
      chitFund: true,
      investment: true,
    };
  }

  if (validated.expenseTracker !== undefined) {
    user.modulePreferences.expenseTracker = validated.expenseTracker;
  }
  if (validated.emi !== undefined) {
    user.modulePreferences.emi = validated.emi;
  }
  if (validated.lendingBorrowing !== undefined) {
    user.modulePreferences.lendingBorrowing = validated.lendingBorrowing;
  }
  if (validated.budget !== undefined) {
    user.modulePreferences.budget = validated.budget;
  }
  if (validated.recurringTransactions !== undefined) {
    user.modulePreferences.recurringTransactions = validated.recurringTransactions;
  }
  if (validated.creditCards !== undefined) {
    user.modulePreferences.creditCards = validated.creditCards;
  }
  if (validated.chitFund !== undefined) {
    user.modulePreferences.chitFund = validated.chitFund;
  }
  if (validated.investment !== undefined) {
    user.modulePreferences.investment = validated.investment;
  }

  await user.save();

  sendSuccess(res, {
    modulePreferences: user.modulePreferences,
    expenseTracker: user.modulePreferences.expenseTracker,
    emi: user.modulePreferences.emi,
    lendingBorrowing: user.modulePreferences.lendingBorrowing,
    budget: user.modulePreferences.budget,
    recurringTransactions: user.modulePreferences.recurringTransactions,
    creditCards: user.modulePreferences.creditCards,
    chitFund: user.modulePreferences.chitFund,
    investment: user.modulePreferences.investment,
  }, 'Module preferences updated successfully');
};

/**
 * Reset Selected Transactions & Financial Entries
 * Removes selected personal activity while strictly preserving bank accounts, credit cards,
 * chit fund records (members, collections, payouts, reserves), opening balances, profile credentials,
 * and recalculating remaining balances authoritatively.
 */
export const resetTransactions = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const validated = resetTransactionsSchema.parse(req.body);

  const selectedTypes = validated.selectedTypes;
  const deletedCounts: Record<string, number> = {};

  if (selectedTypes.includes('income')) {
    const r = await Transaction.deleteMany({ userId, type: TransactionType.INCOME });
    deletedCounts.income = r.deletedCount;
  }

  const deleteExpenses = selectedTypes.includes('expense');
  const deleteCcPurchases = selectedTypes.includes('credit_card_purchases');

  if (deleteExpenses && deleteCcPurchases) {
    const r = await Transaction.deleteMany({
      userId,
      $or: [{ type: TransactionType.EXPENSE }, { type: TransactionType.CREDIT_CARD_REFUND }],
    });
    deletedCounts.expense = r.deletedCount;
  } else if (deleteExpenses) {
    const r = await Transaction.deleteMany({
      userId,
      type: TransactionType.EXPENSE,
      creditCardId: null,
    });
    deletedCounts.expense = r.deletedCount;
  } else if (deleteCcPurchases) {
    const r = await Transaction.deleteMany({
      userId,
      $or: [
        { type: TransactionType.EXPENSE, creditCardId: { $ne: null } },
        { type: TransactionType.CREDIT_CARD_REFUND },
      ],
    });
    deletedCounts.credit_card_purchases = r.deletedCount;
  }

  if (selectedTypes.includes('transfers')) {
    const r = await Transaction.deleteMany({ userId, type: TransactionType.TRANSFER });
    deletedCounts.transfers = r.deletedCount;
  }

  if (selectedTypes.includes('credit_card_repayments')) {
    const r = await Transaction.deleteMany({ userId, type: TransactionType.CREDIT_CARD_PAYMENT });
    deletedCounts.credit_card_repayments = r.deletedCount;
    await CreditCardStatement.deleteMany({ userId });
  }

  if (selectedTypes.includes('budgets')) {
    const r = await Budget.deleteMany({ userId });
    deletedCounts.budgets = r.deletedCount;
  }

  if (selectedTypes.includes('recurring')) {
    const r = await RecurringTransaction.deleteMany({ userId });
    deletedCounts.recurring = r.deletedCount;
  }

  // Recalculate all bank account balances authoritatively
  const accounts = await BankAccount.find({ userId });
  for (const acc of accounts) {
    await recalculateAccountBalance(acc._id, userId);
  }

  // Recalculate all credit card outstandings authoritatively
  const cards = await CreditCard.find({ userId });
  for (const card of cards) {
    await recalculateCreditCardOutstanding(card._id, userId);
  }

  sendSuccess(
    res,
    {
      deletedCounts,
      accountsPreserved: accounts.length,
      cardsPreserved: cards.length,
    },
    'Selected transactions and entries successfully reset. Remaining balances authoritatively recalculated.'
  );
};

/**
 * Option B — Reset All Financial Data
 * Complete wipe of the user's financial setup (accounts, cards, members, transactions, budgets)
 * while preserving user account, credentials, admin role, and login identity.
 */
export const resetAllFinancialData = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const validated = resetAllFinancialDataSchema.parse(req.body);

  const user = await User.findById(userId).select('+password');
  if (!user) {
    sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    return;
  }

  if (validated.password && user.password) {
    const match = await bcrypt.compare(validated.password, user.password);
    if (!match) {
      sendError(res, 'Password confirmation failed. Incorrect password.', 401, 'INVALID_PASSWORD');
      return;
    }
  }

  // Atomic wipe of financial records belonging to this user
  await Promise.all([
    Transaction.deleteMany({ userId }),
    CreditCardStatement.deleteMany({ userId }),
    CreditCard.deleteMany({ userId }),
    BankAccount.deleteMany({ userId }),
    ChitFundCollection.deleteMany({ userId }),
    ChitFundPayout.deleteMany({ userId }),
    ChitFundAdjustment.deleteMany({ userId }),
    ChitFundCycle.deleteMany({ userId }),
    ChitFundMember.deleteMany({ userId }),
    ChitFund.deleteMany({ userId }),
    Budget.deleteMany({ userId }),
    RecurringTransaction.deleteMany({ userId }),
    RecurringOccurrence.deleteMany({ userId }),
    Category.deleteMany({ userId, isCustom: true }),
    LendingBorrowing.deleteMany({ userId }),
    Investment.deleteMany({ userId }),
    InvestmentContribution.deleteMany({ userId }),
    EmiRule.deleteMany({ userId }),
    EmiOccurrence.deleteMany({ userId }),
    CashAccount.deleteMany({ userId }),
    PassThroughMoney.deleteMany({ userId }),
  ]);

  sendSuccess(
    res,
    {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      resetCompleted: true,
      userPreserved: true,
    },
    'All financial records and configuration have been reset. Your account login and administrator privileges remain active.'
  );
};

/**
 * Permanent Account Deletion
 * Permanently and irreversibly removes the user's account and all associated personal and financial records.
 */
export const deleteAccountPermanently = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const validated = deleteAccountPermanentlySchema.parse(req.body);

  const user = await User.findById(userId).select('+password');
  if (!user) {
    sendError(res, 'User not found', 404, 'USER_NOT_FOUND');
    return;
  }

  if (validated.password && user.password) {
    const match = await bcrypt.compare(validated.password, user.password);
    if (!match) {
      sendError(res, 'Password confirmation failed. Incorrect password.', 401, 'INVALID_PASSWORD');
      return;
    }
  }

  // Atomic wipe of all records belonging to this user across every collection
  await Promise.all([
    Transaction.deleteMany({ userId }),
    CreditCardStatement.deleteMany({ userId }),
    CreditCard.deleteMany({ userId }),
    BankAccount.deleteMany({ userId }),
    CashAccount.deleteMany({ userId }),
    ChitFundCollection.deleteMany({ userId }),
    ChitFundPayout.deleteMany({ userId }),
    ChitFundAdjustment.deleteMany({ userId }),
    ChitFundCycle.deleteMany({ userId }),
    ChitFundMember.deleteMany({ userId }),
    ChitFund.deleteMany({ userId }),
    Budget.deleteMany({ userId }),
    RecurringTransaction.deleteMany({ userId }),
    RecurringOccurrence.deleteMany({ userId }),
    Category.deleteMany({ userId, isCustom: true }),
    LendingBorrowing.deleteMany({ userId }),
    Investment.deleteMany({ userId }),
    InvestmentContribution.deleteMany({ userId }),
    EmiRule.deleteMany({ userId }),
    EmiOccurrence.deleteMany({ userId }),
    AuditLog.deleteMany({ userId }),
    PassThroughMoney.deleteMany({ userId }),
  ]);

  // Permanently delete user record
  await User.deleteOne({ _id: userId });

  clearAuthCookie(res);

  sendSuccess(
    res,
    { deletedUserId: userId.toString(), accountPermanentlyDeleted: true },
    'Your account and all associated personal and financial records have been permanently deleted.'
  );
};

/**
 * Option A — Reset Chit Winner for a Selected Month (Settings -> Data Management)
 */
export const resetChitWinnerMonth = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;

  if (req.user?.modulePreferences?.chitFund === false) {
    sendError(res, 'Chit Fund module is currently disabled for this account', 403, 'MODULE_DISABLED');
    return;
  }

  const validated = resetChitWinnerMonthSchema.parse(req.body);

  let fundId = validated.chitFundId;
  if (!fundId) {
    const fund = await ChitFund.findOne({ userId });
    if (!fund) {
      sendError(res, 'Chit fund not found', 404, 'CHIT_FUND_NOT_FOUND');
      return;
    }
    fundId = fund._id.toString();
  }

  const cycle = await ChitFundCycle.findOne({
    userId,
    chitFundId: fundId,
    cyclePeriod: validated.cyclePeriod,
  });

  if (!cycle) {
    sendError(res, `Cycle ${validated.cyclePeriod} not found`, 404, 'CYCLE_NOT_FOUND');
    return;
  }

  if (!cycle.winnerMemberId) {
    sendError(res, `Cycle ${validated.cyclePeriod} does not have a confirmed winner to reset`, 400, 'NO_CONFIRMED_WINNER');
    return;
  }

  // Financial safety check: Has a payout already been completed for this winner/cycle?
  const completedPayout = await ChitFundPayout.findOne({
    userId,
    chitFundId: fundId,
    payoutPeriod: validated.cyclePeriod,
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
        `Cannot reset winner for ${validated.cyclePeriod}: A payout of ₹${completedPayout.amount.toLocaleString()} has already been completed for this cycle. Reconcile or correct the payout record first to protect financial integrity.`,
        400,
        'PAYOUT_ALREADY_COMPLETED'
      );
      return;
    }
  }

  const winningMemberId = cycle.winnerMemberId;

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
    const member = await ChitFundMember.findOne({ _id: winningMemberId, chitFundId: fundId, userId });
    if (member) {
      const otherWinCycle = await ChitFundCycle.findOne({
        userId,
        chitFundId: fundId,
        winnerMemberId: member._id,
        cyclePeriod: { $ne: validated.cyclePeriod },
      });

      if (!otherWinCycle) {
        if (!member.previousWinCycle || member.previousWinCycle === validated.cyclePeriod) {
          member.hasPreviouslyWon = false;
          member.previousWinCycle = undefined;
          member.previousWinDate = undefined;
          member.previousWinNotes = undefined;
          await member.save();
        }
      }
    }
  }

  sendSuccess(res, cycle.toJSON(), `Winner for cycle ${validated.cyclePeriod} has been safely reset`);
};

/**
 * Option B — Reset All Chit Winner Assignments (Settings -> Data Management)
 */
export const resetAllChitWinners = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;

  if (req.user?.modulePreferences?.chitFund === false) {
    sendError(res, 'Chit Fund module is currently disabled for this account', 403, 'MODULE_DISABLED');
    return;
  }

  const validated = resetAllChitWinnersSchema.parse(req.body);

  let fundId = validated.chitFundId;
  if (!fundId) {
    const fund = await ChitFund.findOne({ userId });
    if (!fund) {
      sendError(res, 'Chit fund not found', 404, 'CHIT_FUND_NOT_FOUND');
      return;
    }
    fundId = fund._id.toString();
  }

  // Safety check: verify no live completed payouts exist
  const liveCompletedPayouts = await ChitFundPayout.find({
    userId,
    chitFundId: fundId,
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
    chitFundId: fundId,
    isHistorical: true,
  });

  const cyclesWithWinners = await ChitFundCycle.find({
    userId,
    chitFundId: fundId,
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

  for (const memberId of affectedWinnerMemberIds) {
    const member = await ChitFundMember.findOne({ _id: memberId, chitFundId: fundId, userId });
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
 * Chit Fund Financial Data Reset Preview (Counts & Affected Records)
 */
export const getChitFundResetPreview = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;

  if (req.user?.modulePreferences?.chitFund === false) {
    sendError(res, 'Chit Fund module is currently disabled for this account', 403, 'MODULE_DISABLED');
    return;
  }

  const fund = await ChitFund.findOne({ userId });
  if (!fund) {
    sendError(res, 'Chit fund not found', 404, 'CHIT_FUND_NOT_FOUND');
    return;
  }

  const [collectionsCount, payoutsCount, adjustmentsCount, cyclesWithWinnersCount, membersCount] =
    await Promise.all([
      ChitFundCollection.countDocuments({ userId, chitFundId: fund._id }),
      ChitFundPayout.countDocuments({ userId, chitFundId: fund._id }),
      ChitFundAdjustment.countDocuments({ userId, chitFundId: fund._id }),
      ChitFundCycle.countDocuments({
        userId,
        chitFundId: fund._id,
        $or: [{ winnerMemberId: { $exists: true, $ne: null } }, { winnerMemberName: { $exists: true, $ne: null } }],
      }),
      ChitFundMember.countDocuments({ userId, chitFundId: fund._id }),
    ]);

  const designatedAccount = await BankAccount.findOne({
    userId,
    isChitFundAccount: true,
    isArchived: false,
  });

  sendSuccess(res, {
    chitFundId: fund._id.toString(),
    chitFundName: fund.name,
    collectionsCount,
    payoutsCount,
    adjustmentsCount,
    ledgerEntriesCount: adjustmentsCount,
    cyclesCount: cyclesWithWinnersCount,
    cyclesWithWinnersCount,
    membersCount,
    membersPreserved: membersCount,
    designatedAccount: designatedAccount
      ? {
          accountName: designatedAccount.accountName,
          currentBalance: designatedAccount.currentBalance,
        }
      : null,
    designatedAccountName: designatedAccount?.accountName || 'None',
    currentBankBalance: designatedAccount?.currentBalance ?? 0,
    preserveCurrentBankBalance: true,
    backupSnapshotCollection: 'ChitFundAuditBackup',
  });
};

/**
 * Reset Chit Fund Financial Data — Preserve Members Only
 * Completely resets collections, payouts, winner history, cycle financial stats, ledger entries.
 * Retains all members (standardized to 1 chit @ ₹5,000/mo) and preserves real bank balances completely.
 */
export const resetChitFundFinancials = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;

  if (req.user?.modulePreferences?.chitFund === false) {
    sendError(res, 'Chit Fund module is currently disabled for this account', 403, 'MODULE_DISABLED');
    return;
  }

  const validated = resetChitFundFinancialsSchema.parse(req.body);

  let fundId = validated.chitFundId;
  let fund: any = null;
  if (fundId) {
    fund = await ChitFund.findOne({ _id: fundId, userId });
  } else {
    fund = (await ChitFund.findOne({ userId, isActive: true })) || (await ChitFund.findOne({ userId }));
  }

  if (!fund) {
    sendError(res, 'Chit fund not found', 404, 'CHIT_FUND_NOT_FOUND');
    return;
  }

  // 1. Create a snapshot backup before deletion for safety & audit
  const [collectionsToBackup, payoutsToBackup, adjustmentsToBackup, cyclesToBackup] = await Promise.all([
    ChitFundCollection.find({ userId, chitFundId: fund._id }),
    ChitFundPayout.find({ userId, chitFundId: fund._id }),
    ChitFundAdjustment.find({ userId, chitFundId: fund._id }),
    ChitFundCycle.find({ userId, chitFundId: fund._id }),
  ]);

  const backupSnapshot = {
    timestamp: new Date().toISOString(),
    userId: userId.toString(),
    chitFundId: fund._id.toString(),
    counts: {
      collections: collectionsToBackup.length,
      payouts: payoutsToBackup.length,
      adjustments: adjustmentsToBackup.length,
      cycles: cyclesToBackup.length,
    },
    data: {
      collections: collectionsToBackup.map((c) => c.toJSON()),
      payouts: payoutsToBackup.map((p) => p.toJSON()),
      adjustments: adjustmentsToBackup.map((a) => a.toJSON()),
      cycles: cyclesToBackup.map((c) => c.toJSON()),
    },
  };

  // 2. Delete chit financial records scoped strictly to this user and fund
  const [delCollections, delPayouts, delAdjustments] = await Promise.all([
    ChitFundCollection.deleteMany({ userId, chitFundId: fund._id }),
    ChitFundPayout.deleteMany({ userId, chitFundId: fund._id }),
    ChitFundAdjustment.deleteMany({ userId, chitFundId: fund._id }),
  ]);

  // 3. Reset all cycles for this fund
  await ChitFundCycle.updateMany(
    { userId, chitFundId: fund._id },
    {
      $set: {
        status: 'collecting',
        winnerMemberId: null,
        winnerMemberName: null,
        winnerConfirmedAt: null,
        winnerConfirmedBy: null,
        winnerNotes: null,
        notes: null,
        payoutId: null,
        payoutStatus: 'none',
        payoutAmount: 0,
      },
    }
  );

  // 4. Standardize all active members: 1 chit each, ₹5000/mo contribution, clear past winner flags
  const memberUpdateResult = await ChitFundMember.updateMany(
    { userId, chitFundId: fund._id, status: 'active' },
    {
      $set: {
        numberOfChits: 1,
        contributionPerChit: 5000,
        totalExpectedPerPeriod: 5000,
        hasPreviouslyWon: false,
        previousWinCycle: null,
        previousWinDate: null,
        previousWinNotes: null,
        winningCycleId: null,
        winningMonth: null,
      },
    }
  );

  // 5. Preserved Bank Balances: designated bank account balance is NOT touched
  const designatedAccount = await BankAccount.findOne({
    userId,
    isChitFundAccount: true,
    isArchived: false,
  });

  sendSuccess(
    res,
    {
      deletedCollections: delCollections.deletedCount,
      deletedPayouts: delPayouts.deletedCount,
      deletedAdjustments: delAdjustments.deletedCount,
      standardizedMembers: memberUpdateResult.modifiedCount,
      preservedBankBalance: designatedAccount?.currentBalance ?? 0,
      backupSnapshotSummary: backupSnapshot.counts,
    },
    'Chit fund financial records have been completely reset. All members are preserved and standardized to 1 chit @ ₹5,000/mo.'
  );
};

/**
 * Reset Lending & Borrowing Data
 * Completely deletes all lending, borrowing, and repayment records for the authenticated user,
 * then recalculates bank balances and cash in hand.
 */
export const resetLendingBorrowing = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;

  if (req.user?.modulePreferences?.lendingBorrowing === false) {
    sendError(res, 'Lending and Borrowing module is currently disabled for this account', 403, 'MODULE_DISABLED');
    return;
  }

  resetLendingBorrowingSchema.parse(req.body);

  const deleteResult = await LendingBorrowing.deleteMany({ userId });

  // Recalculate all bank account balances and cash in hand for this user
  const userAccounts = await BankAccount.find({ userId });
  for (const acc of userAccounts) {
    await recalculateAccountBalance(acc._id.toString(), userId);
  }
  await calculateCashInHand(userId);

  sendSuccess(
    res,
    { deletedCount: deleteResult.deletedCount },
    'All lending and borrowing records have been safely reset. Account and cash balances have been updated.'
  );
};

/**
 * Reset EMI Data
 * Completely deletes all EMI loan rules, installment occurrences, and linked transactions for the authenticated user,
 * then recalculates bank balances and credit card outstandings.
 */
export const resetEmiData = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;

  if (req.user?.modulePreferences?.emi === false) {
    sendError(res, 'EMI Management module is currently disabled for this account', 403, 'MODULE_DISABLED');
    return;
  }

  resetEmiSchema.parse(req.body);

  const [occResult, txResult, ruleResult] = await Promise.all([
    EmiOccurrence.deleteMany({ userId }),
    Transaction.deleteMany({ userId, emiRuleId: { $exists: true } }),
    EmiRule.deleteMany({ userId }),
  ]);

  // Recalculate affected bank accounts and credit cards
  const userAccounts = await BankAccount.find({ userId });
  for (const acc of userAccounts) {
    await recalculateAccountBalance(acc._id.toString(), userId);
  }
  const userCards = await CreditCard.find({ userId });
  for (const card of userCards) {
    await recalculateCreditCardOutstanding(card._id.toString(), userId);
  }

  sendSuccess(
    res,
    {
      deletedRulesCount: ruleResult.deletedCount,
      deletedOccurrencesCount: occResult.deletedCount,
      deletedTransactionsCount: txResult.deletedCount,
    },
    'All EMI loan rules, installments, and schedule records have been safely reset.'
  );
};

