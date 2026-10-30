import mongoose, { Types } from 'mongoose';
import { CreditCard, ICreditCard } from '../models/CreditCard';
import { CreditCardStatement, ICreditCardStatement } from '../models/CreditCardStatement';
import { Transaction } from '../models/Transaction';
import {
  TransactionType,
  TransactionStatus,
  StatementStatus,
  CreditCardRepaymentMode,
  CreditCardCycleInfo,
  CreditCardDetailResponse,
  safeAdd,
  safeSubtract,
  toCents,
  fromCents,
} from '@finora/shared';
import { recalculateCreditCardOutstanding } from './financial';

/**
 * Returns number of days in the specified month (1-based or 0-based).
 */
export function getDaysInMonth(year: number, monthZeroBased: number): number {
  return new Date(Date.UTC(year, monthZeroBased + 1, 0)).getUTCDate();
}

/**
 * Clamps day of month so it never exceeds the actual days in that month.
 * Handles February (28/29 days in leap years), 30-day months, etc.
 */
export function clampDay(year: number, monthZeroBased: number, desiredDay: number): number {
  const maxDays = getDaysInMonth(year, monthZeroBased);
  return Math.max(1, Math.min(desiredDay, maxDays));
}

/**
 * Creates a safe local date using clamped day.
 */
export function buildSafeDate(
  year: number,
  monthZeroBased: number,
  desiredDay: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0
): Date {
  const safeDay = clampDay(year, monthZeroBased, desiredDay);
  return new Date(year, monthZeroBased, safeDay, hour, minute, second, ms);
}

/**
 * Calculates statement payment due date as exactly 15 calendar days after the statement closing date.
 * Automatically handles 28-, 29-, 30-, 31-day months, leap years, and year-end boundaries.
 */
export function calculateDueDateFromClosingDate(closingDate: Date): Date {
  const dueDate = new Date(closingDate.getTime());
  dueDate.setDate(dueDate.getDate() + 15);
  return dueDate;
}

export interface CardCycleDates {
  ongoingPeriodStart: Date;
  ongoingPeriodEnd: Date;
  nextClosingDate: Date;
  nextDueDate: Date;
  lastClosingDate: Date;
  lastPeriodStart: Date;
  lastPeriodEnd: Date;
  lastDueDate: Date;
}

/**
 * Calculates current ongoing cycle dates and latest closed cycle dates
 * for a credit card given its billingCycleClosingDay.
 * Due dates are automatically 15 calendar days after statement closing dates.
 */
export function calculateCardCycleDates(
  closingDay: number,
  dueDay?: number,
  referenceDate: Date = new Date()
): CardCycleDates {
  const refYear = referenceDate.getFullYear();
  const refMonth = referenceDate.getMonth();
  const refDay = referenceDate.getDate();

  let lastClosingYear = refYear;
  let lastClosingMonth = refMonth;

  if (refDay <= closingDay) {
    // If today is on or before closingDay, the last statement closed in the PREVIOUS month
    lastClosingMonth = refMonth - 1;
    if (lastClosingMonth < 0) {
      lastClosingMonth = 11;
      lastClosingYear = refYear - 1;
    }
  } else {
    // Today is after closingDay, so the last statement closed in the CURRENT month
    lastClosingMonth = refMonth;
    lastClosingYear = refYear;
  }

  // Last statement closing date (23:59:59.999)
  const lastClosingDate = buildSafeDate(lastClosingYear, lastClosingMonth, closingDay, 23, 59, 59, 999);

  // Last statement period start (1 day after the statement prior to last statement, at 00:00:00.000)
  let priorClosingMonth = lastClosingMonth - 1;
  let priorClosingYear = lastClosingYear;
  if (priorClosingMonth < 0) {
    priorClosingMonth = 11;
    priorClosingYear = lastClosingYear - 1;
  }
  const priorClosingDate = buildSafeDate(priorClosingYear, priorClosingMonth, closingDay, 23, 59, 59, 999);
  const lastPeriodStart = new Date(priorClosingDate.getTime() + 1); // 00:00:00.000 of next day
  const lastPeriodEnd = lastClosingDate;

  // Due date for the last statement: exactly 15 calendar days after lastClosingDate
  const lastDueDate = calculateDueDateFromClosingDate(lastClosingDate);

  // Ongoing cycle:
  // Starts 1 millisecond after lastClosingDate
  const ongoingPeriodStart = new Date(lastClosingDate.getTime() + 1);

  // Next closing date: 1 month after lastClosingDate
  let nextClosingMonth = lastClosingMonth + 1;
  let nextClosingYear = lastClosingYear;
  if (nextClosingMonth > 11) {
    nextClosingMonth = 0;
    nextClosingYear = lastClosingYear + 1;
  }
  const nextClosingDate = buildSafeDate(nextClosingYear, nextClosingMonth, closingDay, 23, 59, 59, 999);
  const ongoingPeriodEnd = nextClosingDate;

  // Next due date: exactly 15 calendar days after nextClosingDate
  const nextDueDate = calculateDueDateFromClosingDate(nextClosingDate);

  return {
    ongoingPeriodStart,
    ongoingPeriodEnd,
    nextClosingDate,
    nextDueDate,
    lastClosingDate,
    lastPeriodStart,
    lastPeriodEnd,
    lastDueDate,
  };
}

