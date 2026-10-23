import { Request, Response } from 'express';
import crypto from 'crypto';
import { User } from '../models/User';
import { BankAccount } from '../models/BankAccount';
import { CreditCard } from '../models/CreditCard';
import { sendVerificationOtpEmail, sendPasswordResetOtpEmail } from '../services/email';
import { sendSuccess, sendError, AppError } from '../utils/api-response';
import { signToken, sendAuthCookie, clearAuthCookie } from '../utils/token';
import {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  updateProfileSchema,
} from '@finora/shared';
import { env } from '../config/env';

export const register = async (req: Request, res: Response): Promise<void> => {
  const validatedData = registerSchema.parse(req.body);
  const normalizedEmail = validatedData.email.toLowerCase().trim();

  // Determine whether OTP verification is enforced (true in production or when onboarding requested)
  const requireVerification =
    req.body.requireVerification !== undefined
      ? Boolean(req.body.requireVerification)
      : (env.NODE_ENV === 'production' || req.body.onboarding === true);

  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    if (existingUser.isEmailVerified) {
      throw new AppError('An account with this email address already exists', 409, 'EMAIL_EXISTS');
    }

    // Existing unverified account: update credentials and resend verification OTP safely
    existingUser.fullName = validatedData.fullName;
    existingUser.password = validatedData.password;
    existingUser.currency = validatedData.currency || 'INR';

    const rawOtp = crypto.randomInt(100000, 1000000).toString();
    existingUser.emailVerificationOtpHash = crypto.createHash('sha256').update(rawOtp).digest('hex');
    existingUser.emailVerificationOtpExpires = new Date(Date.now() + 10 * 60 * 1000);
    existingUser.emailVerificationAttempts = 0;
    existingUser.emailVerificationLastSentAt = new Date();
    await existingUser.save();

    const emailRes = await sendVerificationOtpEmail(normalizedEmail, rawOtp, existingUser.fullName);
    if (!emailRes.success && env.NODE_ENV === 'production') {
      throw new AppError(emailRes.error || 'Failed to dispatch verification email', 500, 'EMAIL_SEND_FAILED');
    }

    if (requireVerification) {
      sendSuccess(
        res,
        { email: normalizedEmail, requiresVerification: true },
        'Registration initiated. Verification OTP sent to your email.',
        201
      );
      return;
    }

    // Non-verification mode fallback
    existingUser.isEmailVerified = true;
    existingUser.isOnboardingCompleted = true;
    await existingUser.save();
    const token = signToken({
      userId: existingUser._id.toString(),
      role: existingUser.role,
      tokenVersion: existingUser.tokenVersion,
    });
    sendAuthCookie(res, token);
    sendSuccess(res, { user: existingUser.toJSON(), token }, 'Registration successful', 201);
    return;
  }

  // Generate cryptographically secure 6-digit numeric OTP
  const rawOtp = crypto.randomInt(100000, 1000000).toString();
  const otpHash = crypto.createHash('sha256').update(rawOtp).digest('hex');
  const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

  const user = await User.create({
    email: normalizedEmail,
    password: validatedData.password,
    fullName: validatedData.fullName,
    currency: validatedData.currency,
    isEmailVerified: !requireVerification,
    isOnboardingCompleted: !requireVerification,
    emailVerificationOtpHash: otpHash,
    emailVerificationOtpExpires: otpExpires,
    emailVerificationAttempts: 0,
    emailVerificationLastSentAt: new Date(),
  });

  const emailRes = await sendVerificationOtpEmail(normalizedEmail, rawOtp, user.fullName);
  if (!emailRes.success && env.NODE_ENV === 'production') {
    throw new AppError(emailRes.error || 'Failed to dispatch verification email', 500, 'EMAIL_SEND_FAILED');
  }

  if (requireVerification) {
    sendSuccess(
      res,
      { email: normalizedEmail, requiresVerification: true },
      'Registration initiated. Verification OTP sent to your email.',
      201
    );
    return;
  }

  const token = signToken({
    userId: user._id.toString(),
    role: user.role,
    tokenVersion: user.tokenVersion,
  });

  sendAuthCookie(res, token);
  sendSuccess(res, { user: user.toJSON(), token }, 'Registration successful', 201);
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = loginSchema.parse(req.body);

  const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    sendError(res, 'Invalid email or password', 401, 'INVALID_CREDENTIALS');
    return;
  }

  if (!user.isActive) {
    sendError(
      res,
      'Your account has been deactivated. Please contact support.',
      403,
      'ACCOUNT_DEACTIVATED'
    );
    return;
  }

  if (user.isEmailVerified === false) {
    sendError(
      res,
      'Your email address has not been verified. Please verify your email to log in.',
      403,
      'EMAIL_NOT_VERIFIED',
      { email: user.email, requiresVerification: true }
    );
    return;
  }

  const token = signToken({
    userId: user._id.toString(),
    role: user.role,
    tokenVersion: user.tokenVersion,
  });

  sendAuthCookie(res, token);
  sendSuccess(res, { user: user.toJSON(), token }, 'Login successful', 200);
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  if (req.user) {
    // Increment tokenVersion in database to revoke current and previous session tokens
    req.user.tokenVersion += 1;
    await req.user.save();
  }

  clearAuthCookie(res);
  sendSuccess(res, null, 'Logged out successfully', 200);
};

