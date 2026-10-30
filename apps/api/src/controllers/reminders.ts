import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { CreditCard } from '../models/CreditCard';
import { RecurringTransaction } from '../models/RecurringTransaction';
import { getUserBudgetsWithProgress } from '../services/budget';
import { calculateCardCycleDates } from '../services/credit-card-cycle';

export interface ReminderItem {
  id: string;
  type: 'credit_card_due' | 'recurring_bill' | 'budget_alert' | 'budget_exceeded';
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'danger';
  dueDate?: string;
  actionUrl: string;
}

export const getReminders = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user!._id);

    const reminders: ReminderItem[] = [];

    // 1. Credit Card Due Dates
    const cards = await CreditCard.find({ userId, isArchived: false, currentOutstanding: { $gt: 0 } });
    const today = new Date();
    const currentDay = today.getDate();

    for (const card of cards) {
      const cycleDates = calculateCardCycleDates(card.billingCycleClosingDay, card.paymentDueDay, today);
      const targetDueDate = cycleDates.lastDueDate;
      const msDiff = targetDueDate.getTime() - today.getTime();
      const diff = Math.ceil(msDiff / (1000 * 60 * 60 * 24));
      if (diff >= 0 && diff <= 7) {
        reminders.push({
          id: `card-${card._id}`,
          type: 'credit_card_due',
          title: `Credit Card Bill Due Soon: ${card.cardNickname}`,
          message: `Payment of ₹${card.currentOutstanding.toLocaleString('en-IN')} is due in ${diff === 0 ? 'today' : `${diff} day(s)`}.`,
          severity: diff <= 2 ? 'danger' : 'warning',
          actionUrl: '/credit-cards',
        });
      }
    }

    // 2. Upcoming Recurring Transactions (within next 7 days or overdue)
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const recurring = await RecurringTransaction.find({
      userId,
      isActive: true,
      nextExecutionDate: { $lte: sevenDaysFromNow },
    });

    for (const rule of recurring) {
      const isPast = new Date(rule.nextExecutionDate) < today;
      reminders.push({
        id: `recurring-${rule._id}`,
        type: 'recurring_bill',
        title: `${isPast ? 'Overdue' : 'Upcoming'} Recurring: ${rule.title}`,
        message: `₹${rule.amount.toLocaleString('en-IN')} scheduled for ${new Date(rule.nextExecutionDate).toLocaleDateString()}. Please confirm or record transaction.`,
        severity: isPast ? 'danger' : 'info',
        dueDate: rule.nextExecutionDate.toISOString(),
        actionUrl: '/recurring',
      });
    }

    // 3. Budgets Alerts & Overruns
    const budgets = await getUserBudgetsWithProgress(userId);
    for (const b of budgets) {
      if (b.isExceeded) {
        reminders.push({
          id: `budget-exceeded-${b.id}`,
          type: 'budget_exceeded',
          title: `Budget Exceeded: ${b.category}`,
          message: `You have spent ₹${b.spentAmount.toLocaleString('en-IN')} (${b.percentUsed}%), exceeding your ₹${b.limitAmount.toLocaleString('en-IN')} limit!`,
          severity: 'danger',
          actionUrl: '/budgets',
        });
      } else if (b.isAlertTriggered) {
        reminders.push({
          id: `budget-alert-${b.id}`,
          type: 'budget_alert',
          title: `Budget Threshold Alert: ${b.category}`,
          message: `You have reached ${b.percentUsed}% of your ₹${b.limitAmount.toLocaleString('en-IN')} budget limit.`,
          severity: 'warning',
          actionUrl: '/budgets',
        });
      }
    }

    res.status(200).json({
      success: true,
      data: reminders,
    });
  } catch (err) {
    next(err);
  }
};
