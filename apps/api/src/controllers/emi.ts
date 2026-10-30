import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { EmiRule, IEmiRule } from '../models/EmiRule';
import { EmiOccurrence, IEmiOccurrence } from '../models/EmiOccurrence';
import { Transaction } from '../models/Transaction';
import {
  createEmiSchema,
  updateEmiSchema,
  payEmiSchema,
  updateHistoricalInstallmentSchema,
  PaymentMethod,
  PaymentChannel,
  TransactionType,
  TransactionStatus,
  EmiStatus,
  EmiOccurrenceStatus,
  getLocalDateParts,
  parseDateInput,
  safeSubtract,
} from '@finora/shared';
import { AppError } from '../utils/api-response';
import {
  recalculateAccountBalance,
  recalculateCreditCardOutstanding,
  calculatePersonalCashInHand,
} from '../services/financial';
import {
  reconcileHistoricalEmiTransactions,
  backfillAllHistoricalEmiExpenses,
} from '../services/emi-schedule';
import { getCycleKey } from './recurring';

/**
 * Generates monthly installment occurrences from firstDueDate through endDate,
 * identifying installments strictly prior to nextEmiDate as historical.
 */
export function generateEmiSchedule(
  firstDueDateInput: Date | string,
  endDateInput: Date | string,
  dueDayInput?: number,
  nextEmiDateInput?: Date | string
): Array<{
  occurrenceKey: string;
  installmentNumber: number;
  dueDate: Date;
  isHistorical: boolean;
}> {
  const firstDue = parseDateInput(firstDueDateInput);
  const end = parseDateInput(endDateInput);
  const nextEmiDate = nextEmiDateInput ? parseDateInput(nextEmiDateInput) : firstDue;

  const startParts = getLocalDateParts(firstDue, 'Asia/Kolkata');
  const endParts = getLocalDateParts(end, 'Asia/Kolkata');
  const nextParts = getLocalDateParts(nextEmiDate, 'Asia/Kolkata');

  const startYear = startParts.year;
  const startMonth = startParts.month;
  const endYear = endParts.year;
  const endMonth = endParts.month;

  const totalMonths = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
  if (totalMonths <= 0) {
    throw new AppError('End date must be on or after first due date', 400, 'INVALID_SCHEDULE_RANGE');
  }

  const effectiveDueDay = dueDayInput && dueDayInput >= 1 && dueDayInput <= 31 ? dueDayInput : startParts.day;
  const nextEmiCycleKey = `${nextParts.year}-${String(nextParts.month).padStart(2, '0')}`;

  const schedule: Array<{
    occurrenceKey: string;
    installmentNumber: number;
    dueDate: Date;
    isHistorical: boolean;
  }> = [];

  for (let i = 0; i < totalMonths; i++) {
    const m = startMonth + i;
    const curYear = startYear + Math.floor((m - 1) / 12);
    const curMonth = ((m - 1) % 12) + 1; // 1 to 12
    const occurrenceKey = `${curYear}-${String(curMonth).padStart(2, '0')}`;

    // Calculate maximum valid days in this specific month
    const daysInMonth = new Date(Date.UTC(curYear, curMonth, 0)).getUTCDate();
    const day = Math.min(effectiveDueDay, daysInMonth);

    // Midday UTC ensures date does not slip in Asia/Kolkata
    const dueDate = new Date(Date.UTC(curYear, curMonth - 1, day, 12, 0, 0));

    // Installments before the next EMI cycle key are historical
    const isHistorical = occurrenceKey < nextEmiCycleKey;

    schedule.push({
      occurrenceKey,
      installmentNumber: i + 1,
      dueDate,
      isHistorical,
    });
  }

  return schedule;
}

