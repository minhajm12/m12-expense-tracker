import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/async-handler';
import {
  recordPassThroughReceived,
  recordPassThroughSend,
  getPassThroughRecords,
  getPassThroughDetail,
} from '../controllers/pass-through';

export const passThroughRouter = Router();

passThroughRouter.use(authenticate);

passThroughRouter.post('/', asyncHandler(recordPassThroughReceived));
passThroughRouter.post('/:id/send', asyncHandler(recordPassThroughSend));
passThroughRouter.get('/', asyncHandler(getPassThroughRecords));
passThroughRouter.get('/:id', asyncHandler(getPassThroughDetail));