export const verifyEmailOtp = async (req: Request, res: Response): Promise<void> => {
  const { email, otp } = req.body;
  if (!email || !otp || typeof email !== 'string' || typeof otp !== 'string') {
    sendError(res, 'Valid email and 6-digit OTP code are required', 400, 'MISSING_FIELDS');
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();
  const trimmedOtp = otp.trim();

  const user = await User.findOne({ email: normalizedEmail }).select(
    '+emailVerificationOtpHash +emailVerificationOtpExpires +emailVerificationAttempts'
  );

  if (!user) {
    sendError(res, 'Invalid verification code or email address', 400, 'INVALID_OTP');
    return;
  }

  if (user.isEmailVerified) {
    const token = signToken({
      userId: user._id.toString(),
      role: user.role,
      tokenVersion: user.tokenVersion,
    });
    sendAuthCookie(res, token);
    sendSuccess(res, { user: user.toJSON(), token, isEmailVerified: true }, 'Email is already verified');
    return;
  }

  if (user.emailVerificationOtpExpires && user.emailVerificationOtpExpires < new Date()) {
    sendError(res, 'Verification code has expired. Please request a new code.', 400, 'OTP_EXPIRED');
    return;
  }

  if (user.emailVerificationAttempts && user.emailVerificationAttempts >= 5) {
    sendError(
      res,
      'Too many incorrect attempts. Please request a new verification code.',
      400,
      'TOO_MANY_ATTEMPTS'
    );
    return;
  }

  const candidateHash = crypto.createHash('sha256').update(trimmedOtp).digest('hex');
  if (candidateHash !== user.emailVerificationOtpHash) {
    user.emailVerificationAttempts = (user.emailVerificationAttempts || 0) + 1;
    await user.save();
    sendError(res, 'Invalid verification code. Please check and try again.', 400, 'INVALID_OTP');
    return;
  }

  user.isEmailVerified = true;
  user.emailVerificationOtpHash = undefined;
  user.emailVerificationOtpExpires = undefined;
  user.emailVerificationAttempts = 0;
  await user.save();

  const token = signToken({
    userId: user._id.toString(),
    role: user.role,
    tokenVersion: user.tokenVersion,
  });

  sendAuthCookie(res, token);
  sendSuccess(res, { user: user.toJSON(), token, isEmailVerified: true }, 'Email verified successfully');
};

export const resendEmailOtp = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    sendError(res, 'Email address is required', 400, 'INVALID_EMAIL');
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail }).select(
    '+emailVerificationLastSentAt +emailVerificationOtpHash +emailVerificationOtpExpires'
  );

  if (!user) {
    sendSuccess(res, null, 'If an unverified account exists, a new code has been sent.');
    return;
  }

  if (user.isEmailVerified) {
    sendError(res, 'This email address is already verified. Please proceed to login.', 400, 'ALREADY_VERIFIED');
    return;
  }

  if (user.emailVerificationLastSentAt) {
    const elapsedMs = Date.now() - user.emailVerificationLastSentAt.getTime();
    if (elapsedMs < 60000) {
      const waitSeconds = Math.ceil((60000 - elapsedMs) / 1000);
      sendError(
        res,
        `Please wait ${waitSeconds} second${waitSeconds === 1 ? '' : 's'} before requesting a new code.`,
        429,
        'RESEND_COOLDOWN',
        { retryAfterSeconds: waitSeconds }
      );
      return;
    }
  }

  const rawOtp = crypto.randomInt(100000, 1000000).toString();
  user.emailVerificationOtpHash = crypto.createHash('sha256').update(rawOtp).digest('hex');
  user.emailVerificationOtpExpires = new Date(Date.now() + 10 * 60 * 1000);
  user.emailVerificationAttempts = 0;
  user.emailVerificationLastSentAt = new Date();
  await user.save();

  const emailRes = await sendVerificationOtpEmail(normalizedEmail, rawOtp, user.fullName);
  if (!emailRes.success && env.NODE_ENV === 'production') {
    sendError(res, 'Failed to dispatch verification email. Please try again.', 500, 'EMAIL_SEND_FAILED');
    return;
  }

  sendSuccess(res, null, 'A fresh verification code has been sent to your email.');
};

