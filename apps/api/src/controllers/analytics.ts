import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { getDashboardAnalytics } from '../services/analytics';
import { sendSuccess } from '../utils/api-response';
import { RecurringTransaction } from '../models/RecurringTransaction';
import { RecurringOccurrence } from '../models/RecurringOccurrence';
import { EmiRule } from '../models/EmiRule';
import { EmiOccurrence } from '../models/EmiOccurrence';
import {
  safeAdd,
  EmiStatus,
  EmiOccurrenceStatus,
  UpcomingPaymentItem,
  UpcomingPaymentForecast,
} from '@finora/shared';
import { getCycleKey } from './recurring';
import { getUpcomingEmiItemsForForecast } from '../services/emi-schedule';
import { getUpcomingInvestmentObligations } from '../services/investment-service';

export const getDashboardData = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { period, startDate, endDate } = req.query;

  const data = await getDashboardAnalytics(
    userId,
    typeof period === 'string' ? period : 'this-month',
    typeof startDate === 'string' ? startDate : undefined,
    typeof endDate === 'string' ? endDate : undefined
  );

  sendSuccess(res, data, 'Dashboard analytics retrieved successfully');
};

export const getUpcomingMonthlyForecast = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const targetMonth =
    typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
      ? req.query.month
      : getCycleKey(new Date(), 'Asia/Kolkata');

  // 1. Ensure any active monthly recurring rules due in targetMonth have occurrence records
  const activeRules = await RecurringTransaction.find({ userId, isActive: true });
  for (const rule of activeRules) {
    const ruleKey = getCycleKey(rule.nextExecutionDate, 'Asia/Kolkata');
    if (ruleKey === targetMonth) {
      await RecurringOccurrence.findOneAndUpdate(
        { recurringRuleId: rule._id, occurrenceKey: targetMonth },
        {
          $setOnInsert: {
            userId,
            recurringRuleId: rule._id,
            occurrenceKey: targetMonth,
            scheduledDate: rule.nextExecutionDate,
            status: 'DUE',
            originalAmount: rule.amount,
          },
        },
        { upsert: true }
      );
    }
  }

  const recurringOccurrences = await RecurringOccurrence.find({
    userId,
    occurrenceKey: targetMonth,
    status: { $in: ['DUE', 'LOGGED', 'SKIPPED'] },
  }).populate('recurringRuleId');

  const items: UpcomingPaymentItem[] = [];
  let recurringRemaining = 0;
  let totalPaid = 0;

  for (const occ of recurringOccurrences) {
    const rule = occ.recurringRuleId as any;
    if (!rule) continue;
    const isPaid = occ.status === 'LOGGED';
    const isSkipped = occ.status === 'SKIPPED';
    const expected = occ.originalAmount || rule.amount;
    const actual = isPaid ? (occ.actualAmount ?? expected) : undefined;

    if (isPaid) {
      totalPaid = safeAdd(totalPaid, actual ?? expected);
    } else if (!isSkipped) {
      recurringRemaining = safeAdd(recurringRemaining, expected);
    }

    items.push({
      id: occ._id.toString(),
      title: rule.title,
      type: 'recurring',
      category: rule.category,
      dueDate: occ.scheduledDate.toISOString(),
      expectedAmount: expected,
      actualAmount: actual,
      status: isPaid ? 'paid' : isSkipped ? 'skipped' : 'unpaid',
      ruleId: rule._id.toString(),
      occurrenceKey: targetMonth,
      occurrenceId: occ._id.toString(),
      paymentMethod: occ.paymentMethod || rule.paymentMethod,
      accountId: occ.accountId ? occ.accountId.toString() : rule.accountId ? rule.accountId.toString() : undefined,
      creditCardId: occ.creditCardId ? occ.creditCardId.toString() : rule.creditCardId ? rule.creditCardId.toString() : undefined,
      isFlexibleDate: Boolean(rule.isFlexibleDate),
    });
  }

  // 2. Authoritative EMI occurrences for targetMonth via shared emi-schedule service
  const emiForecast = await getUpcomingEmiItemsForForecast(userId, targetMonth);
  const emiRemaining = emiForecast.emiRemaining;
  totalPaid = safeAdd(totalPaid, emiForecast.emiPaid);
  items.push(...emiForecast.items);

  // 3. Investment obligations for targetMonth via investment service
  const investmentForecast = await getUpcomingInvestmentObligations(userId, targetMonth);
  const investmentRemaining = investmentForecast.investmentRemaining;
  totalPaid = safeAdd(totalPaid, investmentForecast.investmentPaid);
  items.push(...investmentForecast.items);

  // Total Expected = sum of scheduled expected amounts applicable to the selected month
  let totalExpected = 0;
  for (const item of items) {
    totalExpected = safeAdd(totalExpected, item.expectedAmount);
  }

  // Sort items: unpaid first by dueDate ascending, then paid by dueDate ascending
  items.sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === 'unpaid' ? -1 : 1;
    }
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });

  const remainingAmountNeeded = safeAdd(safeAdd(recurringRemaining, emiRemaining), investmentRemaining);

  const forecast: UpcomingPaymentForecast = {
    month: targetMonth,
    totalExpectedPayments: totalExpected,
    recurringPaymentsRemaining: recurringRemaining,
    emiPaymentsRemaining: emiRemaining,
    investmentPaymentsRemaining: investmentRemaining,
    totalPaid,
    remainingAmountNeeded,
    items,
  };

  sendSuccess(res, forecast, 'Upcoming monthly forecast retrieved successfully');
};

