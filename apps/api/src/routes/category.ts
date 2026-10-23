import { Router } from 'express';
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../controllers/category';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/async-handler';

export const categoryRouter = Router();

categoryRouter.use(authenticate);

categoryRouter.get('/', asyncHandler(listCategories));
categoryRouter.post('/', asyncHandler(createCategory));
categoryRouter.patch('/:id', asyncHandler(updateCategory));
categoryRouter.delete('/:id', asyncHandler(deleteCategory));