export const listEmis = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user!._id);
    const { status } = req.query;

    const filter: Record<string, any> = { userId };
    if (status && status !== 'all') {
      filter.status = status;
    } else {
      filter.status = { $ne: EmiStatus.ARCHIVED };
    }

    const rules = await EmiRule.find(filter)
      .populate('accountId', 'accountName bankName')
      .populate('creditCardId', 'cardNickname')
      .sort({ createdAt: -1 });

    const ruleIds = rules.map((r) => r._id);
    const occurrences = await EmiOccurrence.find({
      userId,
      emiRuleId: { $in: ruleIds },
    }).sort({ dueDate: 1 });

    // Group occurrences by emiRuleId
    const occByRule: Record<string, IEmiOccurrence[]> = {};
    for (const occ of occurrences) {
      const key = occ.emiRuleId.toString();
      if (!occByRule[key]) occByRule[key] = [];
      occByRule[key].push(occ);
    }

    const now = new Date();

    const enrichedRules = rules.map((rule) => {
      const occs = occByRule[rule._id.toString()] || [];
      const normalPaidOccs = occs.filter((o) => o.status === EmiOccurrenceStatus.PAID);
      const historicalPaidOccs = occs.filter((o) => o.status === EmiOccurrenceStatus.PAID_HISTORICAL);
      const allPaidOccs = occs.filter(
        (o) => o.status === EmiOccurrenceStatus.PAID || o.status === EmiOccurrenceStatus.PAID_HISTORICAL
      );
      const unpaidOccs = occs.filter(
        (o) => o.status !== EmiOccurrenceStatus.PAID && o.status !== EmiOccurrenceStatus.PAID_HISTORICAL
      );
      const overdueOccs = unpaidOccs.filter((o) => o.dueDate < now);

      const totalScheduledAmount = occs.reduce((sum, o) => sum + o.expectedAmount, 0);
      const totalPaidAmount = allPaidOccs.reduce((sum, o) => sum + (o.actualAmountPaid ?? o.expectedAmount), 0);
      const remainingAmount = unpaidOccs.reduce((sum, o) => sum + o.expectedAmount, 0);
      const nextDueOcc = unpaidOccs[0];

      const ret: Record<string, any> = rule.toJSON();
      ret.totalInstallments = occs.length;
      ret.paidInstallmentsCount = allPaidOccs.length;
      ret.historicalPaidInstallmentsCount = historicalPaidOccs.length;
      ret.normalPaidInstallmentsCount = normalPaidOccs.length;
      ret.remainingInstallmentsCount = unpaidOccs.length;
      ret.overdueInstallmentsCount = overdueOccs.length;
      ret.totalScheduledAmount = totalScheduledAmount;
      ret.totalPaidAmount = totalPaidAmount;
      ret.remainingAmount = remainingAmount;
      ret.nextDueDate = nextDueOcc ? nextDueOcc.dueDate.toISOString() : (rule.nextEmiDate ? rule.nextEmiDate.toISOString() : undefined);
      return ret;
    });

    // Compute Summary for active/completed overview
    const allUserRules = await EmiRule.find({ userId });
    const allOccurrences = await EmiOccurrence.find({ userId }).sort({ dueDate: 1 });

    const activeRules = allUserRules.filter((r) => r.status === EmiStatus.ACTIVE);
    const completedRules = allUserRules.filter((r) => r.status === EmiStatus.COMPLETED);

    const activeRuleIds = new Set(activeRules.map((r) => r._id.toString()));
    const activeOccurrences = allOccurrences.filter((o) => activeRuleIds.has(o.emiRuleId.toString()));
    const activeDueOccurrences = activeOccurrences.filter(
      (o) => o.status !== EmiOccurrenceStatus.PAID && o.status !== EmiOccurrenceStatus.PAID_HISTORICAL
    );

    const estimatedMonthlyOutflow = activeRules.reduce((sum, r) => sum + r.monthlyAmount, 0);
    const totalRemainingAmount = activeDueOccurrences.reduce((sum, o) => sum + o.expectedAmount, 0);

    let nextEmiDue: any = null;
    if (activeDueOccurrences.length > 0) {
      const earliest = activeDueOccurrences[0];
      const matchingRule = activeRules.find((r) => r._id.toString() === earliest.emiRuleId.toString());
      if (matchingRule) {
        nextEmiDue = {
          emiRuleId: matchingRule._id.toString(),
          emiName: matchingRule.name,
          lender: matchingRule.lender,
          dueDate: earliest.dueDate.toISOString(),
          amount: earliest.expectedAmount,
          occurrenceKey: earliest.occurrenceKey,
        };
      }
    }

    const summary = {
      activeEmisCount: activeRules.length,
      completedEmisCount: completedRules.length,
      estimatedMonthlyOutflow,
      nextEmiDue,
      totalRemainingAmount,
    };

    res.status(200).json({
      success: true,
      data: enrichedRules,
      summary,
    });
  } catch (err) {
    next(err);
  }
};

