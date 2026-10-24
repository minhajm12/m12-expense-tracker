import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { PassThroughMoney } from '../models/PassThroughMoney';
import { BankAccount } from '../models/BankAccount';
import {
  recordPassThroughReceivedSchema,
  recordPassThroughSendSchema,
  safeAdd,
  safeSubtract,
  getStartOfDay,
  getEndOfDay,
} from '@finora/shared';
import { sendSuccess, sendError, AppError } from '../utils/api-response';
import { recalculateAccountBalance } from '../services/financial';

/**
 * Record Pass-Through Money received into a bank account.
 * Adjusts bank account balance without creating ordinary income or expense transactions.
 */
export const recordPassThroughReceived = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const validated = recordPassThroughReceivedSchema.parse(req.body);

  const bankAccount = await BankAccount.findOne({
    _id: validated.receivingBankAccountId,
    userId,
    isArchived: false,
  });

  if (!bankAccount) {
    throw new AppError('Receiving bank account not found or archived', 404, 'ACCOUNT_NOT_FOUND');
  }

  const record = await PassThroughMoney.create({
    userId,
    senderName: validated.senderName.trim(),
    receivedAmount: validated.receivedAmount,
    receivedDate: new Date(validated.receivedDate),
    receivingBankAccountId: bankAccount._id,
    reference: validated.reference?.trim() || undefined,
    notes: validated.notes?.trim() || undefined,
    totalSentAmount: 0,
    outstandingAmount: validated.receivedAmount,
    status: 'pending',
    sends: [],
  });

  // Recompute bank balance authoritatively
  const updatedBalance = await recalculateAccountBalance(bankAccount._id, userId);

  sendSuccess(
    res,
    {
      record: {
        ...record.toJSON(),
        receivingBankAccountName: bankAccount.accountName,
      },
      updatedBankBalance: updatedBalance,
    },
    'Pass-through money received recorded successfully',
    201
  );
};

/**
 * Record Pass-Through Money sent from a bank account to an intended recipient.
 * Adjusts bank account balance without creating ordinary income or expense transactions.
 */
export const recordPassThroughSend = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;
  const validated = recordPassThroughSendSchema.parse(req.body);

  const record = await PassThroughMoney.findOne({ _id: id, userId });
  if (!record) {
    throw new AppError('Pass-through record not found', 404, 'RECORD_NOT_FOUND');
  }

  if (record.status === 'completed' || record.outstandingAmount <= 0) {
    throw new AppError(
      'This pass-through record has already been completely fulfilled.',
      400,
      'RECORD_ALREADY_COMPLETED'
    );
  }

  if (validated.amount > record.outstandingAmount) {
    throw new AppError(
      `Amount sent (₹${validated.amount.toLocaleString()}) cannot exceed outstanding amount (₹${record.outstandingAmount.toLocaleString()}).`,
      400,
      'AMOUNT_EXCEEDS_OUTSTANDING'
    );
  }

  const bankAccount = await BankAccount.findOne({
    _id: validated.bankAccountId,
    userId,
    isArchived: false,
  });

  if (!bankAccount) {
    throw new AppError('Sending bank account not found or archived', 404, 'ACCOUNT_NOT_FOUND');
  }

  const sendEntry = {
    _id: new mongoose.Types.ObjectId(),
    recipientName: validated.recipientName.trim(),
    amount: validated.amount,
    date: new Date(validated.date),
    bankAccountId: bankAccount._id,
    reference: validated.reference?.trim() || undefined,
    notes: validated.notes?.trim() || undefined,
    createdAt: new Date(),
  };

  record.sends.push(sendEntry as any);
  record.totalSentAmount = safeAdd(record.totalSentAmount, validated.amount);
  record.outstandingAmount = Math.max(0, safeSubtract(record.receivedAmount, record.totalSentAmount));

  if (record.outstandingAmount <= 0) {
    record.status = 'completed';
  } else {
    record.status = 'partially_sent';
  }

  await record.save();

  // Recompute bank balance authoritatively
  const updatedBalance = await recalculateAccountBalance(bankAccount._id, userId);

  sendSuccess(
    res,
    {
      record: {
        ...record.toJSON(),
      },
      updatedBankBalance: updatedBalance,
    },
    'Pass-through money transfer recorded successfully'
  );
};

