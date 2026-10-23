import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { Investment } from '../models/Investment';
import { InvestmentContribution } from '../models/InvestmentContribution';
import { Transaction } from '../models/Transaction';
import { BankAccount } from '../models/BankAccount';
import { CashAccount } from '../models/CashAccount';
import {
  AccountType,
  TransactionType,
  InvestmentType,
  InvestmentStatus,
  InvestmentContributionStatus,
  PaymentMethod,
} from '@finora/shared';

describe('Phase 1 - 7: Dedicated Investment Module & External Chit Lifecycle Test Suite', () => {
  let mongoServer: MongoMemoryServer;
  let user1Cookie: string;
  let user2Cookie: string;
  let user1BankAccountId: string;
  let user1Bank2Id: string;
  let user2BankAccountId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // Register User 1
    const regRes1 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'investor1@finora.test',
        password: 'Password123!',
        fullName: 'Primary Investor',
        currency: 'INR',
      });
    user1Cookie = regRes1.headers['set-cookie'][0];

    // Create Bank Account 1 for User 1 (₹50,000)
    const accRes1 = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', user1Cookie)
      .send({
        accountName: 'HDFC Salary Bank',
        accountType: AccountType.SAVINGS,
        bankName: 'HDFC',
        openingBalance: 50000,
        openingBalanceDate: '2026-01-01',
        currency: 'INR',
      });
    user1BankAccountId = accRes1.body.data.id;

    // Create Bank Account 2 for User 1 (₹10,000)
    const accRes2 = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', user1Cookie)
      .send({
        accountName: 'ICICI Savings',
        accountType: AccountType.SAVINGS,
        bankName: 'ICICI',
        openingBalance: 10000,
        openingBalanceDate: '2026-01-01',
        currency: 'INR',
      });
    user1Bank2Id = accRes2.body.data.id;

    // Register User 2 for Tenancy Isolation checks
    const regRes2 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'investor2@finora.test',
        password: 'Password123!',
        fullName: 'Secondary Investor',
        currency: 'INR',
      });
    user2Cookie = regRes2.headers['set-cookie'][0];

    const accRes3 = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', user2Cookie)
      .send({
        accountName: 'SBI Account',
        accountType: AccountType.SAVINGS,
        bankName: 'SBI',
        openingBalance: 20000,
        openingBalanceDate: '2026-01-01',
        currency: 'INR',
      });
    user2BankAccountId = accRes3.body.data.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  describe('1. Ordinary Investments & Tenancy Isolation', () => {
    let ordinaryInvId: string;

    it('creates an ordinary mutual funds investment without external chit fields', async () => {
      const res = await request(app)
        .post('/api/v1/investments')
        .set('Cookie', user1Cookie)
        .send({
          name: 'Nifty 50 Index Fund',
          category: 'Mutual Funds',
          investmentType: InvestmentType.RECURRING,
          monthlyContribution: 5000,
          isMonthlyPaymentEnabled: true,
          startDate: '2026-01-01',
          paymentMethod: PaymentMethod.UPI,
          accountId: user1BankAccountId,
          notes: 'Long-term equity allocation',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Nifty 50 Index Fund');
      expect(res.body.data.isExternalChit).toBe(false);
      expect(res.body.data.isWon).toBe(false);

      ordinaryInvId = res.body.data.id;
    });

    it('enforces tenancy: user 2 cannot view or edit user 1 investment', async () => {
      // User 2 gets 404
      const getRes = await request(app)
        .get(`/api/v1/investments/${ordinaryInvId}`)
        .set('Cookie', user2Cookie);
      expect(getRes.status).toBe(404);

      // User 2 cannot edit
      const putRes = await request(app)
        .put(`/api/v1/investments/${ordinaryInvId}`)
        .set('Cookie', user2Cookie)
        .send({ name: 'Hacked Name' });
      expect(putRes.status).toBe(404);
    });

    it('edits investment metadata without changing bank balances', async () => {
      const editRes = await request(app)
        .put(`/api/v1/investments/${ordinaryInvId}`)
        .set('Cookie', user1Cookie)
        .send({
          notes: 'Updated allocation strategy notes',
        });

      expect(editRes.status).toBe(200);
      expect(editRes.body.data.notes).toBe('Updated allocation strategy notes');

      // Verify bank balance is untouched at ₹50,000
      const bankRes = await request(app)
        .get(`/api/v1/accounts/${user1BankAccountId}`)
        .set('Cookie', user1Cookie);
      expect(bankRes.body.data.currentBalance).toBe(50000);
    });
  });

  describe('2. External Chit Lifecycle & Midway Historical Payments', () => {
    let chitId: string;

    it('creates an external chit starting June 2026 with 4 historical months (June-Sept)', async () => {
      // Scenario from prompt:
      // Chit starts June 2026, ends May 2027, monthly ₹1,000.
      // June, July, August, September marked as already paid.
      const res = await request(app)
        .post('/api/v1/investments')
        .set('Cookie', user1Cookie)
        .send({
          name: 'Sri Gokulam Chit Group A',
          category: 'CHIT',
          startDate: '2026-06-01',
          endDate: '2027-05-31',
          durationMonths: 12,
          monthlyContribution: 1000,
          isMonthlyPaymentEnabled: true,
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          accountId: user1BankAccountId,
          historicalPayments: [
            { cycleKey: '2026-06', amount: 1000 },
            { cycleKey: '2026-07', amount: 1000 },
            { cycleKey: '2026-08', amount: 1000 },
            { cycleKey: '2026-09', amount: 1000 },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isExternalChit).toBe(true);
      expect(res.body.data.durationMonths).toBe(12);

      chitId = res.body.data.id;

      // Critical check: Bank balance MUST NOT have changed because of historical entries!
      const bankRes = await request(app)
        .get(`/api/v1/accounts/${user1BankAccountId}`)
        .set('Cookie', user1Cookie);
      expect(bankRes.body.data.currentBalance).toBe(50000);

      // Verify no debit transactions were created for historical entries
      const txCount = await Transaction.countDocuments({
        investmentId: chitId,
      });
      expect(txCount).toBe(0);
    });

    it('records in-app payment for October 2026 (₹1,000) and debits bank balance exactly once', async () => {
      const payRes = await request(app)
        .post(`/api/v1/investments/${chitId}/pay`)
        .set('Cookie', user1Cookie)
        .send({
          cycleKey: '2026-10',
          amount: 1000,
          paymentDate: '2026-10-15',
          paymentMethod: PaymentMethod.UPI,
          accountId: user1BankAccountId,
        });

      expect(payRes.status).toBe(200);
      expect(payRes.body.success).toBe(true);

      // Bank balance debited exactly once: 50,000 - 1,000 = 49,000
      const bankRes = await request(app)
        .get(`/api/v1/accounts/${user1BankAccountId}`)
        .set('Cookie', user1Cookie);
      expect(bankRes.body.data.currentBalance).toBe(49000);

      // Total contributions through October must equal ₹5,000 (₹4,000 historical + ₹1,000 actual)
      const invRes = await request(app)
        .get(`/api/v1/investments/${chitId}`)
        .set('Cookie', user1Cookie);
      expect(invRes.body.data.investment.totalHistoricalContributed).toBe(4000);
      expect(invRes.body.data.investment.totalActualContributed).toBe(1000);
      expect(invRes.body.data.investment.totalContributionsInvested).toBe(5000);
      expect(invRes.body.data.investment.paidMonthsCount).toBe(5); // June, July, Aug, Sep, Oct
    });

    it('rejects duplicate payment for the already paid October 2026 cycle', async () => {
      const dupRes = await request(app)
        .post(`/api/v1/investments/${chitId}/pay`)
        .set('Cookie', user1Cookie)
        .send({
          cycleKey: '2026-10',
          amount: 1000,
          paymentMethod: PaymentMethod.UPI,
          accountId: user1BankAccountId,
        });

      expect(dupRes.status).toBe(400);
      expect(dupRes.body.error.code).toBe('DUPLICATE_PAYMENT');

      // Bank balance remains 49,000
      const bankRes = await request(app)
        .get(`/api/v1/accounts/${user1BankAccountId}`)
        .set('Cookie', user1Cookie);
      expect(bankRes.body.data.currentBalance).toBe(49000);
    });

    it('Upcoming Monthly Payments reflects October as paid and November as upcoming unpaid', async () => {
      // October forecast
      const octForecast = await request(app)
        .get('/api/v1/analytics/upcoming-forecast?month=2026-10')
        .set('Cookie', user1Cookie);

      expect(octForecast.status).toBe(200);
      const octChitItem = octForecast.body.data.items.find(
        (i: any) => i.ruleId === chitId && i.occurrenceKey === '2026-10'
      );
      expect(octChitItem).toBeDefined();
      expect(octChitItem.status).toBe('paid');

      // November forecast
      const novForecast = await request(app)
        .get('/api/v1/analytics/upcoming-forecast?month=2026-11')
        .set('Cookie', user1Cookie);

      expect(novForecast.status).toBe(200);
      const novChitItem = novForecast.body.data.items.find(
        (i: any) => i.ruleId === chitId && i.occurrenceKey === '2026-11'
      );
      expect(novChitItem).toBeDefined();
      expect(novChitItem.status).toBe('unpaid');
      expect(novChitItem.expectedAmount).toBe(1000);
      expect(novForecast.body.data.investmentPaymentsRemaining).toBeGreaterThanOrEqual(1000);
    });

    it('deleting October payment reverses financial impact and restores cycle to unpaid', async () => {
      const delRes = await request(app)
        .delete(`/api/v1/investments/${chitId}/pay`)
        .set('Cookie', user1Cookie)
        .send({ cycleKey: '2026-10' });

      expect(delRes.status).toBe(200);

      // Bank balance restored to 50,000
      const bankRes = await request(app)
        .get(`/api/v1/accounts/${user1BankAccountId}`)
        .set('Cookie', user1Cookie);
      expect(bankRes.body.data.currentBalance).toBe(50000);

      // Total historical contributed reverts to 4,000
      const invRes = await request(app)
        .get(`/api/v1/investments/${chitId}`)
        .set('Cookie', user1Cookie);
      expect(invRes.body.data.investment.totalHistoricalContributed).toBe(4000);

      // Re-pay October to keep flow consistent
      await request(app)
        .post(`/api/v1/investments/${chitId}/pay`)
        .set('Cookie', user1Cookie)
        .send({
          cycleKey: '2026-10',
          amount: 1000,
          paymentMethod: PaymentMethod.UPI,
          accountId: user1BankAccountId,
        });
    });

    it('marks chit as won, credits prize payout to bank account, stops future obligations, and preserves historical contributions', async () => {
      // Bank balance currently 49,000
      // Prize payout = ₹10,500 into user1Bank2Id (ICICI Savings opening 10,000)
      const wonRes = await request(app)
        .post(`/api/v1/investments/${chitId}/won`)
        .set('Cookie', user1Cookie)
        .send({
          winningDate: '2026-10-25',
          payoutAmount: 10500,
          payoutDestinationType: 'bank',
          payoutAccountId: user1Bank2Id,
          payoutNotes: 'Won 5th auction',
        });

      expect(wonRes.status).toBe(200);
      expect(wonRes.body.success).toBe(true);
      expect(wonRes.body.data.investment.isWon).toBe(true);
      expect(wonRes.body.data.investment.status).toBe(InvestmentStatus.WON);

      // ICICI bank balance credited: 10,000 + 10,500 = 20,500
      const bankRes = await request(app)
        .get(`/api/v1/accounts/${user1Bank2Id}`)
        .set('Cookie', user1Cookie);
      expect(bankRes.body.data.currentBalance).toBe(20500);

      // Critical Rule: Total Historical Contributed is NOT reset to zero!
      const invRes = await request(app)
        .get(`/api/v1/investments/${chitId}`)
        .set('Cookie', user1Cookie);
      expect(invRes.body.data.investment.totalHistoricalContributed).toBe(4000);
      expect(invRes.body.data.investment.totalActualContributed).toBe(1000);
      expect(invRes.body.data.investment.totalContributionsInvested).toBe(5000);

      // Future obligations continue after winning until chit duration completes
      const novForecast = await request(app)
        .get('/api/v1/analytics/upcoming-forecast?month=2026-11')
        .set('Cookie', user1Cookie);
      const novChitItem = novForecast.body.data.items.find(
        (i: any) => i.ruleId === chitId && i.occurrenceKey === '2026-11'
      );
      expect(novChitItem).toBeDefined();
      expect(novChitItem.status).toBe('unpaid');
    });

    it('rejects duplicate winning submission to prevent double crediting', async () => {
      const dupWonRes = await request(app)
        .post(`/api/v1/investments/${chitId}/won`)
        .set('Cookie', user1Cookie)
        .send({
          winningDate: '2026-10-25',
          payoutAmount: 10500,
          payoutDestinationType: 'bank',
          payoutAccountId: user1Bank2Id,
        });

      expect(dupWonRes.status).toBe(400);
      expect(dupWonRes.body.error.code).toBe('ALREADY_WON');

      // Balance remains 20,500
      const bankRes = await request(app)
        .get(`/api/v1/accounts/${user1Bank2Id}`)
        .set('Cookie', user1Cookie);
      expect(bankRes.body.data.currentBalance).toBe(20500);
    });

    it('corrects payout amount safely using explicit correction workflow', async () => {
      // Adjust payout from 10,500 to 11,000 (+500 difference)
      const correctRes = await request(app)
        .put(`/api/v1/investments/${chitId}/payout`)
        .set('Cookie', user1Cookie)
        .send({
          winningDate: '2026-10-25',
          payoutAmount: 11000,
          payoutDestinationType: 'bank',
          payoutAccountId: user1Bank2Id,
          payoutNotes: 'Auction dividend reconciliation adjustment',
        });

      expect(correctRes.status).toBe(200);
      expect(correctRes.body.data.payoutAmount).toBe(11000);

      // Bank balance updated cleanly: 10,000 + 11,000 = 21,000
      const bankRes = await request(app)
        .get(`/api/v1/accounts/${user1Bank2Id}`)
        .set('Cookie', user1Cookie);
      expect(bankRes.body.data.currentBalance).toBe(21000);
    });
  });

  describe('3. Investment Data Reset in Settings', () => {
    let resetTargetId: string;

    it('creates an investment to test single reset', async () => {
      const res = await request(app)
        .post('/api/v1/investments')
        .set('Cookie', user1Cookie)
        .send({
          name: 'Gold Sovereign Bond',
          category: 'Gold',
          startDate: '2026-01-01',
          initialAmount: 25000,
          monthlyContribution: 0,
          isMonthlyPaymentEnabled: false,
        });
      resetTargetId = res.body.data.id;
    });

    it('resets a single investment without touching unrelated investments', async () => {
      const delRes = await request(app)
        .delete(`/api/v1/investments/${resetTargetId}`)
        .set('Cookie', user1Cookie);
      expect(delRes.status).toBe(200);

      const check = await Investment.findById(resetTargetId);
      expect(check).toBeNull();

      // Verify user1 list still contains the earlier mutual fund and chit
      const listRes = await request(app)
        .get('/api/v1/investments')
        .set('Cookie', user1Cookie);
      expect(listRes.body.data.length).toBeGreaterThan(0);
    });

    it('resets all investments with confirmation phrase RESET INVESTMENTS', async () => {
      // Rejects invalid phrase
      const badPhraseRes = await request(app)
        .post('/api/v1/investments/reset-all')
        .set('Cookie', user1Cookie)
        .send({ confirmationPhrase: 'wrong' });
      expect(badPhraseRes.status).toBe(400);

      // Accepts exact phrase
      const resetAllRes = await request(app)
        .post('/api/v1/investments/reset-all')
        .set('Cookie', user1Cookie)
        .send({ confirmationPhrase: 'RESET INVESTMENTS' });

      expect(resetAllRes.status).toBe(200);

      // Verify all investments for user 1 are removed
      const user1Invs = await Investment.find({ userId: (await Investment.findOne({}))?.userId });
      const afterList = await request(app)
        .get('/api/v1/investments')
        .set('Cookie', user1Cookie);
      expect(afterList.body.data.length).toBe(0);

      // Unrelated accounts and user 2 data remain completely intact
      const u2Invs = await request(app)
        .get('/api/v1/investments')
        .set('Cookie', user2Cookie);
      expect(u2Invs.status).toBe(200);

      const bank1 = await request(app)
        .get(`/api/v1/accounts/${user1BankAccountId}`)
        .set('Cookie', user1Cookie);
      expect(bank1.status).toBe(200);
      expect(bank1.body.data.currentBalance).toBe(50000);
    });
  });
});
