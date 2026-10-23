import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { User } from '../models/User';
import { UserRole } from '@finora/shared';
import { testEmailOtpStore } from '../services/email';

describe('Phase 2: Authentication, Authorization & Security Test Suite', () => {
  let mongoServer: MongoMemoryServer;
  let userACookie: string;
  let userBCookie: string;
  let adminCookie: string;
  let userAId: string;
  let userBId: string;

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

  describe('1. Registration & Validation', () => {
    it('registers User A successfully with secure defaults', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'userA@finora.test',
          password: 'Password123!',
          fullName: 'Alice Finance',
          currency: 'INR',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user).toHaveProperty('id');
      expect(res.body.data.user.email).toBe('usera@finora.test');
      expect(res.body.data.user.role).toBe(UserRole.USER);
      expect(res.body.data.user).not.toHaveProperty('password');

      userAId = res.body.data.user.id;
      // Capture HTTP-only auth cookie
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      userACookie = cookies[0];
    });

    it('registers User B successfully', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'userB@finora.test',
          password: 'Password123!',
          fullName: 'Bob Accounting',
          currency: 'USD',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      userBId = res.body.data.user.id;
      userBCookie = res.headers['set-cookie'][0];
    });

    it('rejects registration with duplicate email (409 Conflict)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'userA@finora.test',
          password: 'Password123!',
          fullName: 'Duplicate Alice',
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EMAIL_EXISTS');
    });

    it('rejects registration with weak password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'weak@finora.test',
          password: 'weak',
          fullName: 'Weak Password User',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('2. Login & Credentials Verification', () => {
    it('authenticates User A with valid credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'usera@finora.test',
          password: 'Password123!',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe('usera@finora.test');
      userACookie = res.headers['set-cookie'][0];
    });

    it('rejects login with invalid password (401 Unauthorized)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'usera@finora.test',
          password: 'WrongPassword999!',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects login for non-existent email (401 Unauthorized)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@finora.test',
          password: 'Password123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('3. Protected User Profile & Session Handling', () => {
    it('rejects unauthenticated request to /api/v1/auth/me', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('allows authenticated User A to fetch their profile', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', userACookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.id).toBe(userAId);
      expect(res.body.data.user.fullName).toBe('Alice Finance');
    });

    it('updates user profile correctly', async () => {
      const res = await request(app)
        .patch('/api/v1/auth/me')
        .set('Cookie', userACookie)
        .send({
          fullName: 'Alice Wealth Manager',
          preferences: { theme: 'dark' },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.fullName).toBe('Alice Wealth Manager');
      expect(res.body.data.user.preferences.theme).toBe('dark');
    });
  });

  describe('4. Session Revocation & Logout', () => {
    it('logout revokes session cookie and invalidates old token', async () => {
      // 1. Logout
      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', userACookie);

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);

      // 2. Attempting to use the revoked userACookie must be rejected!
      const subsequentRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', userACookie);

      expect(subsequentRes.status).toBe(401);
      expect(subsequentRes.body.error.code).toBe('SESSION_REVOKED');
    });

    it('logging in again generates a new active session', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'usera@finora.test',
          password: 'Password123!',
        });

      expect(res.status).toBe(200);
      userACookie = res.headers['set-cookie'][0];

      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', userACookie);
      expect(meRes.status).toBe(200);
    });
  });

  describe('5. Password Change & Reset Flow', () => {
    it('allows changing password with valid current password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Cookie', userACookie)
        .send({
          currentPassword: 'Password123!',
          newPassword: 'NewPassword999!',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // New cookie issued for current session
      userACookie = res.headers['set-cookie'][0];
    });

    it('old password fails to login after change', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'usera@finora.test',
          password: 'Password123!',
        });

      expect(res.status).toBe(401);
    });

    it('new password succeeds in logging in', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'usera@finora.test',
          password: 'NewPassword999!',
        });

      expect(res.status).toBe(200);
      userACookie = res.headers['set-cookie'][0];
    });

    it('executes forgot password and reset password flow', async () => {
      // 1. Request reset
      const forgotRes = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'userb@finora.test' });

      expect(forgotRes.status).toBe(200);
      expect(forgotRes.body.success).toBe(true);
      // Secrets must not be returned in API response body
      expect(forgotRes.body.data).toBeNull();

      // Retrieve securely delivered OTP from email service
      const otp = testEmailOtpStore.get('reset:userb@finora.test');
      expect(otp).toBeDefined();

      // Verify OTP to receive short-lived resetToken
      const verifyRes = await request(app)
        .post('/api/v1/auth/verify-reset-otp')
        .send({
          email: 'userb@finora.test',
          otp,
        });

      expect(verifyRes.status).toBe(200);
      const resetToken = verifyRes.body.data.resetToken;
      expect(resetToken).toBeDefined();

      // 2. Perform reset
      const resetRes = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: resetToken,
          newPassword: 'BrandNewBobPass1!',
        });

      expect(resetRes.status).toBe(200);

      // 3. Verify Bob can login with new password
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'userb@finora.test',
          password: 'BrandNewBobPass1!',
        });
      expect(loginRes.status).toBe(200);
      userBCookie = loginRes.headers['set-cookie'][0];
    });
  });

  describe('6. Admin Bootstrapping & Role-Based Authorization', () => {
    it('reports bootstrap is open when no administrator exists', async () => {
      const res = await request(app).get('/api/v1/admin/bootstrap-status');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isBootstrapOpen).toBe(true);
    });

    it('safely promotes an existing registered user to first administrator preserving account and data', async () => {
      // User B was previously registered as a normal user with role 'user'
      const statusBefore = await request(app)
        .get('/api/v1/admin/users')
        .set('Cookie', userBCookie);
      expect(statusBefore.status).toBe(403);

      // User B claims administrator privileges
      const res = await request(app)
        .post('/api/v1/admin/bootstrap')
        .set('Cookie', userBCookie)
        .send({ email: 'userb@finora.test' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.role).toBe(UserRole.ADMIN);
      expect(res.body.data.user.email).toBe('userb@finora.test');
      adminCookie = res.headers['set-cookie'][0];

      // Bootstrap is now permanently closed
      const statusAfter = await request(app).get('/api/v1/admin/bootstrap-status');
      expect(statusAfter.status).toBe(200);
      expect(statusAfter.body.data.isBootstrapOpen).toBe(false);
    });

    it('second bootstrap attempt is forbidden (403 BOOTSTRAP_DISABLED)', async () => {
      const res = await request(app)
        .post('/api/v1/admin/bootstrap')
        .send({
          email: 'hacker@finora.test',
          password: 'HackerPassword123!',
          fullName: 'Hacker',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('BOOTSTRAP_DISABLED');
    });

    it('regular User A is forbidden from accessing admin routes (403 FORBIDDEN)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/users')
        .set('Cookie', userACookie);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('authenticated administrator can list all users', async () => {
      const res = await request(app)
        .get('/api/v1/admin/users')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2); // Alice and Bob (promoted to Admin)
    });

    it('admin deactivates User A, blocking User A from subsequent requests', async () => {
      // 1. Admin deactivates User A
      const deactivateRes = await request(app)
        .patch(`/api/v1/admin/users/${userAId}/status`)
        .set('Cookie', adminCookie)
        .send({ isActive: false });

      expect(deactivateRes.status).toBe(200);
      expect(deactivateRes.body.data.user.isActive).toBe(false);

      // 2. User A attempts to access profile -> 403 ACCOUNT_DEACTIVATED
      const userARes = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', userACookie);

      expect(userARes.status).toBe(403);
      expect(userARes.body.error.code).toBe('ACCOUNT_DEACTIVATED');

      // 3. User A attempts to log in -> 403 ACCOUNT_DEACTIVATED
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'usera@finora.test',
          password: 'NewPassword999!',
        });

      expect(loginRes.status).toBe(403);
      expect(loginRes.body.error.code).toBe('ACCOUNT_DEACTIVATED');

      // 4. Admin re-activates User A
      const reactivateRes = await request(app)
        .patch(`/api/v1/admin/users/${userAId}/status`)
        .set('Cookie', adminCookie)
        .send({ isActive: true });
      expect(reactivateRes.status).toBe(200);
    });
  });

  describe('7. Data Isolation & IDOR Protection Verification', () => {
    it('proves User A cannot access or mutate User B data by manipulating IDs', async () => {
      // User A logs back in
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'usera@finora.test',
          password: 'NewPassword999!',
        });
      expect(loginRes.status).toBe(200);
      userACookie = loginRes.headers['set-cookie'][0];

      // User A attempts to call admin status endpoint with Bob's ID -> 403 Forbidden
      const idorRes = await request(app)
        .patch(`/api/v1/admin/users/${userBId}/status`)
        .set('Cookie', userACookie)
        .send({ isActive: false });

      expect(idorRes.status).toBe(403);
      expect(idorRes.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects arbitrary invalid ObjectId format safely (400 INVALID_ID)', async () => {
      const res = await request(app)
        .patch('/api/v1/admin/users/invalid-object-id-12345/status')
        .set('Cookie', adminCookie)
        .send({ isActive: false });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ID');
    });
  });
});
