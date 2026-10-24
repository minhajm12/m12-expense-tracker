import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { User } from '../models/User';
import { BankAccount } from '../models/BankAccount';
import { AUTH_TOKEN_KEY, LEGACY_AUTH_TOKEN_KEY, AUTH_COOKIE_NAME } from '../utils/token';

describe('Auth Token Persistence and Protected Routes Regression Test Suite', () => {
  let mongoServer: MongoMemoryServer;
  let testUserEmail = 'token.test@m12tracker.com';
  let testUserPassword = 'Password123!';
  let userId: string;
  let authToken: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // Register a verified user
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: testUserEmail,
        password: testUserPassword,
        fullName: 'Token Persistence Tester',
        currency: 'INR',
        requireVerification: false,
      });

    expect(regRes.status).toBe(201);
    userId = regRes.body.data.user.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  describe('1. Response shape and JWT extraction on login', () => {
    it('returns HTTP 200 with JWT available at both top-level and in data', async () => {
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUserEmail,
          password: testUserPassword,
        });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.success).toBe(true);
      expect(loginRes.body.message).toBe('Login successful');

      // 1. Verify token in data.token
      expect(loginRes.body.data).toBeDefined();
      expect(typeof loginRes.body.data.token).toBe('string');
      expect(loginRes.body.data.token.length).toBeGreaterThan(20);

      // 2. Verify token at top-level token field
      expect(typeof loginRes.body.token).toBe('string');
      expect(loginRes.body.token).toBe(loginRes.body.data.token);

      // 3. Verify user object is populated
      expect(loginRes.body.data.user).toBeDefined();
      expect(loginRes.body.data.user.email).toBe(testUserEmail);

      authToken = loginRes.body.token;
    });
  });

  describe('2. Canonical storage key and client helpers', () => {
    it('confirms the canonical storage key is m12_expense_tracker_token', () => {
      expect(AUTH_TOKEN_KEY).toBe('m12_expense_tracker_token');
      expect(LEGACY_AUTH_TOKEN_KEY).toBe('finora_token');
    });

    it('simulates localStorage extraction matching the real response shape', () => {
      // Mock response mimicking the production endpoint
      const response = {
        success: true,
        data: {
          user: { id: userId, email: testUserEmail },
          token: authToken,
        },
        token: authToken,
        message: 'Login successful',
      };

      // Extract using the exact frontend logic
      const extractedToken = response.token || response.data?.token;
      expect(extractedToken).toBe(authToken);
    });
  });

  describe('3. Page refresh session restoration (/api/v1/auth/me)', () => {
    it('restores user profile using only the Authorization: Bearer header (no cookies)', async () => {
      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${authToken}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.success).toBe(true);
      expect(meRes.body.data.user).toBeDefined();
      expect(meRes.body.data.user.id).toBe(userId);
      expect(meRes.body.data.user.email).toBe(testUserEmail);
    });
  });

  describe('4. Protected requests with Bearer token without cookies', () => {
    it('accesses /api/v1/analytics/dashboard successfully with Bearer token', async () => {
      const dashRes = await request(app)
        .get('/api/v1/analytics/dashboard?period=this-month')
        .set('Authorization', `Bearer ${authToken}`);

      expect(dashRes.status).toBe(200);
      expect(dashRes.body.success).toBe(true);
      expect(dashRes.body.data).toBeDefined();
    });

    it('accesses /api/v1/analytics/upcoming-forecast successfully with Bearer token', async () => {
      const forecastRes = await request(app)
        .get('/api/v1/analytics/upcoming-forecast?month=2026-10')
        .set('Authorization', `Bearer ${authToken}`);

      expect(forecastRes.status).toBe(200);
      expect(forecastRes.body.success).toBe(true);
      expect(forecastRes.body.data).toBeDefined();
    });

    it('accesses /api/v1/accounts successfully with Bearer token', async () => {
      const accRes = await request(app)
        .get('/api/v1/accounts')
        .set('Authorization', `Bearer ${authToken}`);

      expect(accRes.status).toBe(200);
      expect(accRes.body.success).toBe(true);
      expect(Array.isArray(accRes.body.data)).toBe(true);
    });

    it('accesses /api/v1/chit-funds successfully with Bearer token', async () => {
      const chitRes = await request(app)
        .get('/api/v1/chit-funds')
        .set('Authorization', `Bearer ${authToken}`);

      expect(chitRes.status).toBe(200);
      expect(chitRes.body.success).toBe(true);
    });
  });

  describe('5. Missing or invalid credentials protection', () => {
    it('returns HTTP 401 when no token or cookie is supplied', async () => {
      const noAuthRes = await request(app)
        .get('/api/v1/analytics/dashboard?period=this-month');

      expect(noAuthRes.status).toBe(401);
      expect(noAuthRes.body.success).toBe(false);
      expect(noAuthRes.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns HTTP 401 when an invalid or malformed Bearer token is supplied', async () => {
      const badTokenRes = await request(app)
        .get('/api/v1/analytics/dashboard?period=this-month')
        .set('Authorization', 'Bearer invalid.token.payload');

      expect(badTokenRes.status).toBe(401);
      expect(badTokenRes.body.success).toBe(false);
      expect(badTokenRes.body.error.code).toBe('INVALID_TOKEN');
    });
  });

  describe('6. Failed API requests do not invalidate the session', () => {
    it('preserves valid token after a 400 Bad Request on another endpoint', async () => {
      // Trigger a 400 validation error
      const badReqRes = await request(app)
        .post('/api/v1/accounts')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ invalidField: 123 });

      expect(badReqRes.status).toBe(400);

      // Verify the Bearer token is STILL completely valid and operational
      const dashRes = await request(app)
        .get('/api/v1/analytics/dashboard?period=this-month')
        .set('Authorization', `Bearer ${authToken}`);

      expect(dashRes.status).toBe(200);
      expect(dashRes.body.success).toBe(true);
    });
  });

  describe('7. Logout revokes the session and clears credentials', () => {
    it('logs out and revokes the token', async () => {
      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${authToken}`);

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);

      // Attempting to use the old revoked token must now fail with 401 SESSION_REVOKED
      const expiredRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${authToken}`);

      expect(expiredRes.status).toBe(401);
      expect(expiredRes.body.error.code).toBe('SESSION_REVOKED');
    });
  });
});