/**
 * Computes consecutive non-overlapping cycle boundaries.
 * Payment due dates are automatically calculated as 15 calendar days after cycle closing date.
 */
export function getHistoricalCycleBoundaries(
  closingDay: number,
  dueDay?: number,
  count = 6,
  referenceDate: Date = new Date()
) {
  const base = calculateCardCycleDates(closingDay, dueDay, referenceDate);
  const cycles: Array<{
    periodStart: Date;
    periodEnd: Date;
    closingDate: Date;
    dueDate: Date;
    isOngoing: boolean;
  }> = [];

  // 1. Ongoing cycle
  cycles.push({
    periodStart: base.ongoingPeriodStart,
    periodEnd: base.ongoingPeriodEnd,
    closingDate: base.nextClosingDate,
    dueDate: base.nextDueDate,
    isOngoing: true,
  });

  // 2. Closed cycles going backwards
  let currentClosing = base.lastClosingDate;
  for (let i = 0; i < count; i++) {
    const cYear = currentClosing.getFullYear();
    const cMonth = currentClosing.getMonth();

    // Prior closing
    let priorMonth = cMonth - 1;
    let priorYear = cYear;
    if (priorMonth < 0) {
      priorMonth = 11;
      priorYear = cYear - 1;
    }
    const priorClosing = buildSafeDate(priorYear, priorMonth, closingDay, 23, 59, 59, 999);
    const pStart = new Date(priorClosing.getTime() + 1);
    const pEnd = currentClosing;

    // Due date: 15 calendar days after closing date
    const dDate = calculateDueDateFromClosingDate(currentClosing);

    cycles.push({
      periodStart: pStart,
      periodEnd: pEnd,
      closingDate: currentClosing,
      dueDate: dDate,
      isOngoing: false,
    });

    currentClosing = priorClosing;
  }

  return cycles;
}

export interface CardOutstandingBreakdown {
  totalOutstanding: number;
  previousCycleOutstanding: number;
  ongoingCycleOutstanding: number;
  availableCredit: number;
  creditLimit: number;
  utilization: number;
  dates: CardCycleDates;
  latestStatement?: {
    id?: string;
    statementBalance: number;
    amountPaid: number;
    remainingBalance: number;
    dueDate: string;
    closingDate: string;
    status: StatementStatus;
  };
}

/**
 * Computes authoritative previous-cycle and ongoing-cycle outstanding amounts
 * strictly reconciled with ledger currentOutstanding.
 *
 * Invariant: Total Outstanding = Previous-Cycle Outstanding + Ongoing-Cycle Outstanding
 */
