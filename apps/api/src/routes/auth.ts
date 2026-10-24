import { Router } from 'express';
import {
  register,
  login,
  logout,
  getMe,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  verifyResetOtp,
  deactivateAccount,
  verifyEmailOtp,
  resendEmailOtp,
  finishOnboarding,
} from '../controllers/auth';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/async-handler';
import { authRateLimiter } from '../middleware/rate-limiter';
import { deleteAccountPermanently } from '../controllers/settings';

export const authRouter = Router();

// Public Authentication & OTP Routes (protected with brute-force rate limiter)
authRouter.post('/register', authRateLimiter, asyncHandler(register));
authRouter.post('/login', authRateLimiter, asyncHandler(login));
authRouter.post('/verify-otp', authRateLimiter, asyncHandler(verifyEmailOtp));
authRouter.post('/resend-otp', authRateLimiter, asyncHandler(resendEmailOtp));
authRouter.post('/forgot-password', authRateLimiter, asyncHandler(forgotPassword));
authRouter.post('/verify-reset-otp', authRateLimiter, asyncHandler(verifyResetOtp));
authRouter.post('/reset-password', authRateLimiter, asyncHandler(resetPassword));


// Authenticated Routes
authRouter.post('/logout', authenticate, asyncHandler(logout));
authRouter.get('/me', authenticate, asyncHandler(getMe));
authRouter.patch('/me', authenticate, asyncHandler(updateProfile));
authRouter.post('/change-password', authenticate, asyncHandler(changePassword));
authRouter.post('/deactivate', authenticate, asyncHandler(deactivateAccount));
authRouter.delete('/delete-account', authenticate, asyncHandler(deleteAccountPermanently));
authRouter.delete('/me', authenticate, asyncHandler(deleteAccountPermanently));
authRouter.post('/onboarding-finish', authenticate, asyncHandler(finishOnboarding));

