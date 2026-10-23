import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { Budget } from '../models/Budget';
import { createBudgetSchema, updateBudgetSchema } from '@finora/shared';
import { AppError } from '../utils/api-response';
import {
  getUserBudgetsWithProgress,
  calculateBudgetProgress,
} from '../services/budget';

export const getBudgets = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user!._id);
    const budgets = await getUserBudgetsWithProgress(userId);

    res.status(200).json({
      success: true,
      data: budgets,
    });
  } catch (err) {
    next(err);
  }
};

export const getBudgetById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid budget ID', 400, 'INVALID_ID');
    }

    const userId = new mongoose.Types.ObjectId(req.user!._id);
    const budget = await Budget.findOne({ _id: id, userId });

    if (!budget) {
      throw new AppError('Budget not found', 404, 'NOT_FOUND');
    }


    const budgetWithProgress = await calculateBudgetProgress(budget, userId);

    res.status(200).json({
      success: true,
      data: budgetWithProgress,
    });
  } catch (err) {
    next(err);
  }
};

export const createBudget = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const validatedData = createBudgetSchema.parse(req.body);
    const userId = new mongoose.Types.ObjectId(req.user!._id);

    const budget = await Budget.create({
      userId,
      category: validatedData.category,
      limitAmount: validatedData.limitAmount,
      period: validatedData.period,
      startDate: new Date(validatedData.startDate),
      endDate: new Date(validatedData.endDate),
      alertThresholdPercent: validatedData.alertThresholdPercent,
    });

    const budgetWithProgress = await calculateBudgetProgress(budget, userId);

    res.status(201).json({
      success: true,
      data: budgetWithProgress,
      message: 'Budget created successfully',
    });
  } catch (err) {
    next(err);
  }
};

export const updateBudget = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid budget ID', 400, 'INVALID_ID');
    }

    const validatedData = updateBudgetSchema.parse(req.body);
    const userId = new mongoose.Types.ObjectId(req.user!._id);

    const updateFields: Record<string, any> = {};
    if (validatedData.category !== undefined) updateFields.category = validatedData.category;
    if (validatedData.limitAmount !== undefined) updateFields.limitAmount = validatedData.limitAmount;
    if (validatedData.period !== undefined) updateFields.period = validatedData.period;
    if (validatedData.startDate !== undefined) updateFields.startDate = new Date(validatedData.startDate);
    if (validatedData.endDate !== undefined) updateFields.endDate = new Date(validatedData.endDate);
    if (validatedData.alertThresholdPercent !== undefined) {
      updateFields.alertThresholdPercent = validatedData.alertThresholdPercent;
    }

    const budget = await Budget.findOneAndUpdate(
      { _id: id, userId },
      { $set: updateFields },
      { new: true }
    );

    if (!budget) {
      throw new AppError('Budget not found', 404, 'NOT_FOUND');
    }

    const budgetWithProgress = await calculateBudgetProgress(budget, userId);

    res.status(200).json({
      success: true,
      data: budgetWithProgress,
      message: 'Budget updated successfully',
    });
  } catch (err) {
    next(err);
  }
};

export const deleteBudget = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError('Invalid budget ID', 400, 'INVALID_ID');
    }

    const userId = new mongoose.Types.ObjectId(req.user!._id);
    const budget = await Budget.findOneAndDelete({ _id: id, userId });

    if (!budget) {
      throw new AppError('Budget not found', 404, 'NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      message: 'Budget deleted successfully',
    });
  } catch (err) {
    next(err);
  }
};

