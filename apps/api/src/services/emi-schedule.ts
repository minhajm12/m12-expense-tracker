import mongoose from 'mongoose';
import { EmiRule, IEmiRule } from '../models/EmiRule';
import { EmiOccurrence, IEmiOccurrence } from '../models/EmiOccurrence';
import { Transaction } from '../models/Transaction';
import {
  EmiStatus,
  EmiOccurrenceStatus,
  UpcomingPaymentItem,
  TransactionType,
  TransactionStatus,
  PaymentMethod,
  PaymentChannel,
  safeAdd,
} from '@finora/shared';
import { getCycleKey } from '../controllers/recurring';

export interface NextPayableInstallmentResult {
  emiRuleId: string;
  emiName: string;
  lender: string;
  monthlyAmount: number;
  nextPayableOccurrence: IEmiOccurrence | null;
  isCompleted: boolean;
  isOverdue: boolean;
  nextEmiDate: Date | null;
  remainingInstallments: number;
  totalInstallments: number;
  paidCount: number;
}

/**
 * Authoritatively determines the next payable installment for an EMI rule.
 * 
 * Rules:
 * 1. Excludes installments marked PAID or PAID_HISTORICAL.
 * 2. Identifies the earliest eligible unpaid installment by installmentNumber / dueDate.
 * 3. Does not treat an installment as paid merely because its due date has passed.
 * 4. Detects overdue status when dueDate < now.
 * 5. Automatically updates and synchronizes EmiRule.nextEmiDate and EmiRule.status.
 */
export async function getNextPayableInstallment(
  emiRuleId: string | mongoose.Types.ObjectId,
  userId?: string | mongoose.Types.ObjectId
): Promise<NextPayableInstallmentResult> {
  const query: Record<string, any> = { _id: emiRuleId };
  if (userId) query.userId = userId;

  const emi = await EmiRule.findOne(query);
  if (!emi) {
    throw new Error(`EMI rule not found: ${emiRuleId}`);
  }

  const occurrences = await EmiOccurrence.find({ emiRuleId: emi._id }).sort({
    installmentNumber: 1,
    dueDate: 1,
  });

  const isPaid = (o: IEmiOccurrence) =>
    o.status === EmiOccurrenceStatus.PAID || o.status === EmiOccurrenceStatus.PAID_HISTORICAL;

  const paidOccs = occurrences.filter(isPaid);
  const unpaidOccs = occurrences.filter((o) => !isPaid(o));

  const totalInstallments = occurrences.length;
  const paidCount = paidOccs.length;
  const remainingInstallments = unpaidOccs.length;

  if (unpaidOccs.length === 0) {
    // All installments have been completed
    if (emi.status !== EmiStatus.COMPLETED || emi.nextEmiDate !== undefined) {
      emi.status = EmiStatus.COMPLETED;
      emi.nextEmiDate = undefined;
      await emi.save();
    }

    return {
      emiRuleId: emi._id.toString(),
      emiName: emi.name,
      lender: emi.lender,
      monthlyAmount: emi.monthlyAmount,
      nextPayableOccurrence: null,
      isCompleted: true,
      isOverdue: false,
      nextEmiDate: null,
      remainingInstallments: 0,
      totalInstallments,
      paidCount,
    };
  }

  const nextOcc = unpaidOccs[0];
  const now = new Date();
  const isOverdue = nextOcc.dueDate < now;

  // Ensure rule status and nextEmiDate are synchronized with this earliest unpaid installment
  let needsSave = false;
  if (emi.status === EmiStatus.COMPLETED) {
    emi.status = EmiStatus.ACTIVE;
    needsSave = true;
  }
  if (!emi.nextEmiDate || emi.nextEmiDate.getTime() !== nextOcc.dueDate.getTime()) {
    emi.nextEmiDate = nextOcc.dueDate;
    needsSave = true;
  }
  if (needsSave) {
    await emi.save();
  }

  return {
    emiRuleId: emi._id.toString(),
    emiName: emi.name,
    lender: emi.lender,
    monthlyAmount: emi.monthlyAmount,
    nextPayableOccurrence: nextOcc,
    isCompleted: false,
    isOverdue,
    nextEmiDate: nextOcc.dueDate,
    remainingInstallments,
    totalInstallments,
    paidCount,
  };
}