export const getEmiById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid EMI rule ID', 400, 'INVALID_ID');
    }

    const userId = new mongoose.Types.ObjectId(req.user!._id);
    const rule = await EmiRule.findOne({ _id: id, userId })
      .populate('accountId', 'accountName bankName')
      .populate('creditCardId', 'cardNickname')
      .populate('downPaymentAccountId', 'accountName bankName')
      .populate('downPaymentCreditCardId', 'cardNickname')
      .populate('downPaymentTransactionId', 'amount date title status paymentMethod accountId creditCardId');

    if (!rule) {
      throw new AppError('EMI schedule not found', 404, 'NOT_FOUND');
    }

    const occurrences = await EmiOccurrence.find({ emiRuleId: id, userId })
      .populate('transactionId', 'amount date title status paymentMethod accountId creditCardId')
      .sort({ installmentNumber: 1 });

    const now = new Date();
    const normalPaidOccs = occurrences.filter((o) => o.status === EmiOccurrenceStatus.PAID);
    const historicalPaidOccs = occurrences.filter((o) => o.status === EmiOccurrenceStatus.PAID_HISTORICAL);
    const allPaidOccs = occurrences.filter(
      (o) => o.status === EmiOccurrenceStatus.PAID || o.status === EmiOccurrenceStatus.PAID_HISTORICAL
    );
    const unpaidOccs = occurrences.filter(
      (o) => o.status !== EmiOccurrenceStatus.PAID && o.status !== EmiOccurrenceStatus.PAID_HISTORICAL
    );
    const overdueOccs = unpaidOccs.filter((o) => o.dueDate < now);

    const totalScheduledAmount = occurrences.reduce((sum, o) => sum + o.expectedAmount, 0);
    const totalPaidAmount = allPaidOccs.reduce((sum, o) => sum + (o.actualAmountPaid ?? o.expectedAmount), 0);
    const remainingAmount = unpaidOccs.reduce((sum, o) => sum + o.expectedAmount, 0);

    const nextUnpaidOcc = unpaidOccs[0];
    const nextDueDate = nextUnpaidOcc
      ? nextUnpaidOcc.dueDate.toISOString()
      : (rule.nextEmiDate ? rule.nextEmiDate.toISOString() : undefined);

    const ret: Record<string, any> = rule.toJSON();
    ret.totalInstallments = occurrences.length;
    ret.paidInstallmentsCount = allPaidOccs.length;
    ret.historicalPaidInstallmentsCount = historicalPaidOccs.length;
    ret.normalPaidInstallmentsCount = normalPaidOccs.length;
    ret.remainingInstallmentsCount = unpaidOccs.length;
    ret.overdueInstallmentsCount = overdueOccs.length;
    ret.totalScheduledAmount = totalScheduledAmount;
    ret.totalPaidAmount = totalPaidAmount;
    ret.remainingAmount = remainingAmount;
    ret.nextDueDate = nextDueDate;
    ret.occurrences = occurrences;

    res.status(200).json({
      success: true,
      data: ret,
    });
  } catch (err) {
    next(err);
  }
};

export const getEmiInstallments = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid EMI rule ID', 400, 'INVALID_ID');
    }

    const userId = new mongoose.Types.ObjectId(req.user!._id);
    const rule = await EmiRule.findOne({ _id: id, userId });
    if (!rule) {
      throw new AppError('EMI schedule not found', 404, 'NOT_FOUND');
    }

    const occurrences = await EmiOccurrence.find({ emiRuleId: id, userId })
      .populate('accountId', 'accountName bankName')
      .populate('creditCardId', 'cardNickname')
      .populate('transactionId', 'amount date title status paymentMethod accountId creditCardId')
      .sort({ installmentNumber: 1 });

    res.status(200).json({
      success: true,
      data: occurrences,
    });
  } catch (err) {
    next(err);
  }
};

