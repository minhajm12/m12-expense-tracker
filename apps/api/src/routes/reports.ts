import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getReports,
  exportTransactionsCsv,
  getMonthlyIncomeReport,
  getIncomeCategories,
  updateIncomeCategories,
} from '../controllers/reports';

export const reportsRouter = Router();

reportsRouter.use(authenticate);

reportsRouter.get('/', getReports);
reportsRouter.get('/export-csv', exportTransactionsCsv);
reportsRouter.get('/income-summary', getMonthlyIncomeReport);
reportsRouter.get('/income-categories', getIncomeCategories);
reportsRouter.put('/income-categories', updateIncomeCategories);
reportsRouter.patch('/income-categories', updateIncomeCategories);
