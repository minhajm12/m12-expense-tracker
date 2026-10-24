import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { User } from '../models/User';
import { BankAccount } from '../models/BankAccount';
import { Transaction } from '../models/Transaction';
import { LendingBorrowing } from '../models/LendingBorrowing';
import { LendingBorrowingType, LendingBorrowingStatus } from '@finora/shared';

describe('Transaction Pagination & Lending Repayment Channel Suite', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let userId: string;
  let userBCookie: string;
  let userBId: string;
  let bankAccountId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // 1. Register User A
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'user.pagination@m12tracker.com',
        password: 'Password123!',
        fullName: 'Pagination Tester',
        currency: 'INR',
        requireVerification: false,
      });

    userCookie = regRes.headers['set-cookie']?.[0] || '';
    userId = regRes.body.data.user.id;

    // 2. Register User B (for isolation check)
    const regBRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'user.b@m12tracker.com',
        password: 'Password123!',
        fullName: 'User B',
        currency: 'INR',
        requireVerification: false,
      });

    userBCookie = regBRes.headers['set-cookie']?.[0] || '';
    userBId = regBRes.body.data.user.id;

    // 3. Create Bank Account for User A
    const bankRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'HDFC Main Account',
        bankName: 'HDFC Bank',
        accountType: 'savings',
        openingBalance: 100000,
        openingBalanceDate: '2026-01-01T00:00:00.000Z',
        currency: 'INR',
      });

    bankAccountId = bankRes.body.data.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  describe('Part 1: Transaction Infinite Scroll / Server-Side Pagination (>= 45 records)', () => {
    const totalTransactionsToCreate = 48;

    it('seeds 48 distinct transactions for User A', async () => {
      const now = new Date();
      const docs = [];

      for (let i = 1; i <= totalTransactionsToCreate; i++) {
        // Vary dates slightly to test deterministic ordering
        const txDate = new Date(now.getTime() - i * 3600 * 1000);
        docs.push({
          userId,
          title: `Pagination Test Expense #${String(i).padStart(2, '0')}`,
          amount: 100 + i * 10,
          type: i % 5 === 0 ? 'income' : 'expense',
          category: i % 2 === 0 ? 'Groceries' : 'Utilities',
          paymentMethod: i % 3 === 0 ? 'cash' : 'upi',
          paymentChannel: i % 3 === 0 ? 'offline' : 'online',
          accountId: bankAccountId,
          date: txDate,
          currency: 'INR',
          createdAt: txDate,
          updatedAt: txDate,
        });
      }

      await Transaction.insertMany(docs);

      const count = await Transaction.countDocuments({ userId });
      expect(count).toBe(48);
    });

    it('Page 1 (limit=20): returns first 20 records with hasMore=true and both meta and pagination aliases', async () => {
      const res = await request(app)
        .get('/api/v1/transactions?unified=true&page=1&limit=20')
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(20);

      // Verify meta
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.total).toBe(48);
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.limit).toBe(20);
      expect(res.body.meta.totalPages).toBe(3);
      expect(res.body.meta.hasMore).toBe(true);

      // Verify pagination alias
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.total).toBe(48);
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(20);
      expect(res.body.pagination.hasMore).toBe(true);
    });

    it('Page 2 (limit=20): returns next 20 records with hasMore=true', async () => {
      const res = await request(app)
        .get('/api/v1/transactions?unified=true&page=2&limit=20')
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(20);
      expect(res.body.meta.page).toBe(2);
      expect(res.body.meta.hasMore).toBe(true);
      expect(res.body.pagination.hasMore).toBe(true);
    });

    it('Page 3 (limit=20): returns remaining 8 records with hasMore=false', async () => {
      const res = await request(app)
        .get('/api/v1/transactions?unified=true&page=3&limit=20')
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(8);
      expect(res.body.meta.page).toBe(3);
      expect(res.body.meta.hasMore).toBe(false);
      expect(res.body.pagination.hasMore).toBe(false);
    });

    it('Page 4 (limit=20): returns empty array with hasMore=false', async () => {
      const res = await request(app)
        .get('/api/v1/transactions?unified=true&page=4&limit=20')
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(0);
      expect(res.body.meta.page).toBe(4);
      expect(res.body.meta.hasMore).toBe(false);
    });

    it('guarantees deterministic sort and 0 duplicate IDs across all paginated pages', async () => {
      const res1 = await request(app)
        .get('/api/v1/transactions?unified=true&page=1&limit=20')
        .set('Cookie', userCookie);

      const res2 = await request(app)
        .get('/api/v1/transactions?unified=true&page=2&limit=20')
        .set('Cookie', userCookie);

      const res3 = await request(app)
        .get('/api/v1/transactions?unified=true&page=3&limit=20')
        .set('Cookie', userCookie);

      const ids1: string[] = res1.body.data.map((tx: any) => tx.id);
      const ids2: string[] = res2.body.data.map((tx: any) => tx.id);
      const ids3: string[] = res3.body.data.map((tx: any) => tx.id);

      // Verify no overlap between page 1 and page 2
      const overlap12 = ids1.filter((id) => ids2.includes(id));
      expect(overlap12).toHaveLength(0);

      // Verify no overlap between page 2 and page 3
      const overlap23 = ids2.filter((id) => ids3.includes(id));
      expect(overlap23).toHaveLength(0);

      // Verify all 48 unique IDs collected
      const allIds = new Set([...ids1, ...ids2, ...ids3]);
      expect(allIds.size).toBe(48);
    });

    it('enforces multi-user isolation: User B gets 0 transactions', async () => {
      const resB = await request(app)
        .get('/api/v1/transactions?unified=true&page=1&limit=20')
        .set('Cookie', userBCookie);

      expect(resB.status).toBe(200);
      expect(resB.body.data.length).toBe(0);
      expect(resB.body.meta.total).toBe(0);
      expect(resB.body.meta.hasMore).toBe(false);
    });

    it('supports filtered pagination (e.g. payment=cash)', async () => {
      const res = await request(app)
        .get('/api/v1/transactions?unified=true&payment=cash&page=1&limit=10')
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      // 48 / 3 = 16 cash transactions
      expect(res.body.meta.total).toBe(16);
      expect(res.body.data.length).toBe(10);
      expect(res.body.meta.hasMore).toBe(true);

      res.body.data.forEach((tx: any) => {
        expect(tx.paymentMethod).toBe('cash');
        expect(tx.paymentChannel).toBe('offline');
      });
    });
  });

  describe('Part 2: Lending Repayment Payment Channel Fix (UPI -> online, Cash -> offline)', () => {
    let lendingRecordId: string;
    let upiRepaymentId: string;
    let cashRepaymentId: string;
    let lendingBankAccountId: string;

    beforeAll(async () => {
      // Create dedicated Bank Account for Lending Module test
      const bankRes = await request(app)
        .post('/api/v1/accounts')
        .set('Cookie', userCookie)
        .send({
          accountName: 'ICICI Lending Account',
          bankName: 'ICICI Bank',
          accountType: 'savings',
          openingBalance: 100000,
          openingBalanceDate: '2026-01-01T00:00:00.000Z',
          currency: 'INR',
        });
      lendingBankAccountId = bankRes.body.data.id;
    });

    it('creates a lending record with UPI (online channel)', async () => {
      const lendRes = await request(app)
        .post('/api/v1/lending-borrowing')
        .set('Cookie', userCookie)
        .send({
          type: LendingBorrowingType.LENDING,
          personName: 'Rahul Verma',
          amount: 25000,
          paymentMethod: 'upi',
          paymentChannel: 'online',
          bankAccountId: lendingBankAccountId,
          date: new Date().toISOString(),
          notes: 'Hand loan to Rahul via UPI',
        });

      expect(lendRes.status).toBe(201);
      expect(lendRes.body.success).toBe(true);
      expect(lendRes.body.data.paymentMethod).toBe('upi');
      expect(lendRes.body.data.paymentChannel).toBe('online');
      lendingRecordId = lendRes.body.data.id;
    });

    it('records a UPI partial repayment: saves and returns paymentChannel=online', async () => {
      const repRes = await request(app)
        .post(`/api/v1/lending-borrowing/${lendingRecordId}/repayments`)
        .set('Cookie', userCookie)
        .send({
          amount: 10000,
          date: new Date().toISOString(),
          paymentMethod: 'upi',
          paymentChannel: 'online',
          bankAccountId: lendingBankAccountId,
          notes: 'Rahul returned 10k via PhonePe',
        });

      expect(repRes.status).toBe(200);
      expect(repRes.body.success).toBe(true);
      expect(repRes.body.data.status).toBe(LendingBorrowingStatus.PARTIALLY_SETTLED);
      expect(repRes.body.data.settledAmount).toBe(10000);
      expect(repRes.body.data.outstandingAmount).toBe(15000);

      const repayments = repRes.body.data.repayments;
      expect(repayments.length).toBe(1);
      const rep = repayments[0];
      upiRepaymentId = rep.id;
      expect(rep.paymentMethod).toBe('upi');
      expect(rep.paymentChannel).toBe('online');
    });

    it('records a Cash partial repayment: saves and returns paymentChannel=offline', async () => {
      const repRes = await request(app)
        .post(`/api/v1/lending-borrowing/${lendingRecordId}/repayments`)
        .set('Cookie', userCookie)
        .send({
          amount: 5000,
          date: new Date().toISOString(),
          paymentMethod: 'cash',
          paymentChannel: 'offline',
          notes: 'Rahul returned 5k cash in hand',
        });

      expect(repRes.status).toBe(200);
      expect(repRes.body.success).toBe(true);
      expect(repRes.body.data.status).toBe(LendingBorrowingStatus.PARTIALLY_SETTLED);
      expect(repRes.body.data.settledAmount).toBe(15000);
      expect(repRes.body.data.outstandingAmount).toBe(10000);

      const repayments = repRes.body.data.repayments;
      expect(repayments.length).toBe(2);
      const cashRep = repayments.find((r: any) => r.paymentMethod === 'cash');
      expect(cashRep).toBeDefined();
      cashRepaymentId = cashRep.id;
      expect(cashRep.paymentChannel).toBe('offline');
    });

    it('verifies unified transactions list displays UPI repayment with paymentChannel=online (NOT offline!)', async () => {
      const res = await request(app)
        .get('/api/v1/transactions?unified=true&search=Rahul')
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Find the UPI repayment item
      const upiRepTx = res.body.data.find(
        (tx: any) => tx.id === `rep_${upiRepaymentId}`
      );
      expect(upiRepTx).toBeDefined();
      expect(upiRepTx.title).toContain('Repayment received from Rahul Verma');
      expect(upiRepTx.amount).toBe(10000);
      expect(upiRepTx.paymentMethod).toBe('upi');
      expect(upiRepTx.paymentChannel).toBe('online');
      expect(upiRepTx.isLendingBorrowing).toBe(true);
      expect(upiRepTx.recordType).toBe('repayment');

      // Find the Cash repayment item
      const cashRepTx = res.body.data.find(
        (tx: any) => tx.id === `rep_${cashRepaymentId}`
      );
      expect(cashRepTx).toBeDefined();
      expect(cashRepTx.amount).toBe(5000);
      expect(cashRepTx.paymentMethod).toBe('cash');
      expect(cashRepTx.paymentChannel).toBe('offline');
    });

    it('retrieves repayment by synthetic ID and confirms paymentChannel is online', async () => {
      const res = await request(app)
        .get(`/api/v1/transactions/rep_${upiRepaymentId}`)
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(`rep_${upiRepaymentId}`);
      expect(res.body.data.paymentMethod).toBe('upi');
      expect(res.body.data.paymentChannel).toBe('online');
    });

    it('verifies bank account balance was credited only by the UPI repayment (+10,000, -25,000 lending)', async () => {
      const bankRes = await request(app)
        .get(`/api/v1/accounts/${lendingBankAccountId}`)
        .set('Cookie', userCookie);

      expect(bankRes.status).toBe(200);
      // Opening: 100,000. Lending out: -25,000. UPI Repayment in: +10,000. Cash Repayment in: does not affect bank.
      // Net: 85,000.
      expect(bankRes.body.data.currentBalance).toBe(85000);
    });
  });
});