export const createEmi = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const validatedData = createEmiSchema.parse(req.body);
    const userId = new mongoose.Types.ObjectId(req.user!._id);

    const firstDueDate = parseDateInput(validatedData.firstDueDate);
    const endDate = parseDateInput(validatedData.endDate);
    const startDate = parseDateInput(validatedData.startDate);
    const nextEmiDate = validatedData.nextEmiDate ? parseDateInput(validatedData.nextEmiDate) : firstDueDate;

    const localFirstDue = getLocalDateParts(firstDueDate, 'Asia/Kolkata');
    const localNextEmi = getLocalDateParts(nextEmiDate, 'Asia/Kolkata');
    const localEnd = getLocalDateParts(endDate, 'Asia/Kolkata');

    const firstDueKey = `${localFirstDue.year}-${String(localFirstDue.month).padStart(2, '0')}`;
    const nextEmiKey = `${localNextEmi.year}-${String(localNextEmi.month).padStart(2, '0')}`;
    const endKey = `${localEnd.year}-${String(localEnd.month).padStart(2, '0')}`;

    if (nextEmiKey < firstDueKey) {
      throw new AppError('Next EMI date cannot be before first due date / start date', 400, 'INVALID_NEXT_EMI_DATE');
    }
    if (nextEmiKey > endKey) {
      throw new AppError('Next EMI date cannot be after final end date', 400, 'INVALID_NEXT_EMI_DATE');
    }

    const dueDay = validatedData.dueDay || localFirstDue.day;

    // Generate schedule
    const schedule = generateEmiSchedule(firstDueDate, endDate, dueDay, nextEmiDate);

    // Validate consistency if user provided totalInstallments
    if (
      typeof validatedData.totalInstallments === 'number' &&
      validatedData.totalInstallments > 0 &&
      validatedData.totalInstallments !== schedule.length
    ) {
      throw new AppError(
        `Total installments (${validatedData.totalInstallments}) does not match the schedule count (${schedule.length}) between first due date and end date.`,
        400,
        'INSTALLMENT_COUNT_MISMATCH'
      );
    }

    const effectiveAccountId =
      validatedData.paymentMethod !== PaymentMethod.CREDIT_CARD &&
      validatedData.paymentMethod !== PaymentMethod.CASH &&
      validatedData.accountId
        ? new mongoose.Types.ObjectId(validatedData.accountId)
        : undefined;

    const effectiveCreditCardId =
      validatedData.paymentMethod === PaymentMethod.CREDIT_CARD && validatedData.creditCardId
        ? new mongoose.Types.ObjectId(validatedData.creditCardId)
        : undefined;

    // Down Payment Handling (Phase 2 Requirement)
    const downPaymentAmount = validatedData.downPaymentAmount || 0;
    const downPaymentAlreadyPaid = validatedData.downPaymentAlreadyPaid === true;
    let downPaymentStatus: 'paid' | 'paid_historical' | 'not_paid' = 'not_paid';
    const downPaymentDate = validatedData.downPaymentDate
      ? parseDateInput(validatedData.downPaymentDate)
      : (downPaymentAmount > 0 ? startDate : undefined);

    const downPaymentAccountId =
      validatedData.downPaymentPaymentMethod !== PaymentMethod.CREDIT_CARD &&
      validatedData.downPaymentPaymentMethod !== PaymentMethod.CASH &&
      validatedData.downPaymentAccountId
        ? new mongoose.Types.ObjectId(validatedData.downPaymentAccountId)
        : (downPaymentAmount > 0 && !validatedData.downPaymentCreditCardId ? effectiveAccountId : undefined);

    const downPaymentCreditCardId =
      validatedData.downPaymentPaymentMethod === PaymentMethod.CREDIT_CARD && validatedData.downPaymentCreditCardId
        ? new mongoose.Types.ObjectId(validatedData.downPaymentCreditCardId)
        : (downPaymentAmount > 0 && validatedData.downPaymentCreditCardId
            ? new mongoose.Types.ObjectId(validatedData.downPaymentCreditCardId)
            : undefined);

    const downPaymentPaymentMethod =
      validatedData.downPaymentPaymentMethod ||
      (downPaymentCreditCardId
        ? PaymentMethod.CREDIT_CARD
        : (downPaymentAccountId ? PaymentMethod.BANK_TRANSFER : validatedData.paymentMethod));

    if (downPaymentAmount > 0) {
      if (downPaymentAlreadyPaid) {
        downPaymentStatus = 'paid_historical';
      } else {
        downPaymentStatus = 'paid';
      }
    }

    const emi = await EmiRule.create({
      userId,
      name: validatedData.name,
      lender: validatedData.lender,
      monthlyAmount: validatedData.monthlyAmount,
      startDate,
      firstDueDate,
      nextEmiDate,
      dueDay,
      endDate,
      totalInstallments: schedule.length,
      originalLoanAmount: validatedData.originalLoanAmount,
      outstandingPrincipal: validatedData.outstandingPrincipal ?? validatedData.originalLoanAmount,
      loanReference: validatedData.loanReference,
      paymentMethod: validatedData.paymentMethod,
      paymentChannel: validatedData.paymentChannel || PaymentChannel.ONLINE,
      accountId: effectiveAccountId,
      creditCardId: effectiveCreditCardId,
      status: EmiStatus.ACTIVE,
      notes: validatedData.notes,
      downPaymentAmount,
      downPaymentAlreadyPaid,
      downPaymentPaymentMethod: downPaymentAmount > 0 ? downPaymentPaymentMethod : undefined,
      downPaymentAccountId: downPaymentAmount > 0 ? downPaymentAccountId : undefined,
      downPaymentCreditCardId: downPaymentAmount > 0 ? downPaymentCreditCardId : undefined,
      downPaymentDate: downPaymentAmount > 0 ? downPaymentDate : undefined,
      downPaymentStatus,
      downPaymentNotes: validatedData.downPaymentNotes,
    });

    // If down payment is live (not already paid), create linked Transaction and adjust balance
    if (downPaymentAmount > 0 && !downPaymentAlreadyPaid) {
      const dpTx = await Transaction.create({
        userId,
        title: `EMI Down Payment — ${validatedData.name}`,
        type: TransactionType.EXPENSE,
        category: 'EMI',
        amount: downPaymentAmount,
        currency: 'INR',
        date: downPaymentDate || new Date(),
        paymentMethod: downPaymentPaymentMethod,
        paymentChannel: PaymentChannel.ONLINE,
        accountId: downPaymentAccountId,
        creditCardId: downPaymentCreditCardId,
        status: TransactionStatus.COMPLETED,
        notes: validatedData.downPaymentNotes || `Down payment for ${validatedData.name}`,
        metadata: {
          emiId: emi._id,
          isDownPayment: true,
        },
      });

      emi.downPaymentTransactionId = dpTx._id;
      await emi.save();

      if (downPaymentAccountId) {
        await recalculateAccountBalance(downPaymentAccountId, userId);
      } else if (downPaymentCreditCardId) {
        await recalculateCreditCardOutstanding(downPaymentCreditCardId, userId);
      } else if (downPaymentPaymentMethod === PaymentMethod.CASH) {
        await calculatePersonalCashInHand(userId);
      }
    }

    // Map custom historical amounts if provided
    const historicalMap = new Map<string, { actualAmount?: number; notes?: string }>();
    if (validatedData.historicalInstallments) {
      for (const h of validatedData.historicalInstallments) {
        historicalMap.set(h.occurrenceKey, h);
      }
    }

    // Create installment occurrences
    const occurrencesToInsert = schedule.map((item) => {
      const isHistoricalItem = item.isHistorical || historicalMap.has(item.occurrenceKey);
      if (isHistoricalItem) {
        if (validatedData.markHistoricalPaid || historicalMap.has(item.occurrenceKey)) {
          const customH = historicalMap.get(item.occurrenceKey);
          const actualAmount = customH?.actualAmount ?? validatedData.monthlyAmount;
          return {
            userId,
            emiRuleId: emi._id,
            occurrenceKey: item.occurrenceKey,
            installmentNumber: item.installmentNumber,
            dueDate: item.dueDate,
            expectedAmount: validatedData.monthlyAmount,
            actualAmountPaid: actualAmount,
            status: EmiOccurrenceStatus.PAID_HISTORICAL,
            isHistorical: true,
            notes: customH?.notes || 'Historical paid installment',
          };
        } else {
          return {
            userId,
            emiRuleId: emi._id,
            occurrenceKey: item.occurrenceKey,
            installmentNumber: item.installmentNumber,
            dueDate: item.dueDate,
            expectedAmount: validatedData.monthlyAmount,
            status: EmiOccurrenceStatus.DUE,
            isHistorical: true,
          };
        }
      } else {
        return {
          userId,
          emiRuleId: emi._id,
          occurrenceKey: item.occurrenceKey,
          installmentNumber: item.installmentNumber,
          dueDate: item.dueDate,
          expectedAmount: validatedData.monthlyAmount,
          status: EmiOccurrenceStatus.DUE,
          isHistorical: false,
        };
      }
    });

    await EmiOccurrence.insertMany(occurrencesToInsert);

    // Reconcile historical installment transactions (creates past-recorded expense transactions)
    await reconcileHistoricalEmiTransactions(emi._id, userId);

    // If all installments were marked historically paid, complete the EMI and clear nextEmiDate
    const remainingUnpaidCount = occurrencesToInsert.filter(
      (o) => o.status !== EmiOccurrenceStatus.PAID && o.status !== EmiOccurrenceStatus.PAID_HISTORICAL
    ).length;

    if (remainingUnpaidCount === 0) {
      emi.status = EmiStatus.COMPLETED;
      emi.nextEmiDate = undefined;
      await emi.save();
    }

    res.status(201).json({
      success: true,
      data: emi,
      message: `EMI schedule "${emi.name}" created with ${schedule.length} monthly installments.`,
    });
  } catch (err) {
    next(err);
  }
};

