import jwt from 'jsonwebtoken';
import { Response } from 'express';
import { env } from '../config/env';
import { UserRole } from '@finora/shared';

export interface TokenPayload {
  userId: string;
  role: UserRole;
  tokenVersion: number;
}

export const AUTH_COOKIE_NAME = 'm12_expense_tracker_token';
export const AUTH_TOKEN_KEY = 'm12_expense_tracker_token';
export const LEGACY_AUTH_TOKEN_KEY = 'finora_token';

export const signToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
};

export const verifyToken = (token: string): TokenPayload | null => {
  try {
    return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
};

export const sendAuthCookie = (res: Response, token: string): void => {
  const isProduction = env.NODE_ENV === 'production';
  // 7 days in milliseconds
  const maxAge = 7 * 24 * 60 * 60 * 1000;

  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge,
    path: '/',
  });
};

export const clearAuthCookie = (res: Response): void => {
  const isProduction = env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
    path: '/',
  };
  res.clearCookie(AUTH_COOKIE_NAME, cookieOptions);
  res.clearCookie('finora_token', cookieOptions);
};