/**
 * Synchronizes an EMI rule's status and nextEmiDate based on its live occurrence schedule.
 */
export async function syncEmiNextPayableState(
  emiRuleId: string | mongoose.Types.ObjectId
): Promise<NextPayableInstallmentResult> {
  return getNextPayableInstallment(emiRuleId);
}

/**
 * Returns EMI upcoming forecast items for the requested month.
 * Ensures the dashboard displays the authoritative next payable installment,
 * excludes paid/historical installments from remaining amounts, and displays obligations for targetMonth.
 */
export async function getUpcomingEmiItemsForForecast(
  userId: string | mongoose.Types.ObjectId,
  targetMonth: string
): Promise<{
  items: UpcomingPaymentItem[];
  emiRemaining: number;
  emiPaid: number;
}> {
  const items: UpcomingPaymentItem[] = [];
  let emiRemaining = 0;
  let emiPaid = 0;

  // Active or completed rules (exclude archived/deleted)
  const rules = await EmiRule.find({
    userId,
    status: { $ne: EmiStatus.ARCHIVED },
  });

  const ruleMap = new Map<string, IEmiRule>();
  for (const r of rules) {
    ruleMap.set(r._id.toString(), r);
  }

  // Find occurrences specifically for targetMonth
  const occurrences = await EmiOccurrence.find({
    userId,
    emiRuleId: { $in: Array.from(ruleMap.keys()) },
    occurrenceKey: targetMonth,
  }).sort({ dueDate: 1, installmentNumber: 1 });

  const now = new Date();

  for (const occ of occurrences) {
    const emi = ruleMap.get(occ.emiRuleId.toString());
    if (!emi) continue;

    const isPaid =
      occ.status === EmiOccurrenceStatus.PAID ||
      occ.status === EmiOccurrenceStatus.PAID_HISTORICAL;

    const expected = occ.expectedAmount;
    const actual = occ.actualAmountPaid ?? expected;

    if (isPaid) {
      emiPaid = safeAdd(emiPaid, actual);

      items.push({
        id: occ._id.toString(),
        title: `${emi.name} (${emi.lender})`,
        type: 'emi',
        dueDate: occ.dueDate.toISOString(),
        expectedAmount: expected,
        actualAmount: actual,
        status: 'paid',
        ruleId: emi._id.toString(),
        occurrenceKey: targetMonth,
        occurrenceId: occ._id.toString(),
        paymentMethod: occ.paymentMethod || emi.paymentMethod,
        accountId: occ.accountId ? occ.accountId.toString() : emi.accountId ? emi.accountId.toString() : undefined,
        creditCardId: occ.creditCardId ? occ.creditCardId.toString() : emi.creditCardId ? emi.creditCardId.toString() : undefined,
        isOverdue: false,
      });
    } else {
      emiRemaining = safeAdd(emiRemaining, expected);
      const isOverdue = occ.dueDate < now;

      items.push({
        id: occ._id.toString(),
        title: `${emi.name} (${emi.lender})`,
        type: 'emi',
        dueDate: occ.dueDate.toISOString(),
        expectedAmount: expected,
        status: 'unpaid',
        ruleId: emi._id.toString(),
        occurrenceKey: targetMonth,
        occurrenceId: occ._id.toString(),
        paymentMethod: occ.paymentMethod || emi.paymentMethod,
        accountId: occ.accountId ? occ.accountId.toString() : emi.accountId ? emi.accountId.toString() : undefined,
        creditCardId: occ.creditCardId ? occ.creditCardId.toString() : emi.creditCardId ? emi.creditCardId.toString() : undefined,
        isOverdue,
      });
    }
  }

  return { items, emiRemaining, emiPaid };
}

/**
 * Ensures that all confirmed historical installments (PAID_HISTORICAL)
 * have corresponding linked Expense transactions recorded for their actual historical months.
 *
 * Financial Accounting Rules:
 * - isPastRecorded: true (strictly prevents duplicate deductions from bank account or cash balance).
 * - Records are marked COMPLETED, category 'EMI', type EXPENSE, and use the installment's actual dueDate/paidAt.
 * - Idempotent: verifies whether an expense transaction already exists by emiOccurrenceId or (emiRuleId + occurrenceKey).
 * - Accurately updates existing transactions if installment amount or notes are updated.
 * - Safely cleans up linked historical transactions if an installment is no longer historical/paid.
 */