export const updateHistoricalInstallment = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id, occurrenceKey } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid EMI rule ID', 400, 'INVALID_ID');
    }

    const validatedData = updateHistoricalInstallmentSchema.parse(req.body);
    const userId = new mongoose.Types.ObjectId(req.user!._id);

    const emi = await EmiRule.findOne({ _id: id, userId });
    if (!emi) {
      throw new AppError('EMI schedule not found', 404, 'NOT_FOUND');
    }

    const occ = await EmiOccurrence.findOne({
      emiRuleId: id,
      occurrenceKey,
      userId,
    });

    if (!occ) {
      throw new AppError(`Installment occurrence ${occurrenceKey} not found`, 404, 'NOT_FOUND');
    }

    if (occ.status !== EmiOccurrenceStatus.PAID_HISTORICAL) {
      throw new AppError('Only historically paid installments can be edited using this endpoint', 400, 'INVALID_STATUS');
    }

    occ.actualAmountPaid = validatedData.actualAmount;
    if (validatedData.notes !== undefined) {
      occ.notes = validatedData.notes;
    }
    await occ.save();

    // Reconcile corresponding past-recorded expense transaction
    await reconcileHistoricalEmiTransactions(emi._id, userId);

    res.status(200).json({
      success: true,
      data: occ,
      message: `Historical installment ${occurrenceKey} updated successfully`,
    });
  } catch (err) {
    next(err);
  }
};

