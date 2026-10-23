import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { RecurringTransaction } from '../models/RecurringTransaction';
import { RecurringOccurrence } from '../models/RecurringOccurrence';
import { Transaction } from '../models/Transaction';
import { BankAccount } from '../models/BankAccount';
import { CreditCard } from '../models/CreditCard';
import {
  createRecurringSchema,
  updateRecurringSchema,
  TransactionType,
  TransactionStatus,
  RecurringFrequency,
  PaymentMethod,
  PaymentChannel,
  toCents,
  fromCents,
  safeSubtract,
} from '@finora/shared';
import { AppError } from '../utils/api-response';
import {
  recalculateAccountBalance,
  recalculateCreditCardOutstanding,
  calculatePersonalCashInHand,
} from '../services/financial';

export function getCycleKey(dateInput: Date | string = new Date(), timeZone: string = 'Asia/Kolkata'): string {
  const d = new Date(dateInput);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  });
  return formatter.format(d);
}

function computeNextDueDate(currentDate: Date, frequency: RecurringFrequency): Date {
  const next = new Date(currentDate);
  switch (frequency) {
    case RecurringFrequency.WEEKLY:
      next.setDate(next.getDate() + 7);
      break;
    case RecurringFrequency.MONTHLY:
      next.setMonth(next.getMonth() + 1);
      break;
    case RecurringFrequency.QUARTERLY:
      next.setMonth(next.getMonth() + 3);
      break;
    case RecurringFrequency.YEARLY:
      next.setFullYear(next.getFullYear() + 1);
      break;
  }
  return next;
}

export const getRecurringRules = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user!._id);
    const rules = await RecurringTransaction.find({ userId }).sort({ nextExecutionDate: 1 });

    const currentCycleKey = getCycleKey(new Date(), 'Asia/Kolkata');
    const ruleIds = rules.map((r) => r._id);

    const occurrences = await RecurringOccurrence.find({
      userId,
      recurringRuleId: { $in: ruleIds },
      occurrenceKey: currentCycleKey,
    });
    const occMap = new Map<string, any>();
    for (const occ of occurrences) {
      occMap.set(occ.recurringRuleId.toString(), occ);
    }

    const rulesData = rules.map((r) => {
      const obj: any = r.toJSON();
      const occ = occMap.get(r._id.toString());
      const isLogged = occ?.status === 'LOGGED';
      const isSkipped = occ?.status === 'SKIPPED';
      obj.isLoggedForCurrentMonth = isLogged;
      obj.isSkippedForCurrentMonth = isSkipped;
      obj.currentMonthCycleKey = currentCycleKey;
      obj.currentMonthOccurrenceStatus = occ?.status || 'DUE';
      obj.currentMonthTransactionId = occ?.transactionId ? occ.transactionId.toString() : undefined;
      return obj;
    });

    res.status(200).json({
      success: true,
      data: rulesData,
    });
  } catch (err) {
    next(err);
  }
};

export const getRecurringRuleById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid recurring rule ID', 400, 'INVALID_ID');
    }

    const userId = new mongoose.Types.ObjectId(req.user!._id);
    const rule = await RecurringTransaction.findOne({ _id: id, userId });

    if (!rule) {
      throw new AppError('Recurring schedule not found', 404, 'NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      data: rule,
    });
  } catch (err) {
    next(err);
  }
};

export const createRecurringRule = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const validatedData = createRecurringSchema.parse(req.body);
    const userId = new mongoose.Types.ObjectId(req.user!._id);

    const rule = await RecurringTransaction.create({
      userId,
      title: validatedData.title,
      amount: validatedData.amount,
      type: validatedData.type,
      category: validatedData.category,
      frequency: validatedData.frequency,
      paymentMethod: validatedData.paymentMethod,
      paymentChannel: validatedData.paymentChannel,
      accountId: validatedData.accountId ? new mongoose.Types.ObjectId(validatedData.accountId) : undefined,
      creditCardId: validatedData.creditCardId
        ? new mongoose.Types.ObjectId(validatedData.creditCardId)
        : undefined,
      nextExecutionDate: new Date(validatedData.nextExecutionDate),
      notes: validatedData.notes,
      isActive: validatedData.isActive ?? true,
      status: (validatedData as any).status ?? 'active',
      isFlexibleDate: (validatedData as any).isFlexibleDate ?? false,
    });

    const initialCycleKey = getCycleKey(rule.nextExecutionDate, 'Asia/Kolkata');
    await RecurringOccurrence.create({
      userId,
      recurringRuleId: rule._id,
      occurrenceKey: initialCycleKey,
      scheduledDate: rule.nextExecutionDate,
      status: 'DUE',
    });

    res.status(201).json({
      success: true,
      data: rule,
      message: 'Recurring schedule created successfully',
    });
  } catch (err) {
    next(err);
  }
};

