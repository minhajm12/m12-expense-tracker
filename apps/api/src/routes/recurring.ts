import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getRecurringRules,
  getRecurringRuleById,
  createRecurringRule,
  updateRecurringRule,
  deleteRecurringRule,
  executeRecurringRule,
  skipRecurringOccurrence,
  completeRecurringRule,
  cancelRecurringRule,
} from '../controllers/recurring';

export const recurringRouter = Router();

recurringRouter.use(authenticate);

recurringRouter.get('/', getRecurringRules);
recurringRouter.post('/', createRecurringRule);
recurringRouter.get('/:id', getRecurringRuleById);
recurringRouter.put('/:id', updateRecurringRule);
recurringRouter.delete('/:id', deleteRecurringRule);
recurringRouter.post('/:id/execute', executeRecurringRule);
recurringRouter.post('/:id/skip', skipRecurringOccurrence);
recurringRouter.post('/:id/complete', completeRecurringRule);
recurringRouter.post('/:id/cancel', cancelRecurringRule);
