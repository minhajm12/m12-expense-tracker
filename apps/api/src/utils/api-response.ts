import { Response } from 'express';
import { ApiResponse } from '@finora/shared';

export const sendSuccess = <T>(
  res: Response,
  data: T,
  message?: string,
  statusCode: number = 200,
  meta?: ApiResponse['meta']
): Response => {
  const payload: any = {
    success: true,
    data,
    ...(message && { message }),
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };
  // If data object contains a token (e.g. login, verify-otp, register), also expose top-level token
  if (data && typeof data === 'object' && 'token' in (data as Record<string, unknown>)) {
    payload.token = (data as Record<string, unknown>).token;
  }
  return res.status(statusCode).json(payload);
};

export const sendError = (
  res: Response,
  message: string,
  statusCode: number = 400,
  code: string = 'BAD_REQUEST',
  details?: unknown
): Response => {
  const payload: ApiResponse = {
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  };
  return res.status(statusCode).json(payload);
};

export class AppError extends Error {
  public statusCode: number;
  public code: string;
  public details?: unknown;
  public isOperational: boolean;

  constructor(
    message: string,
    statusCode: number = 400,
    code: string = 'APPLICATION_ERROR',
    details?: unknown
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}