export const updateRecurringRule = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid recurring rule ID', 400, 'INVALID_ID');
    }

    const validatedData = updateRecurringSchema.parse(req.body);
    const userId = new mongoose.Types.ObjectId(req.user!._id);

    const updateFields: Record<string, any> = {};
    if (validatedData.title !== undefined) updateFields.title = validatedData.title;
    if (validatedData.amount !== undefined) updateFields.amount = validatedData.amount;
    if (validatedData.type !== undefined) updateFields.type = validatedData.type;
    if (validatedData.category !== undefined) updateFields.category = validatedData.category;
    if (validatedData.frequency !== undefined) updateFields.frequency = validatedData.frequency;
    if (validatedData.paymentMethod !== undefined) updateFields.paymentMethod = validatedData.paymentMethod;
    if (validatedData.paymentChannel !== undefined) updateFields.paymentChannel = validatedData.paymentChannel;
    if (validatedData.accountId !== undefined) {
      updateFields.accountId = validatedData.accountId
        ? new mongoose.Types.ObjectId(validatedData.accountId)
        : null;
    }
    if (validatedData.creditCardId !== undefined) {
      updateFields.creditCardId = validatedData.creditCardId
        ? new mongoose.Types.ObjectId(validatedData.creditCardId)
        : null;
    }
    if (validatedData.nextExecutionDate !== undefined) {
      updateFields.nextExecutionDate = new Date(validatedData.nextExecutionDate);
    }
    if (validatedData.notes !== undefined) updateFields.notes = validatedData.notes;
    if (validatedData.isActive !== undefined) updateFields.isActive = validatedData.isActive;
    if ((validatedData as any).isFlexibleDate !== undefined) {
      updateFields.isFlexibleDate = (validatedData as any).isFlexibleDate;
    }
    if ((validatedData as any).status !== undefined) {
      updateFields.status = (validatedData as any).status;
      if ((validatedData as any).status === 'completed' || (validatedData as any).status === 'cancelled') {
        updateFields.isActive = false;
      }
    }

    const rule = await RecurringTransaction.findOneAndUpdate(
      { _id: id, userId },
      { $set: updateFields },
      { new: true }
    );

    if (!rule) {
      throw new AppError('Recurring schedule not found', 404, 'NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      data: rule,
      message: 'Recurring schedule updated successfully',
    });
  } catch (err) {
    next(err);
  }
};

export const deleteRecurringRule = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid recurring rule ID', 400, 'INVALID_ID');
    }

    const userId = new mongoose.Types.ObjectId(req.user!._id);
    const rule = await RecurringTransaction.findOneAndDelete({ _id: id, userId });

    if (!rule) {
      throw new AppError('Recurring schedule not found', 404, 'NOT_FOUND');
    }

    // Clean up occurrences for this rule
    await RecurringOccurrence.deleteMany({ recurringRuleId: id, userId });

    res.status(200).json({
      success: true,
      message: 'Recurring schedule deleted successfully',
    });
  } catch (err) {
    next(err);
  }
};

