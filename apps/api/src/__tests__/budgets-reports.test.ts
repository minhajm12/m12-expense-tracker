import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import {
  TransactionType,
  PaymentMethod,
  PaymentChannel,
  AccountType,
  RecurringFrequency,
} from '@finora/shared';

describe('Phase 6: Budgets, Recurring Schedules, Reports & Administration Test Suite', () => {
  let mongoServer: MongoMemoryServer;
  let user1Cookie: string;
  let user2Cookie: string;
  let bankAccountId: string;
  let destAccountId: string;
  let budgetId: string;
  let recurringRuleId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // Register User 1
    const auth1 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'user1.phase6@finora.test',
        password: 'Password123!',
        fullName: 'Budget Master One',
        currency: 'INR',
      });
    user1Cookie = auth1.headers['set-cookie'][0];

    // Register User 2 (for tenant isolation verification)
    const auth2 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'user2.phase6@finora.test',
        password: 'Password123!',
        fullName: 'Tenant Two',
        currency: 'INR',
      });
    user2Cookie = auth2.headers['set-cookie'][0];

    // Create Bank Account for User 1 with ₹50,000 opening balance
    const bankRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', user1Cookie)
      .send({
        accountName: 'Primary Checking',
        bankName: 'HDFC Bank',
        accountType: AccountType.SAVINGS,
        openingBalance: 50000,
        openingBalanceDate: '2026-01-01T00:00:00.000Z',
      });
    bankAccountId = bankRes.body.data.id;

    // Create Second Account for User 1 (for transfers)
    const destRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', user1Cookie)
      .send({
        accountName: 'Savings Reserve',
        bankName: 'ICICI Bank',
        accountType: AccountType.SAVINGS,
        openingBalance: 10000,
        openingBalanceDate: '2026-01-01T00:00:00.000Z',
      });
    destAccountId = destRes.body.data.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  describe('Budgets Management & Server-Authoritative Progress Calculation', () => {
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const endOfMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59).toISOString();

    it('creates a monthly budget with limit and threshold', async () => {
      const res = await request(app)
        .post('/api/v1/budgets')
        .set('Cookie', user1Cookie)
        .send({
          category: 'Food',
          limitAmount: 10000,
          period: 'monthly',
          startDate: startOfMonth,
          endDate: endOfMonth,
          alertThresholdPercent: 80,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.limitAmount).toBe(10000);
      expect(res.body.data.spentAmount).toBe(0);
      expect(res.body.data.remainingAmount).toBe(10000);
      expect(res.body.data.percentUsed).toBe(0);
      expect(res.body.data.isAlertTriggered).toBe(false);
      expect(res.body.data.isExceeded).toBe(false);

      budgetId = res.body.data.id;
    });

    it('updates spent amount and remaining correctly as expenses are posted', async () => {
      // 1. Post ₹6,000 expense (60% spent)
      await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', user1Cookie)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Grocery Mart',
          amount: 6000,
          currency: 'INR',
          date: new Date().toISOString(),
          category: 'Food',
          paymentMethod: PaymentMethod.UPI,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bankAccountId,
        });

      let res = await request(app)
        .get(`/api/v1/budgets/${budgetId}`)
        .set('Cookie', user1Cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.spentAmount).toBe(6000);
      expect(res.body.data.remainingAmount).toBe(4000);
      expect(res.body.data.percentUsed).toBe(60);
      expect(res.body.data.isAlertTriggered).toBe(false);
      expect(res.body.data.isExceeded).toBe(false);

      // 2. Post ₹2,500 expense (total ₹8,500 = 85% spent -> threshold alert triggered!)
      await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', user1Cookie)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Dinner at Bistro',
          amount: 2500,
          currency: 'INR',
          date: new Date().toISOString(),
          category: 'Food',
          paymentMethod: PaymentMethod.UPI,
          paymentChannel: PaymentChannel.OFFLINE,
          accountId: bankAccountId,
        });

      res = await request(app)
        .get(`/api/v1/budgets/${budgetId}`)
        .set('Cookie', user1Cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.spentAmount).toBe(8500);
      expect(res.body.data.remainingAmount).toBe(1500);
      expect(res.body.data.percentUsed).toBe(85);
      expect(res.body.data.isAlertTriggered).toBe(true);
      expect(res.body.data.isExceeded).toBe(false);

      // 3. Post ₹2,000 expense (total ₹10,500 = 105% spent -> budget exceeded!)
      await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', user1Cookie)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Bakery Treats',
          amount: 2000,
          currency: 'INR',
          date: new Date().toISOString(),
          category: 'Food',
          paymentMethod: PaymentMethod.UPI,
          paymentChannel: PaymentChannel.OFFLINE,
          accountId: bankAccountId,
        });

      res = await request(app)
        .get(`/api/v1/budgets/${budgetId}`)
        .set('Cookie', user1Cookie);

      expect(res.status).toBe(200);
      expect(res.body.data.spentAmount).toBe(10500);
      expect(res.body.data.remainingAmount).toBe(0);
      expect(res.body.data.percentUsed).toBe(105);
      expect(res.body.data.isAlertTriggered).toBe(true);
      expect(res.body.data.isExceeded).toBe(true);
    });

    it('excludes transfers and non-expense transactions from budget calculations', async () => {
      // Execute a ₹5,000 transfer between accounts
      await request(app)
        .post('/api/v1/transactions/transfer')
        .set('Cookie', user1Cookie)
        .send({
          sourceAccountId: bankAccountId,
          destinationAccountId: destAccountId,
          amount: 5000,
          date: new Date().toISOString(),
          idempotencyKey: 'transfer-test-p6-01',
        });

      const res = await request(app)
        .get(`/api/v1/budgets/${budgetId}`)
        .set('Cookie', user1Cookie);

      // Spent should still be ₹10,500, not ₹15,500
      expect(res.body.data.spentAmount).toBe(10500);
    });

    it('enforces multi-user isolation on budgets (User 2 cannot access or delete User 1 budget)', async () => {
      // User 2 attempts to get User 1 budget
      const getRes = await request(app)
        .get(`/api/v1/budgets/${budgetId}`)
        .set('Cookie', user2Cookie);

      expect(getRes.status).toBe(404);

      // User 2 attempts to delete User 1 budget
      const delRes = await request(app)
        .delete(`/api/v1/budgets/${budgetId}`)
        .set('Cookie', user2Cookie);

      expect(delRes.status).toBe(404);
    });
  });

  describe('Recurring Transactions & Manual Confirmation Workflow', () => {
    it('creates a recurring rule for recurring expense', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const res = await request(app)
        .post('/api/v1/recurring')
        .set('Cookie', user1Cookie)
        .send({
          title: 'High-speed Fiber Internet',
          amount: 1500,
          type: TransactionType.EXPENSE,
          category: 'Utilities',
          frequency: RecurringFrequency.MONTHLY,
          paymentMethod: PaymentMethod.UPI,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bankAccountId,
          nextExecutionDate: tomorrow.toISOString(),
          notes: 'Auto-debit bill',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe('High-speed Fiber Internet');
      expect(res.body.data.amount).toBe(1500);
      expect(res.body.data.frequency).toBe('monthly');

      recurringRuleId = res.body.data.id;
    });

    it('executes recurring rule via user confirmation and updates account balance', async () => {
      // Get bank balance before execution
      const preAccRes = await request(app)
        .get(`/api/v1/accounts/${bankAccountId}`)
        .set('Cookie', user1Cookie);
      const balanceBefore = preAccRes.body.data.currentBalance;

      // Execute recurring rule
      const execRes = await request(app)
        .post(`/api/v1/recurring/${recurringRuleId}/execute`)
        .set('Cookie', user1Cookie);

      expect(execRes.status).toBe(200);
      expect(execRes.body.success).toBe(true);
      expect(execRes.body.data.transaction.title).toBe('High-speed Fiber Internet');
      expect(execRes.body.data.transaction.amount).toBe(1500);

      // Check next execution date advanced by ~1 month
      const updatedRule = execRes.body.data.recurringRule;
      const nextDate = new Date(updatedRule.nextExecutionDate);
      const originalTomorrow = new Date();
      originalTomorrow.setDate(originalTomorrow.getDate() + 1);
      expect(nextDate.getMonth()).not.toBe(originalTomorrow.getMonth());

      // Check bank balance deducted by ₹1,500
      const postAccRes = await request(app)
        .get(`/api/v1/accounts/${bankAccountId}`)
        .set('Cookie', user1Cookie);
      expect(postAccRes.body.data.currentBalance).toBe(balanceBefore - 1500);
    });
  });

  describe('Financial Reports & Safe CSV Export with Formula Injection Protection', () => {
    beforeAll(async () => {
      // Create transactions with potentially dangerous formula prefixes (=, +, -, @)
      await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', user1Cookie)
        .send({
          type: TransactionType.EXPENSE,
          title: '=cmd|\' /C calc\'!A0', // Formula injection payload
          amount: 250,
          currency: 'INR',
          date: new Date().toISOString(),
          category: 'Utilities',
          paymentMethod: PaymentMethod.UPI,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bankAccountId,
          merchantOrRecipient: '@MaliciousMerchant',
          notes: '+1234567890 Phone note',
        });
    });

    it('generates structured financial report summary for date range', async () => {
      const res = await request(app)
        .get('/api/v1/reports')
        .set('Cookie', user1Cookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.summary).toHaveProperty('totalIncome');
      expect(res.body.data.summary).toHaveProperty('totalExpenses');
      expect(res.body.data.summary).toHaveProperty('netCashFlow');
      expect(res.body.data.categoryBreakdown.length).toBeGreaterThan(0);
    });

    it('exports CSV with sanitized fields neutralizing formula injection', async () => {
      const res = await request(app)
        .get('/api/v1/reports/export-csv')
        .set('Cookie', user1Cookie);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment');

      const csv = res.text;
      // Formula triggers must be prepended with a single quote
      expect(csv).toContain("'=cmd|' /C calc'!A0");
      expect(csv).toContain("'+1234567890 Phone note");
      expect(csv).toContain("'@MaliciousMerchant");
      // Raw unescaped formula should NOT be present
      expect(csv).not.toContain('\n=cmd|');

    });
  });

  describe('Reminders and Alerts Engine', () => {
    it('returns budget exceeded reminders and upcoming recurring schedules', async () => {
      const res = await request(app)
        .get('/api/v1/reminders')
        .set('Cookie', user1Cookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);

      const reminders = res.body.data;
      const budgetExceededAlert = reminders.find(
        (r: any) => r.type === 'budget_exceeded' && r.title.includes('Food')
      );
      expect(budgetExceededAlert).toBeDefined();
      expect(budgetExceededAlert.severity).toBe('danger');
    });
  });

  describe('Admin Audit Logs & Traceability', () => {
    it('records administrative actions in audit log and allows admin retrieval', async () => {
      // Bootstrap first admin
      const bootstrapRes = await request(app)
        .post('/api/v1/admin/bootstrap')
        .send({
          email: 'admin.phase6@finora.test',
          password: 'AdminPassword123!',
          fullName: 'System Administrator',
          currency: 'INR',
        });
      const adminCookie = bootstrapRes.headers['set-cookie'][0];

      // Retrieve audit logs
      const auditRes = await request(app)
        .get('/api/v1/admin/audit-logs')
        .set('Cookie', adminCookie);

      expect(auditRes.status).toBe(200);
      expect(auditRes.body.success).toBe(true);
      expect(auditRes.body.data.length).toBeGreaterThan(0);
      const bootstrapLog = auditRes.body.data.find(
        (l: any) => l.action === 'BOOTSTRAP_CREATED_FIRST_ADMIN'
      );
      expect(bootstrapLog).toBeDefined();
    });
  });
});
