import mongoose from 'mongoose';
import { Investment, IInvestment } from '../models/Investment';
import { InvestmentContribution, IInvestmentContribution } from '../models/InvestmentContribution';
import { Transaction } from '../models/Transaction';
import { BankAccount } from '../models/BankAccount';
import { CreditCard } from '../models/CreditCard';
import {
  InvestmentType,
  InvestmentStatus,
  InvestmentContributionStatus,
  TransactionType,
  TransactionStatus,
  PaymentMethod,
  PaymentChannel,
  UpcomingPaymentItem,
  safeAdd,
  toCents,
  fromCents,
} from '@finora/shared';
import { AppError } from '../utils/api-response';
import {
  recalculateAccountBalance,
  calculatePersonalCashInHand,
  recalculateCreditCardOutstanding,
} from './financial';
import { getCycleKey } from '../controllers/recurring';

export interface HistoricalPaymentInput {
  cycleKey: string;
  amount?: number;
  paidAt?: Date | string;
  notes?: string;
}

export interface HistoricalRangeInput {
  startMonth?: string; // YYYY-MM
  endMonth?: string;   // YYYY-MM
}

/**
 * Derives cycle keys (YYYY-MM in Asia/Kolkata) between two dates inclusive.
 */
export function generateMonthCycleKeys(startDate: Date, endDate: Date): string[] {
  const keys: string[] = [];
  const cur = new Date(startDate);
  cur.setDate(1); // align to beginning of month

  const endKey = getCycleKey(endDate, 'Asia/Kolkata');
  let currentKey = getCycleKey(cur, 'Asia/Kolkata');

  while (currentKey <= endKey && keys.length < 120) {
    keys.push(currentKey);
    // Advance 1 month
    cur.setMonth(cur.getMonth() + 1);
    currentKey = getCycleKey(cur, 'Asia/Kolkata');
  }

  return keys;
}

/**
 * Creates schedule occurrences for an external chit or monthly recurring investment,
 * supporting both list-based historical inputs and month/year range inputs with safe reconciliation.
 */
export async function initializeInvestmentSchedule(
  investment: IInvestment,
  historicalPayments?: HistoricalPaymentInput[],
  historicalRange?: HistoricalRangeInput
): Promise<void> {
  const userId = investment.userId;
  const investmentId = investment._id;

  const startDate = new Date(investment.startDate);
  let duration = investment.durationMonths || 12;

  // Calculate end date if not explicitly set
  let endDate = investment.endDate;
  if (!endDate) {
    endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + duration - 1);
  }

  const cycleKeys = generateMonthCycleKeys(startDate, endDate);
  const monthlyAmount = investment.monthlyContribution || investment.initialAmount || 0;

  const historicalMap = new Map<string, HistoricalPaymentInput>();
  if (Array.isArray(historicalPayments)) {
    for (const hp of historicalPayments) {
      if (hp.cycleKey) {
        historicalMap.set(hp.cycleKey, hp);
      }
    }
  }

  // If historicalRange is provided, populate historicalMap with all cycles in that range
  if (historicalRange?.startMonth && historicalRange?.endMonth) {
    const rStart = historicalRange.startMonth;
    const rEnd = historicalRange.endMonth;
    const currentMonthKey = getCycleKey(new Date(), 'Asia/Kolkata');

    for (const key of cycleKeys) {
      if (key >= rStart && key <= rEnd) {
        if (!historicalMap.has(key)) {
          historicalMap.set(key, {
            cycleKey: key,
            amount: monthlyAmount,
            notes: 'Midway historical payment imported',
          });
        }
      }
    }
  }

  // Get existing contributions for this investment to reconcile safely without overwriting actual payments
  const existingContributions = await InvestmentContribution.find({ investmentId, userId });
  const existingMap = new Map<string, IInvestmentContribution>();
  for (const c of existingContributions) {
    existingMap.set(c.cycleKey, c);
  }

  for (let i = 0; i < cycleKeys.length; i++) {
    const cycleKey = cycleKeys[i];
    const installmentNumber = i + 1;

    // Approximate scheduled date as the 10th of that cycle month in IST
    const [yearStr, monthStr] = cycleKey.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const scheduledDate = new Date(Date.UTC(year, month - 1, 10, 6, 0, 0)); // ~11:30 AM IST

    const hp = historicalMap.get(cycleKey);
    const isHistorical = Boolean(hp);

    const expectedAmount = monthlyAmount;
    const actualAmount = isHistorical ? (hp?.amount ?? expectedAmount) : undefined;
    const status = isHistorical
      ? InvestmentContributionStatus.PAID_HISTORICAL
      : InvestmentContributionStatus.DUE;
    const paidAt = isHistorical ? (hp?.paidAt ? new Date(hp.paidAt) : scheduledDate) : undefined;

    const existing = existingMap.get(cycleKey);

    if (existing) {
      // If already has an actual in-app payment with a transaction, NEVER overwrite it!
      if (existing.transactionId && existing.status === InvestmentContributionStatus.PAID) {
        continue;
      }

      // If it was historical, reconcile with new range/map
      if (existing.isHistorical || existing.status === InvestmentContributionStatus.PAID_HISTORICAL) {
        if (isHistorical) {
          existing.status = InvestmentContributionStatus.PAID_HISTORICAL;
          existing.actualAmount = actualAmount;
          existing.paidAt = paidAt;
          existing.notes = hp?.notes;
          await existing.save();
        } else {
          // No longer in historical range -> restore to DUE
          existing.status = InvestmentContributionStatus.DUE;
          existing.isHistorical = false;
          existing.actualAmount = undefined;
          existing.paidAt = undefined;
          existing.notes = undefined;
          await existing.save();
        }
      } else if (existing.status === InvestmentContributionStatus.DUE && isHistorical) {
        // Marked as historical now
        existing.status = InvestmentContributionStatus.PAID_HISTORICAL;
        existing.isHistorical = true;
        existing.actualAmount = actualAmount;
        existing.paidAt = paidAt;
        existing.notes = hp?.notes;
        await existing.save();
      }
    } else {
      // Insert new contribution record
      await InvestmentContribution.create({
        userId,
        investmentId,
        cycleKey,
        installmentNumber,
        scheduledDate,
        expectedAmount,
        actualAmount,
        status,
        isHistorical,
        paidAt,
        notes: hp?.notes,
      });
    }
  }
}