export const finishOnboarding = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    sendError(res, 'Authentication required to finish onboarding', 401, 'UNAUTHORIZED');
    return;
  }

  const userId = req.user._id;
  const { modulePreferences, bankAccounts, creditCards } = req.body || {};

  // 1. Save module preferences
  if (modulePreferences && typeof modulePreferences === 'object') {
    req.user.modulePreferences = {
      expenseTracker: modulePreferences.expenseTracker !== false,
      emi: modulePreferences.emi !== false,
      lendingBorrowing: modulePreferences.lendingBorrowing !== false,
      budget: modulePreferences.budget !== false,
      recurringTransactions: modulePreferences.recurringTransactions !== false,
      creditCards: modulePreferences.creditCards !== false,
      chitFund: modulePreferences.chitFund !== false,
      investment: modulePreferences.investment !== false,
    };
  }

  // 2. Create bank accounts if provided
  if (Array.isArray(bankAccounts) && bankAccounts.length > 0) {
    for (const acc of bankAccounts) {
      if (!acc.accountName || !acc.bankName) continue;
      const exists = await BankAccount.findOne({ userId, accountName: acc.accountName.trim() });
      if (!exists) {
        await BankAccount.create({
          userId,
          accountName: acc.accountName.trim(),
          bankName: acc.bankName.trim(),
          accountType: acc.accountType || 'savings',
          openingBalance: Number(acc.openingBalance) || 0,
          currentBalance: Number(acc.openingBalance) || 0,
          openingBalanceDate: acc.openingBalanceDate ? new Date(acc.openingBalanceDate) : new Date(),
          accountNumberMasked: acc.accountNumberMasked,
        });
      }
    }
  }

  // 3. Create credit cards if provided
  if (Array.isArray(creditCards) && creditCards.length > 0) {
    for (const card of creditCards) {
      if (!card.cardNickname || !card.issuingBank) continue;
      const exists = await CreditCard.findOne({ userId, cardNickname: card.cardNickname.trim() });
      if (!exists) {
        const creditLimit = Number(card.creditLimit) || 50000;
        const currentOutstanding = Number(card.currentOutstanding) || 0;
        const availableCredit = Math.max(0, creditLimit - currentOutstanding);
        await CreditCard.create({
          userId,
          cardNickname: card.cardNickname.trim(),
          issuingBank: card.issuingBank.trim(),
          network: card.network || card.cardNetwork || 'visa',
          creditLimit,
          openingOutstanding: currentOutstanding,
          currentOutstanding,
          availableCredit,
          billingCycleClosingDay: Number(card.billingCycleClosingDay) || Number(card.billingCycleDay) || 1,
          paymentDueDay: Number(card.paymentDueDay) || 20,
        });
      }
    }
  }

  // 4. Mark onboarding completed and clear temporary onboarding session
  req.user.isOnboardingCompleted = true;
  await req.user.save();

  clearAuthCookie(res);

  sendSuccess(
    res,
    { onboardingCompleted: true },
    'Setup completed successfully. Please sign in to your account.'
  );
};