export async function computeCardOutstandingBreakdown(
  card: ICreditCard,
  userId: string | Types.ObjectId
): Promise<CardOutstandingBreakdown> {
  const dates = calculateCardCycleDates(
    card.billingCycleClosingDay,
    card.paymentDueDay,
    new Date()
  );

  // Fetch all transactions for this card
  const transactions = await Transaction.find({
    userId,
    creditCardId: card._id,
    status: TransactionStatus.COMPLETED,
  }).sort({ date: 1 });

  // 1. Separate transactions into ongoing vs previous cycles
  let ongoingDebitsCents = 0;
  let ongoingCreditsCents = 0;
  let previousDebitsCents = 0;
  let previousCreditsCents = 0;
  let totalPaymentsSettledCents = 0;

  // Opening outstanding handling strictly based on openingOutstandingDate:
  if (card.openingOutstanding && card.openingOutstanding > 0) {
    const openDate = card.openingOutstandingDate ? new Date(card.openingOutstandingDate) : new Date();
    if (openDate > dates.lastClosingDate) {
      // Opening balance was recorded within the current ongoing billing cycle
      ongoingDebitsCents += toCents(card.openingOutstanding);
    } else {
      // Opening balance was recorded in a prior closed billing cycle
      previousDebitsCents += toCents(card.openingOutstanding);
    }
  }

  for (const tx of transactions) {
    if ((tx as any).isPastRecorded) {
      continue;
    }

    const txCents = toCents(tx.amount);
    const txDate = new Date(tx.date);
    const isOngoing = txDate > dates.lastClosingDate;

    if (tx.type === TransactionType.EXPENSE || tx.type === TransactionType.INVESTMENT) {
      if (isOngoing) {
        ongoingDebitsCents += txCents;
      } else {
        previousDebitsCents += txCents;
      }
    } else if (tx.type === TransactionType.CREDIT_CARD_REFUND) {
      if (isOngoing) {
        ongoingCreditsCents += txCents;
      } else {
        previousCreditsCents += txCents;
      }
    } else if (tx.type === TransactionType.CREDIT_CARD_PAYMENT) {
      const settledAmount =
        tx.liabilitySettled !== undefined && tx.liabilitySettled !== null
          ? tx.liabilitySettled
          : tx.amount;
      totalPaymentsSettledCents += toCents(settledAmount);
    }
  }

  // Net un-repaid debts before payments:
  const grossPreviousDebtCents = Math.max(0, previousDebitsCents - previousCreditsCents);
  const grossOngoingDebtCents = Math.max(0, ongoingDebitsCents - ongoingCreditsCents);

  // Oldest debt first allocation:
  // Payments first settle previous-cycle debt, then any surplus settles ongoing-cycle debt
  let remainingPaymentsCents = totalPaymentsSettledCents;

  const paymentsToPreviousCents = Math.min(grossPreviousDebtCents, remainingPaymentsCents);
  remainingPaymentsCents -= paymentsToPreviousCents;

  const paymentsToOngoingCents = Math.min(grossOngoingDebtCents, remainingPaymentsCents);

  const prevOutstandingCents = Math.max(0, grossPreviousDebtCents - paymentsToPreviousCents);
  const ongoingOutstandingCents = Math.max(0, grossOngoingDebtCents - paymentsToOngoingCents);

  const calculatedTotalCents = prevOutstandingCents + ongoingOutstandingCents;
  const totalOutstanding = fromCents(calculatedTotalCents);

  // Ensure card.currentOutstanding in database matches this exact ledger total
  if (toCents(card.currentOutstanding) !== calculatedTotalCents) {
    card.currentOutstanding = totalOutstanding;
    card.availableCredit = Math.max(0, safeSubtract(card.creditLimit, totalOutstanding));
    await card.save();
  }

  const previousCycleOutstanding = fromCents(prevOutstandingCents);
  // Reconciled ongoing:
  const ongoingCycleOutstanding = Math.max(0, safeSubtract(totalOutstanding, previousCycleOutstanding));

  const availableCredit = card.availableCredit;
  const creditLimit = card.creditLimit;
  const utilization = creditLimit > 0 ? Math.round((totalOutstanding / creditLimit) * 100) : 0;

  // Find latest statement document if already persisted
  const latestStatementDoc = await CreditCardStatement.findOne({
    userId,
    creditCardId: card._id,
  }).sort({ closingDate: -1 });

  let latestStatement: CardOutstandingBreakdown['latestStatement'] = undefined;
  if (latestStatementDoc) {
    const remainingBalance =
      latestStatementDoc.remainingBalance !== undefined
        ? latestStatementDoc.remainingBalance
        : Math.max(0, safeSubtract(latestStatementDoc.statementBalance, latestStatementDoc.paymentsReceived || 0));

    latestStatement = {
      id: latestStatementDoc._id.toString(),
      statementBalance: latestStatementDoc.statementBalance,
      amountPaid: latestStatementDoc.paymentsReceived || 0,
      remainingBalance,
      dueDate: latestStatementDoc.dueDate.toISOString(),
      closingDate: latestStatementDoc.closingDate.toISOString(),
      status: latestStatementDoc.status,
    };
  } else if (grossPreviousDebtCents > 0) {
    // Synthetic latest statement data if statements have not yet been generated
    const stmtBalance = fromCents(grossPreviousDebtCents);
    const stmtPaid = fromCents(paymentsToPreviousCents);
    const stmtRem = previousCycleOutstanding;
    const isPastDue = new Date() > dates.lastDueDate;
    const stmtStatus =
      stmtRem === 0
        ? StatementStatus.PAID
        : stmtPaid > 0
        ? StatementStatus.PARTIALLY_PAID
        : isPastDue
        ? StatementStatus.OVERDUE
        : StatementStatus.DUE;

    latestStatement = {
      statementBalance: stmtBalance,
      amountPaid: stmtPaid,
      remainingBalance: stmtRem,
      dueDate: dates.lastDueDate.toISOString(),
      closingDate: dates.lastClosingDate.toISOString(),
      status: stmtStatus,
    };
  }

  return {
    totalOutstanding,
    previousCycleOutstanding,
    ongoingCycleOutstanding,
    availableCredit,
    creditLimit,
    utilization,
    dates,
    latestStatement,
  };
}

