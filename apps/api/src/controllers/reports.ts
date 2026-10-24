import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Transaction } from '../models/Transaction';
import {
  getFinancialReport,
  generateTransactionsCsv,
  getMonthlyIncomeSummary,
  getMonthlyExpensesSummary,
  getAvailableIncomeCategories,
  updateConfiguredIncomeCategories,
} from '../services/reports';
import { TransactionStatus, TransactionType, getStartOfDay, getEndOfDay } from '@finora/shared';
import { getCycleKey } from './recurring';

export const getReports = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user!._id);
    const { startDate, endDate, accountId, category, paymentMethod, includeForecast } = req.query;

    const start = startDate
      ? getStartOfDay(startDate as string)
      : getStartOfDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const end = endDate ? getEndOfDay(endDate as string) : getEndOfDay(new Date());

    const reportData = await getFinancialReport(userId, start, end, {
      accountId: accountId ? (accountId as string) : undefined,
      category: category ? (category as string) : undefined,
      paymentMethod: paymentMethod ? (paymentMethod as string) : undefined,
      includeForecast: includeForecast === 'true',
    });

    res.status(200).json({
      success: true,
      data: reportData,
    });
  } catch (err) {
    next(err);
  }
};

export const exportTransactionsCsv = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user!._id);

    const { startDate, endDate, type, category, accountId, paymentMethod } = req.query;

    const query: Record<string, any> = {
      userId,
      status: TransactionStatus.COMPLETED,
      // Strictly exclude CHIT_SEPARATION and TRANSFER by default
      type: type || { $nin: [TransactionType.CHIT_SEPARATION, TransactionType.TRANSFER] },
    };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = getStartOfDay(startDate as string);
      if (endDate) query.date.$lte = getEndOfDay(endDate as string);
    }

    if (category) query.category = category;
    if (paymentMethod) query.paymentMethod = paymentMethod;
    if (accountId && mongoose.Types.ObjectId.isValid(accountId as string)) {
      query.$or = [
        { accountId: new mongoose.Types.ObjectId(accountId as string) },
        { destinationAccountId: new mongoose.Types.ObjectId(accountId as string) },
      ];
    }

    const transactions = await Transaction.find(query).sort({ date: -1 });
    const csvContent = generateTransactionsCsv(transactions);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="m12-expense-tracker-transactions-export.csv"');
    res.status(200).send(csvContent);
  } catch (err) {
    next(err);
  }
};

export const getMonthlyIncomeReport = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user!._id);
    const targetMonth =
      typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
        ? req.query.month
        : getCycleKey(new Date(), 'Asia/Kolkata');

    const data = await getMonthlyIncomeSummary(userId, targetMonth);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

export const getMonthlyExpensesReport = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user!._id);
    const targetMonth =
      typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
        ? req.query.month
        : getCycleKey(new Date(), 'Asia/Kolkata');

    const data = await getMonthlyExpensesSummary(userId, targetMonth);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

export const getIncomeCategories = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user!._id);
    const data = await getAvailableIncomeCategories(userId);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

export const updateIncomeCategories = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user!._id);
    const categories = Array.isArray(req.body.categories) ? req.body.categories : [];
    const updated = await updateConfiguredIncomeCategories(userId, categories);
    res.status(200).json({ success: true, data: { configuredCategories: updated } });
  } catch (err) {
    next(err);
  }
};