/**
 * Get all Pass-Through Money records with filters, pagination, and summary overview.
 */
export const getPassThroughRecords = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { status, search, month, page = '1', limit = '20' } = req.query;

  const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit as string, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const query: any = { userId };

  if (status && status !== 'all') {
    query.status = status;
  }

  if (month && typeof month === 'string' && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split('-').map(Number);
    const start = getStartOfDay(new Date(Date.UTC(y, m - 1, 1, 12, 0, 0)), 'Asia/Kolkata');
    const end = getEndOfDay(new Date(Date.UTC(y, m, 0, 12, 0, 0)), 'Asia/Kolkata');
    query.receivedDate = { $gte: start, $lte: end };
  }

  if (search && typeof search === 'string' && search.trim()) {
    const term = search.trim();
    query.$or = [
      { senderName: { $regex: term, $options: 'i' } },
      { 'sends.recipientName': { $regex: term, $options: 'i' } },
      { reference: { $regex: term, $options: 'i' } },
      { notes: { $regex: term, $options: 'i' } },
    ];
  }

  const [allUserRecords, filteredRecords, totalFiltered] = await Promise.all([
    PassThroughMoney.find({ userId }),
    PassThroughMoney.find(query).sort({ receivedDate: -1, createdAt: -1 }).skip(skip).limit(limitNum),
    PassThroughMoney.countDocuments(query),
  ]);

  // Overall statistics across all records
  let totalReceived = 0;
  let totalSent = 0;
  let totalOutstanding = 0;
  let openCount = 0;
  let completedCount = 0;

  for (const r of allUserRecords) {
    totalReceived = safeAdd(totalReceived, r.receivedAmount);
    totalSent = safeAdd(totalSent, r.totalSentAmount);
    totalOutstanding = safeAdd(totalOutstanding, r.outstandingAmount);
    if (r.status === 'completed') {
      completedCount += 1;
    } else {
      openCount += 1;
    }
  }

  // Map bank account names
  const bankAccounts = await BankAccount.find({ userId });
  const bankMap = new Map(bankAccounts.map((a) => [a._id.toString(), a.accountName]));

  const enrichedRecords = filteredRecords.map((r) => {
    const obj: any = r.toJSON();
    obj.receivingBankAccountName = bankMap.get(r.receivingBankAccountId.toString()) || 'Unknown Account';
    if (Array.isArray(obj.sends)) {
      obj.sends = obj.sends.map((s: any) => ({
        ...s,
        bankAccountName: bankMap.get(s.bankAccountId?.toString()) || 'Unknown Account',
      }));
    }
    return obj;
  });

  sendSuccess(res, {
    overview: {
      totalReceived,
      totalSent,
      totalOutstanding,
      openCount,
      completedCount,
    },
    records: enrichedRecords,
    total: totalFiltered,
    page: pageNum,
    totalPages: Math.ceil(totalFiltered / limitNum) || 1,
  });
};

/**
 * Get single Pass-Through Money record details.
 */
export const getPassThroughDetail = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;

  const record = await PassThroughMoney.findOne({ _id: id, userId });
  if (!record) {
    throw new AppError('Pass-through record not found', 404, 'RECORD_NOT_FOUND');
  }

  const bankAccounts = await BankAccount.find({ userId });
  const bankMap = new Map(bankAccounts.map((a) => [a._id.toString(), a.accountName]));

  const obj: any = record.toJSON();
  obj.receivingBankAccountName = bankMap.get(record.receivingBankAccountId.toString()) || 'Unknown Account';
  if (Array.isArray(obj.sends)) {
    obj.sends = obj.sends.map((s: any) => ({
      ...s,
      bankAccountName: bankMap.get(s.bankAccountId?.toString()) || 'Unknown Account',
    }));
  }

  sendSuccess(res, { record: obj });
};
