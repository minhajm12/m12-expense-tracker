import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { AccountType, PaymentMethod, PaymentChannel, TransactionType } from '@finora/shared';

describe('Phase 3: Core Financial Features & Accounting Test Suite', () => {
  let mongoServer: MongoMemoryServer;
  let userACookie: string;
  let userBCookie: string;
  let account1Id: string;
  let account2Id: string;
  let userBAccountId: string;
  let incomeTxId: string;
  let expenseTxId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // Register User A
    const resA = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'alice.financial@finora.test',
        password: 'Password123!',
        fullName: 'Alice Financial Core',
        currency: 'INR',
      });
    userACookie = resA.headers['set-cookie'][0];

    // Register User B
    const resB = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'bob.financial@finora.test',
        password: 'Password123!',
        fullName: 'Bob Financial Core',
        currency: 'INR',
      });
    userBCookie = resB.headers['set-cookie'][0];
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  describe('1. Bank Account Creation & Isolation', () => {
    it('creates Account 1 for User A with opening balance ₹50,000', async () => {
      const res = await request(app)
        .post('/api/v1/accounts')
        .set('Cookie', userACookie)
        .send({
          accountName: 'HDFC Salary Account',
          bankName: 'HDFC Bank',
          accountType: AccountType.SALARY,
          accountNumberMasked: '•••• 1234',
          openingBalance: 50000,
          openingBalanceDate: '2026-01-01T00:00:00.000Z',
          currency: 'INR',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.openingBalance).toBe(50000);
      expect(res.body.data.currentBalance).toBe(50000);
      account1Id = res.body.data.id;
    });

    it('creates Account 2 for User A with opening balance ₹10,000', async () => {
      const res = await request(app)
        .post('/api/v1/accounts')
        .set('Cookie', userACookie)
        .send({
          accountName: 'ICICI Savings Account',
          bankName: 'ICICI Bank',
          accountType: AccountType.SAVINGS,
          accountNumberMasked: '•••• 5678',
          openingBalance: 10000,
          openingBalanceDate: '2026-01-01T00:00:00.000Z',
          currency: 'INR',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.currentBalance).toBe(10000);
      account2Id = res.body.data.id;
    });

    it('creates an account for User B and verifies isolation from User A', async () => {
      const resB = await request(app)
        .post('/api/v1/accounts')
        .set('Cookie', userBCookie)
        .send({
          accountName: 'Bob Axis Account',
          bankName: 'Axis Bank',
          accountType: AccountType.SAVINGS,
          openingBalance: 25000,
          openingBalanceDate: '2026-01-01T00:00:00.000Z',
        });
      userBAccountId = resB.body.data.id;

      // User A lists accounts - must ONLY see Account 1 and Account 2
      const resListA = await request(app)
        .get('/api/v1/accounts')
        .set('Cookie', userACookie);

      expect(resListA.status).toBe(200);
      expect(resListA.body.data.length).toBe(2);
      expect(resListA.body.data.map((a: { id: string }) => a.id)).not.toContain(userBAccountId);

      // User B tries to view User A's Account 1 -> 404
      const resUnauth = await request(app)
        .get(`/api/v1/accounts/${account1Id}`)
        .set('Cookie', userBCookie);
      expect(resUnauth.status).toBe(404);
    });
  });

  describe('2. Prompt Accounting Scenario: Opening ₹50k, Income ₹5k, Expense ₹2k -> Expected ₹53k', () => {
    it('posts Income of ₹5,000 to Account 1', async () => {
      const res = await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', userACookie)
        .send({
          type: TransactionType.INCOME,
          title: 'Freelance Design Payment',
          amount: 5000,
          currency: 'INR',
          date: new Date().toISOString(),
          category: 'Freelance income',
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: account1Id,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      incomeTxId = res.body.data.id;

      // Check account 1 balance: 50,000 + 5,000 = 55,000
      const accRes = await request(app)
        .get(`/api/v1/accounts/${account1Id}`)
        .set('Cookie', userACookie);
      expect(accRes.body.data.currentBalance).toBe(55000);
    });

    it('posts Expense of ₹2,000 from Account 1', async () => {
      const res = await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', userACookie)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Weekly Grocery Shopping',
          amount: 2000,
          currency: 'INR',
          date: new Date().toISOString(),
          category: 'Groceries',
          paymentMethod: PaymentMethod.DEBIT_CARD,
          paymentChannel: PaymentChannel.OFFLINE,
          accountId: account1Id,
          merchantOrRecipient: 'Supermarket',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expenseTxId = res.body.data.id;

      // Check account 1 balance: 55,000 - 2,000 = 53,000 (Exact prompt match!)
      const accRes = await request(app)
        .get(`/api/v1/accounts/${account1Id}`)
        .set('Cookie', userACookie);
      expect(accRes.body.data.currentBalance).toBe(53000);
    });
  });

  describe('3. Account-to-Account Transfers: Atomic Balance Invariant & Exclusion from Income/Expense', () => {
    it('transfers ₹5,000 from Account 1 to Account 2', async () => {
      const idempotencyKey = 'transfer-key-test-001';
      const res = await request(app)
        .post('/api/v1/transactions/transfer')
        .set('Cookie', userACookie)
        .send({
          sourceAccountId: account1Id,
          destinationAccountId: account2Id,
          amount: 5000,
          date: new Date().toISOString(),
          notes: 'Transfer to savings',
          idempotencyKey,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.alreadyProcessed).toBe(false);

      // Verify Source Account (Account 1): 53,000 - 5,000 = 48,000
      const acc1Res = await request(app)
        .get(`/api/v1/accounts/${account1Id}`)
        .set('Cookie', userACookie);
      expect(acc1Res.body.data.currentBalance).toBe(48000);

      // Verify Destination Account (Account 2): 10,000 + 5,000 = 15,000
      const acc2Res = await request(app)
        .get(`/api/v1/accounts/${account2Id}`)
        .set('Cookie', userACookie);
      expect(acc2Res.body.data.currentBalance).toBe(15000);

      // Verify transfer idempotency: repeated request does NOT modify balance twice
      const repeatRes = await request(app)
        .post('/api/v1/transactions/transfer')
        .set('Cookie', userACookie)
        .send({
          sourceAccountId: account1Id,
          destinationAccountId: account2Id,
          amount: 5000,
          date: new Date().toISOString(),
          idempotencyKey,
        });
      expect(repeatRes.status).toBe(201);
      expect(repeatRes.body.data.alreadyProcessed).toBe(true);

      const acc1After = await request(app)
        .get(`/api/v1/accounts/${account1Id}`)
        .set('Cookie', userACookie);
      expect(acc1After.body.data.currentBalance).toBe(48000);
    });

    it('confirms transfers appear in both account histories and remain excluded from income/expense', async () => {
      // Check Account 1 history
      const acc1Tx = await request(app)
        .get(`/api/v1/accounts/${account1Id}/transactions`)
        .set('Cookie', userACookie);
      expect(acc1Tx.body.data.length).toBe(3); // income + expense + transfer

      // Check Account 2 history
      const acc2Tx = await request(app)
        .get(`/api/v1/accounts/${account2Id}/transactions`)
        .set('Cookie', userACookie);
      expect(acc2Tx.body.data.length).toBe(1); // transfer from Account 1

      // Verify query with type=income only returns 1 income transaction (₹5,000)
      const incomeList = await request(app)
        .get('/api/v1/transactions?type=income')
        .set('Cookie', userACookie);
      expect(incomeList.body.data.length).toBe(1);
      expect(incomeList.body.data[0].amount).toBe(5000);

      // Verify query with type=expense only returns 1 expense transaction (₹2,000)
      const expenseList = await request(app)
        .get('/api/v1/transactions?type=expense')
        .set('Cookie', userACookie);
      expect(expenseList.body.data.length).toBe(1);
      expect(expenseList.body.data[0].amount).toBe(2000);
    });
  });

  describe('4. Transaction Deletion & Balance Recalculation', () => {
    it('deleting expense transaction recalculates account balance back to ₹50,000 before transfer', async () => {
      const deleteRes = await request(app)
        .delete(`/api/v1/transactions/${expenseTxId}`)
        .set('Cookie', userACookie);

      expect(deleteRes.status).toBe(200);

      // Account 1 was 48,000. Reversing the 2,000 grocery expense makes it 50,000!
      const acc1Res = await request(app)
        .get(`/api/v1/accounts/${account1Id}`)
        .set('Cookie', userACookie);
      expect(acc1Res.body.data.currentBalance).toBe(50000);
    });
  });

  describe('5. Categories & Custom Category Management', () => {
    it('returns seeded system default categories', async () => {
      const res = await request(app)
        .get('/api/v1/categories')
        .set('Cookie', userACookie);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(20);
    });

    it('allows User A to create a custom expense category', async () => {
      const res = await request(app)
        .post('/api/v1/categories')
        .set('Cookie', userACookie)
        .send({
          name: 'Cryptocurrency Trading Fees',
          type: 'expense',
          icon: 'Coins',
          color: '#f59e0b',
          subcategories: ['Spot Fees', 'Futures Fees'],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.isCustom).toBe(true);

      // User B cannot see User A's custom category
      const resB = await request(app)
        .get('/api/v1/categories')
        .set('Cookie', userBCookie);
      const categoryNames = resB.body.data.map((c: { name: string }) => c.name);
      expect(categoryNames).not.toContain('Cryptocurrency Trading Fees');
    });
  });
});
