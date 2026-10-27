import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { BankAccount } from '../models/BankAccount';
import { CashAccount } from '../models/CashAccount';
import { Transaction } from '../models/Transaction';
import {
  AccountType,
  TransactionType,
  PaymentMethod,
  PaymentChannel,
  RefundClassification,
} from '@finora/shared';
import { recalculateAccountBalance, calculatePersonalCashInHand } from '../services/financial';

describe('Linked Refund & Cashback Management System', () => {
  let mongoServer: MongoMemoryServer;
  let authToken: string;
  let userId: string;
  let bankAccountId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await connectDatabase(uri);

    // Register test user
    const regRes = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Refund Tester',
      email: 'refundtester@m12.test',
      password: 'Password123!',
      currency: 'INR',
      requireVerification: false,
    });
    authToken = regRes.body.data.token;
    userId = regRes.body.data.user.id || regRes.body.data.user._id;

    // Create Bank Account with opening balance of 10,000
    const accRes = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        accountName: 'Main Checking',
        bankName: 'HDFC Bank',
        accountType: AccountType.SAVINGS,
        openingBalance: 10000,
        openingBalanceDate: '2026-01-01',
        currency: 'INR',
      });
    bankAccountId = accRes.body.data.id || accRes.body.data._id;
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
  });

  it('1. should record an expense and correctly reflect balance and candidate availability', async () => {
    // Expense: ₹1,000 Amazon Shopping on 2026-03-01
    const expRes = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        type: TransactionType.EXPENSE,
        title: 'Amazon Headphones',
        amount: 1000,
        currency: 'INR',
        date: '2026-03-01T10:00:00.000Z',
        category: 'Shopping',
        paymentMethod: PaymentMethod.UPI,
        paymentChannel: PaymentChannel.ONLINE,
        accountId: bankAccountId,
      });

    expect(expRes.status).toBe(201);
    const expId = expRes.body.data.id || expRes.body.data._id;

    // Balance should be 10,000 - 1,000 = 9,000
    const bankDoc = await BankAccount.findById(bankAccountId);
    expect(bankDoc?.currentBalance).toBe(9000);

    // Candidate query should show 1,000 remaining
    const candRes = await request(app)
      .get('/api/v1/transactions/refundable-candidates?onlyWithRemaining=true')
      .set('Authorization', `Bearer ${authToken}`);

    expect(candRes.status).toBe(200);
    const candidate = candRes.body.data.find((c: any) => c.id === expId);
    expect(candidate).toBeDefined();
    expect(candidate.remainingRefundable).toBe(1000);
    expect(candidate.totalRefunded).toBe(0);
  });

  it('2. should record partial linked refund (₹300) and increase bank balance', async () => {
    // Find the Amazon expense
    const expDoc = await Transaction.findOne({ title: 'Amazon Headphones', userId });
    expect(expDoc).toBeDefined();
    const expId = expDoc!._id.toString();

    // Record partial refund: ₹300
    const refRes = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        type: TransactionType.INCOME,
        title: 'Amazon Partial Return',
        amount: 300,
        currency: 'INR',
        date: '2026-03-03T11:00:00.000Z',
        category: 'Refunds received',
        refundClassification: RefundClassification.LINKED_REFUND,
        originalExpenseId: expId,
        paymentMethod: PaymentMethod.UPI,
        paymentChannel: PaymentChannel.ONLINE,
        accountId: bankAccountId,
      });

    expect(refRes.status).toBe(201);
    expect(refRes.body.data.refundClassification).toBe(RefundClassification.LINKED_REFUND);
    expect(refRes.body.data.originalExpenseId).toBe(expId);

    // Bank balance should increase by 300: 9,000 + 300 = 9,300
    const bankDoc = await BankAccount.findById(bankAccountId);
    expect(bankDoc?.currentBalance).toBe(9300);

    // Check candidate remaining refundable: 1,000 - 300 = 700
    const candRes = await request(app)
      .get('/api/v1/transactions/refundable-candidates?onlyWithRemaining=true')
      .set('Authorization', `Bearer ${authToken}`);

    const candidate = candRes.body.data.find((c: any) => c.id === expId);
    expect(candidate.remainingRefundable).toBe(700);
    expect(candidate.totalRefunded).toBe(300);
  });

  it('3. should reject a refund that exceeds the remaining refundable amount (400)', async () => {
    const expDoc = await Transaction.findOne({ title: 'Amazon Headphones', userId });
    const expId = expDoc!._id.toString();

    // Remaining is 700. Attempt to record refund of ₹800
    const overRes = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        type: TransactionType.INCOME,
        title: 'Over Refund Attempt',
        amount: 800,
        currency: 'INR',
        date: '2026-03-04T12:00:00.000Z',
        category: 'Refunds received',
        refundClassification: RefundClassification.LINKED_REFUND,
        originalExpenseId: expId,
        paymentMethod: PaymentMethod.UPI,
        paymentChannel: PaymentChannel.ONLINE,
        accountId: bankAccountId,
      });

    expect(overRes.status).toBe(400);
    expect(overRes.body.error.code).toBe('REFUND_EXCEEDS_REMAINING_AMOUNT');

    // Balance should remain 9,300
    const bankDoc = await BankAccount.findById(bankAccountId);
    expect(bankDoc?.currentBalance).toBe(9300);
  });

  it('4. should record a second partial refund (₹400) and verify remaining is ₹300', async () => {
    const expDoc = await Transaction.findOne({ title: 'Amazon Headphones', userId });
    const expId = expDoc!._id.toString();

    // Record second refund: ₹400
    const ref2Res = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        type: TransactionType.INCOME,
        title: 'Amazon Second Return',
        amount: 400,
        currency: 'INR',
        date: '2026-03-05T14:00:00.000Z',
        category: 'Refunds received',
        refundClassification: RefundClassification.LINKED_REFUND,
        originalExpenseId: expId,
        paymentMethod: PaymentMethod.UPI,
        paymentChannel: PaymentChannel.ONLINE,
        accountId: bankAccountId,
      });

    expect(ref2Res.status).toBe(201);

    // Balance: 9,300 + 400 = 9,700
    const bankDoc = await BankAccount.findById(bankAccountId);
    expect(bankDoc?.currentBalance).toBe(9700);

    // Audit context check
    const ctxRes = await request(app)
      .get(`/api/v1/transactions/${expId}/refund-context`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(ctxRes.status).toBe(200);
    expect(ctxRes.body.data.originalAmount).toBe(1000);
    expect(ctxRes.body.data.totalRefunded).toBe(700);
    expect(ctxRes.body.data.remainingRefundable).toBe(300);
    expect(ctxRes.body.data.netAmount).toBe(300);
    expect(ctxRes.body.data.refunds).toHaveLength(2);
  });

  it('5. should record a past-recorded refund and ensure balance is NOT adjusted again', async () => {
    const expDoc = await Transaction.findOne({ title: 'Amazon Headphones', userId });
    const expId = expDoc!._id.toString();

    const initialBankDoc = await BankAccount.findById(bankAccountId);
    const initialBalance = initialBankDoc?.currentBalance;

    // Remaining is 300. Record past-recorded refund of ₹200
    const pastRefRes = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        type: TransactionType.INCOME,
        title: 'Historical Return',
        amount: 200,
        currency: 'INR',
        date: '2026-03-06T15:00:00.000Z',
        category: 'Refunds received',
        refundClassification: RefundClassification.LINKED_REFUND,
        originalExpenseId: expId,
        paymentMethod: PaymentMethod.UPI,
        paymentChannel: PaymentChannel.ONLINE,
        accountId: bankAccountId,
        isPastRecorded: true,
      });

    expect(pastRefRes.status).toBe(201);

    // Balance MUST remain unchanged (9,700)
    const afterBankDoc = await BankAccount.findById(bankAccountId);
    expect(afterBankDoc?.currentBalance).toBe(initialBalance);

    // Remaining refundable should decrease to 100
    const ctxRes = await request(app)
      .get(`/api/v1/transactions/${expId}/refund-context`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(ctxRes.body.data.totalRefunded).toBe(900);
    expect(ctxRes.body.data.remainingRefundable).toBe(100);
    expect(ctxRes.body.data.netAmount).toBe(100);
  });

  it('6. should support creating an unlinked refund and linking it later', async () => {
    // Unlinked refund of ₹100
    const unlinkRes = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        type: TransactionType.INCOME,
        title: 'General Mystery Refund',
        amount: 100,
        currency: 'INR',
        date: '2026-03-07T16:00:00.000Z',
        category: 'Refunds received',
        refundClassification: RefundClassification.UNLINKED_REFUND,
        paymentMethod: PaymentMethod.UPI,
        paymentChannel: PaymentChannel.ONLINE,
        accountId: bankAccountId,
      });

    expect(unlinkRes.status).toBe(201);
    const refundId = unlinkRes.body.data.id || unlinkRes.body.data._id;
    expect(unlinkRes.body.data.originalExpenseId).toBeUndefined();

    const expDoc = await Transaction.findOne({ title: 'Amazon Headphones', userId });
    const expId = expDoc!._id.toString();

    // Link it to the Amazon expense
    const linkRes = await request(app)
      .post(`/api/v1/transactions/${refundId}/link-refund`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ originalExpenseId: expId });

    expect(linkRes.status).toBe(200);
    expect(linkRes.body.data.refundClassification).toBe(RefundClassification.LINKED_REFUND);
    expect(linkRes.body.data.originalExpenseId).toBe(expId);

    // Remaining refundable should now be 0 (full 1,000 refunded)
    const ctxRes = await request(app)
      .get(`/api/v1/transactions/${expId}/refund-context`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(ctxRes.body.data.totalRefunded).toBe(1000);
    expect(ctxRes.body.data.remainingRefundable).toBe(0);
    expect(ctxRes.body.data.netAmount).toBe(0);
  });

  it('7. should unlink a refund cleanly without deleting records', async () => {
    const mysteryRefund = await Transaction.findOne({ title: 'General Mystery Refund', userId });
    const refundId = mysteryRefund!._id.toString();

    const unlinkRes = await request(app)
      .post(`/api/v1/transactions/${refundId}/unlink-refund`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(unlinkRes.status).toBe(200);
    expect(unlinkRes.body.data.refundClassification).toBe(RefundClassification.UNLINKED_REFUND);
    expect(unlinkRes.body.data.originalExpenseId).toBeUndefined();

    // Candidate should now have 100 remaining refundable again
    const expDoc = await Transaction.findOne({ title: 'Amazon Headphones', userId });
    const expId = expDoc!._id.toString();

    const ctxRes = await request(app)
      .get(`/api/v1/transactions/${expId}/refund-context`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(ctxRes.body.data.totalRefunded).toBe(900);
    expect(ctxRes.body.data.remainingRefundable).toBe(100);
    expect(ctxRes.body.data.netAmount).toBe(100);
  });

  it('8. should safely unlink refunds when the original expense is deleted', async () => {
    // Create new expense for ₹500
    const expRes = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        type: TransactionType.EXPENSE,
        title: 'Temporary Dinner',
        amount: 500,
        currency: 'INR',
        date: '2026-03-08T18:00:00.000Z',
        category: 'Food & dining',
        paymentMethod: PaymentMethod.UPI,
        paymentChannel: PaymentChannel.ONLINE,
        accountId: bankAccountId,
      });

    const expId = expRes.body.data.id || expRes.body.data._id;

    // Create linked refund of ₹150
    const refRes = await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        type: TransactionType.INCOME,
        title: 'Dinner Overcharge Refund',
        amount: 150,
        currency: 'INR',
        date: '2026-03-08T19:00:00.000Z',
        category: 'Refunds received',
        refundClassification: RefundClassification.LINKED_REFUND,
        originalExpenseId: expId,
        paymentMethod: PaymentMethod.UPI,
        paymentChannel: PaymentChannel.ONLINE,
        accountId: bankAccountId,
      });

    const refundId = refRes.body.data.id || refRes.body.data._id;

    // Delete the original expense
    const delRes = await request(app)
      .delete(`/api/v1/transactions/${expId}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(delRes.status).toBe(200);

    // The refund must NOT be deleted. It should be converted to UNLINKED_REFUND
    const refundDoc = await Transaction.findById(refundId);
    expect(refundDoc).toBeDefined();
    expect(refundDoc?.refundClassification).toBe(RefundClassification.UNLINKED_REFUND);
    expect(refundDoc?.originalExpenseId).toBeUndefined();
  });

  it('9. should accurately calculate Net Expenses and Category Net in Monthly Expenses Report', async () => {
    // Query monthly expenses summary for 2026-03
    const repRes = await request(app)
      .get('/api/v1/reports/expenses-summary?month=2026-03')
      .set('Authorization', `Bearer ${authToken}`);

    expect(repRes.status).toBe(200);
    const data = repRes.body.data;

    // Amazon expense was 1,000 gross. Linked refunds: ₹300 + ₹400 + ₹200 = ₹900.
    // Net expense should be 100
    expect(data.grossExpenses).toBe(1000);
    expect(data.linkedRefunds).toBe(900);
    expect(data.netExpenses).toBe(100);
    expect(data.totalExpenses).toBe(100);

    // Shopping category breakdown should reflect net 100
    const shoppingCat = data.categoryBreakdown.find((c: any) => c.category === 'Shopping');
    expect(shoppingCat).toBeDefined();
    expect(shoppingCat.grossAmount).toBe(1000);
    expect(shoppingCat.refundAmount).toBe(900);
    expect(shoppingCat.netAmount).toBe(100);
    expect(shoppingCat.amount).toBe(100);
  });

  it('10. should exclude all refunds from personal Monthly Income Report', async () => {
    // Record real salary income of ₹50,000 in 2026-03
    await request(app)
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        type: TransactionType.INCOME,
        title: 'Monthly Salary',
        amount: 50000,
        currency: 'INR',
        date: '2026-03-01T09:00:00.000Z',
        category: 'Salary',
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        paymentChannel: PaymentChannel.ONLINE,
        accountId: bankAccountId,
      });

    const incRes = await request(app)
      .get('/api/v1/reports/income-summary?month=2026-03')
      .set('Authorization', `Bearer ${authToken}`);

    expect(incRes.status).toBe(200);
    const data = incRes.body.data;

    // Personal monthly income should be exactly 50,000 (excluding all refunds)
    expect(data.totalMonthlyIncome).toBe(50000);

    // Total refunds received should be tracked
    expect(data.totalRefundsReceived).toBeGreaterThan(0);

    // Refunds received category should be marked as non-configured/not counted towards personal income
    const refundInBreakdown = data.categoryBreakdown?.find(
      (c: any) => c.category.toLowerCase() === 'refunds received'
    );
    expect(refundInBreakdown?.isConfigured).toBe(false);
  });
});