/**
 * Computes live accounting summaries for an investment, separating:
 * - Total Contributions Invested (Historical + Actual In-app Paid)
 * - Historical Contributions
 * - Actual In-app Contributions Paid
 * - Chit Payout Received
 * - Outstanding Contributions
 * - Remaining Contribution Commitment
 * - Net Chit Cash Flow
 */
export async function computeInvestmentSummary(
  investmentId: string | mongoose.Types.ObjectId,
  userId: string | mongoose.Types.ObjectId
): Promise<{
  totalHistoricalContributed: number;
  totalActualContributed: number;
  totalContributionsInvested: number;
  totalInvested: number;
  totalPaidThisMonth: number;
  totalScheduledMonths: number;
  paidMonthsCount: number;
  unpaidMonthsCount: number;
  remainingScheduledAmount: number;
  remainingContributionCommitment: number;
  outstandingContributions: number;
  netChitCashFlow: number;
  payoutReceived: number;
  isHistoricalPayout: boolean;
  nextDueCycle?: string;
  nextDueDate?: Date;
}> {
  const currentMonthKey = getCycleKey(new Date(), 'Asia/Kolkata');

  const inv = await Investment.findOne({ _id: investmentId, userId });
  const contributions = await InvestmentContribution.find({ investmentId, userId }).sort({
    cycleKey: 1,
  });

  let historicalCents = 0;
  let actualCents = 0;
  let totalPaidThisMonthCents = 0;
  let remainingScheduledCents = 0;
  let outstandingCents = 0;
  let paidMonthsCount = 0;
  let unpaidMonthsCount = 0;
  let nextDueCycle: string | undefined;
  let nextDueDate: Date | undefined;

  for (const c of contributions) {
    const isPaid =
      c.status === InvestmentContributionStatus.PAID ||
      c.status === InvestmentContributionStatus.PAID_HISTORICAL;

    if (isPaid) {
      paidMonthsCount++;
      const paidAmt = c.actualAmount ?? c.expectedAmount;
      if (c.isHistorical || c.status === InvestmentContributionStatus.PAID_HISTORICAL) {
        historicalCents += toCents(paidAmt);
      } else {
        actualCents += toCents(paidAmt);
      }

      if (c.cycleKey === currentMonthKey) {
        totalPaidThisMonthCents += toCents(paidAmt);
      }
    } else if (c.status === InvestmentContributionStatus.DUE) {
      unpaidMonthsCount++;
      remainingScheduledCents += toCents(c.expectedAmount);

      if (c.cycleKey <= currentMonthKey) {
        outstandingCents += toCents(c.expectedAmount);
      }

      if (!nextDueCycle) {
        nextDueCycle = c.cycleKey;
        nextDueDate = c.scheduledDate;
      }
    }
  }

  // Also account for initial lump-sum amount for one-time investments if no contributions exist
  if (contributions.length === 0 && inv && inv.initialAmount > 0) {
    actualCents += toCents(inv.initialAmount);
  }

  const totalHistoricalContributed = fromCents(historicalCents);
  const totalActualContributed = fromCents(actualCents);
  const totalContributionsInvested = fromCents(historicalCents + actualCents);
  const payoutReceived = inv?.isWon ? (inv.payoutAmount || 0) : 0;
  const isHistoricalPayout = Boolean(inv?.isHistoricalPayout);
  const netChitCashFlow = payoutReceived - totalContributionsInvested;

  return {
    totalHistoricalContributed,
    totalActualContributed,
    totalContributionsInvested,
    totalInvested: totalContributionsInvested,
    totalPaidThisMonth: fromCents(totalPaidThisMonthCents),
    totalScheduledMonths: contributions.length,
    paidMonthsCount,
    unpaidMonthsCount,
    remainingScheduledAmount: fromCents(remainingScheduledCents),
    remainingContributionCommitment: fromCents(remainingScheduledCents),
    outstandingContributions: fromCents(outstandingCents),
    netChitCashFlow,
    payoutReceived,
    isHistoricalPayout,
    nextDueCycle,
    nextDueDate,
  };
}