export const executeRecurringRule = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid recurring rule ID', 400, 'INVALID_ID');
    }

    const userId = new mongoose.Types.ObjectId(req.user!._id);
    const rule = await RecurringTransaction.findOne({ _id: id, userId });

    if (!rule) {
      throw new AppError('Recurring schedule not found', 404, 'NOT_FOUND');
    }

    // Determine target cycleKey (e.g. "2026-10" in Asia/Kolkata)
    const {
      occurrenceKey,
      actualAmount,
      discountType,
      discountAmount,
      discountNotes,
      updateFutureAmount,
      futureAmount,
      paymentMethod,
      paymentChannel,
      accountId,
      creditCardId,
      updateFuturePaymentSettings,
      updateDefaultPaymentSettings,
    } = req.body || {};

    const cycleKey = occurrenceKey || getCycleKey(rule.nextExecutionDate, 'Asia/Kolkata');

    // 1. Check if an occurrence for this rule and cycleKey is already LOGGED
    const existingLogged = await RecurringOccurrence.findOne({
      recurringRuleId: rule._id,
      occurrenceKey: cycleKey,
      status: 'LOGGED',
    });

    if (existingLogged) {
      throw new AppError(
        `An active transaction for this recurring schedule has already been logged for ${cycleKey}.`,
        400,
        'RECURRING_OCCURRENCE_ALREADY_LOGGED'
      );
    }

    // 2. Check if a transaction for this rule & cycleKey already exists
    const existingTx = await Transaction.findOne({
      recurringRuleId: rule._id,
      occurrenceKey: cycleKey,
    });
    if (existingTx) {
      throw new AppError(
        `A transaction for this recurring schedule has already been posted for ${cycleKey}.`,
        400,
        'TRANSACTION_ALREADY_EXISTS'
      );
    }

    // Determine actual amount to post and discount audit data
    const originalAmount = rule.amount;
    const finalAmount =
      typeof actualAmount === 'number' && actualAmount > 0 ? actualAmount : rule.amount;
    const calculatedDiscount =
      typeof discountAmount === 'number' && discountAmount >= 0
        ? discountAmount
        : originalAmount > finalAmount
        ? safeSubtract(originalAmount, finalAmount)
        : 0;

    // Dynamically resolve payment method and destination account/card
    const effectivePaymentMethod = (paymentMethod || rule.paymentMethod) as PaymentMethod;
    let effectiveAccountId: mongoose.Types.ObjectId | undefined = undefined;
    let effectiveCreditCardId: mongoose.Types.ObjectId | undefined = undefined;
    let effectivePaymentChannel = paymentChannel || rule.paymentChannel || PaymentChannel.ONLINE;

    if (effectivePaymentMethod === PaymentMethod.CREDIT_CARD) {
      const cardId = creditCardId || (rule.creditCardId ? rule.creditCardId.toString() : undefined);
      if (!cardId) {
        throw new AppError('Credit card is required when paying with Credit Card', 400, 'CREDIT_CARD_REQUIRED');
      }
      effectiveCreditCardId = new mongoose.Types.ObjectId(cardId);
      effectiveAccountId = undefined;
      effectivePaymentChannel = paymentChannel || PaymentChannel.ONLINE;
    } else if (effectivePaymentMethod === PaymentMethod.CASH) {
      effectiveAccountId = undefined;
      effectiveCreditCardId = undefined;
      effectivePaymentChannel = PaymentChannel.OFFLINE;
    } else {
      // Bank / UPI / Net Banking / Debit Card
      const accId = accountId || (rule.accountId ? rule.accountId.toString() : undefined);
      if (!accId) {
        throw new AppError('Bank account is required when paying with UPI / Bank Account', 400, 'ACCOUNT_REQUIRED');
      }
      effectiveAccountId = new mongoose.Types.ObjectId(accId);
      effectiveCreditCardId = undefined;
      if (effectivePaymentMethod === PaymentMethod.UPI) {
        effectivePaymentChannel = paymentChannel || PaymentChannel.ONLINE;
      }
    }

    const combinedNotes = [
      `Recurring ${rule.frequency} execution: ${rule.notes || ''}`.trim(),
      discountNotes ? `Offer/Discount: ${discountNotes}` : null,
      calculatedDiscount > 0 ? `(Configured: ₹${originalAmount}, Discount: ₹${calculatedDiscount})` : null,
    ]
      .filter(Boolean)
      .join(' | ');

    // 3. Create the actual manual transaction linked to this recurring schedule
    const tx = await Transaction.create({
      userId,
      title: rule.title,
      amount: finalAmount,
      originalAmount,
      discountAmount: calculatedDiscount,
      discountType: discountType || (calculatedDiscount > 0 ? 'custom' : 'none'),
      discountNotes: discountNotes || undefined,
      type: rule.type,
      category: rule.category,
      paymentMethod: effectivePaymentMethod,
      paymentChannel: effectivePaymentChannel,
      accountId: effectiveAccountId,
      creditCardId: effectiveCreditCardId,
      destinationAccountId: rule.destinationAccountId,
      recurringRuleId: rule._id,
      occurrenceKey: cycleKey,
      date: new Date(),
      status: TransactionStatus.COMPLETED,
      notes: combinedNotes,
    });

    // 4. Mark or upsert RecurringOccurrence as LOGGED with full discount and payment audit metadata
    await RecurringOccurrence.findOneAndUpdate(
      { recurringRuleId: rule._id, occurrenceKey: cycleKey },
      {
        $set: {
          userId,
          recurringRuleId: rule._id,
          occurrenceKey: cycleKey,
          scheduledDate: rule.nextExecutionDate,
          status: 'LOGGED',
          transactionId: tx._id,
          loggedAt: new Date(),
          originalAmount,
          actualAmount: finalAmount,
          discountAmount: calculatedDiscount,
          discountType: discountType || (calculatedDiscount > 0 ? 'custom' : 'none'),
          discountNotes: discountNotes || undefined,
          paymentMethod: effectivePaymentMethod,
          paymentChannel: effectivePaymentChannel,
          accountId: effectiveAccountId,
          creditCardId: effectiveCreditCardId,
        },
      },
      { upsert: true, new: true }
    );

    // 5. Authoritatively update balances using decimal-safe accounting services
    if (effectiveAccountId) {
      await recalculateAccountBalance(effectiveAccountId, userId);
    }
    if (rule.destinationAccountId) {
      await recalculateAccountBalance(rule.destinationAccountId, userId);
    }
    if (effectiveCreditCardId) {
      await recalculateCreditCardOutstanding(effectiveCreditCardId, userId);
    }
    if (effectivePaymentMethod === PaymentMethod.CASH) {
      await calculatePersonalCashInHand(userId);
    }

    // 6. Advance the nextExecutionDate and optionally update rule defaults for future occurrences
    const nextDate = computeNextDueDate(rule.nextExecutionDate, rule.frequency);
    rule.lastExecutedAt = new Date();
    rule.nextExecutionDate = nextDate;
    if (updateFutureAmount && typeof futureAmount === 'number' && futureAmount > 0) {
      rule.amount = futureAmount;
    }

    const shouldUpdateFuturePaymentSettings = Boolean(updateFuturePaymentSettings || updateDefaultPaymentSettings);
    if (shouldUpdateFuturePaymentSettings) {
      rule.paymentMethod = effectivePaymentMethod;
      rule.paymentChannel = effectivePaymentChannel;
      rule.accountId = effectiveAccountId;
      rule.creditCardId = effectiveCreditCardId;
    }

    await rule.save();

    // 7. Ensure next occurrence exists in DUE status
    const nextCycleKey = getCycleKey(nextDate, 'Asia/Kolkata');
    await RecurringOccurrence.findOneAndUpdate(
      { recurringRuleId: rule._id, occurrenceKey: nextCycleKey },
      {
        $setOnInsert: {
          userId,
          recurringRuleId: rule._id,
          occurrenceKey: nextCycleKey,
          scheduledDate: nextDate,
          status: 'DUE',
        },
      },
      { upsert: true }
    );

    res.status(200).json({
      success: true,
      data: {
        transaction: tx,
        recurringRule: rule,
      },
      message: 'Recurring transaction executed and posted successfully',
    });
  } catch (err) {
    next(err);
  }
};

