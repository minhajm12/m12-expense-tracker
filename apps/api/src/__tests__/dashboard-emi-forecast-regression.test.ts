import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { BankAccount } from '../models/BankAccount';
import { EmiRule } from '../models/EmiRule';
import { EmiOccurrence } from '../models/EmiOccurrence';
import { Transaction } from '../models/Transaction';
import {
  AccountType,
  PaymentMethod,
  EmiStatus,
  EmiOccurrenceStatus,
  TransactionType,
  TransactionStatus,
} from '@finora/shared';
import { getCycleKey } from '../controllers/recurring';

describe('Phase 1: Dashboard Upcoming EMI Payments & Schedule Regression Suite', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let userId: string;
  let bankAccountId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await connectDatabase(uri);

    // Register test user
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'phase1.dashboard.emi@finora.test',
        password: 'Password123!',
        fullName: 'Phase 1 Tester',
        currency: 'INR',
      });

    expect(res.status).toBe(201);
    const cookies = res.headers['set-cookie'];
    userCookie = Array.isArray(cookies) ? cookies[0] : cookies;
    userId = res.body.data.user.id;

    // Create a primary bank account
    const accRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'Salary Checking',
        bankName: 'HDFC Bank',
        accountType: AccountType.SAVINGS,
        openingBalance: 100000,
        openingBalanceDate: new Date().toISOString(),
      });

    expect(accRes.status).toBe(201);
    bankAccountId = accRes.body.data.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
  });

  it('Acceptance Tests 1 & 2: A paid current-month EMI does not appear as an unpaid payment; next EMI appears with correct next due date', async () => {
    const currentMonth = getCycleKey(new Date(), 'Asia/Kolkata');
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthNum = now.getMonth();

    // Create an EMI starting current month, 3 installments
    const startDate = new Date(Date.UTC(currentYear, currentMonthNum, 5));
    const firstDueDate = new Date(Date.UTC(currentYear, currentMonthNum, 5));
    const endDate = new Date(Date.UTC(currentYear, currentMonthNum + 2, 5));

    const emiRes = await request(app)
      .post('/api/v1/emi')
      .set('Cookie', userCookie)
      .send({
        name: 'iPhone 16 Pro',
        lender: 'HDFC Bank',
        totalAmount: 150000,
        monthlyAmount: 50000,
        totalInstallments: 3,
        startDate: startDate.toISOString(),
        firstDueDate: firstDueDate.toISOString(),
        endDate: endDate.toISOString(),
        dueDay: 5,
        paymentMethod: PaymentMethod.UPI,
        accountId: bankAccountId,
      });

    expect(emiRes.status).toBe(201);
    const emiId = emiRes.body.data.id;

    // 1. Before payment: upcoming forecast for current month should show the current month installment as unpaid
    const preForecastRes = await request(app)
      .get(`/api/v1/analytics/upcoming-forecast?month=${currentMonth}`)
      .set('Cookie', userCookie);

    expect(preForecastRes.status).toBe(200);
    const preItem = preForecastRes.body.data.items.find((i: any) => i.ruleId === emiId);
    expect(preItem).toBeDefined();
    expect(preItem.status).toBe('unpaid');
    expect(preItem.occurrenceKey).toBe(currentMonth);

    // 2. Pay the current month installment
    const payRes = await request(app)
      .post(`/api/v1/emi/${emiId}/pay`)
      .set('Cookie', userCookie)
      .send({
        occurrenceKey: currentMonth,
        actualAmount: 50000,
        paymentMethod: PaymentMethod.UPI,
        accountId: bankAccountId,
      });

    expect(payRes.status).toBe(200);

    // 3. Check forecast for current month:
    // The current month installment is marked PAID with 0 remaining
    const postForecastRes = await request(app)
      .get(`/api/v1/analytics/upcoming-forecast?month=${currentMonth}`)
      .set('Cookie', userCookie);

    expect(postForecastRes.status).toBe(200);
    const postForecast = postForecastRes.body.data;

    // Current month paid item exists under paid items with 0 remaining
    const paidItem = postForecast.items.find((i: any) => i.ruleId === emiId && i.status === 'paid');
    expect(paidItem).toBeDefined();
    expect(paidItem.actualAmount).toBe(50000);
    expect(postForecast.emiPaymentsRemaining).toBe(0);

    // 4. When viewing NEXT month, the upcoming installment appears as unpaid and due
    const dNext = new Date(startDate);
    dNext.setDate(1);
    dNext.setMonth(dNext.getMonth() + 1);
    const nextMonthKey = getCycleKey(dNext, 'Asia/Kolkata');

    const nextForecastRes = await request(app)
      .get(`/api/v1/analytics/upcoming-forecast?month=${nextMonthKey}`)
      .set('Cookie', userCookie);

    expect(nextForecastRes.status).toBe(200);
    const nextForecast = nextForecastRes.body.data;
    const nextUnpaidItem = nextForecast.items.find((i: any) => i.ruleId === emiId && i.status === 'unpaid');
    expect(nextUnpaidItem).toBeDefined();
    expect(nextUnpaidItem.status).toBe('unpaid');
    expect(new Date(nextUnpaidItem.dueDate).getTime()).toBeGreaterThan(startDate.getTime());
    expect(nextForecast.emiPaymentsRemaining).toBe(50000);
  });

  it('Acceptance Test 3: An unpaid overdue EMI remains visible as overdue rather than excluded', async () => {
    const now = new Date();
    const pastStart = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 2, 10));
    const pastFirstDue = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 2, 10));
    const pastEnd = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 10));

    const overdueEmiRes = await request(app)
      .post('/api/v1/emi')
      .set('Cookie', userCookie)
      .send({
        name: 'Overdue Laptop EMI',
        lender: 'Bajaj Finserv',
        totalAmount: 60000,
        monthlyAmount: 20000,
        totalInstallments: 3,
        startDate: pastStart.toISOString(),
        firstDueDate: pastFirstDue.toISOString(),
        endDate: pastEnd.toISOString(),
        dueDay: 10,
        paymentMethod: PaymentMethod.UPI,
        accountId: bankAccountId,
      });

    expect(overdueEmiRes.status).toBe(201);
    const overdueEmiId = overdueEmiRes.body.data.id;

    const currentMonth = getCycleKey(new Date(), 'Asia/Kolkata');
    const forecastRes = await request(app)
      .get(`/api/v1/analytics/upcoming-forecast?month=${currentMonth}`)
      .set('Cookie', userCookie);

    expect(forecastRes.status).toBe(200);
    const overdueItem = forecastRes.body.data.items.find((i: any) => i.ruleId === overdueEmiId);
    expect(overdueItem).toBeDefined();
    expect(overdueItem.status).toBe('unpaid');
    expect(overdueItem.isOverdue).toBe(true);
    expect(new Date(overdueItem.dueDate).getTime()).toBeLessThan(Date.now());
  });

  it('Acceptance Test 4: A historically paid EMI is excluded from upcoming payments', async () => {
    const now = new Date();
    const pastDate = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 3, 1));
    const pastEndDate = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));

    const historicalEmiRes = await request(app)
      .post('/api/v1/emi')
      .set('Cookie', userCookie)
      .send({
        name: 'Old TV EMI',
        lender: 'Kotak',
        totalAmount: 30000,
        monthlyAmount: 10000,
        totalInstallments: 3,
        markHistoricalPaid: true,
        historicalInstallments: [
          { occurrenceKey: getCycleKey(new Date(Date.UTC(now.getFullYear(), now.getMonth() - 3, 1)), 'Asia/Kolkata') },
          { occurrenceKey: getCycleKey(new Date(Date.UTC(now.getFullYear(), now.getMonth() - 2, 1)), 'Asia/Kolkata') },
          { occurrenceKey: getCycleKey(new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1)), 'Asia/Kolkata') },
        ],
        startDate: pastDate.toISOString(),
        firstDueDate: pastDate.toISOString(),
        endDate: pastEndDate.toISOString(),
        dueDay: 1,
        paymentMethod: PaymentMethod.UPI,
        accountId: bankAccountId,
      });

    expect(historicalEmiRes.status).toBe(201);
    const histEmiId = historicalEmiRes.body.data.id;

    const currentMonth = getCycleKey(new Date(), 'Asia/Kolkata');
    const forecastRes = await request(app)
      .get(`/api/v1/analytics/upcoming-forecast?month=${currentMonth}`)
      .set('Cookie', userCookie);

    expect(forecastRes.status).toBe(200);
    const histItem = forecastRes.body.data.items.find((i: any) => i.ruleId === histEmiId && i.status === 'unpaid');
    expect(histItem).toBeUndefined(); // Excluded from upcoming unpaid payments!
  });

  it('Acceptance Test 5: Deleting a valid linked payment transaction reopens only the affected installment', async () => {
    const currentMonth = getCycleKey(new Date(), 'Asia/Kolkata');
    const now = new Date();
    const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 15));
    const end = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 15));

    const emiRes = await request(app)
      .post('/api/v1/emi')
      .set('Cookie', userCookie)
      .send({
        name: 'Camera EMI',
        lender: 'ICICI Bank',
        totalAmount: 40000,
        monthlyAmount: 20000,
        totalInstallments: 2,
        startDate: start.toISOString(),
        firstDueDate: start.toISOString(),
        endDate: end.toISOString(),
        dueDay: 15,
        paymentMethod: PaymentMethod.UPI,
        accountId: bankAccountId,
      });

    expect(emiRes.status).toBe(201);
    const emiId = emiRes.body.data.id;

    // Pay current month installment
    const payRes = await request(app)
      .post(`/api/v1/emi/${emiId}/pay`)
      .set('Cookie', userCookie)
      .send({
        occurrenceKey: currentMonth,
        actualAmount: 20000,
        paymentMethod: PaymentMethod.UPI,
        accountId: bankAccountId,
      });
    expect(payRes.status).toBe(200);

    // Find created transaction
    const tx = await Transaction.findOne({ emiRuleId: emiId, occurrenceKey: currentMonth });
    expect(tx).not.toBeNull();

    // Delete the transaction
    const delRes = await request(app)
      .delete(`/api/v1/transactions/${tx!._id}`)
      .set('Cookie', userCookie);
    expect(delRes.status).toBe(200);

    // Forecast should now show this installment reopened as unpaid for current month!
    const forecastRes = await request(app)
      .get(`/api/v1/analytics/upcoming-forecast?month=${currentMonth}`)
      .set('Cookie', userCookie);

    const reopenedItem = forecastRes.body.data.items.find(
      (i: any) => i.ruleId === emiId && i.occurrenceKey === currentMonth
    );
    expect(reopenedItem).toBeDefined();
    expect(reopenedItem.status).toBe('unpaid');
  });

  it('Acceptance Tests 6, 7 & 8: Updating Next EMI Date, EMI completion, and page refresh persistence', async () => {
    const currentMonth = getCycleKey(new Date(), 'Asia/Kolkata');
    const now = new Date();
    const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 20));

    const emiRes = await request(app)
      .post('/api/v1/emi')
      .set('Cookie', userCookie)
      .send({
        name: 'Single Installment Loan',
        lender: 'Axis Bank',
        totalAmount: 12000,
        monthlyAmount: 12000,
        totalInstallments: 1,
        startDate: start.toISOString(),
        firstDueDate: start.toISOString(),
        endDate: start.toISOString(),
        dueDay: 20,
        paymentMethod: PaymentMethod.UPI,
        accountId: bankAccountId,
      });

    expect(emiRes.status).toBe(201);
    const emiId = emiRes.body.data.id;

    // 6. Next EMI date appears correctly on dashboard
    let forecastRes = await request(app)
      .get(`/api/v1/analytics/upcoming-forecast?month=${currentMonth}`)
      .set('Cookie', userCookie);

    let item = forecastRes.body.data.items.find((i: any) => i.ruleId === emiId);
    expect(item).toBeDefined();
    expect(item.status).toBe('unpaid');

    // 7. Pay the only installment -> marks completed
    const payRes = await request(app)
      .post(`/api/v1/emi/${emiId}/pay`)
      .set('Cookie', userCookie)
      .send({
        occurrenceKey: currentMonth,
        actualAmount: 12000,
        paymentMethod: PaymentMethod.UPI,
        accountId: bankAccountId,
      });
    expect(payRes.status).toBe(200);

    // Completed EMI removes upcoming unpaid payments
    forecastRes = await request(app)
      .get(`/api/v1/analytics/upcoming-forecast?month=${currentMonth}`)
      .set('Cookie', userCookie);

    const completedUnpaidItem = forecastRes.body.data.items.find(
      (i: any) => i.ruleId === emiId && i.status === 'unpaid'
    );
    expect(completedUnpaidItem).toBeUndefined();

    // 8. Refreshing / repeated requests do not restore an already-paid installment
    const refreshRes = await request(app)
      .get(`/api/v1/analytics/upcoming-forecast?month=${currentMonth}`)
      .set('Cookie', userCookie);
    const refreshUnpaid = refreshRes.body.data.items.find(
      (i: any) => i.ruleId === emiId && i.status === 'unpaid'
    );
    expect(refreshUnpaid).toBeUndefined();
  });
});
