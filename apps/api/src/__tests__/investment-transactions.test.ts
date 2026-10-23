import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { BankAccount } from '../models/BankAccount';
import { CreditCard } from '../models/CreditCard';
import { CashAccount } from '../models/CashAccount';
import { RecurringTransaction } from '../models/RecurringTransaction';
import { RecurringOccurrence } from '../models/RecurringOccurrence';
import { Transaction } from '../models/Transaction';
import {
  AccountType,
  CreditCardNetwork,
  PaymentMethod,
  PaymentChannel,
  RecurringFrequency,
  TransactionType,
  TransactionStatus,
} from '@finora/shared';

describe('Phase 2: Investment Transactions & Reporting Verification Suite', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let userId: string;
  let bankAccountId: string;
  let creditCardId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await connectDatabase(uri);

    // 1. Register a test user
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'phase2.investments@finora.test',
        password: 'Password123!',
        fullName: 'Investment Investor',
        currency: 'INR',
      });

    expect(res.status).toBe(201);
    const cookies = res.headers['set-cookie'];
    userCookie = Array.isArray(cookies) ? cookies[0] : cookies;
    userId = res.body.data.user.id;

    // 2. Create Bank Account with ₹1,00,000 opening balance
    const accRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'ICICI Savings',
        bankName: 'ICICI Bank',
        accountType: AccountType.SAVINGS,
        openingBalance: 100000,
        openingBalanceDate: '2026-10-01',
      });
    expect(accRes.status).toBe(201);
    bankAccountId = accRes.body.data.id;

    // 3. Create Credit Card with ₹50,000 limit, ₹0 opening outstanding
    const cardRes = await request(app)
      .post('/api/v1/credit-cards')
      .set('Cookie', userCookie)
      .send({
        cardNickname: 'Amazon Pay ICICI',
        issuingBank: 'ICICI Bank',
        network: CreditCardNetwork.VISA,
        creditLimit: 50000,
        billingCycleClosingDay: 20,
        paymentDueDay: 10,
        openingOutstanding: 0,
        openingOutstandingDate: '2026-10-01',
      });
    expect(cardRes.status).toBe(201);
    creditCardId = cardRes.body.data.id;

    // 4. Initialize Personal Cash in Hand with ₹20,000 opening balance
    await CashAccount.create({
      userId,
      openingBalance: 20000,
      openingBalanceDate: new Date('2026-10-01'),
      currentBalance: 20000,
      currency: 'INR',
      adjustments: [],
    });
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  describe('Scenario 1: Manual bank-funded investment reduces the correct bank balance', () => {
    let txId: string;

    it('records a manual investment funded by bank account and reduces balance', async () => {
      const res = await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', userCookie)
        .send({
          type: TransactionType.INVESTMENT,
          title: 'Nifty 50 Index Mutual Fund',
          amount: 15000,
          date: '2026-10-05',
          category: 'Mutual Funds',
          paymentMethod: PaymentMethod.UPI,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bankAccountId,
          notes: 'Lumpsum allocation',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe(TransactionType.INVESTMENT);
      txId = res.body.data.id;

      // Verify bank balance was reduced from ₹100,000 by ₹15,000 to ₹85,000
      const accRes = await request(app)
        .get(`/api/v1/accounts/${bankAccountId}`)
        .set('Cookie', userCookie);

      expect(accRes.status).toBe(200);
      expect(accRes.body.data.currentBalance).toBe(85000);
    });
  });

  describe('Scenario 2: Cash-funded investment reduces Personal Cash in Hand', () => {
    it('records a cash-funded investment and reduces personal cash', async () => {
      const res = await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', userCookie)
        .send({
          type: TransactionType.INVESTMENT,
          title: 'Physical Sovereign Gold Coin',
          amount: 6000,
          date: '2026-10-06',
          category: 'Gold',
          paymentMethod: PaymentMethod.CASH,
          paymentChannel: PaymentChannel.OFFLINE,
          notes: 'Bought 1g coin in cash',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe(TransactionType.INVESTMENT);

      // Verify Personal Cash in Hand reduced from ₹20,000 by ₹6,000 to ₹14,000
      const summaryRes = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);

      expect(summaryRes.status).toBe(200);
      expect(summaryRes.body.data.personalCashInHand).toBe(14000);
    });
  });

  describe('Scenario 3: Credit-card-funded investment follows existing credit-card accounting rules', () => {
    it('records a credit-card-funded investment, increases card outstanding and preserves bank balance', async () => {
      const res = await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', userCookie)
        .send({
          type: TransactionType.INVESTMENT,
          title: 'Online Digital Gold Subscription',
          amount: 8000,
          date: '2026-10-07',
          category: 'Gold',
          paymentMethod: PaymentMethod.CREDIT_CARD,
          paymentChannel: PaymentChannel.ONLINE,
          creditCardId: creditCardId,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe(TransactionType.INVESTMENT);

      // Verify Credit Card outstanding increased from 0 to 8,000, available credit reduced from 50,000 to 42,000
      const cardRes = await request(app)
        .get(`/api/v1/credit-cards/${creditCardId}`)
        .set('Cookie', userCookie);

      expect(cardRes.status).toBe(200);
      expect(cardRes.body.data.currentOutstanding).toBe(8000);
      expect(cardRes.body.data.availableCredit).toBe(42000);

      // Verify bank account balance remains unchanged at ₹85,000
      const accRes = await request(app)
        .get(`/api/v1/accounts/${bankAccountId}`)
        .set('Cookie', userCookie);

      expect(accRes.body.data.currentBalance).toBe(85000);
    });
  });

  describe('Scenario 4: An investment does not appear in ordinary Expense or Income totals', () => {
    it('creates an ordinary income and ordinary expense, verifying investments are segregated', async () => {
      // Create ₹50,000 income
      await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', userCookie)
        .send({
          type: TransactionType.INCOME,
          title: 'Monthly Salary',
          amount: 50000,
          date: '2026-10-02',
          category: 'Salary',
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bankAccountId,
        });

      // Create ₹10,000 expense
      await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', userCookie)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Monthly Groceries',
          amount: 10000,
          date: '2026-10-03',
          category: 'Groceries',
          paymentMethod: PaymentMethod.UPI,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bankAccountId,
        });

      // Check Financial Report
      const repRes = await request(app)
        .get('/api/v1/reports?startDate=2026-10-01&endDate=2026-10-31')
        .set('Cookie', userCookie);

      expect(repRes.status).toBe(200);
      const summary = repRes.body.data.summary;

      // Income must be strictly ₹50,000
      expect(summary.totalIncome).toBe(50000);

      // Ordinary Expenses must be strictly ₹10,000 (NOT including the ₹15k, ₹6k, or ₹8k investments)
      expect(summary.totalExpenses).toBe(10000);

      // Net Cash Flow should be Income - Ordinary Expenses = 40,000
      expect(summary.netCashFlow).toBe(40000);

      // Total Investments must be tracked separately = 15,000 + 6,000 + 8,000 = 29,000
      expect(summary.totalInvestments).toBe(29000);

      // Investments property must be present with breakdown
      expect(repRes.body.data.investments).toBeDefined();
      expect(repRes.body.data.investments.totalInvested).toBe(29000);
    });
  });

  describe('Scenario 5 & 6: Recurring investment creates Investment transaction and prevents duplicate execution', () => {
    let ruleId: string;

    it('creates a recurring investment rule', async () => {
      const res = await request(app)
        .post('/api/v1/recurring')
        .set('Cookie', userCookie)
        .send({
          title: 'Bluechip Equity SIP',
          amount: 5000,
          type: TransactionType.INVESTMENT,
          category: 'Mutual Funds',
          frequency: RecurringFrequency.MONTHLY,
          paymentMethod: PaymentMethod.UPI,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bankAccountId,
          nextExecutionDate: '2026-10-10',
          notes: 'Monthly SIP investment',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe(TransactionType.INVESTMENT);
      ruleId = res.body.data._id || res.body.data.id;
    });

    it('logs the recurring investment and generates an INVESTMENT transaction', async () => {
      const res = await request(app)
        .post(`/api/v1/recurring/${ruleId}/execute`)
        .set('Cookie', userCookie)
        .send({
          occurrenceKey: '2026-10',
          actualAmount: 5000,
          paymentMethod: PaymentMethod.UPI,
          accountId: bankAccountId,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.transaction.type).toBe(TransactionType.INVESTMENT);
      expect(res.body.data.transaction.amount).toBe(5000);
    });

    it('rejects a duplicate execution attempt for the same 2026-10 cycle', async () => {
      const res = await request(app)
        .post(`/api/v1/recurring/${ruleId}/execute`)
        .set('Cookie', userCookie)
        .send({
          occurrenceKey: '2026-10',
          actualAmount: 5000,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('RECURRING_OCCURRENCE_ALREADY_LOGGED');
    });
  });

  describe('Scenario 7: Deleting an investment transaction updates balances and recurring status correctly', () => {
    it('deletes the recurring investment transaction and restores balance and recurring occurrence to DUE', async () => {
      // Find the recurring transaction
      const tx = await Transaction.findOne({
        userId,
        type: TransactionType.INVESTMENT,
        occurrenceKey: '2026-10',
      });
      expect(tx).toBeDefined();

      const balBefore = (await BankAccount.findById(bankAccountId))!.currentBalance;

      // Delete transaction
      const delRes = await request(app)
        .delete(`/api/v1/transactions/${tx!._id}`)
        .set('Cookie', userCookie);

      expect(delRes.status).toBe(200);

      // Verify bank account was credited back by ₹5,000
      const balAfter = (await BankAccount.findById(bankAccountId))!.currentBalance;
      expect(balAfter).toBe(balBefore + 5000);

      // Verify RecurringOccurrence status was reverted back to DUE
      const occ = await RecurringOccurrence.findOne({
        userId,
        occurrenceKey: '2026-10',
      });
      expect(occ).toBeDefined();
      expect(occ!.status).toBe('DUE');
      expect(occ!.transactionId).toBeUndefined();
    });
  });

  describe('Scenario 8: Main Reports totals and date filters are correct', () => {
    it('validates Main Reports category breakdown, funding sources, and date filtering', async () => {
      const repRes = await request(app)
        .get('/api/v1/reports?startDate=2026-10-01&endDate=2026-10-31')
        .set('Cookie', userCookie);

      expect(repRes.status).toBe(200);
      const data = repRes.body.data;
      const inv = data.investments;

      // Active remaining investments:
      // 1. ₹15,000 Mutual Funds (ICICI Bank)
      // 2. ₹6,000 Gold (Cash)
      // 3. ₹8,000 Gold (Amazon Pay ICICI Credit Card)
      // Total = ₹29,000
      expect(inv.totalInvested).toBe(29000);

      // Category breakdown
      const goldCat = inv.categoryBreakdown.find((c: any) => c.category === 'Gold');
      expect(goldCat).toBeDefined();
      expect(goldCat.totalAmount).toBe(14000); // 6k + 8k

      const mfCat = inv.categoryBreakdown.find((c: any) => c.category === 'Mutual Funds');
      expect(mfCat).toBeDefined();
      expect(mfCat.totalAmount).toBe(15000);

      // Funding source breakdown
      const cashSource = inv.fundingSourceBreakdown.find((s: any) => s.source.includes('Cash'));
      expect(cashSource).toBeDefined();
      expect(cashSource.amount).toBe(6000);

      const bankSource = inv.fundingSourceBreakdown.find((s: any) => s.source.includes('ICICI Savings'));
      expect(bankSource).toBeDefined();
      expect(bankSource.amount).toBe(15000);

      const cardSource = inv.fundingSourceBreakdown.find((s: any) => s.source.includes('Amazon Pay ICICI'));
      expect(cardSource).toBeDefined();
      expect(cardSource.amount).toBe(8000);

      // Verify date filter out of bounds returns 0 investments
      const futureRepRes = await request(app)
        .get('/api/v1/reports?startDate=2027-01-01&endDate=2027-01-31')
        .set('Cookie', userCookie);

      expect(futureRepRes.status).toBe(200);
      expect(futureRepRes.body.data.summary.totalInvestments).toBe(0);
      expect(futureRepRes.body.data.investments.transactions.length).toBe(0);
    });
  });

  describe('Scenario 9: Existing Expense and Income workflows remain completely unchanged', () => {
    it('creates normal income and expense transactions, verifying correct balance changes', async () => {
      const balBefore = (await BankAccount.findById(bankAccountId))!.currentBalance;

      // Post normal income of ₹12,000
      const incRes = await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', userCookie)
        .send({
          type: TransactionType.INCOME,
          title: 'Consulting Fee',
          amount: 12000,
          date: '2026-10-12',
          category: 'Freelance income',
          paymentMethod: PaymentMethod.UPI,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bankAccountId,
        });

      expect(incRes.status).toBe(201);
      expect(incRes.body.data.type).toBe(TransactionType.INCOME);

      const balMid = (await BankAccount.findById(bankAccountId))!.currentBalance;
      expect(balMid).toBe(balBefore + 12000);

      // Post normal expense of ₹4,000
      const expRes = await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', userCookie)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Internet Broadband Bill',
          amount: 4000,
          date: '2026-10-14',
          category: 'Broadband',
          paymentMethod: PaymentMethod.UPI,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bankAccountId,
        });

      expect(expRes.status).toBe(201);
      expect(expRes.body.data.type).toBe(TransactionType.EXPENSE);

      const balFinal = (await BankAccount.findById(bankAccountId))!.currentBalance;
      expect(balFinal).toBe(balMid - 4000);
    });
  });
});
