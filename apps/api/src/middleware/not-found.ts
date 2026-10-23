import { Request, Response } from 'express';
import { sendError } from '../utils/api-response';

export const notFoundHandler = (req: Request, res: Response): void => {
  sendError(res, `Cannot ${req.method} ${req.originalUrl} - Route not found`, 404, 'NOT_FOUND');
};
