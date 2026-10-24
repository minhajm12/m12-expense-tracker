import { Request, Response, NextFunction } from 'express';
import { verifyToken, AUTH_COOKIE_NAME } from '../utils/token';
import { User, IUser } from '../models/User';
import { sendError } from '../utils/api-response';
import { UserRole } from '@finora/shared';

// Extend Express Request interface to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: IUser;
    }
  }
}

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // 1. Extract token from Authorization header or HTTP-only cookie
    let token: string | undefined;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.slice(7).trim();
    } else if (req.cookies?.[AUTH_COOKIE_NAME]) {
      token = req.cookies[AUTH_COOKIE_NAME];
    } else if (req.cookies?.['finora_token']) {
      token = req.cookies['finora_token'];
    }

    if (!token) {
      sendError(res, 'Authentication required. Please log in.', 401, 'UNAUTHORIZED');
      return;
    }

    // 2. Cryptographically verify token
    const decoded = verifyToken(token);
    if (!decoded) {
      sendError(res, 'Invalid or expired session. Please log in again.', 401, 'INVALID_TOKEN');
      return;
    }

    // 3. Retrieve user from database
    const user = await User.findById(decoded.userId).select('+password');
    if (!user) {
      sendError(res, 'User associated with this session no longer exists.', 401, 'USER_NOT_FOUND');
      return;
    }

    // 4. Check if account is active
    if (!user.isActive) {
      sendError(
        res,
        'Your account has been deactivated. Please contact support.',
        403,
        'ACCOUNT_DEACTIVATED'
      );
      return;
    }

    // 5. Check if session has been revoked (e.g. password changed or logged out)
    if (user.tokenVersion !== decoded.tokenVersion) {
      sendError(
        res,
        'Session has expired or was revoked. Please log in again.',
        401,
        'SESSION_REVOKED'
      );
      return;
    }

    // 6. Attach authenticated user to request
    req.user = user;
    next();
  } catch (err: unknown) {
    next(err);
  }
};

export const optionalAuthenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    let token: string | undefined;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.slice(7).trim();
    } else if (req.cookies?.[AUTH_COOKIE_NAME]) {
      token = req.cookies[AUTH_COOKIE_NAME];
    } else if (req.cookies?.['finora_token']) {
      token = req.cookies['finora_token'];
    }

    if (token) {
      const decoded = verifyToken(token);
      if (decoded) {
        const user = await User.findById(decoded.userId).select('+password');
        if (user && user.isActive && user.tokenVersion === decoded.tokenVersion) {
          req.user = user;
        }
      }
    }
  } catch {
    // Continue even if unauthenticated
  }
  next();
};

export const requireRole = (...allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, 'Authentication required', 401, 'UNAUTHORIZED');
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      sendError(
        res,
        'Access denied: You do not possess the required permissions.',
        403,
        'FORBIDDEN'
      );
      return;
    }

    next();
  };
};