export const payEmi = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid EMI rule ID', 400, 'INVALID_ID');
    }

    const validatedData = payEmiSchema.parse(req.body);
    const userId = new mongoose.Types.ObjectId(req.user!._id);

    const emi = await EmiRule.findOne({ _id: id, userId });
    if (!emi) {
      throw new AppError('EMI schedule not found', 404, 'NOT_FOUND');
    }

    // Resolve target occurrence
    let occurrence: IEmiOccurrence | null = null;
    if (validatedData.occurrenceKey) {
      occurrence = await EmiOccurrence.findOne({
        emiRuleId: emi._id,
        occurrenceKey: validatedData.occurrenceKey,
      });
    } else {
      // Pick earliest unpaid installment
      occurrence = await EmiOccurrence.findOne({
        emiRuleId: emi._id,
        status: { $nin: [EmiOccurrenceStatus.PAID, EmiOccurrenceStatus.PAID_HISTORICAL] },
      }).sort({ installmentNumber: 1 });
    }

    if (!occurrence) {
      throw new AppError('No eligible unpaid EMI installment found to pay', 404, 'OCCURRENCE_NOT_FOUND');
    }

    // Strict duplicate check
    if (
      occurrence.status === EmiOccurrenceStatus.PAID ||
      occurrence.status === EmiOccurrenceStatus.PAID_HISTORICAL ||
      occurrence.transactionId
    ) {
      throw new AppError(
        `Installment #${occurrence.installmentNumber} (${occurrence.occurrenceKey}) has already been paid.`,
        400,
        'EMI_ALREADY_PAID'
      );
    }

    const existingTx = await Transaction.findOne({
      emiOccurrenceId: occurrence._id,
    });
    if (existingTx) {
      throw new AppError(
        `A transaction for installment #${occurrence.installmentNumber} (${occurrence.occurrenceKey}) already exists.`,
        400,
        'TRANSACTION_ALREADY_EXISTS'
      );
    }

    // Resolve payment method and accounts
    const effectivePaymentMethod = validatedData.paymentMethod || emi.paymentMethod;
    let effectiveAccountId: mongoose.Types.ObjectId | undefined = undefined;
    let effectiveCreditCardId: mongoose.Types.ObjectId | undefined = undefined;
    let effectivePaymentChannel = validatedData.paymentChannel || emi.paymentChannel;

    if (effectivePaymentMethod === PaymentMethod.CREDIT_CARD) {
      const cardId = validatedData.creditCardId || (emi.creditCardId ? emi.creditCardId.toString() : undefined);
      if (!cardId) {
        throw new AppError('Credit card is required when paying with Credit Card', 400, 'CREDIT_CARD_REQUIRED');
      }
      effectiveCreditCardId = new mongoose.Types.ObjectId(cardId);
      effectivePaymentChannel = PaymentChannel.ONLINE;
    } else if (effectivePaymentMethod === PaymentMethod.CASH) {
      effectivePaymentChannel = PaymentChannel.OFFLINE;
    } else {
      const accId = validatedData.accountId || (emi.accountId ? emi.accountId.toString() : undefined);
      if (!accId) {
        throw new AppError('Bank account is required when paying with Bank Account', 400, 'ACCOUNT_REQUIRED');
      }
      effectiveAccountId = new mongoose.Types.ObjectId(accId);
      if (effectivePaymentMethod === PaymentMethod.UPI) {
        effectivePaymentChannel = PaymentChannel.ONLINE;
      }
    }

    // Determine actual amount and discount
    const expectedAmount = occurrence.expectedAmount;
    const finalAmount = validatedData.actualAmount > 0 ? validatedData.actualAmount : expectedAmount;
    const calculatedDiscount =
      typeof validatedData.discountAmount === 'number' && validatedData.discountAmount >= 0
        ? validatedData.discountAmount
        : expectedAmount > finalAmount
        ? safeSubtract(expectedAmount, finalAmount)
        : 0;

    const combinedNotes = [
      `EMI Payment #${occurrence.installmentNumber} (${occurrence.occurrenceKey}): ${emi.name} - ${emi.lender}`.trim(),
      validatedData.notes ? `Notes: ${validatedData.notes}` : null,
      validatedData.discountNotes ? `Offer/Discount: ${validatedData.discountNotes}` : null,
      calculatedDiscount > 0 ? `(Scheduled: ₹${expectedAmount}, Discount: ₹${calculatedDiscount})` : null,
    ]
      .filter(Boolean)
      .join(' | ');

    const txDate = validatedData.date ? parseDateInput(validatedData.date) : occurrence.dueDate;

    // 1. Create Transaction
    const tx = await Transaction.create({
      userId,
      title: `EMI: ${emi.name} (${emi.lender})`,
      amount: finalAmount,
      originalAmount: expectedAmount,
      discountAmount: calculatedDiscount,
      discountType: validatedData.discountType || (calculatedDiscount > 0 ? 'custom' : 'none'),
      discountNotes: validatedData.discountNotes || undefined,
      type: TransactionType.EXPENSE,
      category: 'EMI',
      paymentMethod: effectivePaymentMethod,
      paymentChannel: effectivePaymentChannel,
      accountId: effectiveAccountId,
      creditCardId: effectiveCreditCardId,
      emiRuleId: emi._id,
      emiOccurrenceId: occurrence._id,
      occurrenceKey: occurrence.occurrenceKey,
      date: txDate,
      status: TransactionStatus.COMPLETED,
      notes: combinedNotes,
    });

    // 2. Mark occurrence as PAID
    occurrence.status = EmiOccurrenceStatus.PAID;
    occurrence.actualAmountPaid = finalAmount;
    occurrence.paymentMethod = effectivePaymentMethod;
    occurrence.paymentChannel = effectivePaymentChannel;
    occurrence.accountId = effectiveAccountId;
    occurrence.creditCardId = effectiveCreditCardId;
    occurrence.transactionId = tx._id;
    occurrence.paidAt = txDate;
    occurrence.discountAmount = calculatedDiscount;
    occurrence.discountType = validatedData.discountType;
    occurrence.discountNotes = validatedData.discountNotes;
    if (validatedData.notes) occurrence.notes = validatedData.notes;
    await occurrence.save();

    // 3. Recalculate balances
    if (effectiveAccountId) {
      await recalculateAccountBalance(effectiveAccountId, userId);
    }
    if (effectiveCreditCardId) {
      await recalculateCreditCardOutstanding(effectiveCreditCardId, userId);
    }
    if (effectivePaymentMethod === PaymentMethod.CASH) {
      await calculatePersonalCashInHand(userId);
    }

    // 4. Check EMI completion (Section 8 & 15)
    // Only mark completed if all installments through end date are PAID or PAID_HISTORICAL
    const remainingUnpaidCount = await EmiOccurrence.countDocuments({
      emiRuleId: emi._id,
      status: { $nin: [EmiOccurrenceStatus.PAID, EmiOccurrenceStatus.PAID_HISTORICAL] },
    });

    if (remainingUnpaidCount === 0) {
      emi.status = EmiStatus.COMPLETED;
    } else {
      emi.status = EmiStatus.ACTIVE;
    }

    // Advance nextEmiDate to the next unpaid occurrence's dueDate
    const nextUnpaidOcc = await EmiOccurrence.findOne({
      emiRuleId: emi._id,
      status: { $nin: [EmiOccurrenceStatus.PAID, EmiOccurrenceStatus.PAID_HISTORICAL] },
    }).sort({ installmentNumber: 1 });

    if (nextUnpaidOcc) {
      emi.nextEmiDate = nextUnpaidOcc.dueDate;
    }

    // 5. Update future payment settings if requested
    if (validatedData.updateFuturePaymentSettings) {
      emi.paymentMethod = effectivePaymentMethod;
      emi.paymentChannel = effectivePaymentChannel;
      emi.accountId = effectiveAccountId;
      emi.creditCardId = effectiveCreditCardId;
    }

    await emi.save();

    res.status(200).json({
      success: true,
      data: {
        transaction: tx,
        occurrence,
        emiRule: emi,
      },
      message: `EMI installment #${occurrence.installmentNumber} for ${occurrence.occurrenceKey} paid successfully.`,
    });
  } catch (err) {
    next(err);
  }
};

