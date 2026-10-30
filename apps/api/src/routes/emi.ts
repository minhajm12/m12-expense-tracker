import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  listEmis,
  getEmiById,
  getEmiInstallments,
  createEmi,
  updateEmi,
  deleteEmi,
  payEmi,
  updateHistoricalInstallment,
  backfillHistoricalEmis,
} from '../controllers/emi';

export const emiRouter = Router();

emiRouter.use(authenticate);

emiRouter.get('/', listEmis);
emiRouter.post('/', createEmi);
emiRouter.post('/backfill-historical', backfillHistoricalEmis);
emiRouter.get('/:id', getEmiById);
emiRouter.get('/:id/installments', getEmiInstallments);
emiRouter.put('/:id', updateEmi);
emiRouter.delete('/:id', deleteEmi);
emiRouter.post('/:id/pay', payEmi);
emiRouter.put('/:id/installments/:occurrenceKey/historical', updateHistoricalInstallment);
