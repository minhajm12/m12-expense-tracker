import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { User } from '../models/User';
import { BankAccount } from '../models/BankAccount';
import { CreditCard } from '../models/CreditCard';
import { testEmailOtpStore } from '../services/email';
import { AccountType, CreditCardNetwork } from '@finora/shared';

describe('Phase 4 & 5: Authentication, OTP Security & Onboarding Integration Test Suite', () => {
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

  describe('1. Registration & OTP Generation Security', () => {
    const testEmail = 'newuser@finora.test';
    const testPassword = 'Password123!';

    it('initiates OTP delivery on valid registration when verification is required', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: testEmail,
          password: testPassword,
          fullName: 'New Finora User',
          currency: 'INR',
          requireVerification: true,
          onboarding: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.requiresVerification).toBe(true);
      expect(res.body.data.email).toBe(testEmail);

      // Verify OTP is stored in memory store and user in database has sha256 hash
      const dispatchedOtp = testEmailOtpStore.get(testEmail);
      expect(dispatchedOtp).toBeDefined();
      expect(dispatchedOtp).toHaveLength(6);
      expect(/^\d{6}$/.test(dispatchedOtp!)).toBe(true);

      const dbUser = await User.findOne({ email: testEmail }).select(
        '+emailVerificationOtpHash +emailVerificationOtpExpires +emailVerificationAttempts'
      );
      expect(dbUser).toBeDefined();
      expect(dbUser!.isEmailVerified).toBe(false);
      expect(dbUser!.isOnboardingCompleted).toBe(false);

      // OTP in database must be hashed with sha256, NEVER stored in plaintext
      const expectedHash = crypto.createHash('sha256').update(dispatchedOtp!).digest('hex');
      expect(dbUser!.emailVerificationOtpHash).toBe(expectedHash);
      expect(dbUser!.emailVerificationOtpHash).not.toBe(dispatchedOtp);
      expect(dbUser!.emailVerificationOtpExpires!.getTime()).toBeGreaterThan(Date.now());
    });

    it('blocks login when email is unverified (EMAIL_NOT_VERIFIED)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
      expect(res.body.error.details?.requiresVerification).toBe(true);
    });

    it('rejects incorrect OTP and increments attempt counter', async () => {
      const res = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({
          email: testEmail,
          otp: '000000', // Invalid OTP
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_OTP');

      const dbUser = await User.findOne({ email: testEmail }).select('+emailVerificationAttempts');
      expect(dbUser!.emailVerificationAttempts).toBe(1);
    });

    it('locks out verification after 5 failed attempts', async () => {
      // Simulate 5 failed attempts directly in DB
      await User.updateOne({ email: testEmail }, { emailVerificationAttempts: 5 });

      const res = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({
          email: testEmail,
          otp: '123456',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TOO_MANY_ATTEMPTS');
    });

    it('enforces 60-second cooldown on resend-otp', async () => {
      // User requested OTP at t=now, immediate resend must be throttled
      const res = await request(app)
        .post('/api/v1/auth/resend-otp')
        .send({ email: testEmail });

      expect(res.status).toBe(429);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('RESEND_COOLDOWN');
      expect(res.body.error.details?.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('resends a fresh OTP after cooldown expires', async () => {
      // Advance user's last sent timestamp past 60 seconds
      await User.updateOne(
        { email: testEmail },
        { emailVerificationLastSentAt: new Date(Date.now() - 65 * 1000) }
      );

      const res = await request(app)
        .post('/api/v1/auth/resend-otp')
        .send({ email: testEmail });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const freshOtp = testEmailOtpStore.get(testEmail);
      expect(freshOtp).toBeDefined();
      expect(freshOtp).toHaveLength(6);

      const dbUser = await User.findOne({ email: testEmail }).select(
        '+emailVerificationOtpHash +emailVerificationAttempts'
      );
      expect(dbUser!.emailVerificationAttempts).toBe(0); // Resets counter
    });

    it('rejects expired OTP', async () => {
      // Set expiry to 1 minute in the past
      await User.updateOne(
        { email: testEmail },
        { emailVerificationOtpExpires: new Date(Date.now() - 60 * 1000) }
      );

      const res = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({
          email: testEmail,
          otp: '123456',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('OTP_EXPIRED');
    });

    it('verifies email with valid unexpired OTP and issues session token', async () => {
      // Reset expiry and attempts
      const freshOtp = '742918';
      const hash = crypto.createHash('sha256').update(freshOtp).digest('hex');
      await User.updateOne(
        { email: testEmail },
        {
          emailVerificationOtpHash: hash,
          emailVerificationOtpExpires: new Date(Date.now() + 10 * 60 * 1000),
          emailVerificationAttempts: 0,
        }
      );

      const res = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({
          email: testEmail,
          otp: freshOtp,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isEmailVerified).toBe(true);
      expect(res.body.data.token).toBeDefined();

      const dbUser = await User.findOne({ email: testEmail });
      expect(dbUser!.isEmailVerified).toBe(true);
      expect(dbUser!.emailVerificationOtpHash).toBeUndefined(); // OTP invalidated
    });

    it('rejects duplicate registration for already verified email address', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: testEmail,
          password: 'AnotherPassword123!',
          fullName: 'Another Name',
          currency: 'INR',
          requireVerification: true,
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EMAIL_EXISTS');
    });
  });

  describe('2. Onboarding Workflow: Module Preferences, Accounts & Credit Cards', () => {
    let verifiedUserToken: string;
    let verifiedUserId: string;
    const onboardEmail = 'onboardinguser@finora.test';
    const onboardPassword = 'Password123!';

    beforeAll(async () => {
      // Register and verify a fresh user for the onboarding flow
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: onboardEmail,
          password: onboardPassword,
          fullName: 'Onboarding Tester',
          currency: 'INR',
          requireVerification: true,
          onboarding: true,
        });

      const otp = testEmailOtpStore.get(onboardEmail)!;
      const verifyRes = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({
          email: onboardEmail,
          otp,
        });

      verifiedUserToken = verifyRes.body.data.token;
      verifiedUserId = verifyRes.body.data.user.id;
    });

    it('enforces authentication on onboarding-finish endpoint', async () => {
      const res = await request(app)
        .post('/api/v1/auth/onboarding-finish')
        .send({
          modulePreferences: { chitFund: false },
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('persists module preferences, multiple bank accounts, and credit cards cleanly', async () => {
      const customPreferences = {
        expenseTracker: true,
        emi: true,
        lendingBorrowing: false,
        budget: true,
        recurringTransactions: false,
        creditCards: true,
        chitFund: false,
      };

      const bankAccountsPayload = [
        {
          accountName: 'HDFC Salary Account',
          bankName: 'HDFC Bank',
          accountType: AccountType.SALARY,
          openingBalance: 45000,
          accountNumberMasked: '•••• 1234',
        },
        {
          accountName: 'SBI Savings Account',
          bankName: 'State Bank of India',
          accountType: AccountType.SAVINGS,
          openingBalance: 25000,
          accountNumberMasked: '•••• 5678',
        },
      ];

      const creditCardsPayload = [
        {
          cardNickname: 'Finora Regalia',
          issuingBank: 'HDFC Bank',
          network: CreditCardNetwork.VISA,
          creditLimit: 150000,
          currentOutstanding: 12000,
          billingCycleClosingDay: 5,
          paymentDueDay: 25,
        },
      ];

      const res = await request(app)
        .post('/api/v1/auth/onboarding-finish')
        .set('Authorization', `Bearer ${verifiedUserToken}`)
        .send({
          modulePreferences: customPreferences,
          bankAccounts: bankAccountsPayload,
          creditCards: creditCardsPayload,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.onboardingCompleted).toBe(true);

      // Verify user in database
      const updatedUser = await User.findById(verifiedUserId);
      expect(updatedUser!.isOnboardingCompleted).toBe(true);
      expect(updatedUser!.modulePreferences).toMatchObject(customPreferences);

      // Verify bank accounts in database
      const userAccounts = await BankAccount.find({ userId: verifiedUserId });
      expect(userAccounts).toHaveLength(2);
      const hdfc = userAccounts.find((a) => a.accountName === 'HDFC Salary Account');
      expect(hdfc).toBeDefined();
      expect(hdfc!.openingBalance).toBe(45000);
      expect(hdfc!.currentBalance).toBe(45000);
      expect(hdfc!.accountNumberMasked).toBe('•••• 1234');

      // Verify credit cards in database
      const userCards = await CreditCard.find({ userId: verifiedUserId });
      expect(userCards).toHaveLength(1);
      expect(userCards[0].cardNickname).toBe('Finora Regalia');
      expect(userCards[0].creditLimit).toBe(150000);
      expect(userCards[0].currentOutstanding).toBe(12000);
      expect(userCards[0].availableCredit).toBe(138000); // 150000 - 12000
      expect(userCards[0].billingCycleClosingDay).toBe(5);
      expect(userCards[0].paymentDueDay).toBe(25);
    });

    it('prevents duplicate accounts and cards on repeated finish onboarding submission', async () => {
      // Re-issue a fresh token to test repeated submission idempotence
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: onboardEmail,
          password: onboardPassword,
        });
      const token = loginRes.body.data.token;

      // Resubmit the exact same payload
      const bankAccountsPayload = [
        {
          accountName: 'HDFC Salary Account',
          bankName: 'HDFC Bank',
          openingBalance: 45000,
        },
      ];

      const creditCardsPayload = [
        {
          cardNickname: 'Finora Regalia',
          issuingBank: 'HDFC Bank',
          creditLimit: 150000,
        },
      ];

      const res = await request(app)
        .post('/api/v1/auth/onboarding-finish')
        .set('Authorization', `Bearer ${token}`)
        .send({
          bankAccounts: bankAccountsPayload,
          creditCards: creditCardsPayload,
        });

      expect(res.status).toBe(200);

      // Assert accounts count remains 2 (not 3) and cards count remains 1 (not 2)
      const accounts = await BankAccount.find({ userId: verifiedUserId });
      expect(accounts).toHaveLength(2);

      const cards = await CreditCard.find({ userId: verifiedUserId });
      expect(cards).toHaveLength(1);
    });

    it('subsequent login succeeds and loads the configured module preferences', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: onboardEmail,
          password: onboardPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(onboardEmail);
      expect(res.body.data.user.modulePreferences).toBeDefined();
      expect(res.body.data.user.modulePreferences.lendingBorrowing).toBe(false);
      expect(res.body.data.user.modulePreferences.chitFund).toBe(false);
      expect(res.body.data.user.modulePreferences.emi).toBe(true);
    });

    it('skipped bank and card setup leaves database collections empty without crashing', async () => {
      const skippedEmail = 'skippeduser@finora.test';
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: skippedEmail,
          password: 'Password123!',
          fullName: 'Skipped User',
          currency: 'INR',
          requireVerification: true,
          onboarding: true,
        });

      const otp = testEmailOtpStore.get(skippedEmail)!;
      const verifyRes = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({
          email: skippedEmail,
          otp,
        });

      const token = verifyRes.body.data.token;
      const userId = verifyRes.body.data.user.id;

      // Finish with empty arrays / skipped steps
      const res = await request(app)
        .post('/api/v1/auth/onboarding-finish')
        .set('Authorization', `Bearer ${token}`)
        .send({
          modulePreferences: {},
          bankAccounts: [],
          creditCards: [],
        });

      expect(res.status).toBe(200);

      const accounts = await BankAccount.find({ userId });
      expect(accounts).toHaveLength(0);

      const cards = await CreditCard.find({ userId });
      expect(cards).toHaveLength(0);

      const user = await User.findById(userId);
      expect(user!.isOnboardingCompleted).toBe(true);
    });

    it('prevents User B from accessing or altering User A bank accounts or credit cards', async () => {
      // Register and verify User B
      const userBEmail = 'userb_isolation@finora.test';
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: userBEmail,
          password: 'Password123!',
          fullName: 'User B',
          currency: 'INR',
          requireVerification: true,
          onboarding: true,
        });

      const otp = testEmailOtpStore.get(userBEmail)!;
      const verifyRes = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({
          email: userBEmail,
          otp,
        });
      const userBToken = verifyRes.body.data.token;

      // User A's bank account ID
      const userAAccount = await BankAccount.findOne({ userId: verifiedUserId });
      expect(userAAccount).toBeDefined();

      // User B attempts to access User A's bank account
      const getRes = await request(app)
        .get(`/api/v1/accounts/${userAAccount!._id}`)
        .set('Authorization', `Bearer ${userBToken}`);

      expect(getRes.status).toBe(404); // Scoped to User B's partition

      // User B attempts to access User A's credit card
      const userACard = await CreditCard.findOne({ userId: verifiedUserId });
      expect(userACard).toBeDefined();

      const cardRes = await request(app)
        .get(`/api/v1/credit-cards/${userACard!._id}`)
        .set('Authorization', `Bearer ${userBToken}`);

      expect(cardRes.status).toBe(404);
    });

    it('ensures pre-existing users can log in without being blocked by email verification', async () => {
      // Legacy user created before Phase 4 (isEmailVerified was defaulted to true)
      const legacyEmail = 'legacyuser@finora.test';
      const legacyPassword = 'Password123!';
      await User.create({
        email: legacyEmail,
        password: legacyPassword,
        fullName: 'Legacy User',
        currency: 'INR',
        isEmailVerified: true,
        isOnboardingCompleted: true,
      });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: legacyEmail,
          password: legacyPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(legacyEmail);
    });
  });
});
