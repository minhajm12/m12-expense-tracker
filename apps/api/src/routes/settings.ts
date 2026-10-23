import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/async-handler';
import {
  getModulePreferences,
  updateModulePreferences,
  resetTransactions,
  resetAllFinancialData,
  resetChitWinnerMonth,
  resetAllChitWinners,
  getChitFundResetPreview,
  resetChitFundFinancials,
} from '../controllers/settings';

const router = Router();

router.use(authenticate);

router.get('/', asyncHandler(getModulePreferences));
router.patch('/', asyncHandler(updateModulePreferences));
router.put('/', asyncHandler(updateModulePreferences));
router.get('/modules', asyncHandler(getModulePreferences));
router.patch('/modules', asyncHandler(updateModulePreferences));
router.put('/modules', asyncHandler(updateModulePreferences));
router.get('/module-preferences', asyncHandler(getModulePreferences));
router.patch('/module-preferences', asyncHandler(updateModulePreferences));
router.put('/module-preferences', asyncHandler(updateModulePreferences));

// Data Management & Reset
router.post('/reset-transactions', asyncHandler(resetTransactions));
router.post('/reset-all-financial-data', asyncHandler(resetAllFinancialData));
router.post('/reset-chit-winner-month', asyncHandler(resetChitWinnerMonth));
router.post('/reset-all-chit-winners', asyncHandler(resetAllChitWinners));
router.get('/chit-fund-reset-preview', asyncHandler(getChitFundResetPreview));
router.post('/reset-chit-fund-financials', asyncHandler(resetChitFundFinancials));

export default router;