/**
 * Records an actual in-app payment for an investment contribution cycle.
 * Debits funding source and creates linked financial transaction atomically.
 */
export async function recordInvestmentPayment(params: {
  userId: string | mongoose.Types.ObjectId;
  investmentId: string | mongoose.Types.ObjectId;
  cycleKey: string;
  amount: number;
  paymentDate?: Date | string;
  paymentMethod: PaymentMethod;
  paymentChannel?: PaymentChannel;
  cashSource?: 'tracked_personal_cash' | 'untracked_cash';
  accountId?: string | mongoose.Types.ObjectId;
  creditCardId?: string | mongoose.Types.ObjectId;
  notes?: string;
}): Promise<{
  contribution: IInvestmentContribution;
  transaction: any;
}> {
  const {
    userId,
    investmentId,
    cycleKey,
    amount,
    paymentDate,
    paymentMethod,
    paymentChannel = PaymentChannel.ONLINE,
    cashSource = 'tracked_personal_cash',
    accountId,
    creditCardId,
    notes,
  } = params;

  if (amount <= 0) {
    throw new AppError('Payment amount must be greater than 0', 400, 'INVALID_AMOUNT');
  }

  const investment = await Investment.findOne({ _id: investmentId, userId });
  if (!investment) {
    throw new AppError('Investment not found', 404, 'NOT_FOUND');
  }

  if (investment.status === InvestmentStatus.CANCELLED) {
    throw new AppError('Cannot record payment for a cancelled investment', 400, 'INVESTMENT_CANCELLED');
  }

  // Find or create the contribution occurrence
  let contribution = await InvestmentContribution.findOne({ investmentId, cycleKey, userId });
  if (!contribution) {
    const [yearStr, monthStr] = cycleKey.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const scheduledDate = new Date(Date.UTC(year, month - 1, 10, 6, 0, 0));

    contribution = await InvestmentContribution.create({
      userId,
      investmentId,
      cycleKey,
      scheduledDate,
      expectedAmount: investment.monthlyContribution || amount,
      status: InvestmentContributionStatus.DUE,
      isHistorical: false,
    });
  }

  // Duplicate payment prevention
  if (
    contribution.status === InvestmentContributionStatus.PAID ||
    contribution.status === InvestmentContributionStatus.PAID_HISTORICAL
  ) {
    throw new AppError(
      `Investment contribution for cycle ${cycleKey} is already recorded as paid`,
      400,
      'DUPLICATE_PAYMENT'
    );
  }

  // Validate funding source
  let validatedAccountId: mongoose.Types.ObjectId | undefined;
  let validatedCreditCardId: mongoose.Types.ObjectId | undefined;

  if (paymentMethod === PaymentMethod.CREDIT_CARD) {
    validatedCreditCardId = creditCardId ? new mongoose.Types.ObjectId(creditCardId) : undefined;
    if (!validatedCreditCardId) {
      throw new AppError('Credit card is required for credit card payment method', 400, 'MISSING_CREDIT_CARD');
    }
    const card = await CreditCard.findOne({ _id: validatedCreditCardId, userId });
    if (!card) {
      throw new AppError('Credit card not found', 404, 'CARD_NOT_FOUND');
    }
  } else if (paymentMethod === PaymentMethod.CASH) {
    // CASH IN HAND PAYMENT:
    // Must NEVER debit any bank account (PNB or any other bank)!
    validatedAccountId = undefined;
    validatedCreditCardId = undefined;

    if (cashSource === 'tracked_personal_cash') {
      const currentCash = await calculatePersonalCashInHand(userId);
      if (currentCash < amount) {
        throw new AppError(
          `Insufficient Personal Cash in Hand (Available: ₹${currentCash.toLocaleString()}, Required: ₹${amount.toLocaleString()})`,
          400,
          'INSUFFICIENT_CASH'
        );
      }
    }
  } else {
    // Bank-funded payment
    validatedAccountId = accountId ? new mongoose.Types.ObjectId(accountId) : investment.accountId;
    if (!validatedAccountId) {
      throw new AppError('Bank account is required for this payment method', 400, 'MISSING_ACCOUNT');
    }
    const acc = await BankAccount.findOne({ _id: validatedAccountId, userId });
    if (!acc) {
      throw new AppError('Bank account not found', 404, 'ACCOUNT_NOT_FOUND');
    }
  }

  const effectiveDate = paymentDate ? new Date(paymentDate) : new Date();

  const isUntracked = paymentMethod === PaymentMethod.CASH && cashSource === 'untracked_cash';
  const effectiveTags = ['investment', investment.category?.toLowerCase() || 'chit'];
  if (paymentMethod === PaymentMethod.CASH) {
    effectiveTags.push('cash_in_hand');
    effectiveTags.push(isUntracked ? 'untracked_cash' : 'tracked_personal_cash');
  }

  // Create financial transaction with investment linkage
  const transaction = await Transaction.create({
    userId,
    type: TransactionType.INVESTMENT,
    title: `Investment: ${investment.name} (${cycleKey})`,
    amount,
    currency: 'INR',
    date: effectiveDate,
    category: investment.category || 'CHIT',
    paymentMethod,
    paymentChannel: paymentMethod === PaymentMethod.CASH ? PaymentChannel.OFFLINE : paymentChannel,
    accountId: validatedAccountId,
    creditCardId: validatedCreditCardId,
    isUntrackedCash: isUntracked,
    cashSource: paymentMethod === PaymentMethod.CASH ? cashSource : undefined,
    status: TransactionStatus.COMPLETED,
    investmentId,
    investmentContributionId: contribution._id,
    occurrenceKey: cycleKey,
    notes: notes || `Monthly investment payment for ${cycleKey}${isUntracked ? ' (Untracked Cash)' : ''}`,
    tags: effectiveTags,
  });

  // Mark contribution as paid
  contribution.status = InvestmentContributionStatus.PAID;
  contribution.actualAmount = amount;
  contribution.paidAt = effectiveDate;
  contribution.paymentMethod = paymentMethod;
  contribution.paymentChannel = paymentMethod === PaymentMethod.CASH ? PaymentChannel.OFFLINE : paymentChannel;
  contribution.cashSource = paymentMethod === PaymentMethod.CASH ? cashSource : undefined;
  contribution.accountId = validatedAccountId;
  contribution.creditCardId = validatedCreditCardId;
  contribution.transactionId = transaction._id;
  contribution.isHistorical = false;
  if (notes) contribution.notes = notes;
  await contribution.save();

  // Recalculate funding source balance
  if (validatedAccountId) {
    await recalculateAccountBalance(validatedAccountId, userId);
  }
  if (paymentMethod === PaymentMethod.CASH && cashSource === 'tracked_personal_cash') {
    await calculatePersonalCashInHand(userId);
  }
  if (validatedCreditCardId) {
    await recalculateCreditCardOutstanding(validatedCreditCardId, userId);
  }

  return { contribution, transaction };
}

