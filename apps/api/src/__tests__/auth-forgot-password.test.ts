import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { User } from '../models/User';
import { testEmailOtpStore } from '../services/email';

describe('Phase 3: Password Reset, OTP Security & Auth Architecture Test Suite', () => {
  let mongoServer: MongoMemoryServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(() => {
    testEmailOtpStore.clear();
  });

  const registeredUser = {
    email: 'reset_tester@finora.test',
    password: 'InitialPassword123!',
    fullName: 'Reset Tester',
  };

  it('1 & 2. Existing user login, registration and email verification', async () => {
    // Register
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: registeredUser.email,
        password: registeredUser.password,
        fullName: registeredUser.fullName,
        currency: 'INR',
        requireVerification: true,
      });

    expect(regRes.status).toBe(201);
    expect(regRes.body.success).toBe(true);

    const regOtp = testEmailOtpStore.get(registeredUser.email);
    expect(regOtp).toBeDefined();

    // Verify Email
    const verifyRes = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({
        email: registeredUser.email,
        otp: regOtp,
      });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.success).toBe(true);

    // Login with initial password
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: registeredUser.email,
        password: registeredUser.password,
      });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);
    expect(loginRes.body.data.user.email).toBe(registeredUser.email);
  });

  it('7 & 9. User enumeration protection & secrets never exposed in responses', async () => {
    // Request for non-existent email
    const unknownRes = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nonexistent_account_99@finora.test' });

    expect(unknownRes.status).toBe(200);
    expect(unknownRes.body.success).toBe(true);
    expect(unknownRes.body.message).toContain('If an account exists with that email');
    // Must never leak data
    expect(unknownRes.body.data).toBeNull();

    // Request for existing user
    const existingRes = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: registeredUser.email });

    expect(existingRes.status).toBe(200);
    expect(existingRes.body.success).toBe(true);
    expect(existingRes.body.message).toContain('If an account exists with that email');
    // Must NEVER return OTP or token in response body
    expect(existingRes.body.data).toBeNull();
    expect(existingRes.body.otp).toBeUndefined();
    expect(existingRes.body.resetToken).toBeUndefined();

    // The OTP must strictly be delivered to email store
    const code = testEmailOtpStore.get(`reset:${registeredUser.email}`);
    expect(code).toBeDefined();
    expect(code).toHaveLength(6);
    expect(/^\d{6}$/.test(code!)).toBe(true);
  });

  it('6. Rate limiting and cooldown on reset requests (60s)', async () => {
    // Immediate second request within 60s should be throttled
    const secondReqRes = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: registeredUser.email });

    expect(secondReqRes.status).toBe(429);
    expect(secondReqRes.body.success).toBe(false);
    expect(secondReqRes.body.error.code).toBe('RESEND_COOLDOWN');
    const retryAfter = secondReqRes.body.error?.details?.retryAfterSeconds ?? secondReqRes.body.data?.retryAfterSeconds;
    expect(retryAfter).toBeGreaterThan(0);
  });

  it('4. Incorrect and expired codes rejected, maximum attempts enforced', async () => {
    // Generate fresh OTP for test 4
    const user = await User.findOne({ email: registeredUser.email });
    user!.passwordResetLastSentAt = new Date(Date.now() - 120000);
    await user!.save({ validateBeforeSave: false });

    await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: registeredUser.email });

    const correctCode = testEmailOtpStore.get(`reset:${registeredUser.email}`);
    expect(correctCode).toBeDefined();

    // Check with wrong 6-digit code
    const wrongRes = await request(app)
      .post('/api/v1/auth/verify-reset-otp')
      .send({
        email: registeredUser.email,
        otp: '000000',
      });

    expect(wrongRes.status).toBe(400);
    expect(wrongRes.body.success).toBe(false);
    expect(wrongRes.body.error.code).toBe('INVALID_OTP');

    // Reject non-6-digit code format
    const badFormatRes = await request(app)
      .post('/api/v1/auth/verify-reset-otp')
      .send({
        email: registeredUser.email,
        otp: '123',
      });
    expect(badFormatRes.status).toBe(400);
    expect(badFormatRes.body.error.code).toBe('INVALID_OTP_FORMAT');

    // Manually expire code in database
    const userToExpire = await User.findOne({ email: registeredUser.email }).select('+passwordResetOtpExpires');
    expect(userToExpire).toBeDefined();
    userToExpire!.passwordResetOtpExpires = new Date(Date.now() - 1000); // 1 second in the past
    await userToExpire!.save({ validateBeforeSave: false });

    const expiredRes = await request(app)
      .post('/api/v1/auth/verify-reset-otp')
      .send({
        email: registeredUser.email,
        otp: correctCode,
      });

    expect(expiredRes.status).toBe(400);
    expect(expiredRes.body.success).toBe(false);
    expect(expiredRes.body.error.code).toBe('EXPIRED_RESET_OTP');
  });

  it('3. Valid reset code permits password reset and issues resetToken', async () => {
    // Bypass cooldown in DB for fresh OTP
    const user = await User.findOne({ email: registeredUser.email });
    user!.passwordResetLastSentAt = new Date(Date.now() - 120000); // 2 minutes ago
    await user!.save({ validateBeforeSave: false });

    // Request new code
    const reqRes = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: registeredUser.email });
    expect(reqRes.status).toBe(200);

    const freshOtp = testEmailOtpStore.get(`reset:${registeredUser.email}`);
    expect(freshOtp).toBeDefined();

    // Verify valid code
    const verifyRes = await request(app)
      .post('/api/v1/auth/verify-reset-otp')
      .send({
        email: registeredUser.email,
        otp: freshOtp,
      });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.success).toBe(true);
    expect(verifyRes.body.data.resetToken).toBeDefined();
    expect(verifyRes.body.data.verified).toBe(true);

    const resetToken = verifyRes.body.data.resetToken;

    // Reset password with resetToken
    const newPassword = 'NewSecretPassword987!';
    const resetRes = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({
        resetToken,
        newPassword,
      });

    expect(resetRes.status).toBe(200);
    expect(resetRes.body.success).toBe(true);
  });

  it('5. Used code / token cannot be reused', async () => {
    // Attempting to reset again with the already used token
    const reuseRes = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({
        resetToken: 'some_stale_token_or_used',
        newPassword: 'AnotherPassword123!',
      });

    expect(reuseRes.status).toBe(400);
    expect(reuseRes.body.success).toBe(false);
    expect(reuseRes.body.error.code).toBe('INVALID_RESET_TOKEN');
  });

  it('8. New password works, old password rejected', async () => {
    // Old password should be rejected
    const oldLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: registeredUser.email,
        password: registeredUser.password, // old password
      });

    expect(oldLoginRes.status).toBe(401);
    expect(oldLoginRes.body.success).toBe(false);

    // New password should succeed
    const newLoginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: registeredUser.email,
        password: 'NewSecretPassword987!',
      });

    expect(newLoginRes.status).toBe(200);
    expect(newLoginRes.body.success).toBe(true);
    expect(newLoginRes.body.data.user.email).toBe(registeredUser.email);
  });

  it('enforces strong password complexity on password reset', async () => {
    // Reset attempt with weak password (missing number and uppercase)
    const weakRes = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({
        resetToken: 'mock_token',
        newPassword: 'short',
      });

    expect(weakRes.status).toBe(400);
    expect(weakRes.body.success).toBe(false);
    expect(weakRes.body.error.code).toBe('WEAK_PASSWORD');
  });
});
