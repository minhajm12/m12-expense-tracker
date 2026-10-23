import mongoose from 'mongoose';
import { EmiRule, IEmiRule } from '../models/EmiRule';
import { EmiOccurrence, IEmiOccurrence } from '../models/EmiOccurrence';
import {
  EmiStatus,
  EmiOccurrenceStatus,
  UpcomingPaymentItem,
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
