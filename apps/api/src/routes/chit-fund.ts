import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/async-handler';
import {
  getOrCreateChitFund,
  updateChitFund,
  getChitFundSummary,
  listMembers,
  createMember,
  updateMember,
  deleteMember,
  listCollections,
  recordCollection,
  deleteCollection,
  listPayouts,
  recordPayout,
  updatePayout,
  deletePayout,
  getChitFundLedger,
  recordAdjustment,
  separateExistingMoney,
  listSeparations,
  deleteSeparation,
  getReconciliation,
  listCycles,
  getCycleDetails,
  getSpinPreview,
  getTrialSpinPreview,
  confirmCycleWinner,
  correctCycleWinner,
  resetCycleWinner,
  resetAllWinners,
  getRemainingEligibleMembers,
} from '../controllers/chit-fund';

const router = Router();

router.use(authenticate);

// Fund Operations
router.get('/', asyncHandler(getOrCreateChitFund));
router.patch('/:id', asyncHandler(updateChitFund));
router.get('/:id/summary', asyncHandler(getChitFundSummary));

// Members
router.get('/:id/members', asyncHandler(listMembers));
router.post('/:id/members', asyncHandler(createMember));
router.patch('/:id/members/:memberId', asyncHandler(updateMember));
router.delete('/:id/members/:memberId', asyncHandler(deleteMember));

// Collections
router.get('/:id/collections', asyncHandler(listCollections));
router.post('/:id/collections', asyncHandler(recordCollection));
router.delete('/:id/collections/:collectionId', asyncHandler(deleteCollection));

// Payouts
router.get('/:id/payouts', asyncHandler(listPayouts));
router.post('/:id/payouts', asyncHandler(recordPayout));
router.put('/:id/payouts/:payoutId', asyncHandler(updatePayout));
router.patch('/:id/payouts/:payoutId', asyncHandler(updatePayout));
router.delete('/:id/payouts/:payoutId', asyncHandler(deletePayout));

// Historical Separations (Read-only ledger for historical records)
router.get('/:id/separations', asyncHandler(listSeparations));
router.delete('/:id/separations/:separationId', asyncHandler(deleteSeparation));

// Ledger & Adjustments
router.get('/:id/ledger', asyncHandler(getChitFundLedger));
router.post('/:id/adjustments', asyncHandler(recordAdjustment));

// Reconciliation
router.get('/:id/reconciliation', asyncHandler(getReconciliation));

// Cycles & Winner Management
router.get('/:id/cycles', asyncHandler(listCycles));
router.get('/:id/cycles/:cyclePeriod', asyncHandler(getCycleDetails));
router.get('/:id/cycles/:cyclePeriod/spin-preview', asyncHandler(getSpinPreview));
router.post('/:id/cycles/:cyclePeriod/spin-preview', asyncHandler(getSpinPreview));
router.get('/:id/cycles/:cyclePeriod/trial-spin', asyncHandler(getTrialSpinPreview));
router.post('/:id/cycles/:cyclePeriod/trial-spin', asyncHandler(getTrialSpinPreview));
router.post('/:id/cycles/:cyclePeriod/confirm-winner', asyncHandler(confirmCycleWinner));
router.post('/:id/cycles/:cyclePeriod/correct-winner', asyncHandler(correctCycleWinner));
router.post('/:id/cycles/:cyclePeriod/reset-winner', asyncHandler(resetCycleWinner));
router.post('/:id/reset-all-winners', asyncHandler(resetAllWinners));
router.get('/:id/eligible-members', asyncHandler(getRemainingEligibleMembers));

export default router;
