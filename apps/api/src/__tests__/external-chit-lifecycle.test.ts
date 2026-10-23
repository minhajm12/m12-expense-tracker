import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { BankAccount } from '../models/BankAccount';
import { Transaction } from '../models/Transaction';
import { Investment } from '../models/Investment';
import { InvestmentContribution } from '../models/InvestmentContribution';
import {
  AccountType,
  PaymentMethod,
  PaymentChannel,
  InvestmentStatus,
  InvestmentContributionStatus,
} from '@finora/shared';

describe('Phase 1: External Chit Fund Lifecycle & Transaction Sync Suite', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let userId: string;
  let bankAccountId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await connectDatabase(uri);

    // Register user
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'chit.lifecycle@finora.test',
        password: 'Password123!',
        fullName: 'Chit Winner',
        currency: 'INR',
      });

    expect(res.status).toBe(201);
    const cookies = res.headers['set-cookie'];
    userCookie = Array.isArray(cookies) ? cookies[0] : cookies;
    userId = res.body.data.user.id;

    // Create Bank Account with ₹1,00,000
    const accRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'HDFC Savings',
        bankName: 'HDFC Bank',
        accountType: AccountType.SAVINGS,
        openingBalance: 100000,
        openingBalanceDate: '2026-06-01',
      });
    expect(accRes.status).toBe(201);
    bankAccountId = accRes.body.data.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  it('correctly creates a 12-month chit starting June 2026 with historical range June-Sept', async () => {
    const createRes = await request(app)
      .post('/api/v1/investments')
      .set('Cookie', userCookie)
      .send({
        name: 'Friends Group Chit',
        category: 'CHIT',
        startDate: '2026-06-10',
        durationMonths: 12,
        monthlyContribution: 1000,
        isMonthlyPaymentEnabled: true,
        historicalRange: {
          startMonth: '2026-06',
          endMonth: '2026-09',
        },
      });

    expect(createRes.status).toBe(201);
    const chitId = createRes.body.data._id || createRes.body.data.id;

    // Fetch detail
    const detailRes = await request(app)
      .get(`/api/v1/investments/${chitId}`)
      .set('Cookie', userCookie);

    expect(detailRes.status).toBe(200);
    const data = detailRes.body.data;
    expect(data.investment.totalHistoricalContributed).toBe(4000);
    expect(data.investment.totalActualContributed).toBe(0);
    expect(data.investment.totalContributionsInvested).toBe(4000);
    expect(data.contributions.length).toBe(12);

    // Verify bank balance remains untouched at ₹1,00,000
    const bankRes = await request(app)
      .get(`/api/v1/accounts/${bankAccountId}`)
      .set('Cookie', userCookie);
    expect(bankRes.body.data.currentBalance).toBe(100000);

    // Verify no transactions were created for historical months
    const txCount = await Transaction.countDocuments({ userId });
    expect(txCount).toBe(0);
  });

  it('records October 2026 contribution in-app, debits bank, and updates total invested', async () => {
    const inv = await Investment.findOne({ name: 'Friends Group Chit', userId });
    expect(inv).toBeTruthy();

    const payRes = await request(app)
      .post(`/api/v1/investments/${inv!._id}/pay`)
      .set('Cookie', userCookie)
      .send({
        cycleKey: '2026-10',
        amount: 1000,
        paymentDate: '2026-10-10',
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        paymentChannel: PaymentChannel.ONLINE,
        accountId: bankAccountId,
      });

    expect(payRes.status).toBe(200);

    // Verify bank balance is debited by ₹1,000 to ₹99,000
    const bankRes = await request(app)
      .get(`/api/v1/accounts/${bankAccountId}`)
      .set('Cookie', userCookie);
    expect(bankRes.body.data.currentBalance).toBe(99000);

    // Verify detail calculations
    const detailRes = await request(app)
      .get(`/api/v1/investments/${inv!._id}`)
      .set('Cookie', userCookie);
    const data = detailRes.body.data;
    expect(data.investment.totalHistoricalContributed).toBe(4000);
    expect(data.investment.totalActualContributed).toBe(1000);
    expect(data.investment.totalContributionsInvested).toBe(5000);
  });

  it('deleting October transaction via Transactions API reverts contribution to DUE and reverses bank balance once', async () => {
    const inv = await Investment.findOne({ name: 'Friends Group Chit', userId });
    expect(inv).toBeTruthy();

    const octContrib = await InvestmentContribution.findOne({
      investmentId: inv!._id,
      cycleKey: '2026-10',
    });
    expect(octContrib).toBeTruthy();
    expect(octContrib!.status).toBe(InvestmentContributionStatus.PAID);
    expect(octContrib!.transactionId).toBeTruthy();

    const txId = octContrib!.transactionId!.toString();

    // Delete transaction from Transactions Module
    const delRes = await request(app)
      .delete(`/api/v1/transactions/${txId}`)
      .set('Cookie', userCookie);
    expect(delRes.status).toBe(200);

    // Verify bank balance is restored back to ₹1,00,000 (single reversal, no double-counting)
    const bankRes = await request(app)
      .get(`/api/v1/accounts/${bankAccountId}`)
      .set('Cookie', userCookie);
    expect(bankRes.body.data.currentBalance).toBe(100000);

    // Verify October contribution is reverted back to DUE
    const updatedContrib = await InvestmentContribution.findById(octContrib!._id);
    expect(updatedContrib!.status).toBe(InvestmentContributionStatus.DUE);
    expect(updatedContrib!.transactionId).toBeFalsy();
    expect(updatedContrib!.actualAmount).toBeFalsy();

    // Verify investment summary excludes October
    const detailRes = await request(app)
      .get(`/api/v1/investments/${inv!._id}`)
      .set('Cookie', userCookie);
    const data = detailRes.body.data;
    expect(data.investment.totalHistoricalContributed).toBe(4000);
    expect(data.investment.totalActualContributed).toBe(0);
    expect(data.investment.totalContributionsInvested).toBe(4000);
  });

  it('re-paying October 2026 and marking as won with isHistoricalPayout preserves future DUE contributions', async () => {
    const inv = await Investment.findOne({ name: 'Friends Group Chit', userId });
    expect(inv).toBeTruthy();

    // 1. Re-pay October 2026
    await request(app)
      .post(`/api/v1/investments/${inv!._id}/pay`)
      .set('Cookie', userCookie)
      .send({
        cycleKey: '2026-10',
        amount: 1000,
        paymentDate: '2026-10-10',
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
      });

    // Bank balance is 99,000
    let bankRes = await request(app)
      .get(`/api/v1/accounts/${bankAccountId}`)
      .set('Cookie', userCookie);
    expect(bankRes.body.data.currentBalance).toBe(99000);

    // 2. Mark as won in October 2026 with isHistoricalPayout: true, prize ₹10,000
    const winRes = await request(app)
      .post(`/api/v1/investments/${inv!._id}/won`)
      .set('Cookie', userCookie)
      .send({
        winningDate: '2026-10-15',
        payoutAmount: 10000,
        payoutDestinationType: 'bank',
        payoutAccountId: bankAccountId,
        payoutNotes: 'Won in Oct auction before tracking',
        isHistoricalPayout: true,
      });

    expect(winRes.status).toBe(200);

    // Bank balance must NOT be credited because it was historical payout
    bankRes = await request(app)
      .get(`/api/v1/accounts/${bankAccountId}`)
      .set('Cookie', userCookie);
    expect(bankRes.body.data.currentBalance).toBe(99000);

    // Verify Investment state
    const wonInv = await Investment.findById(inv!._id);
    expect(wonInv!.isWon).toBe(true);
    expect(wonInv!.status).toBe(InvestmentStatus.WON);
    expect(wonInv!.isHistoricalPayout).toBe(true);
    expect(wonInv!.payoutAmount).toBe(10000);
    expect(wonInv!.payoutTransactionId).toBeFalsy();

    // Verify future November 2026 through May 2027 contributions ARE STILL DUE (NOT deleted!)
    const remainingDues = await InvestmentContribution.find({
      investmentId: inv!._id,
      cycleKey: { $gt: '2026-10' },
      status: InvestmentContributionStatus.DUE,
    }).sort({ cycleKey: 1 });

    expect(remainingDues.length).toBe(7); // Nov 2026 to May 2027 = 7 months
    expect(remainingDues[0].cycleKey).toBe('2026-11');

    // Verify upcoming obligations API for November 2026 returns this won chit
    const upcomingRes = await request(app)
      .get('/api/v1/analytics/upcoming-forecast?month=2026-11')
      .set('Cookie', userCookie);

    expect(upcomingRes.status).toBe(200);
    const items = upcomingRes.body.data.items;
    const chitItem = items.find((it: any) => it.ruleId === inv!._id.toString());
    expect(chitItem).toBeTruthy();
    expect(chitItem.status).toBe('unpaid');
    expect(chitItem.expectedAmount).toBe(1000);
  });

  it('allows recording monthly payments for a won chit and continues tracking until completion', async () => {
    const inv = await Investment.findOne({ name: 'Friends Group Chit', userId });
    expect(inv).toBeTruthy();

    // Pay November 2026 on the won chit
    const novPayRes = await request(app)
      .post(`/api/v1/investments/${inv!._id}/pay`)
      .set('Cookie', userCookie)
      .send({
        cycleKey: '2026-11',
        amount: 1000,
        paymentDate: '2026-11-10',
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
      });

    expect(novPayRes.status).toBe(200);

    // Bank balance debited to ₹98,000
    const bankRes = await request(app)
      .get(`/api/v1/accounts/${bankAccountId}`)
      .set('Cookie', userCookie);
    expect(bankRes.body.data.currentBalance).toBe(98000);

    // Detail check: totalActualContributed is now 2000 (Oct + Nov), total historical is 4000, totalInvested = 6000
    const detailRes = await request(app)
      .get(`/api/v1/investments/${inv!._id}`)
      .set('Cookie', userCookie);
    const data = detailRes.body.data;
    expect(data.investment.totalHistoricalContributed).toBe(4000);
    expect(data.investment.totalActualContributed).toBe(2000);
    expect(data.investment.totalContributionsInvested).toBe(6000);
    // Net cash flow = payoutReceived (10000) - totalContributionsInvested (6000) = 4000
    expect(data.investment.netChitCashFlow).toBe(4000);
  });
});