/**
 * Reverses a recorded in-app investment payment and restores the cycle to unpaid.
 */
export async function deleteInvestmentPayment(params: {
  userId: string | mongoose.Types.ObjectId;
  investmentId: string | mongoose.Types.ObjectId;
  cycleKey: string;
}): Promise<void> {
  const { userId, investmentId, cycleKey } = params;

  const contribution = await InvestmentContribution.findOne({ investmentId, cycleKey, userId });
  if (!contribution) {
    throw new AppError('Investment contribution record not found', 404, 'CONTRIBUTION_NOT_FOUND');
  }

  if (contribution.isHistorical) {
    throw new AppError(
      'Historical imported contributions did not create financial balance debits and cannot be deleted via payment reversal. Update the investment schedule if needed.',
      400,
      'CANNOT_DELETE_HISTORICAL'
    );
  }

  if (contribution.status !== InvestmentContributionStatus.PAID) {
    throw new AppError('Contribution is not currently marked as paid', 400, 'NOT_PAID');
  }

  const txId = contribution.transactionId;
  const accountId = contribution.accountId;
  const creditCardId = contribution.creditCardId;
  const paymentMethod = contribution.paymentMethod;

  // Delete linked transaction if present
  if (txId) {
    await Transaction.deleteOne({ _id: txId, userId });
  }

  // Restore contribution to DUE status
  contribution.status = InvestmentContributionStatus.DUE;
  contribution.actualAmount = undefined;
  contribution.paidAt = undefined;
  contribution.transactionId = undefined;
  contribution.paymentMethod = undefined;
  contribution.paymentChannel = undefined;
  contribution.accountId = undefined;
  contribution.creditCardId = undefined;
  await contribution.save();

  // Reverse balance impact by recalculating source
  if (accountId) {
    await recalculateAccountBalance(accountId, userId);
  }
  if (paymentMethod === PaymentMethod.CASH) {
    await calculatePersonalCashInHand(userId);
  }
  if (creditCardId) {
    await recalculateCreditCardOutstanding(creditCardId, userId);
  }
}

