import { Router } from 'express';
import {
  listAccounts,
  getAccountById,
  createAccount,
  updateAccount,
  archiveAccount,
  getAccountTransactions,
  triggerRecalculateBalance,
  getTotalCash,
  updateCashInHand,
  getCashInHand,
  adjustPersonalCashInHand,
} from '../controllers/account';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/async-handler';

export const accountRouter = Router();

accountRouter.use(authenticate);

accountRouter.get('/', asyncHandler(listAccounts));
accountRouter.post('/', asyncHandler(createAccount));
accountRouter.get('/total-cash', asyncHandler(getTotalCash));
accountRouter.get('/cash-in-hand', asyncHandler(getCashInHand));
accountRouter.put('/cash-in-hand', asyncHandler(updateCashInHand));
accountRouter.post('/cash-in-hand/adjust', asyncHandler(adjustPersonalCashInHand));
accountRouter.get('/:id', asyncHandler(getAccountById));
accountRouter.patch('/:id', asyncHandler(updateAccount));
accountRouter.delete('/:id', asyncHandler(archiveAccount));
accountRouter.get('/:id/transactions', asyncHandler(getAccountTransactions));
accountRouter.post('/:id/recalculate', asyncHandler(triggerRecalculateBalance));

