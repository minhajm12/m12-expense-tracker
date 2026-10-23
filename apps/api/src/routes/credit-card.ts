import { Router } from 'express';
import {
  listCreditCards,
  getCreditCardById,
  createCreditCard,
  updateCreditCard,
  archiveCreditCard,
  recordRepayment,
  recordRefund,
  getCardTransactions,
  generateStatement,
  listStatements,
} from '../controllers/credit-card';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/async-handler';

export const creditCardRouter = Router();

creditCardRouter.use(authenticate);

creditCardRouter.get('/', asyncHandler(listCreditCards));
creditCardRouter.post('/', asyncHandler(createCreditCard));
creditCardRouter.post('/repayment', asyncHandler(recordRepayment));
creditCardRouter.get('/:id', asyncHandler(getCreditCardById));
creditCardRouter.patch('/:id', asyncHandler(updateCreditCard));
creditCardRouter.delete('/:id', asyncHandler(archiveCreditCard));
creditCardRouter.post('/:id/refund', asyncHandler(recordRefund));
creditCardRouter.get('/:id/transactions', asyncHandler(getCardTransactions));
creditCardRouter.post('/:id/statements/generate', asyncHandler(generateStatement));
creditCardRouter.get('/:id/statements', asyncHandler(listStatements));