export const updateEmi = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid EMI rule ID', 400, 'INVALID_ID');
    }

    const validatedData = updateEmiSchema.parse(req.body);
    const userId = new mongoose.Types.ObjectId(req.user!._id);

    const emi = await EmiRule.findOne({ _id: id, userId });
    if (!emi) {
      throw new AppError('EMI schedule not found', 404, 'NOT_FOUND');
    }

    if (validatedData.name !== undefined) emi.name = validatedData.name;
    if (validatedData.lender !== undefined) emi.lender = validatedData.lender;
    if (validatedData.notes !== undefined) emi.notes = validatedData.notes;
    if (validatedData.loanReference !== undefined) emi.loanReference = validatedData.loanReference;
    if (validatedData.originalLoanAmount !== undefined) emi.originalLoanAmount = validatedData.originalLoanAmount;
    if (validatedData.outstandingPrincipal !== undefined) emi.outstandingPrincipal = validatedData.outstandingPrincipal;
    if (validatedData.status !== undefined) emi.status = validatedData.status;

    if (validatedData.paymentMethod !== undefined) emi.paymentMethod = validatedData.paymentMethod;
    if (validatedData.paymentChannel !== undefined) emi.paymentChannel = validatedData.paymentChannel;
    if (validatedData.accountId !== undefined) {
      emi.accountId = validatedData.accountId ? new mongoose.Types.ObjectId(validatedData.accountId) : undefined;
    }
    if (validatedData.creditCardId !== undefined) {
      emi.creditCardId = validatedData.creditCardId ? new mongoose.Types.ObjectId(validatedData.creditCardId) : undefined;
    }

    if (validatedData.nextEmiDate !== undefined) {
      const parsedNext = parseDateInput(validatedData.nextEmiDate);
      emi.nextEmiDate = parsedNext;
    }

    // Changing monthly amount only modifies FUTURE UNPAID occurrences
    if (validatedData.monthlyAmount !== undefined && validatedData.monthlyAmount > 0) {
      emi.monthlyAmount = validatedData.monthlyAmount;
      await EmiOccurrence.updateMany(
        {
          emiRuleId: emi._id,
          status: { $nin: [EmiOccurrenceStatus.PAID, EmiOccurrenceStatus.PAID_HISTORICAL] },
        },
        { $set: { expectedAmount: validatedData.monthlyAmount } }
      );
    }

    // If endDate is updated, adjust future schedule
    if (validatedData.endDate !== undefined) {
      const newEndDate = parseDateInput(validatedData.endDate);
      emi.endDate = newEndDate;

      const schedule = generateEmiSchedule(emi.firstDueDate, newEndDate, emi.dueDay, emi.nextEmiDate);
      emi.totalInstallments = schedule.length;

      // Retain all existing occurrences that match schedule keys
      const existingOccs = await EmiOccurrence.find({ emiRuleId: emi._id });
      const existingKeys = new Set(existingOccs.map((o) => o.occurrenceKey));
      const newKeys = new Set(schedule.map((s) => s.occurrenceKey));

      // Remove future DUE occurrences beyond new end date (never delete PAID or PAID_HISTORICAL)
      const keysToDelete = [...existingKeys].filter((k) => !newKeys.has(k));
      if (keysToDelete.length > 0) {
        await EmiOccurrence.deleteMany({
          emiRuleId: emi._id,
          occurrenceKey: { $in: keysToDelete },
          status: { $nin: [EmiOccurrenceStatus.PAID, EmiOccurrenceStatus.PAID_HISTORICAL] },
        });
      }

      // Add missing future occurrences
      const occsToAdd = schedule
        .filter((s) => !existingKeys.has(s.occurrenceKey))
        .map((s) => ({
          userId,
          emiRuleId: emi._id,
          occurrenceKey: s.occurrenceKey,
          installmentNumber: s.installmentNumber,
          dueDate: s.dueDate,
          expectedAmount: emi.monthlyAmount,
          status: EmiOccurrenceStatus.DUE,
          isHistorical: false,
        }));

      if (occsToAdd.length > 0) {
        await EmiOccurrence.insertMany(occsToAdd);
      }
    }

    await emi.save();

    // Reconcile historical installment transactions in case schedule changed
    await reconcileHistoricalEmiTransactions(emi._id, userId);

    res.status(200).json({
      success: true,
      data: emi,
      message: 'EMI schedule updated successfully',
    });
  } catch (err) {
    next(err);
  }
};

