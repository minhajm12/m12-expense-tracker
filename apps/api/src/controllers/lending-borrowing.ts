import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { LendingBorrowing, ILendingBorrowing } from '../models/LendingBorrowing';
import { BankAccount } from '../models/BankAccount';
import {
  createLendingBorrowingSchema,
  updateLendingBorrowingSchema,
  createLendingRepaymentSchema,
  LendingBorrowingType,
  LendingBorrowingStatus,
  safeAdd,
  safeSubtract,
  parseDateInput,
} from '@finora/shared';
import { sendSuccess, sendError, AppError } from '../utils/api-response';
import { recalculateAccountBalance, calculateCashInHand } from '../services/financial';

const populateBankAccountNames = async (
  userId: mongoose.Types.ObjectId,
  records: any[]
): Promise<any[]> => {
  const accounts = await BankAccount.find({ userId });
  const map = new Map<string, string>();
  accounts.forEach((a) => {
    map.set(a._id.toString(), `${a.accountName} (${a.bankName})`);
  });

  return records.map((record) => {
    const r = typeof record.toJSON === 'function' ? record.toJSON() : { ...record };
    if (r.bankAccountId) {
      r.bankAccountName = map.get(r.bankAccountId.toString()) || 'Unknown Account';
    }
    if (Array.isArray(r.repayments)) {
      r.repayments = r.repayments.map((rep: any) => {
        const repObj = { ...rep };
        if (repObj.bankAccountId) {
          repObj.bankAccountName = map.get(repObj.bankAccountId.toString()) || 'Unknown Account';
        }
        return repObj;
      });
    }
    return r;
  });
};

export const getLendingBorrowingSummary = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;

  const records = await LendingBorrowing.find({ userId });

  let totalLent = 0;
  let lentReceivedBack = 0;
  let outstandingLending = 0;

  let totalBorrowed = 0;
  let borrowedRepaid = 0;
  let outstandingBorrowing = 0;

  let activeRecordsCount = 0;
  let settledRecordsCount = 0;

  for (const r of records) {
    if (r.type === LendingBorrowingType.LENDING) {
      totalLent = safeAdd(totalLent, r.amount);
      lentReceivedBack = safeAdd(lentReceivedBack, r.settledAmount);
      outstandingLending = safeAdd(outstandingLending, r.outstandingAmount);
    } else if (r.type === LendingBorrowingType.BORROWING) {
      totalBorrowed = safeAdd(totalBorrowed, r.amount);
      borrowedRepaid = safeAdd(borrowedRepaid, r.settledAmount);
      outstandingBorrowing = safeAdd(outstandingBorrowing, r.outstandingAmount);
    }

    if (r.status === LendingBorrowingStatus.SETTLED) {
      settledRecordsCount++;
    } else {
      activeRecordsCount++;
    }
  }

  sendSuccess(res, {
    totalLent,
    lentReceivedBack,
    outstandingLending,
    totalBorrowed,
    borrowedRepaid,
    outstandingBorrowing,
    activeRecordsCount,
    settledRecordsCount,
  });
};

export const listLendingBorrowing = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { type, status, search, startDate, endDate, sortBy = 'date', sortOrder = 'desc', page, limit } = req.query;

  const filter: any = { userId };

  if (type && (type === 'lending' || type === 'borrowing')) {
    filter.type = type;
  }

  if (status) {
    if (status === 'active') {
      filter.status = { $in: [LendingBorrowingStatus.OUTSTANDING, LendingBorrowingStatus.PARTIALLY_SETTLED] };
    } else if (['outstanding', 'partially_settled', 'settled'].includes(status as string)) {
      filter.status = status;
    }
  }

  if (search && typeof search === 'string' && search.trim()) {
    const searchRegex = new RegExp(search.trim(), 'i');
    filter.$or = [
      { personName: searchRegex },
      { description: searchRegex },
      { notes: searchRegex },
    ];
  }

  if (startDate || endDate) {
    filter.date = {};
    if (startDate) {
      filter.date.$gte = parseDateInput(startDate as string);
    }
    if (endDate) {
      filter.date.$lte = parseDateInput(endDate as string);
    }
  }

  const sortDirection = sortOrder === 'asc' ? 1 : -1;
  const sortObj: any = {};
  if (sortBy === 'amount') {
    sortObj.amount = sortDirection;
  } else if (sortBy === 'outstandingAmount') {
    sortObj.outstandingAmount = sortDirection;
  } else if (sortBy === 'personName') {
    sortObj.personName = sortDirection;
  } else {
    sortObj.date = sortDirection;
  }

  let recordsQuery = LendingBorrowing.find(filter).sort(sortObj);

  const total = await LendingBorrowing.countDocuments(filter);

  let pageNum = page ? parseInt(page as string, 10) : undefined;
  let limitNum = limit ? parseInt(limit as string, 10) : undefined;

  if (pageNum && limitNum) {
    recordsQuery = recordsQuery.skip((pageNum - 1) * limitNum).limit(limitNum);
  }

  const records = await recordsQuery;
  const populated = await populateBankAccountNames(userId, records);

  sendSuccess(res, populated, undefined, 200, {
    timestamp: new Date().toISOString(),
    total,
    page: pageNum || 1,
    limit: limitNum || total,
    totalPages: limitNum ? Math.ceil(total / limitNum) : 1,
  });
};

