import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import {
  CreditCardNetwork,
  PaymentMethod,
  PaymentChannel,
  TransactionType,
  AccountType,
} from '@finora/shared';

describe('Phase 4: Credit Card Management & Double-Entry Accounting Test Suite', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let bankAccountId: string;
  let creditCardId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // Register User
    const authRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'cardholder@finora.test',
        password: 'Password123!',
        fullName: 'Charlie Cardholder',
        currency: 'INR',
      });
    userCookie = authRes.headers['set-cookie'][0];

    // Create Bank Account with ₹50,000
    const bankRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'HDFC Checking',
        bankName: 'HDFC Bank',
        accountType: AccountType.CURRENT,
        openingBalance: 50000,
        openingBalanceDate: '2026-01-01T00:00:00.000Z',
      });
    bankAccountId = bankRes.body.data.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  it('creates Credit Card with Credit Limit ₹100,000 and 0 Opening Outstanding', async () => {
    const res = await request(app)
      .post('/api/v1/credit-cards')
      .set('Cookie', userCookie)
      .send({
        cardNickname: 'Infinia Metal',
        issuingBank: 'HDFC Bank',
        network: CreditCardNetwork.VISA,
        lastFourDigits: '9988',
        creditLimit: 100000,
        billingCycleClosingDay: 15,
        paymentDueDay: 5,
        openingOutstanding: 0,
        openingOutstandingDate: '2026-01-01T00:00:00.000Z',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.creditLimit).toBe(100000);
    expect(res.body.data.currentOutstanding).toBe(0);
    expect(res.body.data.availableCredit).toBe(100000);
    creditCardId = res.body.data.id;
  });

  describe('Prompt Scenario 1: Post Purchase of ₹10,000', () => {
    it('increases outstanding to ₹10,000, reduces available credit to ₹90,000, bank balance remains ₹50,000', async () => {
      const res = await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', userCookie)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Electronics Store Purchase',
          amount: 10000,
          currency: 'INR',
          date: new Date().toISOString(),
          category: 'Shopping',
          paymentMethod: PaymentMethod.CREDIT_CARD,
          paymentChannel: PaymentChannel.ONLINE,
          creditCardId,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      // Verify Credit Card State
      const cardRes = await request(app)
        .get(`/api/v1/credit-cards/${creditCardId}`)
        .set('Cookie', userCookie);
      expect(cardRes.body.data.currentOutstanding).toBe(10000);
      expect(cardRes.body.data.availableCredit).toBe(90000);

      // Verify Bank Account remains UNCHANGED at ₹50,000
      const bankRes = await request(app)
        .get(`/api/v1/accounts/${bankAccountId}`)
        .set('Cookie', userCookie);
      expect(bankRes.body.data.currentBalance).toBe(50000);

      // Verify Expense count
      const expRes = await request(app)
        .get('/api/v1/transactions?type=expense')
        .set('Cookie', userCookie);
      expect(expRes.body.data.length).toBe(1);
      expect(expRes.body.data[0].amount).toBe(10000);
    });
  });

  describe('Prompt Scenario 2: Repay ₹4,000 from Bank Account', () => {
    it('decreases card outstanding to ₹6,000, increases available credit to ₹94,000, bank decreases to ₹46,000, does NOT create a 2nd expense', async () => {
      const res = await request(app)
        .post('/api/v1/credit-cards/repayment')
        .set('Cookie', userCookie)
        .send({
          creditCardId,
          sourceAccountId: bankAccountId,
          amount: 4000,
          date: new Date().toISOString(),
          notes: 'Partial bill payment',
          idempotencyKey: 'repay-scen2-001',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      // Verify Card State: 10,000 - 4,000 = 6,000; available = 94,000
      const cardRes = await request(app)
        .get(`/api/v1/credit-cards/${creditCardId}`)
        .set('Cookie', userCookie);
      expect(cardRes.body.data.currentOutstanding).toBe(6000);
      expect(cardRes.body.data.availableCredit).toBe(94000);

      // Verify Bank Account decreased by ₹4,000: 50,000 - 4,000 = 46,000
      const bankRes = await request(app)
        .get(`/api/v1/accounts/${bankAccountId}`)
        .set('Cookie', userCookie);
      expect(bankRes.body.data.currentBalance).toBe(46000);

      // CRITICAL ACCOUNTING INVARIANT: Expense total must NOT increase again! Still exactly 1 expense of ₹10,000
      const expRes = await request(app)
        .get('/api/v1/transactions?type=expense')
        .set('Cookie', userCookie);
      expect(expRes.body.data.length).toBe(1);
      expect(expRes.body.data[0].amount).toBe(10000);
    });
  });

  describe('Prompt Scenario 3: Refund ₹2,000 against Posted Purchase', () => {
    it('reduces outstanding from ₹6,000 to ₹4,000, increases available to ₹96,000 consistently', async () => {
      const res = await request(app)
        .post(`/api/v1/credit-cards/${creditCardId}/refund`)
        .set('Cookie', userCookie)
        .send({
          amount: 2000,
          title: 'Electronics Return Partial Refund',
          category: 'Shopping',
          idempotencyKey: 'refund-scen3-001',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      // Verify Card State: 6,000 - 2,000 = 4,000; available = 96,000
      const cardRes = await request(app)
        .get(`/api/v1/credit-cards/${creditCardId}`)
        .set('Cookie', userCookie);
      expect(cardRes.body.data.currentOutstanding).toBe(4000);
      expect(cardRes.body.data.availableCredit).toBe(96000);

      // Bank account still untouched at ₹46,000
      const bankRes = await request(app)
        .get(`/api/v1/accounts/${bankAccountId}`)
        .set('Cookie', userCookie);
      expect(bankRes.body.data.currentBalance).toBe(46000);
    });
  });

  describe('Prompt Scenario 4: Duplicate Repayment Request Idempotency', () => {
    it('submitting the same repayment request twice applies the effect only once', async () => {
      const idempotencyKey = 'idempotent-repayment-double-submit-key';

      // First submission: ₹1,000
      const firstRes = await request(app)
        .post('/api/v1/credit-cards/repayment')
        .set('Cookie', userCookie)
        .send({
          creditCardId,
          sourceAccountId: bankAccountId,
          amount: 1000,
          date: new Date().toISOString(),
          idempotencyKey,
        });

      expect(firstRes.status).toBe(201);
      expect(firstRes.body.data.alreadyProcessed).toBe(false);

      // Outstanding was 4,000 -> now 3,000; Bank was 46,000 -> now 45,000
      const cardAfter1 = await request(app)
        .get(`/api/v1/credit-cards/${creditCardId}`)
        .set('Cookie', userCookie);
      expect(cardAfter1.body.data.currentOutstanding).toBe(3000);

      const bankAfter1 = await request(app)
        .get(`/api/v1/accounts/${bankAccountId}`)
        .set('Cookie', userCookie);
      expect(bankAfter1.body.data.currentBalance).toBe(45000);

      // Second identical submission with SAME idempotency key
      const secondRes = await request(app)
        .post('/api/v1/credit-cards/repayment')
        .set('Cookie', userCookie)
        .send({
          creditCardId,
          sourceAccountId: bankAccountId,
          amount: 1000,
          date: new Date().toISOString(),
          idempotencyKey,
        });

      expect(secondRes.status).toBe(201);
      expect(secondRes.body.data.alreadyProcessed).toBe(true);

      // Invariant: Balance and outstanding did NOT change!
      const cardAfter2 = await request(app)
        .get(`/api/v1/credit-cards/${creditCardId}`)
        .set('Cookie', userCookie);
      expect(cardAfter2.body.data.currentOutstanding).toBe(3000);

      const bankAfter2 = await request(app)
        .get(`/api/v1/accounts/${bankAccountId}`)
        .set('Cookie', userCookie);
      expect(bankAfter2.body.data.currentBalance).toBe(45000);
    });
  });

  describe('5. Statements Generation & Billing Cycle Assignment', () => {
    it('generates a statement and computes statement balance and minimum amount due', async () => {
      const res = await request(app)
        .post(`/api/v1/credit-cards/${creditCardId}/statements/generate`)
        .set('Cookie', userCookie);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('statementBalance');
      expect(res.body.data).toHaveProperty('minimumAmountDue');
      expect(res.body.data).toHaveProperty('dueDate');
    });

    it('lists statements for the card', async () => {
      const res = await request(app)
        .get(`/api/v1/credit-cards/${creditCardId}/statements`)
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });
});
