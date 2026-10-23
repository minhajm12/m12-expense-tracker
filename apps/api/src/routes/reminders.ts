import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getReminders } from '../controllers/reminders';

export const remindersRouter = Router();

remindersRouter.use(authenticate);

remindersRouter.get('/', getReminders);