export const getLendingBorrowingById = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;

  const record = await LendingBorrowing.findOne({ _id: id, userId });
  if (!record) {
    sendError(res, 'Record not found', 404, 'RECORD_NOT_FOUND');
    return;
  }

  const [populated] = await populateBankAccountNames(userId, [record]);
  sendSuccess(res, populated);
};

export const createLendingBorrowing = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const validated = createLendingBorrowingSchema.parse(req.body);

  if (validated.paymentMethod === 'upi' && validated.bankAccountId) {
    const acc = await BankAccount.findOne({ _id: validated.bankAccountId, userId, isArchived: false });
    if (!acc) {
      sendError(res, 'Bank account not found or archived', 400, 'BANK_ACCOUNT_NOT_FOUND');
      return;
    }
  }

  const isHistorical = Boolean(validated.isHistorical || validated.accountingMode === 'historical');
  const initialSettledAmount = validated.initialSettledAmount && validated.initialSettledAmount > 0
    ? validated.initialSettledAmount
    : 0;

  if (initialSettledAmount > validated.amount) {
    sendError(res, 'Already repaid amount cannot exceed principal amount', 400, 'SETTLED_EXCEEDS_AMOUNT');
    return;
  }

  const repayments = [];
  if (initialSettledAmount > 0) {
    repayments.push({
      _id: new mongoose.Types.ObjectId(),
      amount: initialSettledAmount,
      date: parseDateInput(validated.date),
      paymentMethod: validated.paymentMethod || 'cash',
      notes: 'Already repaid prior to tracking',
      isHistorical: true,
      createdAt: new Date(),
    });
  }

  const settledAmount = initialSettledAmount;
  const outstandingAmount = safeSubtract(validated.amount, settledAmount);
  let status = LendingBorrowingStatus.OUTSTANDING;
  if (outstandingAmount <= 0) {
    status = LendingBorrowingStatus.SETTLED;
  } else if (settledAmount > 0) {
    status = LendingBorrowingStatus.PARTIALLY_SETTLED;
  }

  const record = await LendingBorrowing.create({
    userId,
    type: validated.type,
    personName: validated.personName,
    phoneNumber: validated.phoneNumber,
    amount: validated.amount,
    date: parseDateInput(validated.date),
    dueDate: validated.dueDate ? parseDateInput(validated.dueDate) : undefined,
    paymentMethod: validated.paymentMethod,
    bankAccountId: validated.bankAccountId ? new mongoose.Types.ObjectId(validated.bankAccountId) : undefined,
    description: validated.description,
    notes: validated.notes,
    isHistorical,
    accountingMode: isHistorical ? 'historical' : 'live',
    status,
    settledAmount,
    outstandingAmount,
    repayments,
  });

  // Balance recalculation: ONLY IF NOT HISTORICAL
  if (!isHistorical) {
    if (record.paymentMethod === 'upi' && record.bankAccountId) {
      await recalculateAccountBalance(record.bankAccountId, userId);
    } else if (record.paymentMethod === 'cash') {
      await calculateCashInHand(userId);
    }
  }

  const [populated] = await populateBankAccountNames(userId, [record]);
  sendSuccess(res, populated, 'Record created successfully', 201);
};

