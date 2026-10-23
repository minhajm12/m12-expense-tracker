import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { sendError, AppError } from '../utils/api-response';
import { env } from '../config/env';

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void => {
  // 1. Zod Validation Errors
  if (err instanceof ZodError || (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'ZodError')) {
    const zodErr = err as ZodError;
    const formattedErrors = (zodErr.errors || []).map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
    sendError(res, 'Validation error', 400, 'VALIDATION_ERROR', formattedErrors);
    return;
  }

  // 2. Custom Application Operational Errors
  if (err instanceof AppError) {
    sendError(res, err.message, err.statusCode, err.code, err.details);
    return;
  }

  // 3. Mongoose Cast Error (invalid ObjectId)
  if (err instanceof mongoose.Error.CastError) {
    sendError(res, `Invalid format for resource identifier: ${err.value}`, 400, 'INVALID_ID');
    return;
  }

  // 4. Mongoose Validation Error
  if (err instanceof mongoose.Error.ValidationError) {
    const messages = Object.values(err.errors).map((val) => val.message);
    sendError(res, `Invalid input: ${messages.join(', ')}`, 400, 'DB_VALIDATION_ERROR');
    return;
  }

  // 5. MongoDB Duplicate Key Error (E11000)
  if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 11000) {
    const keyVal = (err as { keyValue?: Record<string, unknown> }).keyValue || {};
    const keys = Object.keys(keyVal);
    const specificField = keys.find((k) => k !== 'userId') || keys[0] || 'field';
    const message = specificField === 'idempotencyKey'
      ? 'A transaction with this idempotency key has already been recorded'
      : `A record with this ${specificField} already exists`;
    sendError(res, message, 409, 'DUPLICATE_KEY_ERROR');
    return;
  }

  // 6. JSON Parse Error in body
  if (err instanceof SyntaxError && 'status' in err && err.status === 400 && 'body' in err) {
    sendError(res, 'Malformed JSON in request body', 400, 'INVALID_JSON');
    return;
  }

  // 7. MongoDB / Mongoose Connection or Buffer Timeout Errors
  if (
    (err instanceof mongoose.Error && (err.name === 'MongooseError' || err.message.includes('buffering timed out') || err.message.includes('Client must be connected'))) ||
    (typeof err === 'object' && err !== null && 'name' in err && (err as { name: string }).name === 'MongoServerSelectionError')
  ) {
    sendError(
      res,
      'Database connection unavailable: Unable to reach MongoDB Atlas. Please ensure your current IP address is whitelisted in MongoDB Atlas Network Access.',
      503,
      'DATABASE_UNAVAILABLE'
    );
    return;
  }

  // 8. Unhandled Internal Server Errors
  const errorMessage = err instanceof Error ? err.message : 'An unexpected internal error occurred';
  console.error('🔥 [Unhandled Server Error]:', err);

  sendError(
    res,
    env.NODE_ENV === 'production' ? 'An internal server error occurred' : errorMessage,
    500,
    'INTERNAL_SERVER_ERROR',
    env.NODE_ENV === 'development' && err instanceof Error ? { stack: err.stack } : undefined
  );
};