/**
 * Synchronizes investment contribution or payout state when a linked transaction is deleted from the Transactions Module.
 * Idempotent, safe, and handles both contribution payments and payout settlements without duplicate bank balance reversals.
 */
export async function revertInvestmentStateForDeletedTransaction(
  transactionId: mongoose.Types.ObjectId | string,
  userId: mongoose.Types.ObjectId | string
): Promise<void> {
  const txObjectId = new mongoose.Types.ObjectId(transactionId);
  const userObjectId = new mongoose.Types.ObjectId(userId);

  // 1. Check if an InvestmentContribution is linked to this transaction
  const contribution = await InvestmentContribution.findOne({
    transactionId: txObjectId,
    userId: userObjectId,
  });

  if (contribution) {
    contribution.status = InvestmentContributionStatus.DUE;
    contribution.actualAmount = undefined;
    contribution.paidAt = undefined;
    contribution.transactionId = undefined;
    contribution.paymentMethod = undefined;
    contribution.paymentChannel = undefined;
    contribution.accountId = undefined;
    contribution.creditCardId = undefined;
    await contribution.save();
  }

  // 2. Check if an Investment had this transaction as its payoutTransactionId
  const investment = await Investment.findOne({
    payoutTransactionId: txObjectId,
    userId: userObjectId,
  });

  if (investment) {
    investment.isWon = false;
    investment.status = InvestmentStatus.ACTIVE;
    investment.payoutAmount = undefined;
    investment.winningDate = undefined;
    investment.payoutDestinationType = undefined;
    investment.payoutAccountId = undefined;
    investment.payoutTransactionId = undefined;
    investment.payoutNotes = undefined;
    investment.isHistoricalPayout = false;
    await investment.save();
  }
}

/**
 * Marks an external chit as won, records the prize payout settlement,
 * credits the receiving bank or cash account once (unless isHistoricalPayout is true),
 * and preserves future monthly contribution obligations until chit completion.
 */
