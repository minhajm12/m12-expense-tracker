import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getReports,
  exportTransactionsCsv,
  getMonthlyIncomeReport,
  getMonthlyExpensesReport,
  getIncomeCategories,
  updateIncomeCategories,
} from '../controllers/reports';

export const reportsRouter = Router();

reportsRouter.use(authenticate);

reportsRouter.get('/', getReports);
reportsRouter.get('/export-csv', exportTransactionsCsv);
reportsRouter.get('/income-summary', getMonthlyIncomeReport);
reportsRouter.get('/monthly-income', getMonthlyIncomeReport);
reportsRouter.get('/expenses-summary', getMonthlyExpensesReport);
reportsRouter.get('/monthly-expenses', getMonthlyExpensesReport);
reportsRouter.get('/income-categories', getIncomeCategories);
reportsRouter.put('/income-categories', updateIncomeCategories);
reportsRouter.patch('/income-categories', updateIncomeCategories);
