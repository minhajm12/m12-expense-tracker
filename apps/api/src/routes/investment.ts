import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getInvestmentDashboard,
  getInvestments,
  getInvestmentById,
  createInvestment,
  updateInvestment,
  deleteInvestmentController,
  payInvestmentContribution,
  deleteContributionPayment,
  markChitAsWonController,
  correctChitPayoutController,
  resetAllInvestmentsController,
} from '../controllers/investment';

const router = Router();

router.use(authenticate);

// Dashboard & Aggregations
router.get('/dashboard', getInvestmentDashboard);

// List & Create
router.get('/', getInvestments);
router.post('/', createInvestment);

// Reset All Investments
router.post('/reset-all', resetAllInvestmentsController);

// Single Investment Operations
router.get('/:id', getInvestmentById);
router.put('/:id', updateInvestment);
router.delete('/:id', deleteInvestmentController);

// Payment Logging & Deletion
router.post('/:id/pay', payInvestmentContribution);
router.delete('/:id/pay', deleteContributionPayment);

// Winning & Payout Settlement
router.post('/:id/won', markChitAsWonController);
router.put('/:id/payout', correctChitPayoutController);

export default router;