export const skipRecurringOccurrence = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid recurring rule ID', 400, 'INVALID_ID');
    }

    const userId = new mongoose.Types.ObjectId(req.user!._id);
    const rule = await RecurringTransaction.findOne({ _id: id, userId });

    if (!rule) {
      throw new AppError('Recurring schedule not found', 404, 'NOT_FOUND');
    }

    const { occurrenceKey } = req.body || {};
    const cycleKey = occurrenceKey || getCycleKey(rule.nextExecutionDate, 'Asia/Kolkata');

    // Check if an occurrence for this rule and cycleKey is already LOGGED
    const existingLogged = await RecurringOccurrence.findOne({
      recurringRuleId: rule._id,
      occurrenceKey: cycleKey,
      status: 'LOGGED',
    });

    if (existingLogged) {
      throw new AppError(
        `Cannot skip an installment that has already been logged/paid for ${cycleKey}.`,
        400,
        'CANNOT_SKIP_PAID_OCCURRENCE'
      );
    }

    // Mark as SKIPPED
    const skippedOccurrence = await RecurringOccurrence.findOneAndUpdate(
      { recurringRuleId: rule._id, occurrenceKey: cycleKey },
      {
        $set: {
          userId,
          recurringRuleId: rule._id,
          occurrenceKey: cycleKey,
          scheduledDate: rule.nextExecutionDate,
          status: 'SKIPPED',
          originalAmount: rule.amount,
        },
      },
      { upsert: true, new: true }
    );

    // Advance rule.nextExecutionDate to next cycle if the cycleKey matches rule's current nextExecutionDate
    const currentRuleCycleKey = getCycleKey(rule.nextExecutionDate, 'Asia/Kolkata');
    if (cycleKey === currentRuleCycleKey) {
      const nextDate = computeNextDueDate(rule.nextExecutionDate, rule.frequency);
      rule.nextExecutionDate = nextDate;
      await rule.save();

      // Ensure next cycle occurrence exists as DUE
      const nextCycleKey = getCycleKey(nextDate, 'Asia/Kolkata');
      await RecurringOccurrence.findOneAndUpdate(
        { recurringRuleId: rule._id, occurrenceKey: nextCycleKey },
        {
          $setOnInsert: {
            userId,
            recurringRuleId: rule._id,
            occurrenceKey: nextCycleKey,
            scheduledDate: nextDate,
            status: 'DUE',
            originalAmount: rule.amount,
          },
        },
        { upsert: true }
      );
    }

    res.status(200).json({
      success: true,
      data: {
        occurrence: skippedOccurrence,
        recurringRule: rule,
      },
      message: 'Recurring payment skipped for this month. No balance has been debited.',
    });
  } catch (err) {
    next(err);
  }
};

