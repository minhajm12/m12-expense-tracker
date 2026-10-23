import { Router } from 'express';
import { getDashboardData, getUpcomingMonthlyForecast } from '../controllers/analytics';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/async-handler';

export const analyticsRouter = Router();

analyticsRouter.use(authenticate);

analyticsRouter.get('/dashboard', asyncHandler(getDashboardData));
analyticsRouter.get('/upcoming-forecast', asyncHandler(getUpcomingMonthlyForecast));
