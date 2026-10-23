import { Router } from 'express';
import {
  listTransactions,
  getTransactionById,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  createTransfer,
} from '../controllers/transaction';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/async-handler';

export const transactionRouter = Router();

transactionRouter.use(authenticate);

transactionRouter.get('/', asyncHandler(listTransactions));
transactionRouter.post('/', asyncHandler(createTransaction));
transactionRouter.post('/transfer', asyncHandler(createTransfer));
transactionRouter.get('/:id', asyncHandler(getTransactionById));
transactionRouter.patch('/:id', asyncHandler(updateTransaction));
transactionRouter.delete('/:id', asyncHandler(deleteTransaction));