export async function markExternalChitAsWon(params: {
  userId: string | mongoose.Types.ObjectId;
  investmentId: string | mongoose.Types.ObjectId;
  winningDate: Date | string;
  payoutAmount: number;
  payoutDestinationType: 'bank' | 'cash';
  payoutAccountId?: string | mongoose.Types.ObjectId;
  payoutNotes?: string;
  isHistoricalPayout?: boolean;
}): Promise<{
  investment: IInvestment;
  payoutTransaction?: any;
}> {
  const {
    userId,
    investmentId,
    winningDate,
    payoutAmount,
    payoutDestinationType,
    payoutAccountId,
    payoutNotes,
    isHistoricalPayout = false,
  } = params;

  if (payoutAmount <= 0) {
    throw new AppError('Payout amount must be greater than 0', 400, 'INVALID_PAYOUT_AMOUNT');
  }

  const investment = await Investment.findOne({ _id: investmentId, userId });
  if (!investment) {
    throw new AppError('Investment not found', 404, 'NOT_FOUND');
  }

  if (investment.category !== 'CHIT' && !investment.isExternalChit) {
    throw new AppError('Winning actions apply only to external chit investments', 400, 'NOT_A_CHIT');
  }

  if (investment.isWon && (investment.payoutTransactionId || investment.isHistoricalPayout)) {
    throw new AppError(
      'This chit has already been marked as won. Use the payout correction workflow to make changes.',
      400,
      'ALREADY_WON'
    );
  }

  let validatedAccountId: mongoose.Types.ObjectId | undefined;
  if (payoutDestinationType === 'bank' && payoutAccountId) {
    validatedAccountId = new mongoose.Types.ObjectId(payoutAccountId);
    const acc = await BankAccount.findOne({ _id: validatedAccountId, userId });
    if (!acc && !isHistoricalPayout) {
      throw new AppError('Receiving bank account not found', 404, 'ACCOUNT_NOT_FOUND');
    }
  } else if (payoutDestinationType === 'bank' && !payoutAccountId && !isHistoricalPayout) {
    throw new AppError('Receiving bank account is required for bank payout', 400, 'MISSING_ACCOUNT');
  }

  const effectiveWinningDate = new Date(winningDate);
  let payoutTransaction: any = undefined;

  // Only create an inflow Transaction and adjust balances if this is NOT a historical payout
  if (!isHistoricalPayout) {
    payoutTransaction = await Transaction.create({
      userId,
      type: TransactionType.INCOME,
      title: `Chit Payout: ${investment.name}`,
      amount: payoutAmount,
      currency: 'INR',
      date: effectiveWinningDate,
      category: 'CHIT',
      paymentMethod: payoutDestinationType === 'cash' ? PaymentMethod.CASH : PaymentMethod.BANK_TRANSFER,
      paymentChannel: PaymentChannel.ONLINE,
      accountId: validatedAccountId,
      status: TransactionStatus.COMPLETED,
      investmentId,
      notes: payoutNotes || `External chit prize payout received for ${investment.name}`,
      tags: ['investment', 'chit', 'payout', 'settlement'],
    });

    // Credit the receiving account balance
    if (validatedAccountId) {
      await recalculateAccountBalance(validatedAccountId, userId);
    }
    if (payoutDestinationType === 'cash') {
      await calculatePersonalCashInHand(userId);
    }
  }

  // Update investment winning metadata
  investment.isWon = true;
  investment.status = InvestmentStatus.WON;
  investment.winningDate = effectiveWinningDate;
  investment.payoutAmount = payoutAmount;
  investment.payoutDestinationType = payoutDestinationType;
  investment.payoutAccountId = validatedAccountId;
  investment.payoutTransactionId = payoutTransaction ? payoutTransaction._id : undefined;
  investment.isHistoricalPayout = Boolean(isHistoricalPayout);
  investment.payoutNotes = payoutNotes;
  await investment.save();

  // In external chits, the winner continues paying monthly contributions until the end of the chit duration.
  // We do NOT delete future DUE contributions upon winning!

  return { investment, payoutTransaction };
}

/**
 * Safely corrects an existing chit payout (e.g. amount or destination change)
 * without corrupting account balances or leaving orphaned transactions.
 */