export const updateLendingBorrowing = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;
  const validated = updateLendingBorrowingSchema.parse(req.body);

  const record = await LendingBorrowing.findOne({ _id: id, userId });
  if (!record) {
    sendError(res, 'Record not found', 404, 'RECORD_NOT_FOUND');
    return;
  }

  const oldBankAccountId = record.bankAccountId;
  const oldPaymentMethod = record.paymentMethod;
  const oldIsHistorical = Boolean(record.isHistorical);

  if (validated.personName !== undefined) record.personName = validated.personName;
  if (validated.phoneNumber !== undefined) record.phoneNumber = validated.phoneNumber;
  if (validated.description !== undefined) record.description = validated.description;
  if (validated.notes !== undefined) record.notes = validated.notes;
  if (validated.date !== undefined) record.date = parseDateInput(validated.date);
  if (validated.dueDate !== undefined) record.dueDate = validated.dueDate ? parseDateInput(validated.dueDate) : undefined;
  if (validated.type !== undefined) record.type = validated.type;

  if (validated.paymentMethod !== undefined) {
    record.paymentMethod = validated.paymentMethod;
    if (validated.paymentMethod === 'cash') {
      record.bankAccountId = undefined;
    }
  }
  if (validated.bankAccountId !== undefined) {
    record.bankAccountId = validated.bankAccountId ? new mongoose.Types.ObjectId(validated.bankAccountId) : undefined;
  }

  if (validated.isHistorical !== undefined) {
    record.isHistorical = validated.isHistorical;
    record.accountingMode = validated.isHistorical ? 'historical' : 'live';
  }

  if (validated.amount !== undefined) {
    if (validated.amount < record.settledAmount) {
      sendError(
        res,
        `Principal amount cannot be less than settled amount (${record.settledAmount})`,
        400,
        'AMOUNT_LESS_THAN_SETTLED'
      );
      return;
    }
    record.amount = validated.amount;
    record.outstandingAmount = safeSubtract(record.amount, record.settledAmount);
    if (record.outstandingAmount <= 0) {
      record.outstandingAmount = 0;
      record.status = LendingBorrowingStatus.SETTLED;
    } else if (record.settledAmount > 0) {
      record.status = LendingBorrowingStatus.PARTIALLY_SETTLED;
    } else {
      record.status = LendingBorrowingStatus.OUTSTANDING;
    }
  }

  await record.save();

  // Recalculate balances atomically for affected bank accounts and cash in hand
  const accountsToRecalc = new Set<string>();
  if (oldBankAccountId) {
    accountsToRecalc.add(oldBankAccountId.toString());
  }
  if (record.bankAccountId) {
    accountsToRecalc.add(record.bankAccountId.toString());
  }
  for (const accId of accountsToRecalc) {
    await recalculateAccountBalance(accId, userId);
  }

  if (
    oldPaymentMethod === 'cash' ||
    record.paymentMethod === 'cash' ||
    oldIsHistorical !== Boolean(record.isHistorical)
  ) {
    await calculateCashInHand(userId);
  }

  const [populated] = await populateBankAccountNames(userId, [record]);
  sendSuccess(res, populated, 'Record updated successfully');
};

export const deleteLendingBorrowing = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;

  const record = await LendingBorrowing.findOne({ _id: id, userId });
  if (!record) {
    sendError(res, 'Record not found', 404, 'RECORD_NOT_FOUND');
    return;
  }

  const affectedBankAccounts = new Set<string>();
  let cashAffected = false;

  if (!record.isHistorical) {
    if (record.paymentMethod === 'upi' && record.bankAccountId) {
      affectedBankAccounts.add(record.bankAccountId.toString());
    }
    if (record.paymentMethod === 'cash') {
      cashAffected = true;
    }
  }

  if (Array.isArray(record.repayments)) {
    for (const rep of record.repayments) {
      if (!rep.isHistorical) {
        if (rep.paymentMethod === 'upi' && rep.bankAccountId) {
          affectedBankAccounts.add(rep.bankAccountId.toString());
        }
        if (rep.paymentMethod === 'cash') {
          cashAffected = true;
        }
      }
    }
  }

  await record.deleteOne();

  for (const accId of affectedBankAccounts) {
    await recalculateAccountBalance(accId, userId);
  }

  if (cashAffected) {
    await calculateCashInHand(userId);
  }

  sendSuccess(res, { id }, 'Record deleted successfully');
};

