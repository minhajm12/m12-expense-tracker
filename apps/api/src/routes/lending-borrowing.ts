import { Router } from 'express';
import {
  getLendingBorrowingSummary,
  listLendingBorrowing,
  getLendingBorrowingById,
  createLendingBorrowing,
  updateLendingBorrowing,
  deleteLendingBorrowing,
  recordRepayment,
  deleteRepayment,
} from '../controllers/lending-borrowing';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/async-handler';

export const lendingBorrowingRouter = Router();

lendingBorrowingRouter.use(authenticate);

lendingBorrowingRouter.get('/summary', asyncHandler(getLendingBorrowingSummary));
lendingBorrowingRouter.get('/', asyncHandler(listLendingBorrowing));
lendingBorrowingRouter.post('/', asyncHandler(createLendingBorrowing));
lendingBorrowingRouter.get('/:id', asyncHandler(getLendingBorrowingById));
lendingBorrowingRouter.patch('/:id', asyncHandler(updateLendingBorrowing));
lendingBorrowingRouter.delete('/:id', asyncHandler(deleteLendingBorrowing));
lendingBorrowingRouter.post('/:id/repayments', asyncHandler(recordRepayment));
lendingBorrowingRouter.delete('/:id/repayments/:repaymentId', asyncHandler(deleteRepayment));