export async function correctExternalChitPayout(params: {
  userId: string | mongoose.Types.ObjectId;
  investmentId: string | mongoose.Types.ObjectId;
  winningDate?: Date | string;
  payoutAmount: number;
  payoutDestinationType: 'bank' | 'cash';
  payoutAccountId?: string | mongoose.Types.ObjectId;
  payoutNotes?: string;
  isHistoricalPayout?: boolean;
}): Promise<IInvestment> {
  const {
    userId,
    investmentId,
    winningDate,
    payoutAmount,
    payoutDestinationType,
    payoutAccountId,
    payoutNotes,
    isHistoricalPayout = false,
  } = params;

  const investment = await Investment.findOne({ _id: investmentId, userId });
  if (!investment || !investment.isWon) {
    throw new AppError('Chit is not marked as won', 400, 'CHIT_NOT_WON');
  }

  const oldTxId = investment.payoutTransactionId;
  const oldAccountId = investment.payoutAccountId;
  const oldDestType = investment.payoutDestinationType;

  // 1. Delete old payout transaction if one existed
  if (oldTxId) {
    await Transaction.deleteOne({ _id: oldTxId, userId });
  }

  // Recalculate old account balance to reverse credit if it was an active transaction
  if (oldAccountId && oldTxId) {
    await recalculateAccountBalance(oldAccountId, userId);
  }
  if (oldDestType === 'cash' && oldTxId) {
    await calculatePersonalCashInHand(userId);
  }

  // 2. If new setting is NOT historical payout, create updated payout transaction
  let validatedAccountId: mongoose.Types.ObjectId | undefined;
  if (payoutDestinationType === 'bank' && payoutAccountId) {
    validatedAccountId = new mongoose.Types.ObjectId(payoutAccountId);
  }

  const effectiveDate = winningDate ? new Date(winningDate) : (investment.winningDate || new Date());
  let newTx: any = undefined;

  if (!isHistoricalPayout) {
    newTx = await Transaction.create({
      userId,
      type: TransactionType.INCOME,
      title: `Chit Payout: ${investment.name}`,
      amount: payoutAmount,
      currency: 'INR',
      date: effectiveDate,
      category: 'CHIT',
      paymentMethod: payoutDestinationType === 'cash' ? PaymentMethod.CASH : PaymentMethod.BANK_TRANSFER,
      paymentChannel: PaymentChannel.ONLINE,
      accountId: validatedAccountId,
      status: TransactionStatus.COMPLETED,
      investmentId,
      notes: payoutNotes || investment.payoutNotes || `Corrected chit payout for ${investment.name}`,
      tags: ['investment', 'chit', 'payout', 'settlement'],
    });

    // Credit new account
    if (validatedAccountId) {
      await recalculateAccountBalance(validatedAccountId, userId);
    }
    if (payoutDestinationType === 'cash') {
      await calculatePersonalCashInHand(userId);
    }
  }

  investment.payoutAmount = payoutAmount;
  investment.winningDate = effectiveDate;
  investment.payoutDestinationType = payoutDestinationType;
  investment.payoutAccountId = validatedAccountId;
  investment.payoutTransactionId = newTx ? newTx._id : undefined;
  investment.isHistoricalPayout = Boolean(isHistoricalPayout);
  if (payoutNotes !== undefined) investment.payoutNotes = payoutNotes;
  await investment.save();

  return investment;
}

/**
 * Returns upcoming monthly investment obligations for the Dashboard's Upcoming Monthly Payments section.
 */
export async function getUpcomingInvestmentObligations(
  userId: string | mongoose.Types.ObjectId,
  targetMonth: string
): Promise<{
  items: UpcomingPaymentItem[];
  investmentRemaining: number;
  investmentPaid: number;
}> {
  const activeInvestments = await Investment.find({
    userId,
    isMonthlyPaymentEnabled: true,
    status: { $in: [InvestmentStatus.ACTIVE, InvestmentStatus.WON] },
  });

  const items: UpcomingPaymentItem[] = [];
  let investmentRemaining = 0;
  let investmentPaid = 0;

  for (const inv of activeInvestments) {
    // Note: Won chits continue monthly contributions until their end date or total duration!

    // Check if targetMonth falls within [startDate, endDate]
    const startKey = getCycleKey(inv.startDate, 'Asia/Kolkata');
    const endKey = inv.endDate ? getCycleKey(inv.endDate, 'Asia/Kolkata') : undefined;

    if (targetMonth < startKey) {
      continue;
    }
    if (endKey && targetMonth > endKey) {
      continue;
    }

    // Look up contribution occurrence for targetMonth
    let occ = await InvestmentContribution.findOne({
      investmentId: inv._id,
      cycleKey: targetMonth,
      userId,
    });

    // If not exists and investment is active or won, auto-generate DUE occurrence
    if (!occ && (inv.status === InvestmentStatus.ACTIVE || inv.status === InvestmentStatus.WON)) {
      const [yearStr, monthStr] = targetMonth.split('-');
      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10);
      const scheduledDate = new Date(Date.UTC(year, month - 1, 10, 6, 0, 0));

      occ = await InvestmentContribution.create({
        userId,
        investmentId: inv._id,
        cycleKey: targetMonth,
        scheduledDate,
        expectedAmount: inv.monthlyContribution,
        status: InvestmentContributionStatus.DUE,
        isHistorical: false,
      });
    }

    if (!occ) continue;

    const isPaid =
      occ.status === InvestmentContributionStatus.PAID ||
      occ.status === InvestmentContributionStatus.PAID_HISTORICAL;
    const isSkipped = occ.status === InvestmentContributionStatus.SKIPPED;

    const expected = occ.expectedAmount || inv.monthlyContribution;
    const actual = isPaid ? (occ.actualAmount ?? expected) : undefined;

    if (isPaid) {
      investmentPaid = safeAdd(investmentPaid, actual ?? expected);
    } else if (!isSkipped) {
      investmentRemaining = safeAdd(investmentRemaining, expected);
    }

    items.push({
      id: occ._id.toString(),
      title: inv.name,
      type: 'investment',
      category: inv.category,
      dueDate: occ.scheduledDate.toISOString(),
      expectedAmount: expected,
      actualAmount: actual,
      status: isPaid ? 'paid' : isSkipped ? 'skipped' : 'unpaid',
      ruleId: inv._id.toString(),
      occurrenceKey: targetMonth,
      occurrenceId: occ._id.toString(),
      paymentMethod: occ.paymentMethod || inv.paymentMethod,
      accountId: occ.accountId ? occ.accountId.toString() : inv.accountId ? inv.accountId.toString() : undefined,
      creditCardId: occ.creditCardId ? occ.creditCardId.toString() : inv.creditCardId ? inv.creditCardId.toString() : undefined,
      isExternalChit: inv.isExternalChit,
      isWon: inv.isWon,
    });
  }

  return { items, investmentRemaining, investmentPaid };
}

