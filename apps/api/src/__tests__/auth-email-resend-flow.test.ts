import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app';
import { User } from '../models/User';
import { UserRole } from '@finora/shared';
import { testEmailOtpStore } from '../services/email';

describe('Auth & Email Service Integration Test Suite', () => {
  let mongoServer: MongoMemoryServer;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
    app = createApp();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    testEmailOtpStore.clear();
    await User.deleteMany({});
  });

  it('1. registers a new user and dispatches a 6-digit verification OTP', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'john.doe@example.com',
        password: 'Password123!',
        fullName: 'John Doe',
        currency: 'INR',
        requireVerification: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.requiresVerification).toBe(true);
    expect(res.body.data.email).toBe('john.doe@example.com');

    // Verify OTP was saved in store and user exists as unverified
    const otp = testEmailOtpStore.get('john.doe@example.com');
    expect(otp).toBeDefined();
    expect(otp).toHaveLength(6);

    const user = await User.findOne({ email: 'john.doe@example.com' });
    expect(user).toBeDefined();
    expect(user!.isEmailVerified).toBe(false);
  });

  it('2. allows an existing administrator to log in and auto-verifies their account', async () => {
    // Admin created without explicit email verification
    await User.create({
      email: 'admin@finora.test',
      password: 'AdminPassword123!',
      fullName: 'System Administrator',
      role: UserRole.ADMIN,
      currency: 'INR',
      isEmailVerified: false,
    });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@finora.test',
        password: 'AdminPassword123!',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.role).toBe(UserRole.ADMIN);
    expect(res.body.data.token).toBeDefined();

    // Verify admin was auto-verified
    const updatedAdmin = await User.findOne({ email: 'admin@finora.test' });
    expect(updatedAdmin!.isEmailVerified).toBe(true);
  });

  it('3. allows legacy existing user (with no OTP hash) to log in smoothly', async () => {
    await User.create({
      email: 'legacy@finora.test',
      password: 'LegacyPassword123!',
      fullName: 'Legacy Customer',
      role: UserRole.USER,
      currency: 'INR',
      isEmailVerified: false,
      // No emailVerificationOtpHash or emailVerificationOtpExpires
    });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'legacy@finora.test',
        password: 'LegacyPassword123!',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe('legacy@finora.test');
  });

  it('4. blocks unverified new user from login and returns EMAIL_NOT_VERIFIED', async () => {
    // Register unverified user
    await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'pending@example.com',
        password: 'Password123!',
        fullName: 'Pending User',
        requireVerification: true,
      });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'pending@example.com',
        password: 'Password123!',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(res.body.error.details.requiresVerification).toBe(true);
  });

  it('5. verifies valid OTP and activates user session', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'verify.me@example.com',
        password: 'Password123!',
        fullName: 'Verify Me',
        requireVerification: true,
      });

    const otp = testEmailOtpStore.get('verify.me@example.com')!;
    expect(otp).toBeDefined();

    const verifyRes = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({
        email: 'verify.me@example.com',
        otp,
      });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.success).toBe(true);
    expect(verifyRes.body.data.isEmailVerified).toBe(true);
    expect(verifyRes.body.data.token).toBeDefined();

    // User can now log in normally
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'verify.me@example.com',
        password: 'Password123!',
      });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);
  });

  it('6. rejects incorrect OTP with INVALID_OTP', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'wrong.otp@example.com',
        password: 'Password123!',
        fullName: 'Wrong OTP',
        requireVerification: true,
      });

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({
        email: 'wrong.otp@example.com',
        otp: '000000',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_OTP');
  });

  it('7. rejects expired OTP with OTP_EXPIRED', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'expired@example.com',
        password: 'Password123!',
        fullName: 'Expired OTP',
        requireVerification: true,
      });

    const otp = testEmailOtpStore.get('expired@example.com')!;

    // Force expiration in database
    await User.updateOne(
      { email: 'expired@example.com' },
      { emailVerificationOtpExpires: new Date(Date.now() - 1000) }
    );

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({
        email: 'expired@example.com',
        otp,
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('OTP_EXPIRED');
  });

  it('8. enforces cooldown and invalidates old OTP when new OTP is resent', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'resend@example.com',
        password: 'Password123!',
        fullName: 'Resend User',
        requireVerification: true,
      });

    const originalOtp = testEmailOtpStore.get('resend@example.com')!;

    // Immediate resend triggers cooldown
    const cooldownRes = await request(app)
      .post('/api/v1/auth/resend-otp')
      .send({ email: 'resend@example.com' });

    expect(cooldownRes.status).toBe(429);
    expect(cooldownRes.body.error.code).toBe('RESEND_COOLDOWN');

    // Fast-forward cooldown by resetting lastSentAt
    await User.updateOne(
      { email: 'resend@example.com' },
      { emailVerificationLastSentAt: new Date(Date.now() - 65000) }
    );

    // Resend fresh OTP
    const resendRes = await request(app)
      .post('/api/v1/auth/resend-otp')
      .send({ email: 'resend@example.com' });

    expect(resendRes.status).toBe(200);
    expect(resendRes.body.success).toBe(true);

    const freshOtp = testEmailOtpStore.get('resend@example.com')!;
    expect(freshOtp).toBeDefined();

    // Attempting to use the OLD superseded OTP fails
    const oldOtpRes = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({
        email: 'resend@example.com',
        otp: originalOtp,
      });

    expect(oldOtpRes.status).toBe(400);
    expect(oldOtpRes.body.error.code).toBe('INVALID_OTP');

    // Using the fresh OTP succeeds
    const freshOtpRes = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({
        email: 'resend@example.com',
        otp: freshOtp,
      });

    expect(freshOtpRes.status).toBe(200);
    expect(freshOtpRes.body.success).toBe(true);
  });

  it('9. blocks duplicate registration for already existing verified user', async () => {
    await User.create({
      email: 'registered@example.com',
      password: 'ExistingPassword123!',
      fullName: 'Registered User',
      isEmailVerified: true,
    });

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'registered@example.com',
        password: 'NewPassword123!',
        fullName: 'Imposter',
        requireVerification: true,
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('EMAIL_EXISTS');

    // Ensure password was not altered
    const user = await User.findOne({ email: 'registered@example.com' }).select('+password');
    expect(await user!.comparePassword('ExistingPassword123!')).toBe(true);
  });
});
