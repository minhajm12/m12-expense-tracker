import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getBudgets,
  getBudgetById,
  createBudget,
  updateBudget,
  deleteBudget,
} from '../controllers/budget';

export const budgetRouter = Router();

budgetRouter.use(authenticate);

budgetRouter.get('/', getBudgets);
budgetRouter.post('/', createBudget);
budgetRouter.get('/:id', getBudgetById);
budgetRouter.put('/:id', updateBudget);
budgetRouter.delete('/:id', deleteBudget);