/**
 * Resets a single investment cleanly, deleting contributions and linked transactions
 * with safe balance recalculation without affecting unrelated investments or accounts.
 */
export async function resetSingleInvestment(
  investmentId: string | mongoose.Types.ObjectId,
  userId: string | mongoose.Types.ObjectId
): Promise<void> {
  const investment = await Investment.findOne({ _id: investmentId, userId });
  if (!investment) {
    throw new AppError('Investment not found', 404, 'NOT_FOUND');
  }

  // Find all affected bank accounts and credit cards to recalculate after deletion
  const linkedTransactions = await Transaction.find({ investmentId, userId });
  const affectedAccountIds = new Set<string>();
  const affectedCardIds = new Set<string>();
  let affectedCash = false;

  for (const tx of linkedTransactions) {
    if (tx.accountId) affectedAccountIds.add(tx.accountId.toString());
    if (tx.creditCardId) affectedCardIds.add(tx.creditCardId.toString());
    if (tx.paymentMethod === PaymentMethod.CASH) affectedCash = true;
  }

  // Delete all linked transactions
  await Transaction.deleteMany({ investmentId, userId });

  // Delete all contributions
  await InvestmentContribution.deleteMany({ investmentId, userId });

  // Delete investment document
  await Investment.deleteOne({ _id: investmentId, userId });

  // Recalculate affected balances
  for (const accId of affectedAccountIds) {
    await recalculateAccountBalance(accId, userId);
  }
  for (const cardId of affectedCardIds) {
    await recalculateCreditCardOutstanding(cardId, userId);
  }
  if (affectedCash) {
    await calculatePersonalCashInHand(userId);
  }
}

/**
 * Resets all investment data for a user without touching family Chit Fund Module,
 * bank accounts, credit cards, or non-investment transactions.
 */
export async function resetAllInvestmentsForUser(
  userId: string | mongoose.Types.ObjectId
): Promise<{ deletedInvestments: number; deletedContributions: number; deletedTransactions: number }> {
  // Find all investments of this user
  const investments = await Investment.find({ userId });
  const investmentIds = investments.map((i) => i._id);

  // Find all linked transactions
  const linkedTransactions = await Transaction.find({
    userId,
    $or: [{ investmentId: { $in: investmentIds } }, { type: TransactionType.INVESTMENT }],
  });

  const affectedAccountIds = new Set<string>();
  const affectedCardIds = new Set<string>();
  let affectedCash = false;

  for (const tx of linkedTransactions) {
    if (tx.accountId) affectedAccountIds.add(tx.accountId.toString());
    if (tx.creditCardId) affectedCardIds.add(tx.creditCardId.toString());
    if (tx.paymentMethod === PaymentMethod.CASH) affectedCash = true;
  }

  // Delete transactions
  const txDeleteResult = await Transaction.deleteMany({
    userId,
    $or: [{ investmentId: { $in: investmentIds } }, { type: TransactionType.INVESTMENT }],
  });

  // Delete contributions
  const contribDeleteResult = await InvestmentContribution.deleteMany({ userId });

  // Delete investments
  const invDeleteResult = await Investment.deleteMany({ userId });

  // Recalculate affected balances
  for (const accId of affectedAccountIds) {
    await recalculateAccountBalance(accId, userId);
  }
  for (const cardId of affectedCardIds) {
    await recalculateCreditCardOutstanding(cardId, userId);
  }
  if (affectedCash) {
    await calculatePersonalCashInHand(userId);
  }

  return {
    deletedInvestments: invDeleteResult.deletedCount || 0,
    deletedContributions: contribDeleteResult.deletedCount || 0,
    deletedTransactions: txDeleteResult.deletedCount || 0,
  };
}
