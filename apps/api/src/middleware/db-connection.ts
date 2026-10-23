import { Request, Response, NextFunction } from 'express';
import { isConnected, connectDatabase } from '../config/database';
import { sendError } from '../utils/api-response';

/**
 * Middleware that ensures a live MongoDB connection is active before processing requests.
 * Automatically tries to reconnect on demand if the connection was lost or not yet established.
 * Fails fast with an actionable 503 error if MongoDB Atlas cannot be reached (e.g. IP not whitelisted).
 */
export const dbConnectionMiddleware = async (
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // If already connected to MongoDB, proceed immediately
  if (isConnected()) {
    return next();
  }

  // Attempt to establish or restore the database connection
  const connected = await connectDatabase();
  if (connected && isConnected()) {
    return next();
  }

  // Fail fast with clear guidance instead of buffering or timing out
  sendError(
    res,
    'Database is currently unavailable. MongoDB Atlas rejected the connection — please ensure your current IP address is whitelisted in MongoDB Atlas Network Access.',
    503,
    'DATABASE_UNAVAILABLE'
  );
};