/**
 * Automatically & idempotently synchronizes CreditCardStatement records
 * for all historical closed cycles of this card.
 */
export async function syncCardStatements(
  card: ICreditCard,
  userId: string | Types.ObjectId,
  cyclesCount = 6
): Promise<ICreditCardStatement[]> {
  const boundaries = getHistoricalCycleBoundaries(
    card.billingCycleClosingDay,
    card.paymentDueDay,
    cyclesCount,
    new Date()
  );

  const closedBoundaries = boundaries.filter((b) => !b.isOngoing);
  const statements: ICreditCardStatement[] = [];

  // Fetch all card transactions once
  const allTxs = await Transaction.find({
    userId,
    creditCardId: card._id,
    status: TransactionStatus.COMPLETED,
  }).sort({ date: 1 });

  // Phase 1: Synchronize base statement figures (purchases, refunds, opening balance)
  for (let i = closedBoundaries.length - 1; i >= 0; i--) {
    const cycle = closedBoundaries[i];

    // Non-payment transactions falling strictly into this statement cycle
    const cycleTxs = allTxs.filter((tx) => {
      const d = new Date(tx.date);
      return d >= cycle.periodStart && d <= cycle.periodEnd;
    });

    let newPurchases = 0;
    let refunds = 0;

    for (const tx of cycleTxs) {
      if ((tx as any).isPastRecorded) continue;
      if (tx.type === TransactionType.EXPENSE || tx.type === TransactionType.INVESTMENT) {
        newPurchases = safeAdd(newPurchases, tx.amount);
      } else if (tx.type === TransactionType.CREDIT_CARD_REFUND) {
        refunds = safeAdd(refunds, tx.amount);
      }
    }

    // Opening balance should only be assigned to the statement cycle in which openingOutstandingDate falls
    const isEarliest = i === closedBoundaries.length - 1;
    let openingBalance = 0;
    if (card.openingOutstanding && card.openingOutstanding > 0) {
      const openDate = card.openingOutstandingDate ? new Date(card.openingOutstandingDate) : new Date();
      // If openDate falls within this closed cycle [periodStart, periodEnd]
      if (openDate >= cycle.periodStart && openDate <= cycle.periodEnd) {
        openingBalance = card.openingOutstanding;
      } else if (isEarliest && openDate < cycle.periodStart) {
        // If opening date is older than all generated cycles, assign to earliest generated cycle
        openingBalance = card.openingOutstanding;
      }
    }
    const statementBalance = Math.max(0, safeSubtract(safeAdd(openingBalance, newPurchases), refunds));
    const minimumAmountDue = Math.min(statementBalance, Math.max(500, Math.round(statementBalance * 0.05)));

    // Upsert statement snapshot
    let statement = await CreditCardStatement.findOne({
      userId,
      creditCardId: card._id,
      closingDate: cycle.closingDate,
    });

    if (!statement) {
      statement = await CreditCardStatement.create({
        userId,
        creditCardId: card._id,
        periodStart: cycle.periodStart,
        periodEnd: cycle.periodEnd,
        closingDate: cycle.closingDate,
        dueDate: cycle.dueDate,
        openingBalance,
        newPurchases,
        feesAndCharges: 0,
        paymentsReceived: 0,
        refundsAndCredits: refunds,
        statementBalance,
        minimumAmountDue,
        amountPaid: 0,
        remainingBalance: statementBalance,
        status: statementBalance === 0 ? StatementStatus.PAID : StatementStatus.DUE,
      });
    } else {
      statement.newPurchases = newPurchases;
      statement.refundsAndCredits = refunds;
      statement.statementBalance = statementBalance;
      statement.minimumAmountDue = minimumAmountDue;
      statement.periodStart = cycle.periodStart;
      statement.periodEnd = cycle.periodEnd;
      // Preserve existing finalized dueDate if present
      if (!statement.dueDate) {
        statement.dueDate = cycle.dueDate;
      }
      // Note: payments, amounts paid, remaining balance, and status are reconciled authoritatively in Phase 2
    }

    statements.push(statement);
  }

  // Statements sorted chronologically (oldest to newest)
  statements.sort((a, b) => a.closingDate.getTime() - b.closingDate.getTime());

  // Phase 2: Authoritative Statement Payment Reconciliation
  // Collect all payment transactions on this card
  const paymentTxs = allTxs.filter((tx) => tx.type === TransactionType.CREDIT_CARD_PAYMENT);

  // Map to track allocated payments in cents for each statement
  const statementPaidCents = new Map<string, number>();
  for (const stmt of statements) {
    statementPaidCents.set(stmt._id.toString(), 0);
  }

  const matchedPaymentIds = new Set<string>();

  // Pass 2A: Direct match for payments with an explicit statementId
  for (const tx of paymentTxs) {
    if (tx.statementId) {
      const stmtIdStr = tx.statementId.toString();
      if (statementPaidCents.has(stmtIdStr)) {
        const settled = tx.liabilitySettled !== undefined && tx.liabilitySettled !== null ? tx.liabilitySettled : tx.amount;
        const currentPaid = statementPaidCents.get(stmtIdStr) || 0;
        statementPaidCents.set(stmtIdStr, currentPaid + toCents(settled));
        matchedPaymentIds.add(tx._id.toString());
      }
    }
  }

  // Pass 2B: FIFO allocation across unpaid statements for unlinked payments
  for (const tx of paymentTxs) {
    if (matchedPaymentIds.has(tx._id.toString())) {
      continue;
    }

    const settled = tx.liabilitySettled !== undefined && tx.liabilitySettled !== null ? tx.liabilitySettled : tx.amount;
    let remainingPaymentCents = toCents(settled);

    for (const stmt of statements) {
      if (remainingPaymentCents <= 0) break;

      const stmtBalanceCents = toCents(stmt.statementBalance);
      const currentPaidCents = statementPaidCents.get(stmt._id.toString()) || 0;
      const unpaidCents = Math.max(0, stmtBalanceCents - currentPaidCents);

      if (unpaidCents > 0) {
        const allocateCents = Math.min(unpaidCents, remainingPaymentCents);
        statementPaidCents.set(stmt._id.toString(), currentPaidCents + allocateCents);
        remainingPaymentCents -= allocateCents;

        // Auto-link unlinked payment to statement if not set
        if (!tx.statementId) {
          tx.statementId = stmt._id as any;
          await Transaction.updateOne({ _id: tx._id }, { statementId: stmt._id });
        }
      }
    }
  }

  // Phase 3: Update statements with exact payments, remaining balances, and statuses
  for (const stmt of statements) {
    const paidCents = statementPaidCents.get(stmt._id.toString()) || 0;
    const paid = fromCents(paidCents);
    const remaining = Math.max(0, safeSubtract(stmt.statementBalance, paid));
    const isPastDue = new Date() > stmt.dueDate;

    stmt.paymentsReceived = paid;
    stmt.amountPaid = paid;
    stmt.remainingBalance = remaining;
    stmt.status =
      stmt.statementBalance === 0 || remaining === 0
        ? StatementStatus.PAID
        : paid > 0
        ? StatementStatus.PARTIALLY_PAID
        : isPastDue
        ? StatementStatus.OVERDUE
        : StatementStatus.DUE;

    await stmt.save();
  }

  return statements.sort((a, b) => b.closingDate.getTime() - a.closingDate.getTime());
}

