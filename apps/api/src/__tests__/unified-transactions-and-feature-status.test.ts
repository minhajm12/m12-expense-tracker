import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { User } from '../models/User';
import { BankAccount } from '../models/BankAccount';
import { Transaction } from '../models/Transaction';
import { LendingBorrowing } from '../models/LendingBorrowing';
import { LendingBorrowingType } from '@finora/shared';

describe('Phase 5 & 8: Unified Transactions and Admin Feature Status Test Suite', () => {
  let mongoServer: MongoMemoryServer;
  let adminCookie: string;
  let adminUserId: string;
  let bankAccountId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // 1. Register Admin User
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'admin.unified@m12tracker.com',
        password: 'Password123!',
        fullName: 'Admin Unified Test',
        currency: 'INR',
        requireVerification: false,
      });

    adminCookie = regRes.headers['set-cookie']?.[0] || '';
    adminUserId = regRes.body.data.user.id;

    // Promote to Admin
    await User.findByIdAndUpdate(adminUserId, { role: 'admin' });

    // 2. Create Bank Account
    const bankRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', adminCookie)
      .send({
        accountName: 'Primary Checking',
        bankName: 'HDFC Bank',
        accountType: 'salary',
        openingBalance: 50000,
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

  describe('1. Unified Transactions Projection & Monthly Filter', () => {
    let transactionId: string;
    let lendingRecordId: string;
    const currentYear = new Date().getFullYear();
    const currentMonthNum = String(new Date().getMonth() + 1).padStart(2, '0');
    const currentMonthKey = `${currentYear}-${currentMonthNum}`;

    it('creates a normal expense transaction and a hand-loan lending record', async () => {
      // Create regular transaction
      const txRes = await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', adminCookie)
        .send({
          title: 'Office Supplies',
          amount: 2500,
          type: 'expense',
          category: 'Office',
          paymentMethod: 'upi',
          paymentChannel: 'online',
          accountId: bankAccountId,
          date: new Date().toISOString(),
        });

      expect(txRes.status).toBe(201);
      transactionId = txRes.body.data.id;

      // Create Lending record
      const lbRes = await request(app)
        .post('/api/v1/lending-borrowing')
        .set('Cookie', adminCookie)
        .send({
          type: 'lending',
          personName: 'Ravi Kumar',
          amount: 5000,
          paymentMethod: 'upi',
          bankAccountId,
          date: new Date().toISOString(),
          description: 'Short term hand loan',
        });

      expect(lbRes.status).toBe(201);
      lendingRecordId = lbRes.body.data.id;
    });

    it('queries standard /api/v1/transactions without unified flag: returns only normal transactions', async () => {
      const res = await request(app)
        .get('/api/v1/transactions')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Only the 1 normal transaction should be returned
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe(transactionId);
    });

    it('queries /api/v1/transactions?unified=true: returns both normal and lending records merged', async () => {
      const res = await request(app)
        .get('/api/v1/transactions?unified=true')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(2);

      const lendingItem = res.body.data.find((item: any) => item.isLendingBorrowing === true);
      expect(lendingItem).toBeDefined();
      expect(lendingItem.id).toBe(`lb_${lendingRecordId}`);
      expect(lendingItem.title).toBe('Lent to Ravi Kumar');
      expect(lendingItem.amount).toBe(5000);
      expect(lendingItem.recordType).toBe('lending');

      expect(res.body.meta.hasMore).toBe(false);
      expect(res.body.meta.total).toBe(2);
    });

    it('filters unified transactions by month (Asia/Kolkata)', async () => {
      const res = await request(app)
        .get(`/api/v1/transactions?unified=true&month=${currentMonthKey}`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);

      // Future month returns 0 records
      const futureMonth = `${currentYear + 1}-01`;
      const emptyRes = await request(app)
        .get(`/api/v1/transactions?unified=true&month=${futureMonth}`)
        .set('Cookie', adminCookie);

      expect(emptyRes.status).toBe(200);
      expect(emptyRes.body.data.length).toBe(0);
    });

    it('filters transactions by independent year and month parameters', async () => {
      // Current year and month
      const ymRes = await request(app)
        .get(`/api/v1/transactions?unified=true&year=${currentYear}&month=${currentMonthNum}`)
        .set('Cookie', adminCookie);

      expect(ymRes.status).toBe(200);
      expect(ymRes.body.data.length).toBe(2);

      // Current year, all months
      const yAllRes = await request(app)
        .get(`/api/v1/transactions?unified=true&year=${currentYear}&month=all`)
        .set('Cookie', adminCookie);

      expect(yAllRes.status).toBe(200);
      expect(yAllRes.body.data.length).toBe(2);

      // All time
      const allTimeRes = await request(app)
        .get('/api/v1/transactions?unified=true&year=all')
        .set('Cookie', adminCookie);

      expect(allTimeRes.status).toBe(200);
      expect(allTimeRes.body.data.length).toBe(2);

      // Other year returns 0
      const otherYearRes = await request(app)
        .get(`/api/v1/transactions?unified=true&year=${currentYear - 2}`)
        .set('Cookie', adminCookie);

      expect(otherYearRes.status).toBe(200);
      expect(otherYearRes.body.data.length).toBe(0);
    });

    it('strictly isolates type filters and prevents lending/borrowing records from leaking into expense or investment', async () => {
      // type=expense: MUST only return regular transactions (NO lending/borrowing items)
      const expenseRes = await request(app)
        .get('/api/v1/transactions?unified=true&type=expense')
        .set('Cookie', adminCookie);

      expect(expenseRes.status).toBe(200);
      expect(expenseRes.body.data.length).toBe(1);
      expect(expenseRes.body.data[0].id).toBe(transactionId);
      expect(expenseRes.body.data[0].type).toBe('expense');
      expect(expenseRes.body.data[0].isLendingBorrowing).toBeUndefined();

      // type=investment: MUST return 0 records (NOT lending records!)
      const investmentRes = await request(app)
        .get('/api/v1/transactions?unified=true&type=investment')
        .set('Cookie', adminCookie);

      expect(investmentRes.status).toBe(200);
      expect(investmentRes.body.data.length).toBe(0);

      // type=lending: MUST only return lending records
      const lendingRes = await request(app)
        .get('/api/v1/transactions?unified=true&type=lending')
        .set('Cookie', adminCookie);

      expect(lendingRes.status).toBe(200);
      expect(lendingRes.body.data.length).toBe(1);
      expect(lendingRes.body.data[0].id).toBe(`lb_${lendingRecordId}`);
      expect(lendingRes.body.data[0].recordType).toBe('lending');

      // type=borrowing: returns 0 when no borrowing records exist
      const borrowingRes = await request(app)
        .get('/api/v1/transactions?unified=true&type=borrowing')
        .set('Cookie', adminCookie);

      expect(borrowingRes.status).toBe(200);
      expect(borrowingRes.body.data.length).toBe(0);
    });

    it('supports unified payment filtering (account:, method:, card:)', async () => {
      // Filter by bank account
      const accRes = await request(app)
        .get(`/api/v1/transactions?unified=true&payment=account:${bankAccountId}`)
        .set('Cookie', adminCookie);

      expect(accRes.status).toBe(200);
      expect(accRes.body.data.length).toBe(2);

      // Filter by UPI payment method
      const upiRes = await request(app)
        .get('/api/v1/transactions?unified=true&payment=method:upi')
        .set('Cookie', adminCookie);

      expect(upiRes.status).toBe(200);
      expect(upiRes.body.data.length).toBe(2);

      // Filter by Cash payment method (none recorded yet)
      const cashRes = await request(app)
        .get('/api/v1/transactions?unified=true&payment=method:cash')
        .set('Cookie', adminCookie);

      expect(cashRes.status).toBe(200);
      expect(cashRes.body.data.length).toBe(0);
    });

    it('creates past lending with UPI + bank account without debiting the live balance, preserving account link', async () => {
      // Check current bank balance
      const accountBefore = await BankAccount.findById(bankAccountId);
      const balanceBefore = accountBefore!.currentBalance;

      // Create Past Lending with UPI against the bank account
      const pastLendingRes = await request(app)
        .post('/api/v1/lending-borrowing')
        .set('Cookie', adminCookie)
        .send({
          type: 'lending',
          personName: 'Suresh Raina',
          amount: 15000,
          paymentMethod: 'upi',
          bankAccountId,
          isHistorical: true,
          date: new Date().toISOString(),
          description: 'Past loan from last year',
        });

      expect(pastLendingRes.status).toBe(201);
      const pastLendingId = pastLendingRes.body.data.id;
      expect(pastLendingRes.body.data.isHistorical).toBe(true);
      expect(pastLendingRes.body.data.bankAccountId).toBe(bankAccountId);

      // Verify bank account was NOT debited
      const accountAfter = await BankAccount.findById(bankAccountId);
      expect(accountAfter!.currentBalance).toBe(balanceBefore);

      // Verify the past loan appears in unified transactions with its bank account populated
      const txRes = await request(app)
        .get(`/api/v1/transactions?unified=true&type=lending`)
        .set('Cookie', adminCookie);

      expect(txRes.status).toBe(200);
      const found = txRes.body.data.find((item: any) => item.id === `lb_${pastLendingId}`);
      expect(found).toBeDefined();
      expect(found.accountId).toBe(bankAccountId);
      expect(found.isHistorical).toBe(true);
    });

    it('toggles past lending to live lending and vice-versa, adjusting bank balances atomically', async () => {
      // 1. Create a live loan of 10,000 (debits bank account)
      const liveRes = await request(app)
        .post('/api/v1/lending-borrowing')
        .set('Cookie', adminCookie)
        .send({
          type: 'lending',
          personName: 'Vikram Singh',
          amount: 10000,
          paymentMethod: 'upi',
          bankAccountId,
          isHistorical: false,
          date: new Date().toISOString(),
        });

      expect(liveRes.status).toBe(201);
      const loanId = liveRes.body.data.id;

      const accAfterLive = await BankAccount.findById(bankAccountId);
      const balanceAfterLive = accAfterLive!.currentBalance;

      // 2. Edit to mark as Past Lending (isHistorical = true) -> balance must be credited back 10,000
      const editToPastRes = await request(app)
        .patch(`/api/v1/lending-borrowing/${loanId}`)
        .set('Cookie', adminCookie)
        .send({
          isHistorical: true,
          bankAccountId,
          paymentMethod: 'upi',
        });

      expect(editToPastRes.status).toBe(200);
      expect(editToPastRes.body.data.isHistorical).toBe(true);

      const accAfterEditToPast = await BankAccount.findById(bankAccountId);
      expect(accAfterEditToPast!.currentBalance).toBe(balanceAfterLive + 10000);

      // 3. Edit back to Live Lending (isHistorical = false) -> balance must be debited back 10,000
      const editBackToLiveRes = await request(app)
        .patch(`/api/v1/lending-borrowing/${loanId}`)
        .set('Cookie', adminCookie)
        .send({
          isHistorical: false,
          bankAccountId,
          paymentMethod: 'upi',
        });

      expect(editBackToLiveRes.status).toBe(200);
      expect(editBackToLiveRes.body.data.isHistorical).toBe(false);

      const accAfterEditBack = await BankAccount.findById(bankAccountId);
      expect(accAfterEditBack!.currentBalance).toBe(balanceAfterLive);
    });

    it('prevents modifying or deleting lending records through the transactions endpoint', async () => {
      const deleteRes = await request(app)
        .delete(`/api/v1/transactions/lb_${lendingRecordId}`)
        .set('Cookie', adminCookie);

      expect(deleteRes.status).toBe(400);
      expect(deleteRes.body.error.code).toBe('CANNOT_MODIFY_LENDING_RECORD_HERE');

      const updateRes = await request(app)
        .patch(`/api/v1/transactions/lb_${lendingRecordId}`)
        .set('Cookie', adminCookie)
        .send({ title: 'Hacked Title' });

      expect(updateRes.status).toBe(400);
      expect(updateRes.body.error.code).toBe('CANNOT_MODIFY_LENDING_RECORD_HERE');
    });
  });

  describe('2. Admin Feature Status & 12-Module Overview', () => {
    it('retrieves feature status and system health for administrator', async () => {
      const res = await request(app)
        .get('/api/v1/admin/feature-status')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const { systemHealth, userStatistics, modules } = res.body.data;

      expect(systemHealth.status).toBe('healthy');
      expect(systemHealth.database).toBe('connected');
      expect(typeof systemHealth.uptimeSeconds).toBe('number');

      expect(userStatistics.totalUsers).toBeGreaterThanOrEqual(1);
      expect(userStatistics.adminUsers).toBeGreaterThanOrEqual(1);

      expect(Array.isArray(modules)).toBe(true);
      expect(modules.length).toBe(12);

      const moduleIds = modules.map((m: any) => m.id);
      expect(moduleIds).toContain('analytics');
      expect(moduleIds).toContain('accounts');
      expect(moduleIds).toContain('credit_cards');
      expect(moduleIds).toContain('transactions');
      expect(moduleIds).toContain('lending_borrowing');
      expect(moduleIds).toContain('emi');
      expect(moduleIds).toContain('chit_fund');
      expect(moduleIds).toContain('investments');
      expect(moduleIds).toContain('budgets');
      expect(moduleIds).toContain('recurring');
      expect(moduleIds).toContain('reports');
      expect(moduleIds).toContain('security_admin');

      for (const m of modules) {
        expect(m.status).toBe('active');
        expect(typeof m.recordCount).toBe('number');
      }
    });
  });
});
