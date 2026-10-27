import { Router } from 'express';
import {
  listTransactions,
  getTransactionById,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  createTransfer,
  getRefundableCandidates,
  getTransactionRefundContext,
  unlinkRefund,
  linkRefund,
} from '../controllers/transaction';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/async-handler';

export const transactionRouter = Router();

transactionRouter.use(authenticate);

transactionRouter.get('/', asyncHandler(listTransactions));
transactionRouter.post('/', asyncHandler(createTransaction));
transactionRouter.post('/transfer', asyncHandler(createTransfer));
transactionRouter.get('/refundable-candidates', asyncHandler(getRefundableCandidates));
transactionRouter.get('/:id', asyncHandler(getTransactionById));
transactionRouter.get('/:id/refund-context', asyncHandler(getTransactionRefundContext));
transactionRouter.post('/:id/unlink-refund', asyncHandler(unlinkRefund));
transactionRouter.post('/:id/link-refund', asyncHandler(linkRefund));
transactionRouter.patch('/:id', asyncHandler(updateTransaction));
transactionRouter.delete('/:id', asyncHandler(deleteTransaction));
