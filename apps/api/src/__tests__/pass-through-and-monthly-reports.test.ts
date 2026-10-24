import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { User } from '../models/User';
import { BankAccount } from '../models/BankAccount';
import { Transaction } from '../models/Transaction';
import { PassThroughMoney } from '../models/PassThroughMoney';
import {
  AccountType,
  TransactionType,
  TransactionStatus,
  PaymentMethod,
  PaymentChannel,
} from '@finora/shared';
import { getTotalCashSummary } from '../services/financial';

describe('Pass-Through Money Accounting & Monthly Income/Expense Reports', () => {
  let mongoServer: MongoMemoryServer;
  let user1Token: string;
  let user1Id: string;
  let user2Token: string;
  let user2Id: string;
  let user1AccountId: string;
  let user2AccountId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await connectDatabase(uri);

    // Create User 1
    const res1 = await request(app).post('/api/v1/auth/register').send({
      fullName: 'User One',
      email: 'user1@passthrough.test',
      password: 'Password123!',
      currency: 'INR',
      requireVerification: false,
    });
    user1Token = res1.body.data.token;
    user1Id = res1.body.data.user.id || res1.body.data.user._id;

    // Create User 2
    const res2 = await request(app).post('/api/v1/auth/register').send({
      fullName: 'User Two',
      email: 'user2@passthrough.test',
      password: 'Password123!',
      currency: 'INR',
      requireVerification: false,
    });
    user2Token = res2.body.data.token;
    user2Id = res2.body.data.user.id || res2.body.data.user._id;

    // Create User 1 Bank Account with 50,000 opening balance
    const acc1 = await BankAccount.create({
      userId: user1Id,
      accountName: 'HDFC Savings',
      bankName: 'HDFC Bank',
      accountType: AccountType.SAVINGS,
      openingBalance: 50000,
      currentBalance: 50000,
      currency: 'INR',
    });
    user1AccountId = acc1._id.toString();

    // Create User 2 Bank Account with 10,000 opening balance
    const acc2 = await BankAccount.create({
      userId: user2Id,
      accountName: 'SBI Savings',
      bankName: 'SBI',
      accountType: AccountType.SAVINGS,
      openingBalance: 10000,
      currentBalance: 10000,
      currency: 'INR',
    });
    user2AccountId = acc2._id.toString();
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  describe('Pass-Through Money Accounting & Isolation', () => {
    let recordId: string;

    it('1. records pass-through money received and increases bank balance without creating a normal transaction', async () => {
      const res = await request(app)
        .post('/api/v1/pass-through')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          senderName: 'Ramesh Sharma',
          receivedAmount: 10000,
          receivedDate: '2026-10-15',
          receivingBankAccountId: user1AccountId,
          reference: 'IMPS/987654321',
          notes: 'Received to transfer to vendor',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.record.senderName).toBe('Ramesh Sharma');
      expect(res.body.data.record.receivedAmount).toBe(10000);
      expect(res.body.data.record.outstandingAmount).toBe(10000);
      expect(res.body.data.record.totalSentAmount).toBe(0);
      expect(res.body.data.record.status).toBe('pending');
      expect(res.body.data.updatedBankBalance).toBe(60000); // 50,000 + 10,000

      recordId = res.body.data.record._id || res.body.data.record.id;

      // Verify NO record created in transactions collection
      const txCount = await Transaction.countDocuments({ userId: user1Id });
      expect(txCount).toBe(0);

      // Verify bank account directly in DB has 60,000
      const dbAcc = await BankAccount.findById(user1AccountId);
      expect(dbAcc!.currentBalance).toBe(60000);
    });

    it('2. excludes held pass-through funds from personal available balance in cash summary', async () => {
      const summary = await getTotalCashSummary(user1Id);
      // Total bank balance is 60,000
      expect(summary.totalBankBalance).toBe(60000);
      // Held pass-through is 10,000
      expect(summary.heldPassThroughFunds).toBe(10000);
      // Personal available balance is 60,000 - 10,000 = 50,000!
      expect(summary.totalPersonalAvailableBalance).toBe(50000);
    });

    it('3. records partial send, updates outstanding and status to partially_sent, and decreases bank balance', async () => {
      const res = await request(app)
        .post(`/api/v1/pass-through/${recordId}/send`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          recipientName: 'Suresh Hardware',
          amount: 6000,
          date: '2026-10-16',
          bankAccountId: user1AccountId,
          reference: 'UPI/123456',
          notes: 'Part 1 payment',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.record.totalSentAmount).toBe(6000);
      expect(res.body.data.record.outstandingAmount).toBe(4000);
      expect(res.body.data.record.status).toBe('partially_sent');
      expect(res.body.data.record.sends).toHaveLength(1);
      expect(res.body.data.updatedBankBalance).toBe(54000); // 60,000 - 6,000

      // Bank account in DB is 54,000
      const dbAcc = await BankAccount.findById(user1AccountId);
      expect(dbAcc!.currentBalance).toBe(54000);

      // Still 0 normal transactions
      const txCount = await Transaction.countDocuments({ userId: user1Id });
      expect(txCount).toBe(0);
    });

    it('4. rejects send amount exceeding outstanding balance', async () => {
      const res = await request(app)
        .post(`/api/v1/pass-through/${recordId}/send`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          recipientName: 'Suresh Hardware',
          amount: 5000, // Outstanding is only 4,000!
          date: '2026-10-17',
          bankAccountId: user1AccountId,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AMOUNT_EXCEEDS_OUTSTANDING');
    });

    it('5. enforces multi-user security: User 2 cannot access or send from User 1 pass-through record', async () => {
      const res = await request(app)
        .post(`/api/v1/pass-through/${recordId}/send`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({
          recipientName: 'Attacker',
          amount: 1000,
          date: '2026-10-17',
          bankAccountId: user2AccountId,
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('RECORD_NOT_FOUND');
    });

    it('6. completes pass-through record on full transfer and sets outstanding to 0 and status to completed', async () => {
      const res = await request(app)
        .post(`/api/v1/pass-through/${recordId}/send`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          recipientName: 'Suresh Hardware',
          amount: 4000, // Remaining 4,000
          date: '2026-10-18',
          bankAccountId: user1AccountId,
          notes: 'Final settlement',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.record.totalSentAmount).toBe(10000);
      expect(res.body.data.record.outstandingAmount).toBe(0);
      expect(res.body.data.record.status).toBe('completed');
      expect(res.body.data.record.sends).toHaveLength(2);
      expect(res.body.data.updatedBankBalance).toBe(50000); // 54,000 - 4,000 = 50,000 original!

      // Cash summary held pass-through is now 0
      const summary = await getTotalCashSummary(user1Id);
      expect(summary.heldPassThroughFunds).toBe(0);
      expect(summary.totalPersonalAvailableBalance).toBe(50000);
    });

    it('7. lists records with overview metrics', async () => {
      const res = await request(app)
        .get('/api/v1/pass-through')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.overview.totalReceived).toBe(10000);
      expect(res.body.data.overview.totalSent).toBe(10000);
      expect(res.body.data.overview.totalOutstanding).toBe(0);
      expect(res.body.data.overview.completedCount).toBe(1);
      expect(res.body.data.overview.openCount).toBe(0);
      expect(res.body.data.records).toHaveLength(1);
      expect(res.body.data.records[0].receivingBankAccountName).toBe('HDFC Savings');
    });
  });

  describe('Monthly Expenses & Monthly Income Reports', () => {
    beforeAll(async () => {
      // Seed regular expense and income transactions in October 2026
      await Transaction.create([
        {
          userId: user1Id,
          type: TransactionType.EXPENSE,
          title: 'Grocery Supermarket',
          amount: 3500,
          currency: 'INR',
          date: new Date('2026-10-05T10:00:00Z'),
          category: 'Groceries',
          paymentMethod: PaymentMethod.NET_BANKING,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: user1AccountId,
          status: TransactionStatus.COMPLETED,
        },
        {
          userId: user1Id,
          type: TransactionType.EXPENSE,
          title: 'Electricity Bill',
          amount: 2200,
          currency: 'INR',
          date: new Date('2026-10-10T14:00:00Z'),
          category: 'Utilities',
          paymentMethod: PaymentMethod.NET_BANKING,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: user1AccountId,
          status: TransactionStatus.COMPLETED,
        },
        {
          userId: user1Id,
          type: TransactionType.CREDIT_CARD_REFUND,
          title: 'Grocery Item Refund',
          amount: 500,
          currency: 'INR',
          date: new Date('2026-10-12T16:00:00Z'),
          category: 'Groceries',
          paymentMethod: PaymentMethod.NET_BANKING,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: user1AccountId,
          status: TransactionStatus.COMPLETED,
        },
        {
          userId: user1Id,
          type: TransactionType.INCOME,
          title: 'Consulting Retainer',
          amount: 75000,
          currency: 'INR',
          date: new Date('2026-10-01T09:00:00Z'),
          category: 'Salary',
          paymentMethod: PaymentMethod.NET_BANKING,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: user1AccountId,
          status: TransactionStatus.COMPLETED,
        },
        {
          userId: user1Id,
          type: TransactionType.INCOME,
          title: 'Freelance Project',
          amount: 25000,
          currency: 'INR',
          date: new Date('2026-10-15T11:00:00Z'),
          category: 'Freelance income',
          paymentMethod: PaymentMethod.NET_BANKING,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: user1AccountId,
          status: TransactionStatus.COMPLETED,
        },
      ]);
    });

    it('8. calculates monthly expenses report correctly, including category breakdown and refund adjustment', async () => {
      const res = await request(app)
        .get('/api/v1/reports/expenses-summary?month=2026-10')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Expenses: 3,500 + 2,200 = 5,700 minus refund 500 = 5,200 net
      expect(res.body.data.totalExpenses).toBe(5200);
      expect(res.body.data.transactionCount).toBe(2);
      expect(res.body.data.highestCategory.name).toBe('Groceries');
      expect(res.body.data.highestCategory.amount).toBe(3500);
      expect(res.body.data.categoryBreakdown).toHaveLength(2);
      expect(res.body.data.largestExpenses).toHaveLength(2);
      expect(res.body.data.largestExpenses[0].title).toBe('Grocery Supermarket');
    });

    it('9. calculates monthly income report correctly, including daily trend and category breakdown', async () => {
      const res = await request(app)
        .get('/api/v1/reports/income-summary?month=2026-10')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Income: 75,000 + 25,000 = 100,000
      expect(res.body.data.allIncomeTotal).toBe(100000);
      expect(res.body.data.highestCategory.name).toBe('Salary');
      expect(res.body.data.highestCategory.amount).toBe(75000);
      expect(res.body.data.transactionCount).toBe(2);
      expect(res.body.data.largestIncomeEntries).toHaveLength(2);
      expect(res.body.data.dailyIncomeTrend).toHaveLength(31); // 31 days in October
    });

    it('10. verifies that pass-through money never leaks into monthly expenses or monthly income', async () => {
      const expRes = await request(app)
        .get('/api/v1/reports/expenses-summary?month=2026-10')
        .set('Authorization', `Bearer ${user1Token}`);

      const incRes = await request(app)
        .get('/api/v1/reports/income-summary?month=2026-10')
        .set('Authorization', `Bearer ${user1Token}`);

      // Ramesh Sharma pass-through receipt of 10,000 must NOT be in income
      expect(incRes.body.data.allIncomeTotal).toBe(100000);
      const incTitles = incRes.body.data.allTransactions.map((t: any) => t.title);
      expect(incTitles).not.toContain('Ramesh Sharma');

      // Suresh Hardware pass-through send of 10,000 must NOT be in expenses
      expect(expRes.body.data.totalExpenses).toBe(5200);
      const expTitles = expRes.body.data.allTransactions.map((t: any) => t.title);
      expect(expTitles).not.toContain('Suresh Hardware');
    });
  });
});