export async function reconcileHistoricalEmiTransactions(
  emiRuleId: string | mongoose.Types.ObjectId,
  userId?: string | mongoose.Types.ObjectId
): Promise<{ createdCount: number; updatedCount: number }> {
  const emi = await EmiRule.findById(emiRuleId);
  if (!emi) return { createdCount: 0, updatedCount: 0 };

  const effectiveUserId = userId || emi.userId;

  const occurrences = await EmiOccurrence.find({
    emiRuleId: emi._id,
  }).sort({ installmentNumber: 1 });

  let createdCount = 0;
  let updatedCount = 0;

  for (const occ of occurrences) {
    const isHistoricalPaid = occ.status === EmiOccurrenceStatus.PAID_HISTORICAL;

    if (isHistoricalPaid) {
      const amount = occ.actualAmountPaid ?? occ.expectedAmount ?? emi.monthlyAmount;
      const txDate = occ.paidAt || occ.dueDate;

      // Check if transaction already exists
      let tx = null;
      if (occ.transactionId) {
        tx = await Transaction.findById(occ.transactionId);
      }
      if (!tx) {
        tx = await Transaction.findOne({
          userId: effectiveUserId,
          emiRuleId: emi._id,
          occurrenceKey: occ.occurrenceKey,
          type: TransactionType.EXPENSE,
        });
      }

      if (tx) {
        let changed = false;
        if (!occ.transactionId || occ.transactionId.toString() !== tx._id.toString()) {
          occ.transactionId = tx._id;
          await occ.save();
        }
        if (tx.amount !== amount) {
          tx.amount = amount;
          changed = true;
        }
        if (!tx.isPastRecorded) {
          tx.isPastRecorded = true;
          changed = true;
        }
        if (tx.date.getTime() !== txDate.getTime()) {
          tx.date = txDate;
          changed = true;
        }
        if (changed) {
          await tx.save();
          updatedCount++;
        }
      } else {
        const newTx = await Transaction.create({
          userId: effectiveUserId,
          title: `EMI: ${emi.name} (${emi.lender})`,
          amount,
          originalAmount: occ.expectedAmount,
          type: TransactionType.EXPENSE,
          category: 'EMI',
          paymentMethod: occ.paymentMethod || emi.paymentMethod || PaymentMethod.UPI,
          paymentChannel: occ.paymentChannel || emi.paymentChannel || PaymentChannel.ONLINE,
          accountId: occ.accountId || emi.accountId,
          creditCardId: occ.creditCardId || emi.creditCardId,
          emiRuleId: emi._id,
          emiOccurrenceId: occ._id,
          occurrenceKey: occ.occurrenceKey,
          date: txDate,
          isPastRecorded: true, // past-recorded: historical expense without bank balance adjustment
          status: TransactionStatus.COMPLETED,
          notes: occ.notes || `Historical EMI Installment #${occ.installmentNumber} (${occ.occurrenceKey})`,
        });

        occ.transactionId = newTx._id;
        await occ.save();
        createdCount++;
      }
    } else {
      // If occurrence is NOT historical paid, but has a linked past-recorded transaction, remove it
      if (occ.transactionId) {
        const linkedTx = await Transaction.findById(occ.transactionId);
        if (linkedTx && linkedTx.isPastRecorded) {
          await Transaction.deleteOne({ _id: linkedTx._id });
          occ.transactionId = undefined;
          await occ.save();
        }
      }
    }
  }

  return { createdCount, updatedCount };
}

/**
 * Idempotently reconciles historical EMI transactions across all active and completed EMIs.
 */
export async function backfillAllHistoricalEmiExpenses(): Promise<{
  totalEmisProcessed: number;
  totalCreated: number;
  totalUpdated: number;
}> {
  const emis = await EmiRule.find({
    status: { $ne: EmiStatus.ARCHIVED },
  });

  let totalCreated = 0;
  let totalUpdated = 0;

  for (const emi of emis) {
    const res = await reconcileHistoricalEmiTransactions(emi._id, emi.userId);
    totalCreated += res.createdCount;
    totalUpdated += res.updatedCount;
  }

  return {
    totalEmisProcessed: emis.length,
    totalCreated,
    totalUpdated,
  };
}
