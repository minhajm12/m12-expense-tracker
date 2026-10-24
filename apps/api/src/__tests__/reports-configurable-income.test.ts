import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { BankAccount } from '../models/BankAccount';
import { Transaction } from '../models/Transaction';
import { AccountType, TransactionType, TransactionStatus, PaymentMethod } from '@finora/shared';

describe('Phase 3: Configurable Monthly Income Reports Test Suite', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let userId: string;
  let bankAccount1Id: string;
  let bankAccount2Id: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await connectDatabase(uri);

    // Register test user
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'reports.income@finora.test',
        password: 'Password123!',
        fullName: 'Income Reporter',
        currency: 'INR',
      });

    userCookie = Array.isArray(res.headers['set-cookie'])
      ? res.headers['set-cookie'][0]
      : res.headers['set-cookie'];
    userId = res.body.data.user.id;

    // Create 2 accounts
    const acc1 = await BankAccount.create({
      userId,
      accountName: 'Main Checking',
      bankName: 'HDFC Bank',
      accountType: AccountType.SAVINGS,
      openingBalance: 100000,
      openingBalanceDate: new Date(),
      currentBalance: 100000,
    });
    bankAccount1Id = acc1._id.toString();

    const acc2 = await BankAccount.create({
      userId,
      accountName: 'Secondary Savings',
      bankName: 'ICICI Bank',
      accountType: AccountType.SAVINGS,
      openingBalance: 50000,
      openingBalanceDate: new Date(),
      currentBalance: 50000,
    });
    bankAccount2Id = acc2._id.toString();
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
  });

  it('Acceptance Tests 1 & 2: Salary and Freelance income are correctly counted in the selected month', async () => {
    const targetMonth = '2026-10';

    // October Salary: ₹85,000
    await Transaction.create({
      userId,
      title: 'October Tech Salary',
      amount: 85000,
      type: TransactionType.INCOME,
      category: 'Salary',
      paymentMethod: PaymentMethod.BANK_TRANSFER,
      paymentChannel: 'online',
      accountId: bankAccount1Id,
      date: new Date('2026-10-01T12:00:00.000Z'),
      status: TransactionStatus.COMPLETED,
    });

    // October Freelance: ₹30,000
    await Transaction.create({
      userId,
      title: 'UI Redesign Client',
      amount: 30000,
      type: TransactionType.INCOME,
      category: 'Freelance income',
      paymentMethod: PaymentMethod.UPI,
      paymentChannel: 'online',
      accountId: bankAccount1Id,
      date: new Date('2026-10-15T12:00:00.000Z'),
      status: TransactionStatus.COMPLETED,
    });

    // September Salary: ₹80,000 (Different month)
    await Transaction.create({
      userId,
      title: 'September Tech Salary',
      amount: 80000,
      type: TransactionType.INCOME,
      category: 'Salary',
      paymentMethod: PaymentMethod.BANK_TRANSFER,
      paymentChannel: 'online',
      accountId: bankAccount1Id,
      date: new Date('2026-09-01T12:00:00.000Z'),
      status: TransactionStatus.COMPLETED,
    });

    const res = await request(app)
      .get(`/api/v1/reports/income-summary?month=${targetMonth}`)
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.month).toBe(targetMonth);
    expect(data.salaryIncome).toBe(85000);
    expect(data.freelanceIncome).toBe(30000);
    expect(data.totalMonthlyIncome).toBe(115000);
    expect(data.qualifyingTransactionCount).toBe(2);
  });

  it('Acceptance Tests 3 & 4: Selecting and deselecting categories updates totalMonthlyIncome', async () => {
    const targetMonth = '2026-10';

    // Add a Business Income transaction in October: ₹45,000
    await Transaction.create({
      userId,
      title: 'Consulting Retainer',
      amount: 45000,
      type: TransactionType.INCOME,
      category: 'Business income',
      paymentMethod: PaymentMethod.BANK_TRANSFER,
      paymentChannel: 'online',
      accountId: bankAccount1Id,
      date: new Date('2026-10-20T12:00:00.000Z'),
      status: TransactionStatus.COMPLETED,
    });

    // Before selection: Business income is not in default ['Salary', 'Freelance income']
    let res = await request(app)
      .get(`/api/v1/reports/income-summary?month=${targetMonth}`)
      .set('Cookie', userCookie);

    expect(res.body.data.totalMonthlyIncome).toBe(115000); // Only Salary (85k) + Freelance (30k)

    // Acceptance Test 3: Select Business income category
    const updateRes = await request(app)
      .put('/api/v1/reports/income-categories')
      .set('Cookie', userCookie)
      .send({ categories: ['Salary', 'Freelance income', 'Business income'] });

    expect(updateRes.status).toBe(200);

    // After selection: Total monthly income includes Business income! (115k + 45k = 160k)
    res = await request(app)
      .get(`/api/v1/reports/income-summary?month=${targetMonth}`)
      .set('Cookie', userCookie);

    expect(res.body.data.totalMonthlyIncome).toBe(160000);
    expect(res.body.data.otherSelectedIncome).toBe(45000);
    expect(res.body.data.qualifyingTransactionCount).toBe(3);

    // Acceptance Test 4: Deselect Freelance income
    await request(app)
      .put('/api/v1/reports/income-categories')
      .set('Cookie', userCookie)
      .send({ categories: ['Salary', 'Business income'] });

    res = await request(app)
      .get(`/api/v1/reports/income-summary?month=${targetMonth}`)
      .set('Cookie', userCookie);

    expect(res.body.data.totalMonthlyIncome).toBe(130000); // 85k + 45k
    expect(res.body.data.freelanceIncome).toBe(0); // Excluded from total
  });

  it('Acceptance Tests 5, 6 & 7: Expenses, Transfers, and Chit Collections are NEVER counted as income', async () => {
    const targetMonth = '2026-10';

    // 5. Normal Expense in October: ₹15,000
    await Transaction.create({
      userId,
      title: 'Groceries',
      amount: 15000,
      type: TransactionType.EXPENSE,
      category: 'Food & Dining',
      paymentMethod: PaymentMethod.UPI,
      paymentChannel: 'offline',
      accountId: bankAccount1Id,
      date: new Date('2026-10-10T12:00:00.000Z'),
      status: TransactionStatus.COMPLETED,
    });

    // 6. Transfer between accounts: ₹25,000
    await Transaction.create({
      userId,
      title: 'Transfer to Secondary',
      amount: 25000,
      type: TransactionType.TRANSFER,
      category: 'Transfer',
      paymentMethod: PaymentMethod.BANK_TRANSFER,
      paymentChannel: 'online',
      accountId: bankAccount1Id,
      destinationAccountId: bankAccount2Id,
      date: new Date('2026-10-12T12:00:00.000Z'),
      status: TransactionStatus.COMPLETED,
    });

    // 7. Chit Separation: ₹10,000
    await Transaction.create({
      userId,
      title: 'Chit Fund Pool Separation',
      amount: 10000,
      type: TransactionType.CHIT_SEPARATION,
      category: 'Chit Fund',
      paymentMethod: PaymentMethod.BANK_TRANSFER,
      paymentChannel: 'online',
      accountId: bankAccount1Id,
      date: new Date('2026-10-14T12:00:00.000Z'),
      status: TransactionStatus.COMPLETED,
    });

    const res = await request(app)
      .get(`/api/v1/reports/income-summary?month=${targetMonth}`)
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    // None of the expense, transfer, or chit separation should appear in income!
    const breakdown = res.body.data.categoryBreakdown;
    expect(breakdown.find((b: any) => b.category === 'Food & Dining')).toBeUndefined();
    expect(breakdown.find((b: any) => b.category === 'Transfer')).toBeUndefined();
    expect(breakdown.find((b: any) => b.category === 'Chit Fund')).toBeUndefined();
  });

  it('Acceptance Test 8: A deleted income transaction is excluded according to transaction rules', async () => {
    const targetMonth = '2026-10';

    // Temporary bonus income: ₹20,000
    const bonusTx = await Transaction.create({
      userId,
      title: 'Year-end Performance Bonus',
      amount: 20000,
      type: TransactionType.INCOME,
      category: 'Salary',
      paymentMethod: PaymentMethod.BANK_TRANSFER,
      paymentChannel: 'online',
      accountId: bankAccount1Id,
      date: new Date('2026-10-25T12:00:00.000Z'),
      status: TransactionStatus.COMPLETED,
    });

    // Delete transaction
    await request(app)
      .delete(`/api/v1/transactions/${bonusTx._id}`)
      .set('Cookie', userCookie);

    // Verify deleted transaction is not included
    const res = await request(app)
      .get(`/api/v1/reports/income-summary?month=${targetMonth}`)
      .set('Cookie', userCookie);

    const bonusFound = res.body.data.categoryBreakdown
      .find((b: any) => b.category === 'Salary')
      ?.transactions?.find((t: any) => t.id === bonusTx._id.toString());

    expect(bonusFound).toBeUndefined();
  });

  it('Acceptance Tests 9 & 10: Asia/Kolkata month boundaries and reconciliation with transaction list', async () => {
    // Transaction on the edge of month in Asia/Kolkata: 31st Oct 23:30 IST (18:00 UTC)
    const edgeDate = new Date('2026-10-31T18:00:00.000Z');
    await Transaction.create({
      userId,
      title: 'End of Month Stipend',
      amount: 5000,
      type: TransactionType.INCOME,
      category: 'Salary',
      paymentMethod: PaymentMethod.UPI,
      paymentChannel: 'online',
      accountId: bankAccount1Id,
      date: edgeDate,
      status: TransactionStatus.COMPLETED,
    });

    const res = await request(app)
      .get('/api/v1/reports/income-summary?month=2026-10')
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    const salaryCategory = res.body.data.categoryBreakdown.find((b: any) => b.category === 'Salary');
    const stipend = salaryCategory.transactions.find((t: any) => t.title === 'End of Month Stipend');
    expect(stipend).toBeDefined();
    expect(stipend.amount).toBe(5000);

    // Test reconciliation: Sum of qualifying transactions strictly equals totalMonthlyIncome
    let sum = 0;
    for (const cat of res.body.data.categoryBreakdown) {
      if (cat.isConfigured) {
        sum += cat.amount;
      }
    }
    expect(sum).toBe(res.body.data.totalMonthlyIncome);
  });

  it('Phase 4: Total Incoming vs Monthly Income independence and Daily Average Income calculation', async () => {
    const targetMonth = '2026-10'; // October has 31 days

    // Current state: active categories are ['Salary', 'Business income'].
    // Freelance income (₹30,000) is NOT in active categories.
    // Salary total: 85,000 + 5,000 = 90,000.
    // Business income total: 45,000.
    // Configured monthly income: 90,000 + 45,000 = 135,000.
    // All incoming total: 90,000 (Salary) + 45,000 (Business) + 30,000 (Freelance) = 165,000.

    const res = await request(app)
      .get(`/api/v1/reports/income-summary?month=${targetMonth}`)
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    const data = res.body.data;

    // 1. Total Incoming reflects all incoming transactions
    expect(data.allIncomeTotal).toBe(165000);

    // 2. Monthly Income strictly reflects Active Income Categories only
    expect(data.totalMonthlyIncome).toBe(135000);

    // 3. Total Incoming and Monthly Income are independent
    expect(data.allIncomeTotal).not.toBe(data.totalMonthlyIncome);

    // 4. Days in October is 31
    expect(data.daysInMonth).toBe(31);

    // 5. Daily Average Income is calculated from Monthly Income: 135,000 / 31 = 4354.84
    const expectedDailyAvg = Math.round((135000 / 31) * 100) / 100;
    expect(data.averageDailyIncome).toBe(expectedDailyAvg);
  });
});