export const getMe = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    sendError(res, 'Authentication required', 401, 'UNAUTHORIZED');
    return;
  }
  sendSuccess(res, { user: req.user.toJSON() });
};

export const updateProfile = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    sendError(res, 'Authentication required', 401, 'UNAUTHORIZED');
    return;
  }

  const validated = updateProfileSchema.parse(req.body);

  if (validated.fullName) req.user.fullName = validated.fullName;
  if (validated.currency) req.user.currency = validated.currency;
  if (validated.preferences) {
    req.user.preferences = {
      ...req.user.preferences,
      ...validated.preferences,
    };
  }

  await req.user.save();
  sendSuccess(res, { user: req.user.toJSON() }, 'Profile updated successfully');
};

export const changePassword = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    sendError(res, 'Authentication required', 401, 'UNAUTHORIZED');
    return;
  }

  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

  const isValidCurrent = await req.user.comparePassword(currentPassword);
  if (!isValidCurrent) {
    sendError(res, 'Current password is incorrect', 400, 'INCORRECT_PASSWORD');
    return;
  }

  req.user.password = newPassword;
  req.user.tokenVersion += 1; // Invalidate all existing sessions
  await req.user.save();

  // Issue a fresh token for the current session
  const token = signToken({
    userId: req.user._id.toString(),
    role: req.user.role,
    tokenVersion: req.user.tokenVersion,
  });

  sendAuthCookie(res, token);
  sendSuccess(res, { token }, 'Password changed successfully');
};

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    sendError(res, 'A valid email address is required', 400, 'INVALID_EMAIL');
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail }).select(
    '+passwordResetLastSentAt +passwordResetOtpHash +passwordResetOtpExpires +passwordResetAttempts'
  );

  if (!user) {
    // Avoid user enumeration: return success message even if account does not exist
    sendSuccess(
      res,
      null,
      'If an account exists with that email, password reset instructions and a verification code have been sent.'
    );
    return;
  }

  // Rate limiting / cooldown: 60-second cooldown between sending OTPs
  if (user.passwordResetLastSentAt) {
    const elapsedMs = Date.now() - user.passwordResetLastSentAt.getTime();
    if (elapsedMs < 60000) {
      const waitSeconds = Math.ceil((60000 - elapsedMs) / 1000);
      sendError(
        res,
        `Please wait ${waitSeconds} second${waitSeconds === 1 ? '' : 's'} before requesting a new code.`,
        429,
        'RESEND_COOLDOWN',
        { retryAfterSeconds: waitSeconds }
      );
      return;
    }
  }

  // Generate cryptographically secure 6-digit OTP
  const rawOtp = crypto.randomInt(100000, 1000000).toString();
  const otpHash = crypto.createHash('sha256').update(rawOtp).digest('hex');

  // Also generate 32-byte hex reset token for backward compatibility with token-based reset
  const resetToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');

  user.passwordResetOtpHash = otpHash;
  user.passwordResetOtpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  user.passwordResetAttempts = 0;
  user.passwordResetLastSentAt = new Date();

  user.passwordResetToken = tokenHash;
  user.passwordResetExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await user.save({ validateBeforeSave: false });

  // Send branded email with 6-digit code
  await sendPasswordResetOtpEmail(normalizedEmail, rawOtp, user.fullName);

  // Security requirement: Never expose OTP or reset tokens in API responses.
  // The code must solely be delivered via email.
  sendSuccess(
    res,
    null,
    'If an account exists with that email, password reset instructions and a verification code have been sent.'
  );
};

