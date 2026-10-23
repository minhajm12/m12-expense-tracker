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
  CreditCardNetwork,
} from '@finora/shared';

describe('Phase 5: Dashboard Analytics & KPIs Test Suite', () => {
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
        email: 'dashboard.user@finora.test',
        password: 'Password123!',
        fullName: 'Diana Dashboard',
        currency: 'INR',
      });
    userCookie = authRes.headers['set-cookie'][0];

    // Create Bank Account with ₹80,000 opening
    const bankRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'Salary Checking',
        bankName: 'HDFC Bank',
        accountType: AccountType.SALARY,
        openingBalance: 80000,
        openingBalanceDate: '2026-01-01T00:00:00.000Z',
      });
    bankAccountId = bankRes.body.data.id;

    // Create Credit Card with ₹150,000 limit
    const cardRes = await request(app)
      .post('/api/v1/credit-cards')
      .set('Cookie', userCookie)
      .send({
        cardNickname: 'Millennia Card',
        issuingBank: 'HDFC Bank',
        network: CreditCardNetwork.MASTERCARD,
        creditLimit: 150000,
        billingCycleClosingDay: 20,
        paymentDueDay: 10,
        openingOutstanding: 0,
        openingOutstandingDate: '2026-01-01T00:00:00.000Z',
      });
    creditCardId = cardRes.body.data.id;

    // Post Income of ₹40,000
    await request(app)
      .post('/api/v1/transactions')
      .set('Cookie', userCookie)
      .send({
        type: TransactionType.INCOME,
        title: 'Monthly Salary',
        amount: 40000,
        currency: 'INR',
        date: new Date().toISOString(),
        category: 'Salary',
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        paymentChannel: PaymentChannel.ONLINE,
        accountId: bankAccountId,
      });

    // Post Expense of ₹12,000 on Debit card (Rent)
    await request(app)
      .post('/api/v1/transactions')
      .set('Cookie', userCookie)
      .send({
        type: TransactionType.EXPENSE,
        title: 'Apartment Rent',
        amount: 12000,
        currency: 'INR',
        date: new Date().toISOString(),
        category: 'Rent',
        paymentMethod: PaymentMethod.NET_BANKING,
        paymentChannel: PaymentChannel.ONLINE,
        accountId: bankAccountId,
      });

    // Post Expense of ₹5,000 on Credit Card (Shopping)
    await request(app)
      .post('/api/v1/transactions')
      .set('Cookie', userCookie)
      .send({
        type: TransactionType.EXPENSE,
        title: 'Apparel Shopping',
        amount: 5000,
        currency: 'INR',
        date: new Date().toISOString(),
        category: 'Shopping',
        paymentMethod: PaymentMethod.CREDIT_CARD,
        paymentChannel: PaymentChannel.OFFLINE,
        creditCardId,
      });
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  it('calculates server-authoritative Dashboard KPIs correctly', async () => {
    const res = await request(app)
      .get('/api/v1/analytics/dashboard?period=this-month')
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { kpis, charts, recentTransactions } = res.body.data;

    // Income: 40,000
    expect(kpis.periodIncome).toBe(40000);
    // Expenses: 12,000 + 5,000 = 17,000
    expect(kpis.periodExpense).toBe(17000);
    // Net Cash Flow: 40,000 - 17,000 = 23,000
    expect(kpis.netCashFlow).toBe(23000);
    expect(kpis.savings).toBe(23000);
    // Savings rate: (23,000 / 40,000) * 100 = ~57-58%
    expect([57, 58]).toContain(kpis.savingsRate);

    // Bank Account Balance: 80,000 opening + 40,000 income - 12,000 rent = 108,000
    expect(kpis.totalBankBalances).toBe(108000);

    // Credit Card Outstanding: 5,000
    expect(kpis.totalCreditCardOutstanding).toBe(5000);
    // Available Credit: 150,000 - 5,000 = 145,000
    expect(kpis.totalAvailableCredit).toBe(145000);

    // Charts
    expect(charts.categoryBreakdown.length).toBe(2); // Rent & Shopping
    expect(charts.channelBreakdown.length).toBe(2); // Online & Offline
    expect(recentTransactions.length).toBe(3);
  });

  it('responds correctly to different date range filters', async () => {
    const periods = ['last-month', 'last-30-days', 'last-90-days', 'this-year'];

    for (const p of periods) {
      const res = await request(app)
        .get(`/api/v1/analytics/dashboard?period=${p}`)
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.kpis).toHaveProperty('period');
    }
  });
});