export const recordRepayment = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;
  const validated = createLendingRepaymentSchema.parse(req.body);

  const record = await LendingBorrowing.findOne({ _id: id, userId });
  if (!record) {
    sendError(res, 'Record not found', 404, 'RECORD_NOT_FOUND');
    return;
  }

  if (record.status === LendingBorrowingStatus.SETTLED || record.outstandingAmount <= 0) {
    sendError(res, 'This record is already fully settled', 400, 'ALREADY_SETTLED');
    return;
  }

  if (validated.amount > record.outstandingAmount) {
    sendError(
      res,
      `Repayment amount (₹${validated.amount.toLocaleString()}) cannot exceed outstanding amount (₹${record.outstandingAmount.toLocaleString()})`,
      400,
      'EXCEEDS_OUTSTANDING'
    );
    return;
  }

  if (validated.paymentMethod === 'upi' && validated.bankAccountId) {
    const acc = await BankAccount.findOne({ _id: validated.bankAccountId, userId, isArchived: false });
    if (!acc) {
      sendError(res, 'Bank account not found or archived', 400, 'BANK_ACCOUNT_NOT_FOUND');
      return;
    }
  }

  const isHistorical = Boolean(validated.isHistorical);

  const newRepayment = {
    _id: new mongoose.Types.ObjectId(),
    amount: validated.amount,
    date: parseDateInput(validated.date),
    paymentMethod: validated.paymentMethod,
    bankAccountId: validated.bankAccountId ? new mongoose.Types.ObjectId(validated.bankAccountId) : undefined,
    notes: validated.notes,
    isHistorical,
    createdAt: new Date(),
  };

  record.repayments.push(newRepayment as any);
  record.settledAmount = safeAdd(record.settledAmount, validated.amount);
  record.outstandingAmount = safeSubtract(record.amount, record.settledAmount);

  if (record.outstandingAmount <= 0.001) {
    record.outstandingAmount = 0;
    record.status = LendingBorrowingStatus.SETTLED;
  } else {
    record.status = LendingBorrowingStatus.PARTIALLY_SETTLED;
  }

  await record.save();

  // Recalculate balances: ONLY IF REPAYMENT IS NOT HISTORICAL
  if (!isHistorical) {
    if (validated.paymentMethod === 'upi' && validated.bankAccountId) {
      await recalculateAccountBalance(validated.bankAccountId, userId);
    } else if (validated.paymentMethod === 'cash') {
      await calculateCashInHand(userId);
    }
  }

  const [populated] = await populateBankAccountNames(userId, [record]);
  sendSuccess(res, populated, 'Repayment recorded successfully');
};

export const deleteRepayment = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id, repaymentId } = req.params;

  const record = await LendingBorrowing.findOne({ _id: id, userId });
  if (!record) {
    sendError(res, 'Record not found', 404, 'RECORD_NOT_FOUND');
    return;
  }

  const repaymentIndex = record.repayments.findIndex((r: any) => r._id.toString() === repaymentId);
  if (repaymentIndex === -1) {
    sendError(res, 'Repayment not found', 404, 'REPAYMENT_NOT_FOUND');
    return;
  }

  const removedRepayment = record.repayments[repaymentIndex];
  record.repayments.splice(repaymentIndex, 1);

  // Recompute settled amount and outstanding from remaining repayments
  const newSettledAmount = record.repayments.reduce((sum: number, r: any) => safeAdd(sum, r.amount), 0);
  record.settledAmount = newSettledAmount;
  record.outstandingAmount = safeSubtract(record.amount, newSettledAmount);

  if (record.settledAmount === 0) {
    record.status = LendingBorrowingStatus.OUTSTANDING;
  } else if (record.outstandingAmount <= 0.001) {
    record.outstandingAmount = 0;
    record.status = LendingBorrowingStatus.SETTLED;
  } else {
    record.status = LendingBorrowingStatus.PARTIALLY_SETTLED;
  }

  await record.save();

  if (!removedRepayment.isHistorical) {
    if (removedRepayment.paymentMethod === 'upi' && removedRepayment.bankAccountId) {
      await recalculateAccountBalance(removedRepayment.bankAccountId, userId);
    } else if (removedRepayment.paymentMethod === 'cash') {
      await calculateCashInHand(userId);
    }
  }

  const [populated] = await populateBankAccountNames(userId, [record]);
  sendSuccess(res, populated, 'Repayment deleted successfully');
};