export const deleteEmi = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid EMI rule ID', 400, 'INVALID_ID');
    }

    const userId = new mongoose.Types.ObjectId(req.user!._id);
    const emi = await EmiRule.findOne({ _id: id, userId });
    if (!emi) {
      throw new AppError('EMI schedule not found', 404, 'NOT_FOUND');
    }

    // Permanently delete all EMI-specific schedule occurrences for this rule
    await EmiOccurrence.deleteMany({ emiRuleId: id, userId });

    // Permanently delete the EMI rule agreement
    await EmiRule.deleteOne({ _id: id, userId });

    // Note: Confirmed payment transactions in the Transaction collection remain intact
    // so bank balances and transaction histories are preserved, while removing the agreement
    // and its installment schedules completely from active EMI tracking and upcoming payments.

    res.status(200).json({
      success: true,
      message: 'EMI agreement and scheduled installments deleted successfully. Historical payment transactions have been preserved.',
    });
  } catch (err) {
    next(err);
  }
};

export const backfillHistoricalEmis = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const result = await backfillAllHistoricalEmiExpenses();
    res.status(200).json({
      success: true,
      data: result,
      message: `Historical EMI backfill completed: ${result.totalCreated} transactions created, ${result.totalUpdated} updated.`,
    });
  } catch (err) {
    next(err);
  }
};
