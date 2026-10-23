import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import {
  TransactionType,
  PaymentMethod,
  PaymentChannel,
  AccountType,
} from '@finora/shared';

describe('Regression Suite: Dashboard Date Handling & Live Recalculations', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let bankAccountId: string;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-17T12:00:00+05:30'));

    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // Register User
    const authRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'dates.test@finora.test',
        password: 'Password123!',
        fullName: 'Date Regression User',
        currency: 'INR',
      });
    userCookie = authRes.headers['set-cookie'][0];

    // Create Bank Account with initial opening balance ₹10,000
    const bankRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'Main Savings',
        bankName: 'SBI',
        accountType: AccountType.SAVINGS,
        openingBalance: 10000,
        openingBalanceDate: '2026-01-01',
      });
    bankAccountId = bankRes.body.data.id;
  });

  afterAll(async () => {
    vi.useRealTimers();
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  it('1. Adds income dated 16/10/2026 and verifies dashboard figures', async () => {
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Cookie', userCookie)
      .send({
        type: TransactionType.INCOME,
        title: 'Consulting Income 16 Oct',
        amount: 25000,
        date: '2026-10-16',
        category: 'Consulting',
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        paymentChannel: PaymentChannel.ONLINE,
        accountId: bankAccountId,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe(25000);

    // Verify Dashboard This Month includes 16 Oct income
    const dashRes = await request(app)
      .get('/api/v1/analytics/dashboard?period=this-month')
      .set('Cookie', userCookie);

    expect(dashRes.status).toBe(200);
    expect(dashRes.body.data.kpis.periodIncome).toBe(25000);
    expect(dashRes.body.data.kpis.netCashFlow).toBe(25000);
    expect(dashRes.body.data.kpis.totalBankBalances).toBe(35000); // 10k opening + 25k
  });

  it('2. Adds income dated 17/10/2026 (YYYY-MM-DD) and verifies both 16 and 17 Oct are reflected', async () => {
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Cookie', userCookie)
      .send({
        type: TransactionType.INCOME,
        title: 'Project Milestone 17 Oct',
        amount: 35000,
        date: '2026-10-17',
        category: 'Salary',
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        paymentChannel: PaymentChannel.ONLINE,
        accountId: bankAccountId,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe(35000);

    // Dashboard "This Month" must reflect 25,000 + 35,000 = 60,000
    const dashRes = await request(app)
      .get('/api/v1/analytics/dashboard?period=this-month')
      .set('Cookie', userCookie);

    expect(dashRes.status).toBe(200);
    expect(dashRes.body.data.kpis.periodIncome).toBe(60000);
    expect(dashRes.body.data.kpis.netCashFlow).toBe(60000);
    expect(dashRes.body.data.kpis.totalBankBalances).toBe(70000); // 10k + 25k + 35k
  });

  it('3. Accepts date entered in DD/MM/YYYY format ("17/10/2026") without shifting calendar day', async () => {
    const res = await request(app)
      .post('/api/v1/transactions')
      .set('Cookie', userCookie)
      .send({
        type: TransactionType.INCOME,
        title: 'Bonus via DD/MM/YYYY Entry',
        amount: 15000,
        date: '17/10/2026',
        category: 'Bonus',
        paymentMethod: PaymentMethod.UPI,
        paymentChannel: PaymentChannel.ONLINE,
        accountId: bankAccountId,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe(15000);

    // Verify stored date has October 17
    const storedDate = new Date(res.body.data.date);
    expect(storedDate.getUTCDate()).toBe(17);
    expect(storedDate.getUTCMonth()).toBe(9); // 0-indexed month 9 is October

    // Dashboard This Month should now reflect 60,000 + 15,000 = 75,000
    const dashRes = await request(app)
      .get('/api/v1/analytics/dashboard?period=this-month')
      .set('Cookie', userCookie);

    expect(dashRes.body.data.kpis.periodIncome).toBe(75000);
  });

  it('4. Correctly calculates "today" period in Asia/Kolkata timezone', async () => {
    // Both 17 Oct transactions (35,000 + 15,000 = 50,000) must be included in Today,
    // and the 16 Oct transaction (25,000) must be excluded.
    const dashRes = await request(app)
      .get('/api/v1/analytics/dashboard?period=today')
      .set('Cookie', userCookie);

    expect(dashRes.status).toBe(200);
    expect(dashRes.body.data.kpis.periodIncome).toBe(50000);
    expect(dashRes.body.data.kpis.periodExpense).toBe(0);
    expect(dashRes.body.data.kpis.netCashFlow).toBe(50000);
  });

  it('5. Correctly calculates custom date range and all-time calculations', async () => {
    // Custom range: 2026-10-16 to 2026-10-16 only
    const customRes16 = await request(app)
      .get('/api/v1/analytics/dashboard?period=custom&startDate=2026-10-16&endDate=2026-10-16')
      .set('Cookie', userCookie);

    expect(customRes16.body.data.kpis.periodIncome).toBe(25000);

    // Custom range: 2026-10-16 to 2026-10-17 includes both
    const customResBoth = await request(app)
      .get('/api/v1/analytics/dashboard?period=custom&startDate=2026-10-16&endDate=2026-10-17')
      .set('Cookie', userCookie);

    expect(customResBoth.body.data.kpis.periodIncome).toBe(75000);

    // All time includes all
    const allTimeRes = await request(app)
      .get('/api/v1/analytics/dashboard?period=all-time')
      .set('Cookie', userCookie);

    expect(allTimeRes.body.data.kpis.periodIncome).toBe(75000);
  });

  it('6. Adding an expense immediately updates dashboard expense & net cash flow', async () => {
    const expenseRes = await request(app)
      .post('/api/v1/transactions')
      .set('Cookie', userCookie)
      .send({
        type: TransactionType.EXPENSE,
        title: 'Office Rent',
        amount: 20000,
        date: '2026-10-17',
        category: 'Rent',
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        paymentChannel: PaymentChannel.ONLINE,
        accountId: bankAccountId,
      });

    expect(expenseRes.status).toBe(201);

    const dashRes = await request(app)
      .get('/api/v1/analytics/dashboard?period=this-month')
      .set('Cookie', userCookie);

    expect(dashRes.body.data.kpis.periodIncome).toBe(75000);
    expect(dashRes.body.data.kpis.periodExpense).toBe(20000);
    expect(dashRes.body.data.kpis.netCashFlow).toBe(55000); // 75k - 20k
  });

  it('7. Editing a transaction amount updates the dashboard totals and bank balance', async () => {
    // Find the 20,000 expense
    const listRes = await request(app)
      .get('/api/v1/transactions?category=Rent')
      .set('Cookie', userCookie);

    const rentTx = listRes.body.data[0];
    expect(rentTx).toBeDefined();

    // Edit amount from 20,000 to 25,000
    const updateRes = await request(app)
      .patch(`/api/v1/transactions/${rentTx.id}`)
      .set('Cookie', userCookie)
      .send({
        amount: 25000,
        date: '17/10/2026',
      });

    expect(updateRes.status).toBe(200);

    // Verify dashboard reflects updated 25,000 expense
    const dashRes = await request(app)
      .get('/api/v1/analytics/dashboard?period=this-month')
      .set('Cookie', userCookie);

    expect(dashRes.body.data.kpis.periodExpense).toBe(25000);
    expect(dashRes.body.data.kpis.netCashFlow).toBe(50000); // 75k - 25k
  });

  it('8. Deleting a transaction recalculates dashboard and account balance correctly', async () => {
    // Delete the Rent transaction
    const listRes = await request(app)
      .get('/api/v1/transactions?category=Rent')
      .set('Cookie', userCookie);

    const rentTx = listRes.body.data[0];
    const delRes = await request(app)
      .delete(`/api/v1/transactions/${rentTx.id}`)
      .set('Cookie', userCookie);

    expect(delRes.status).toBe(200);

    // Verify dashboard expense is back to 0
    const dashRes = await request(app)
      .get('/api/v1/analytics/dashboard?period=this-month')
      .set('Cookie', userCookie);

    expect(dashRes.body.data.kpis.periodExpense).toBe(0);
    expect(dashRes.body.data.kpis.netCashFlow).toBe(75000);
    // Bank account should have opening 10k + 75k income = 85,000
    expect(dashRes.body.data.kpis.totalBankBalances).toBe(85000);
  });
});