export const verifyResetOtp = async (req: Request, res: Response): Promise<void> => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    sendError(res, 'Email and 6-digit verification code are required', 400, 'MISSING_FIELDS');
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();
  const trimmedOtp = otp.toString().trim();

  if (!/^\d{6}$/.test(trimmedOtp)) {
    sendError(res, 'Verification code must be exactly 6 digits', 400, 'INVALID_OTP_FORMAT');
    return;
  }

  const user = await User.findOne({ email: normalizedEmail }).select(
    '+passwordResetOtpHash +passwordResetOtpExpires +passwordResetAttempts +passwordResetToken'
  );

  if (!user || !user.passwordResetOtpHash || !user.passwordResetOtpExpires) {
    sendError(res, 'Invalid or expired verification code', 400, 'INVALID_RESET_OTP');
    return;
  }

  if (user.passwordResetOtpExpires.getTime() < Date.now()) {
    sendError(res, 'Verification code has expired. Please request a new code.', 400, 'EXPIRED_RESET_OTP');
    return;
  }

  if (user.passwordResetAttempts && user.passwordResetAttempts >= 5) {
    sendError(
      res,
      'Too many incorrect attempts. Please request a new verification code.',
      400,
      'TOO_MANY_ATTEMPTS'
    );
    return;
  }

  const candidateHash = crypto.createHash('sha256').update(trimmedOtp).digest('hex');
  if (candidateHash !== user.passwordResetOtpHash) {
    user.passwordResetAttempts = (user.passwordResetAttempts || 0) + 1;
    await user.save({ validateBeforeSave: false });
    sendError(res, 'Invalid verification code. Please check and try again.', 400, 'INVALID_OTP');
    return;
  }

  // Code verified! Generate fresh short-lived reset token for setting the new password
  const resetToken = crypto.randomBytes(32).toString('hex');
  user.passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  user.passwordResetExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  await user.save({ validateBeforeSave: false });

  sendSuccess(
    res,
    { resetToken, verified: true },
    'Verification code confirmed. You may now set your new password.'
  );
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  const { token, resetToken, email, otp, newPassword } = req.body;
  const effectivePassword = newPassword;
  const effectiveToken = token || resetToken;

  if (!effectivePassword || typeof effectivePassword !== 'string') {
    sendError(res, 'New password is required', 400, 'MISSING_PASSWORD');
    return;
  }

  // Validate password complexity
  if (
    effectivePassword.length < 8 ||
    !/[A-Z]/.test(effectivePassword) ||
    !/[a-z]/.test(effectivePassword) ||
    !/[0-9]/.test(effectivePassword)
  ) {
    sendError(
      res,
      'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, and one number',
      400,
      'WEAK_PASSWORD'
    );
    return;
  }

  let user: any = null;

  if (effectiveToken) {
    const hashedToken = crypto.createHash('sha256').update(effectiveToken).digest('hex');
    user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: new Date() },
    });
  } else if (email && otp) {
    const normalizedEmail = email.toLowerCase().trim();
    const candidateHash = crypto.createHash('sha256').update(otp.toString().trim()).digest('hex');
    user = await User.findOne({
      email: normalizedEmail,
      passwordResetOtpHash: candidateHash,
      passwordResetOtpExpires: { $gt: new Date() },
    }).select('+passwordResetOtpHash +passwordResetOtpExpires +passwordResetAttempts');

    if (user && user.passwordResetAttempts && user.passwordResetAttempts >= 5) {
      sendError(res, 'Too many incorrect attempts. Please request a new verification code.', 400, 'TOO_MANY_ATTEMPTS');
      return;
    }
  }

  if (!user) {
    sendError(res, 'Password reset token or code is invalid or has expired', 400, 'INVALID_RESET_TOKEN');
    return;
  }

  // Securely update password and invalidate ALL reset tokens / OTPs
  user.password = effectivePassword;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  user.passwordResetOtpHash = undefined;
  user.passwordResetOtpExpires = undefined;
  user.passwordResetAttempts = 0;
  user.tokenVersion += 1; // Invalidate all existing sessions

  await user.save();

  // Clear any active auth cookie
  clearAuthCookie(res);

  sendSuccess(res, null, 'Password reset successfully. Please log in with your new password.');
};

export const deactivateAccount = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    sendError(res, 'Authentication required', 401, 'UNAUTHORIZED');
    return;
  }

  req.user.isActive = false;
  req.user.tokenVersion += 1;
  await req.user.save();

  clearAuthCookie(res);
  sendSuccess(res, null, 'Your account has been deactivated successfully');
};
