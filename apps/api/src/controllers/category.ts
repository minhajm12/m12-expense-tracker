import { Request, Response } from 'express';
import { Category, seedDefaultCategories } from '../models/Category';
import { sendSuccess, sendError } from '../utils/api-response';

export const listCategories = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { type } = req.query;

  // Ensure default categories exist
  await seedDefaultCategories();

  const filter: Record<string, unknown> = {
    $or: [{ userId: null }, { userId }],
  };

  if (type === 'income' || type === 'expense' || type === 'investment') {
    filter.type = type;
  }

  const categories = await Category.find(filter).sort({ isCustom: 1, name: 1 });
  sendSuccess(res, categories.map((c) => c.toJSON()));
};

export const createCategory = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { name, type, icon, color, subcategories } = req.body;

  if (!name || !type || !['income', 'expense', 'investment'].includes(type)) {
    sendError(res, 'Valid name and type (income, expense, or investment) are required', 400, 'INVALID_INPUT');
    return;
  }

  // Check if name already exists for this user
  const existing = await Category.findOne({
    name: name.trim(),
    type,
    $or: [{ userId: null }, { userId }],
  });

  if (existing) {
    sendError(res, 'A category with this name already exists', 409, 'CATEGORY_EXISTS');
    return;
  }

  const category = await Category.create({
    userId,
    name: name.trim(),
    type,
    icon: icon || 'Folder',
    color: color || '#10b981',
    subcategories: Array.isArray(subcategories) ? subcategories : [],
    isCustom: true,
  });

  sendSuccess(res, category.toJSON(), 'Category created successfully', 201);
};

export const updateCategory = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;
  const { name, icon, color, subcategories } = req.body;

  const category = await Category.findOne({ _id: id, userId });
  if (!category) {
    sendError(res, 'Category not found or cannot modify system default category', 404, 'CATEGORY_NOT_FOUND');
    return;
  }

  if (name) category.name = name.trim();
  if (icon) category.icon = icon;
  if (color) category.color = color;
  if (Array.isArray(subcategories)) category.subcategories = subcategories;

  await category.save();
  sendSuccess(res, category.toJSON(), 'Category updated successfully');
};

export const deleteCategory = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!._id;
  const { id } = req.params;

  const category = await Category.findOne({ _id: id, userId });
  if (!category) {
    sendError(res, 'Category not found or cannot delete system default category', 404, 'CATEGORY_NOT_FOUND');
    return;
  }

  await Category.deleteOne({ _id: category._id });
  sendSuccess(res, null, 'Category deleted successfully');
};
