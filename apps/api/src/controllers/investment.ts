import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Investment } from '../models/Investment';
import { InvestmentContribution } from '../models/InvestmentContribution';
import { Transaction } from '../models/Transaction';
import { sendSuccess, sendError, AppError } from '../utils/api-response';
import {
  InvestmentType,
  InvestmentStatus,
  InvestmentContributionStatus,
  InvestmentDashboardData,
  InvestmentItem,
  toCents,
  fromCents,
  safeAdd,
} from '@finora/shared';
import {
  initializeInvestmentSchedule,
  computeInvestmentSummary,
  recordInvestmentPayment,
  deleteInvestmentPayment,
  markExternalChitAsWon,
  correctExternalChitPayout,
  getUpcomingInvestmentObligations,
  resetSingleInvestment,
  resetAllInvestmentsForUser,
} from '../services/investment-service';
import { getCycleKey } from './recurring';

/**
 * GET /api/v1/investments/dashboard
 * Aggregates live KPI cards, category breakdown, monthly chart, and recent activity.
 */
export const getInvestmentDashboard = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!._id;
    const currentMonthKey = getCycleKey(new Date(), 'Asia/Kolkata');

    const investments = await Investment.find({ userId }).sort({ createdAt: -1 });

    let totalHistoricalInvestedCents = 0;
    let totalInvestedThisMonthCents = 0;
    let activeInvestmentsCount = 0;
    let completedInvestmentsCount = 0;
    let wonChitsCount = 0;

    const categoryMap = new Map<string, { totalCents: number; count: number }>();
    const monthlyMap = new Map<string, { totalCents: number; count: number }>();

    const investmentItems: InvestmentItem[] = [];

    for (const inv of investments) {
      if (inv.status === InvestmentStatus.ACTIVE) activeInvestmentsCount++;
      if (inv.status === InvestmentStatus.COMPLETED) completedInvestmentsCount++;
      if (inv.isWon) wonChitsCount++;

      const summary = await computeInvestmentSummary(inv._id, userId);

      totalHistoricalInvestedCents += toCents(summary.totalHistoricalContributed);
      totalInvestedThisMonthCents += toCents(summary.totalPaidThisMonth);

      // Category breakdown
      const cat = inv.category || 'Other Investments';
      const catEntry = categoryMap.get(cat) || { totalCents: 0, count: 0 };
      catEntry.totalCents += toCents(summary.totalHistoricalContributed);
      catEntry.count += 1;
      categoryMap.set(cat, catEntry);

      investmentItems.push({
        id: inv._id.toString(),
        userId: userId.toString(),
        name: inv.name,
        category: inv.category,
        investmentType: inv.investmentType,
        initialAmount: inv.initialAmount,
        startDate: inv.startDate.toISOString(),
        endDate: inv.endDate ? inv.endDate.toISOString() : undefined,
        durationMonths: inv.durationMonths,
        monthlyContribution: inv.monthlyContribution,
        isMonthlyPaymentEnabled: inv.isMonthlyPaymentEnabled,
        paymentMethod: inv.paymentMethod,
        accountId: inv.accountId ? inv.accountId.toString() : undefined,
        creditCardId: inv.creditCardId ? inv.creditCardId.toString() : undefined,
        status: inv.status,
        notes: inv.notes,
        isExternalChit: inv.isExternalChit,
        chitName: inv.chitName,
        isWon: inv.isWon,
        winningDate: inv.winningDate ? inv.winningDate.toISOString() : undefined,
        payoutAmount: inv.payoutAmount,
        isHistoricalPayout: inv.isHistoricalPayout,
        payoutDestinationType: inv.payoutDestinationType,
        payoutAccountId: inv.payoutAccountId ? inv.payoutAccountId.toString() : undefined,
        payoutTransactionId: inv.payoutTransactionId ? inv.payoutTransactionId.toString() : undefined,
        payoutNotes: inv.payoutNotes,
        totalHistoricalContributed: summary.totalHistoricalContributed,
        totalActualContributed: summary.totalActualContributed,
        totalContributionsInvested: summary.totalContributionsInvested,
        totalInvested: summary.totalInvested,
        remainingContributionCommitment: summary.remainingContributionCommitment,
        outstandingContributions: summary.outstandingContributions,
        netChitCashFlow: summary.netChitCashFlow,
        totalPaidThisMonth: summary.totalPaidThisMonth,
        totalScheduledMonths: summary.totalScheduledMonths,
        paidMonthsCount: summary.paidMonthsCount,
        unpaidMonthsCount: summary.unpaidMonthsCount,
        remainingScheduledAmount: summary.remainingScheduledAmount,
        nextDueCycle: summary.nextDueCycle,
        nextDueDate: summary.nextDueDate ? summary.nextDueDate.toISOString() : undefined,
        createdAt: inv.createdAt.toISOString(),
        updatedAt: inv.updatedAt.toISOString(),
      });
    }

    // Calculate monthly contribution trend from all contributions
    const allPaidContributions = await InvestmentContribution.find({
      userId,
      status: { $in: [InvestmentContributionStatus.PAID, InvestmentContributionStatus.PAID_HISTORICAL] },
    });

    for (const c of allPaidContributions) {
      const amtCents = toCents(c.actualAmount ?? c.expectedAmount);
      const entry = monthlyMap.get(c.cycleKey) || { totalCents: 0, count: 0 };
      entry.totalCents += amtCents;
      entry.count += 1;
      monthlyMap.set(c.cycleKey, entry);
    }

    // Convert category map to sorted array with percentages
    const totalHistoricalInvested = fromCents(totalHistoricalInvestedCents);
    const categoryBreakdown = Array.from(categoryMap.entries()).map(([cat, val]) => {
      const totalAmount = fromCents(val.totalCents);
      const percentage =
        totalHistoricalInvested > 0
          ? Math.round((totalAmount / totalHistoricalInvested) * 100 * 10) / 10
          : 0;
      return {
        category: cat,
        totalAmount,
        count: val.count,
        percentage,
      };
    });
    categoryBreakdown.sort((a, b) => b.totalAmount - a.totalAmount);

    // Convert monthly map to sorted array
    const monthlyContributions = Array.from(monthlyMap.entries())
      .map(([month, val]) => ({
        month,
        amount: fromCents(val.totalCents),
        count: val.count,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // Get upcoming payments for current month
    const upcoming = await getUpcomingInvestmentObligations(userId, currentMonthKey);

    const dashboardData: InvestmentDashboardData = {
      totalHistoricalInvested,
      totalInvestedThisMonth: fromCents(totalInvestedThisMonthCents),
      activeInvestmentsCount,
      completedInvestmentsCount,
      wonChitsCount,
      categoryBreakdown,
      monthlyContributions,
      investments: investmentItems,
      upcomingPayments: upcoming.items,
    };

    sendSuccess(res, dashboardData, 'Investment dashboard data retrieved successfully');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/investments
 * List investments with filters.
 */
export const getInvestments = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!._id;
    const { category, status, investmentType, isExternalChit, isWon, search } = req.query;

    const filter: any = { userId };
    if (category && typeof category === 'string') filter.category = category;
    if (status && typeof status === 'string') filter.status = status;
    if (investmentType && typeof investmentType === 'string') filter.investmentType = investmentType;
    if (isExternalChit !== undefined) filter.isExternalChit = isExternalChit === 'true';
    if (isWon !== undefined) filter.isWon = isWon === 'true';
    if (search && typeof search === 'string') {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
        { notes: { $regex: search, $options: 'i' } },
      ];
    }

    const investments = await Investment.find(filter).sort({ createdAt: -1 });
    const items: InvestmentItem[] = [];

    for (const inv of investments) {
      const summary = await computeInvestmentSummary(inv._id, userId);
      items.push({
        id: inv._id.toString(),
        userId: userId.toString(),
        name: inv.name,
        category: inv.category,
        investmentType: inv.investmentType,
        initialAmount: inv.initialAmount,
        startDate: inv.startDate.toISOString(),
        endDate: inv.endDate ? inv.endDate.toISOString() : undefined,
        durationMonths: inv.durationMonths,
        monthlyContribution: inv.monthlyContribution,
        isMonthlyPaymentEnabled: inv.isMonthlyPaymentEnabled,
        paymentMethod: inv.paymentMethod,
        accountId: inv.accountId ? inv.accountId.toString() : undefined,
        creditCardId: inv.creditCardId ? inv.creditCardId.toString() : undefined,
        status: inv.status,
        notes: inv.notes,
        isExternalChit: inv.isExternalChit,
        chitName: inv.chitName,
        isWon: inv.isWon,
        winningDate: inv.winningDate ? inv.winningDate.toISOString() : undefined,
        payoutAmount: inv.payoutAmount,
        isHistoricalPayout: inv.isHistoricalPayout,
        payoutDestinationType: inv.payoutDestinationType,
        payoutAccountId: inv.payoutAccountId ? inv.payoutAccountId.toString() : undefined,
        payoutTransactionId: inv.payoutTransactionId ? inv.payoutTransactionId.toString() : undefined,
        payoutNotes: inv.payoutNotes,
        totalHistoricalContributed: summary.totalHistoricalContributed,
        totalActualContributed: summary.totalActualContributed,
        totalContributionsInvested: summary.totalContributionsInvested,
        totalInvested: summary.totalInvested,
        remainingContributionCommitment: summary.remainingContributionCommitment,
        outstandingContributions: summary.outstandingContributions,
        netChitCashFlow: summary.netChitCashFlow,
        totalPaidThisMonth: summary.totalPaidThisMonth,
        totalScheduledMonths: summary.totalScheduledMonths,
        paidMonthsCount: summary.paidMonthsCount,
        unpaidMonthsCount: summary.unpaidMonthsCount,
        remainingScheduledAmount: summary.remainingScheduledAmount,
        nextDueCycle: summary.nextDueCycle,
        nextDueDate: summary.nextDueDate ? summary.nextDueDate.toISOString() : undefined,
        createdAt: inv.createdAt.toISOString(),
        updatedAt: inv.updatedAt.toISOString(),
      });
    }

    sendSuccess(res, items, 'Investments retrieved successfully');
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/investments/:id
 * Retrieve details of a single investment including full contribution ledger.
 */
export const getInvestmentById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!._id;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid investment ID', 400, 'INVALID_ID');
    }

    const investment = await Investment.findOne({ _id: id, userId });
    if (!investment) {
      throw new AppError('Investment not found', 404, 'NOT_FOUND');
    }

    const summary = await computeInvestmentSummary(investment._id, userId);

    const contributions = await InvestmentContribution.find({
      investmentId: id,
      userId,
    }).sort({ cycleKey: 1 });

    const linkedTransactions = await Transaction.find({
      investmentId: id,
      userId,
    }).sort({ date: -1 });

    const data = {
      investment: {
        id: investment._id.toString(),
        userId: userId.toString(),
        name: investment.name,
        category: investment.category,
        investmentType: investment.investmentType,
        initialAmount: investment.initialAmount,
        startDate: investment.startDate.toISOString(),
        endDate: investment.endDate ? investment.endDate.toISOString() : undefined,
        durationMonths: investment.durationMonths,
        monthlyContribution: investment.monthlyContribution,
        isMonthlyPaymentEnabled: investment.isMonthlyPaymentEnabled,
        paymentMethod: investment.paymentMethod,
        accountId: investment.accountId ? investment.accountId.toString() : undefined,
        creditCardId: investment.creditCardId ? investment.creditCardId.toString() : undefined,
        status: investment.status,
        notes: investment.notes,
        isExternalChit: investment.isExternalChit,
        chitName: investment.chitName,
        isWon: investment.isWon,
        winningDate: investment.winningDate ? investment.winningDate.toISOString() : undefined,
        payoutAmount: investment.payoutAmount,
        payoutDestinationType: investment.payoutDestinationType,
        payoutAccountId: investment.payoutAccountId ? investment.payoutAccountId.toString() : undefined,
        payoutTransactionId: investment.payoutTransactionId ? investment.payoutTransactionId.toString() : undefined,
        payoutNotes: investment.payoutNotes,
        ...summary,
        createdAt: investment.createdAt.toISOString(),
        updatedAt: investment.updatedAt.toISOString(),
      },
      contributions: contributions.map((c) => ({
        id: c._id.toString(),
        investmentId: c.investmentId.toString(),
        cycleKey: c.cycleKey,
        installmentNumber: c.installmentNumber,
        scheduledDate: c.scheduledDate.toISOString(),
        expectedAmount: c.expectedAmount,
        actualAmount: c.actualAmount,
        paidAt: c.paidAt ? c.paidAt.toISOString() : undefined,
        status: c.status,
        isHistorical: c.isHistorical,
        paymentMethod: c.paymentMethod,
        paymentChannel: c.paymentChannel,
        cashSource: (c as any).cashSource,
        accountId: c.accountId ? c.accountId.toString() : undefined,
        creditCardId: c.creditCardId ? c.creditCardId.toString() : undefined,
        transactionId: c.transactionId ? c.transactionId.toString() : undefined,
        notes: c.notes,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
      transactions: linkedTransactions,
    };

    sendSuccess(res, data, 'Investment retrieved successfully');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/investments
 * Create a new investment or external chit.
 */
export const createInvestment = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!._id;
    const {
      name,
      category,
      investmentType,
      initialAmount,
      startDate,
      endDate,
      durationMonths,
      monthlyContribution,
      isMonthlyPaymentEnabled,
      paymentMethod,
      accountId,
      creditCardId,
      notes,
      historicalPayments,
      historicalRange,
    } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new AppError('Investment name is required', 400, 'MISSING_NAME');
    }

    if (!category || typeof category !== 'string' || !category.trim()) {
      throw new AppError('Investment category is required', 400, 'MISSING_CATEGORY');
    }

    const isChit = category.trim().toUpperCase() === 'CHIT' || investmentType === InvestmentType.CHIT;

    let computedDuration = durationMonths ? parseInt(durationMonths, 10) : undefined;
    const effectiveStartDate = startDate ? new Date(startDate) : new Date();
    let effectiveEndDate = endDate ? new Date(endDate) : undefined;

    if (isChit) {
      if (!computedDuration && effectiveEndDate) {
        // Derive duration from start and end dates
        const diffMonths =
          (effectiveEndDate.getFullYear() - effectiveStartDate.getFullYear()) * 12 +
          (effectiveEndDate.getMonth() - effectiveStartDate.getMonth()) +
          1;
        computedDuration = Math.max(1, diffMonths);
      } else if (computedDuration && !effectiveEndDate) {
        effectiveEndDate = new Date(effectiveStartDate);
        effectiveEndDate.setMonth(effectiveEndDate.getMonth() + computedDuration - 1);
      } else if (!computedDuration && !effectiveEndDate) {
        computedDuration = 12; // default
        effectiveEndDate = new Date(effectiveStartDate);
        effectiveEndDate.setMonth(effectiveEndDate.getMonth() + 11);
      }
    }

    const investment = await Investment.create({
      userId,
      name: name.trim(),
      category: isChit ? 'CHIT' : category.trim(),
      investmentType: isChit ? InvestmentType.CHIT : (investmentType || InvestmentType.RECURRING),
      initialAmount: initialAmount ? parseFloat(initialAmount) : 0,
      startDate: effectiveStartDate,
      endDate: effectiveEndDate,
      durationMonths: computedDuration,
      monthlyContribution: monthlyContribution ? parseFloat(monthlyContribution) : 0,
      isMonthlyPaymentEnabled: isMonthlyPaymentEnabled !== undefined ? Boolean(isMonthlyPaymentEnabled) : true,
      paymentMethod,
      accountId: accountId && mongoose.Types.ObjectId.isValid(accountId) ? accountId : undefined,
      creditCardId: creditCardId && mongoose.Types.ObjectId.isValid(creditCardId) ? creditCardId : undefined,
      status: InvestmentStatus.ACTIVE,
      notes,
      isExternalChit: isChit,
      chitName: isChit ? name.trim() : undefined,
      isWon: false,
    });

    // If recurring or external chit, initialize monthly schedule & import historical payments
    if (investment.isMonthlyPaymentEnabled || isChit) {
      await initializeInvestmentSchedule(investment, historicalPayments, historicalRange);
    }

    sendSuccess(res, investment, 'Investment created successfully', 201);
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/v1/investments/:id
 * Edit metadata of an investment without modifying historical payment records.
 */
export const updateInvestment = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!._id;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid investment ID', 400, 'INVALID_ID');
    }

    const investment = await Investment.findOne({ _id: id, userId });
    if (!investment) {
      throw new AppError('Investment not found', 404, 'NOT_FOUND');
    }

    const {
      name,
      notes,
      monthlyContribution,
      isMonthlyPaymentEnabled,
      paymentMethod,
      accountId,
      creditCardId,
      status,
      historicalRange,
    } = req.body;

    if (name !== undefined) investment.name = name.trim();
    if (notes !== undefined) investment.notes = notes;
    if (paymentMethod !== undefined) investment.paymentMethod = paymentMethod;
    if (accountId !== undefined) {
      investment.accountId = accountId && mongoose.Types.ObjectId.isValid(accountId) ? accountId : undefined;
    }
    if (creditCardId !== undefined) {
      investment.creditCardId = creditCardId && mongoose.Types.ObjectId.isValid(creditCardId) ? creditCardId : undefined;
    }
    if (status !== undefined && Object.values(InvestmentStatus).includes(status)) {
      investment.status = status;
    }

    // Changing monthly amount affects future DUE obligations only
    if (monthlyContribution !== undefined) {
      const newAmt = parseFloat(monthlyContribution);
      investment.monthlyContribution = newAmt;

      // Update future DUE occurrences
      await InvestmentContribution.updateMany(
        { investmentId: id, userId, status: InvestmentContributionStatus.DUE },
        { $set: { expectedAmount: newAmt } }
      );
    }

    if (isMonthlyPaymentEnabled !== undefined) {
      investment.isMonthlyPaymentEnabled = Boolean(isMonthlyPaymentEnabled);
    }

    if (historicalRange !== undefined) {
      await initializeInvestmentSchedule(investment, undefined, historicalRange);
    }

    await investment.save();

    sendSuccess(res, investment, 'Investment updated successfully');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/investments/:id/pay
 * Record an actual in-app payment for an investment cycle.
 */
export const payInvestmentContribution = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!._id;
    const { id } = req.params;
    const {
      cycleKey,
      amount,
      paymentDate,
      paymentMethod,
      paymentChannel,
      cashSource,
      accountId,
      creditCardId,
      notes,
    } = req.body;

    if (!cycleKey || typeof cycleKey !== 'string') {
      throw new AppError('Contribution cycleKey (YYYY-MM) is required', 400, 'MISSING_CYCLE');
    }

    if (amount === undefined || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      throw new AppError('Valid payment amount is required', 400, 'INVALID_AMOUNT');
    }

    const result = await recordInvestmentPayment({
      userId,
      investmentId: id,
      cycleKey,
      amount: parseFloat(amount),
      paymentDate,
      paymentMethod,
      paymentChannel,
      cashSource,
      accountId,
      creditCardId,
      notes,
    });

    sendSuccess(res, result, 'Investment payment recorded successfully');
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/v1/investments/:id/pay
 * Reverse a recorded payment and restore cycle to unpaid.
 */
export const deleteContributionPayment = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!._id;
    const { id } = req.params;
    const { cycleKey } = req.body;

    if (!cycleKey || typeof cycleKey !== 'string') {
      throw new AppError('cycleKey is required to reverse payment', 400, 'MISSING_CYCLE');
    }

    await deleteInvestmentPayment({ userId, investmentId: id, cycleKey });

    sendSuccess(res, null, 'Investment payment reversed and restored to unpaid successfully');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/investments/:id/won
 * Mark external chit as won and record prize payout.
 */
export const markChitAsWonController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!._id;
    const { id } = req.params;
    const {
      winningDate,
      payoutAmount,
      payoutDestinationType,
      payoutAccountId,
      payoutNotes,
      isHistoricalPayout,
    } = req.body;

    if (!winningDate) {
      throw new AppError('Winning date is required', 400, 'MISSING_WINNING_DATE');
    }

    if (payoutAmount === undefined || isNaN(parseFloat(payoutAmount)) || parseFloat(payoutAmount) <= 0) {
      throw new AppError('Valid payout amount is required', 400, 'INVALID_PAYOUT_AMOUNT');
    }

    if (!payoutDestinationType || !['bank', 'cash'].includes(payoutDestinationType)) {
      throw new AppError('Payout destination type must be bank or cash', 400, 'INVALID_DESTINATION_TYPE');
    }

    const result = await markExternalChitAsWon({
      userId,
      investmentId: id,
      winningDate,
      payoutAmount: parseFloat(payoutAmount),
      payoutDestinationType,
      payoutAccountId,
      payoutNotes,
      isHistoricalPayout: Boolean(isHistoricalPayout),
    });

    sendSuccess(res, result, 'Chit marked as won and payout recorded successfully');
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/v1/investments/:id/payout
 * Correct an existing chit payout safely.
 */
export const correctChitPayoutController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!._id;
    const { id } = req.params;
    const {
      winningDate,
      payoutAmount,
      payoutDestinationType,
      payoutAccountId,
      payoutNotes,
      isHistoricalPayout,
    } = req.body;

    if (payoutAmount === undefined || isNaN(parseFloat(payoutAmount)) || parseFloat(payoutAmount) <= 0) {
      throw new AppError('Valid payout amount is required', 400, 'INVALID_PAYOUT_AMOUNT');
    }

    const result = await correctExternalChitPayout({
      userId,
      investmentId: id,
      winningDate,
      payoutAmount: parseFloat(payoutAmount),
      payoutDestinationType,
      payoutAccountId,
      payoutNotes,
      isHistoricalPayout: Boolean(isHistoricalPayout),
    });

    sendSuccess(res, result, 'Chit payout corrected successfully');
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/v1/investments/:id
 * Delete a single investment cleanly.
 */
export const deleteInvestmentController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!._id;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid investment ID', 400, 'INVALID_ID');
    }

    await resetSingleInvestment(id, userId);

    sendSuccess(res, null, 'Investment deleted and schedule cleaned up successfully');
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/investments/reset-all
 * Reset all investments for the authenticated user.
 */
export const resetAllInvestmentsController = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user!._id;
    const { confirmationPhrase } = req.body;

    if (confirmationPhrase !== 'RESET INVESTMENTS') {
      throw new AppError(
        'Confirmation phrase must exactly match "RESET INVESTMENTS"',
        400,
        'INVALID_CONFIRMATION_PHRASE'
      );
    }

    const result = await resetAllInvestmentsForUser(userId);

    sendSuccess(
      res,
      result,
      `All investments reset successfully (${result.deletedInvestments} investments, ${result.deletedContributions} contributions, and ${result.deletedTransactions} transactions removed)`
    );
  } catch (err) {
    next(err);
  }
};
