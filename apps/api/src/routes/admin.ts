import { Router } from 'express';
import {
  getBootstrapStatus,
  bootstrapFirstAdmin,
  listUsers,
  updateUserStatus,
  updateUserRole,
  listAuditLogs,
} from '../controllers/admin';
import { authenticate, optionalAuthenticate, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/async-handler';
import { UserRole } from '@finora/shared';

export const adminRouter = Router();

// Secure one-time bootstrap
adminRouter.get('/bootstrap-status', asyncHandler(getBootstrapStatus));
adminRouter.post('/bootstrap', optionalAuthenticate, asyncHandler(bootstrapFirstAdmin));

// Admin-only user management routes
adminRouter.get(
  '/users',
  authenticate,
  requireRole(UserRole.ADMIN),
  asyncHandler(listUsers)
);

adminRouter.patch(
  '/users/:id/status',
  authenticate,
  requireRole(UserRole.ADMIN),
  asyncHandler(updateUserStatus)
);

adminRouter.patch(
  '/users/:id/role',
  authenticate,
  requireRole(UserRole.ADMIN),
  asyncHandler(updateUserRole)
);

adminRouter.get(
  '/audit-logs',
  authenticate,
  requireRole(UserRole.ADMIN),
  asyncHandler(listAuditLogs)
);