export const completeRecurringRule = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid recurring rule ID', 400, 'INVALID_ID');
    }

    const userId = new mongoose.Types.ObjectId(req.user!._id);
    const rule = await RecurringTransaction.findOneAndUpdate(
      { _id: id, userId },
      {
        $set: {
          status: 'completed',
          isActive: false,
        },
      },
      { new: true }
    );

    if (!rule) {
      throw new AppError('Recurring schedule not found', 404, 'NOT_FOUND');
    }

    // Clean up future unfulfilled DUE occurrences for this rule so they don't appear in upcoming payments
    await RecurringOccurrence.deleteMany({
      recurringRuleId: rule._id,
      userId,
      status: 'DUE',
    });

    res.status(200).json({
      success: true,
      data: rule,
      message: 'Recurring schedule marked as completed.',
    });
  } catch (err) {
    next(err);
  }
};

export const cancelRecurringRule = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid recurring rule ID', 400, 'INVALID_ID');
    }

    const userId = new mongoose.Types.ObjectId(req.user!._id);
    const rule = await RecurringTransaction.findOneAndUpdate(
      { _id: id, userId },
      {
        $set: {
          status: 'cancelled',
          isActive: false,
        },
      },
      { new: true }
    );

    if (!rule) {
      throw new AppError('Recurring schedule not found', 404, 'NOT_FOUND');
    }

    // Clean up future unfulfilled DUE occurrences for this rule so they don't appear in upcoming payments
    await RecurringOccurrence.deleteMany({
      recurringRuleId: rule._id,
      userId,
      status: 'DUE',
    });

    res.status(200).json({
      success: true,
      data: rule,
      message: 'Recurring schedule cancelled successfully.',
    });
  } catch (err) {
    next(err);
  }
};