/**
 * Returns full details for a card: metrics, cycle-grouped transactions, statement snapshots, payments.
 */
export async function getCreditCardFullDetails(
  cardId: string | Types.ObjectId,
  userId: string | Types.ObjectId
): Promise<CreditCardDetailResponse> {
  const card = await CreditCard.findOne({ _id: cardId, userId, isArchived: false });
  if (!card) {
    throw new Error('Credit card not found or archived');
  }

  // 1. Synchronize statements and get breakdown
  await syncCardStatements(card, userId);
  const breakdown = await computeCardOutstandingBreakdown(card, userId);

  // 2. Fetch all transactions and statements
  const [transactions, statements] = await Promise.all([
    Transaction.find({
      userId,
      creditCardId: card._id,
      status: TransactionStatus.COMPLETED,
    }).sort({ date: -1 }),
    CreditCardStatement.find({
      userId,
      creditCardId: card._id,
    }).sort({ closingDate: -1 }),
  ]);

  // 3. Build billing-cycle grouping
  const boundaries = getHistoricalCycleBoundaries(
    card.billingCycleClosingDay,
    card.paymentDueDay,
    6,
    new Date()
  );

  const cycles: CreditCardCycleInfo[] = [];

  for (const b of boundaries) {
    const matchingStmt = statements.find(
      (s) => s.closingDate.toDateString() === b.closingDate.toDateString()
    );

    let cycleTxs: typeof transactions = [];

    if (b.isOngoing) {
      // Ongoing cycle: include transactions in [periodStart, periodEnd]
      // EXCEPT payments that belong to a closed statement
      cycleTxs = transactions.filter((t) => {
        const d = new Date(t.date);
        const inPeriod = d >= b.periodStart && d <= b.periodEnd;
        if (!inPeriod) return false;

        if (t.type === TransactionType.CREDIT_CARD_PAYMENT && t.statementId) {
          const isForClosedStmt = statements.some(
            (s) => s._id.toString() === t.statementId?.toString()
          );
          if (isForClosedStmt) {
            return false;
          }
        }
        return true;
      });
    } else {
      // Closed cycle: include non-payment transactions in [periodStart, periodEnd]
      // PLUS payments explicitly or FIFO-associated with this closed statement
      cycleTxs = transactions.filter((t) => {
        const d = new Date(t.date);

        if (t.type === TransactionType.CREDIT_CARD_PAYMENT) {
          if (matchingStmt && t.statementId && t.statementId.toString() === matchingStmt._id.toString()) {
            return true;
          }
          if (!t.statementId && d >= b.periodStart && d <= b.periodEnd) {
            return true;
          }
          return false;
        }

        return d >= b.periodStart && d <= b.periodEnd;
      });
    }

    // Sort cycle transactions chronologically descending (newest first)
    cycleTxs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const periodStartStr = b.periodStart.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const periodEndStr = b.periodEnd.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    const cycleLabel = b.isOngoing
      ? `Ongoing Cycle (Closes ${b.closingDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})`
      : `Statement Closing: ${b.closingDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;

    let statementAmount: number | undefined = undefined;
    let amountPaid: number | undefined = undefined;
    let remainingDue: number | undefined = undefined;
    let status: StatementStatus | undefined = undefined;

    if (b.isOngoing) {
      statementAmount = breakdown.ongoingCycleOutstanding;
      remainingDue = breakdown.ongoingCycleOutstanding;
    } else if (matchingStmt) {
      statementAmount = matchingStmt.statementBalance;
      amountPaid = matchingStmt.paymentsReceived || 0;
      remainingDue = matchingStmt.remainingBalance ?? Math.max(0, safeSubtract(matchingStmt.statementBalance, amountPaid));
      status = matchingStmt.status;
    }

    cycles.push({
      cycleId: `cycle-${b.closingDate.toISOString().slice(0, 10)}`,
      cycleLabel,
      periodStart: periodStartStr,
      periodEnd: periodEndStr,
      closingDate: b.closingDate.toISOString(),
      dueDate: b.dueDate ? b.dueDate.toISOString() : undefined,
      isCurrentCycle: b.isOngoing,
      statementId: matchingStmt ? matchingStmt._id.toString() : undefined,
      statementAmount,
      amountPaid,
      remainingDue,
      status,
      transactions: cycleTxs.map((t) => t.toJSON() as any),
    });
  }

  // 4. Recent repayment transactions
  const recentPayments = transactions
    .filter((t) => t.type === TransactionType.CREDIT_CARD_PAYMENT)
    .slice(0, 15)
    .map((t) => t.toJSON() as any);

  let nextPaymentDue: CreditCardDetailResponse['nextPaymentDue'] = undefined;
  if (breakdown.latestStatement && breakdown.latestStatement.remainingBalance > 0) {
    const isOverdue = new Date() > new Date(breakdown.latestStatement.dueDate);
    nextPaymentDue = {
      amount: breakdown.latestStatement.remainingBalance,
      dueDate: breakdown.latestStatement.dueDate,
      isOverdue,
    };
  }

  return {
    card: {
      ...(card.toJSON() as any),
      previousCycleOutstanding: breakdown.previousCycleOutstanding,
      ongoingCycleOutstanding: breakdown.ongoingCycleOutstanding,
      latestStatementAmount: breakdown.latestStatement?.statementBalance,
      latestStatementDueDate: breakdown.latestStatement?.dueDate,
      latestStatementRemaining: breakdown.latestStatement?.remainingBalance,
      latestStatementStatus: breakdown.latestStatement?.status,
      nextClosingDate: breakdown.dates.nextClosingDate.toISOString(),
      nextPaymentDueDate: breakdown.dates.nextDueDate.toISOString(),
    },
    totalOutstanding: breakdown.totalOutstanding,
    previousCycleOutstanding: breakdown.previousCycleOutstanding,
    ongoingCycleOutstanding: breakdown.ongoingCycleOutstanding,
    availableCredit: breakdown.availableCredit,
    creditLimit: breakdown.creditLimit,
    utilization: breakdown.utilization,
    latestStatement: breakdown.latestStatement
      ? ({
          ...breakdown.latestStatement,
          creditCardId: card._id.toString(),
          userId: userId.toString(),
        } as any)
      : undefined,
    nextPaymentDue,
    cycles,
    statements: statements.map((s) => s.toJSON() as any),
    recentPayments,
  };
}
