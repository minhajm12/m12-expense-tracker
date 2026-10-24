import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { BankAccount } from '../models/BankAccount';
import { CreditCard } from '../models/CreditCard';
import { CashAccount } from '../models/CashAccount';
import { Transaction } from '../models/Transaction';
import {
  AccountType,
  CreditCardNetwork,
  TransactionType,
  PaymentMethod,
  PaymentChannel,
} from '@finora/shared';
import { recalculateAccountBalance, recalculateCreditCardOutstanding, calculatePersonalCashInHand } from '../services/financial';

describe('Past-Recorded Transactions & Balance Safety Audit', () => {
  let mongoServer: MongoMemoryServer;
  let authToken: string;
  let userId: string;
  let bankAccountId: string;
  let bankAccountId2: string;
  let creditCardId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await connectDatabase(uri);

    // Register test user
    const regRes = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Past Record Tester',
      email: 'pastrecord@m12.test',
      password: 'Password123!',
      currency: 'INR',
      requireVerification: false,
    });
    authToken = regRes.body.data.token;
    userId = regRes.body.data.user.id || regRes.body.data.user._id;

    // Create Bank Account 1 with opening balance of 10,000
    const accRes1 = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        accountName: 'Primary Checking',
        bankName: 'HDFC Bank',
        accountType: AccountType.SAVINGS,
        openingBalance: 10000,
        openingBalanceDate: '2026-01-01',
        currency: 'INR',
      });
    bankAccountId = accRes1.body.data.id || accRes1.body.data._id;

    // Create Bank Account 2 with opening balance of 5,000
    const accRes2 = await request(app)
      .post('/api/v1/accounts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        accountName: 'Secondary Savings',
        bankName: 'SBI Bank',
        accountType: AccountType.SAVINGS,
        openingBalance: 5000,
        openingBalanceDate: '2026-01-01',
        currency: 'INR',
      });
    bankAccountId2 = accRes2.body.data.id || accRes2.body.data._id;

    // Create Credit Card with limit 50,000 and 0 opening outstanding
    const cardRes = await request(app)
      .post('/api/v1/credit-cards')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        cardNickname: 'Millennia Card',
        issuingBank: 'HDFC Bank',
        network: CreditCardNetwork.VISA,
        lastFourDigits: '4321',
        creditLimit: 50000,
        billingCycleClosingDay: 15,
        paymentDueDay: 5,
        openingOutstanding: 0,
        openingOutstandingDate: '2026-01-01',
      });
    creditCardId = cardRes.body.data.id || cardRes.body.data._id;
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
  });

  describe('1. Income Transactions (Normal vs Past-Recorded)', () => {
    it('Normal income increases bank account balance', async () => {
      const res = await request(app)
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: TransactionType.INCOME,
          title: 'Salary Deposit',
          amount: 25000,
          currency: 'INR',
          date: '2026-10-10',
          category: 'Salary',
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bankAccountId,
          isPastRecorded: false,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.isPastRecorded).toBe(false);

      const acc = await BankAccount.findById(bankAccountId);
      // 10,000 + 25,000 = 35,000
      expect(acc?.currentBalance).toBe(35000);
    });

    it('Past-recorded income does NOT adjust bank account balance', async () => {
      const res = await request(app)
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: TransactionType.INCOME,
          title: 'Old Historical Bonus',
          amount: 15000,
          currency: 'INR',
          date: '2026-10-05',
          category: 'Salary',
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bankAccountId,
          isPastRecorded: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.isPastRecorded).toBe(true);

      const acc = await BankAccount.findById(bankAccountId);
      // Balance MUST remain strictly 35,000
      expect(acc?.currentBalance).toBe(35000);
    });
  });

  describe('2. Expense Transactions (Normal vs Past-Recorded)', () => {
    it('Normal expense decreases bank account balance', async () => {
      const res = await request(app)
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Current Utility Bill',
          amount: 3000,
          currency: 'INR',
          date: '2026-10-12',
          category: 'Utilities',
          paymentMethod: PaymentMethod.UPI,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bankAccountId,
          isPastRecorded: false,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.isPastRecorded).toBe(false);

      const acc = await BankAccount.findById(bankAccountId);
      // 35,000 - 3,000 = 32,000
      expect(acc?.currentBalance).toBe(32000);
    });

    it('Past-recorded expense does NOT adjust bank account balance', async () => {
      const res = await request(app)
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Historical Grocery Run',
          amount: 5000,
          currency: 'INR',
          date: '2026-10-01',
          category: 'Food',
          paymentMethod: PaymentMethod.UPI,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bankAccountId,
          isPastRecorded: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.isPastRecorded).toBe(true);

      const acc = await BankAccount.findById(bankAccountId);
      // Balance MUST remain strictly 32,000
      expect(acc?.currentBalance).toBe(32000);
    });
  });

  describe('3. Investment Transactions (Normal vs Past-Recorded)', () => {
    it('Normal investment decreases bank account balance', async () => {
      const res = await request(app)
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: TransactionType.INVESTMENT,
          title: 'SIP Mutual Fund',
          amount: 2000,
          currency: 'INR',
          date: '2026-10-15',
          category: 'Mutual Funds',
          paymentMethod: PaymentMethod.NET_BANKING,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bankAccountId,
          isPastRecorded: false,
        });

      expect(res.status).toBe(201);
      const acc = await BankAccount.findById(bankAccountId);
      // 32,000 - 2,000 = 30,000
      expect(acc?.currentBalance).toBe(30000);
    });

    it('Past-recorded investment does NOT adjust bank account balance', async () => {
      const res = await request(app)
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: TransactionType.INVESTMENT,
          title: 'Past Gold Purchase',
          amount: 10000,
          currency: 'INR',
          date: '2026-10-02',
          category: 'Gold',
          paymentMethod: PaymentMethod.NET_BANKING,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bankAccountId,
          isPastRecorded: true,
        });

      expect(res.status).toBe(201);
      const acc = await BankAccount.findById(bankAccountId);
      // Balance MUST remain strictly 30,000
      expect(acc?.currentBalance).toBe(30000);
    });
  });

  describe('4. Credit Card Outstanding Handling', () => {
    it('Normal credit card expense increases outstanding', async () => {
      const res = await request(app)
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Flight Ticket',
          amount: 8000,
          currency: 'INR',
          date: '2026-10-18',
          category: 'Travel',
          paymentMethod: PaymentMethod.CREDIT_CARD,
          paymentChannel: PaymentChannel.ONLINE,
          creditCardId: creditCardId,
          isPastRecorded: false,
        });

      expect(res.status).toBe(201);
      const card = await CreditCard.findById(creditCardId);
      expect(card?.currentOutstanding).toBe(8000);
      expect(card?.availableCredit).toBe(42000);
    });

    it('Past-recorded credit card expense does NOT adjust outstanding', async () => {
      const res = await request(app)
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Past Flight Ticket',
          amount: 12000,
          currency: 'INR',
          date: '2026-10-03',
          category: 'Travel',
          paymentMethod: PaymentMethod.CREDIT_CARD,
          paymentChannel: PaymentChannel.ONLINE,
          creditCardId: creditCardId,
          isPastRecorded: true,
        });

      expect(res.status).toBe(201);
      const card = await CreditCard.findById(creditCardId);
      // Outstanding remains strictly 8,000
      expect(card?.currentOutstanding).toBe(8000);
      expect(card?.availableCredit).toBe(42000);
    });
  });

  describe('5. Personal Cash In Hand Handling', () => {
    it('Normal cash expense decreases cash in hand', async () => {
      // First ensure cash in hand starts with 5000
      let cash = await CashAccount.findOne({ userId });
      if (!cash) {
        cash = await CashAccount.create({
          userId,
          openingBalance: 5000,
          currentBalance: 5000,
          currency: 'INR',
        });
      } else {
        cash.openingBalance = 5000;
        await cash.save();
      }

      await request(app)
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Cash Snacks',
          amount: 500,
          currency: 'INR',
          date: '2026-10-19',
          category: 'Food',
          paymentMethod: PaymentMethod.CASH,
          paymentChannel: PaymentChannel.OFFLINE,
          isPastRecorded: false,
        });

      const cashBal = await calculatePersonalCashInHand(userId);
      // 5,000 - 500 = 4,500
      expect(cashBal).toBe(4500);
    });

    it('Past-recorded cash expense does NOT decrease cash in hand', async () => {
      await request(app)
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Historical Cash Tea',
          amount: 1000,
          currency: 'INR',
          date: '2026-10-04',
          category: 'Food',
          paymentMethod: PaymentMethod.CASH,
          paymentChannel: PaymentChannel.OFFLINE,
          isPastRecorded: true,
        });

      const cashBal = await calculatePersonalCashInHand(userId);
      // Cash balance remains strictly 4,500
      expect(cashBal).toBe(4500);
    });
  });

  describe('6. Lifecycle Transitions & Edits', () => {
    let transitionTxId: string;

    it('Transition: Normal -> Past-Recorded reverses previously applied balance effect', async () => {
      // Create normal expense of 1,000
      const createRes = await request(app)
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Transition Test Expense',
          amount: 1000,
          currency: 'INR',
          date: '2026-10-20',
          category: 'Food',
          paymentMethod: PaymentMethod.UPI,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bankAccountId,
          isPastRecorded: false,
        });

      transitionTxId = createRes.body.data.id || createRes.body.data._id;
      let acc = await BankAccount.findById(bankAccountId);
      // 30,000 - 1,000 = 29,000
      expect(acc?.currentBalance).toBe(29000);

      // Now edit to isPastRecorded: true
      const updateRes = await request(app)
        .patch(`/api/v1/transactions/${transitionTxId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          isPastRecorded: true,
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.isPastRecorded).toBe(true);

      acc = await BankAccount.findById(bankAccountId);
      // Balance restored back to 30,000 (effect reversed exactly once!)
      expect(acc?.currentBalance).toBe(30000);
    });

    it('Transition: Past-Recorded -> Normal applies normal balance effect', async () => {
      // Edit back to isPastRecorded: false
      const updateRes = await request(app)
        .patch(`/api/v1/transactions/${transitionTxId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          isPastRecorded: false,
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.isPastRecorded).toBe(false);

      const acc = await BankAccount.findById(bankAccountId);
      // Balance debited back down to 29,000 (normal effect applied exactly once!)
      expect(acc?.currentBalance).toBe(29000);
    });

    it('Editing amount on a past-recorded transaction keeps balance untouched', async () => {
      // Set to past-recorded first
      await request(app)
        .patch(`/api/v1/transactions/${transitionTxId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ isPastRecorded: true });

      let acc = await BankAccount.findById(bankAccountId);
      expect(acc?.currentBalance).toBe(30000);

      // Change amount from 1,000 to 9,999
      const updateRes = await request(app)
        .patch(`/api/v1/transactions/${transitionTxId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ amount: 9999 });

      expect(updateRes.status).toBe(200);
      acc = await BankAccount.findById(bankAccountId);
      // Balance remains strictly 30,000
      expect(acc?.currentBalance).toBe(30000);
    });

    it('Changing bank account on a past-recorded transaction keeps both account balances untouched', async () => {
      const acc1Before = await BankAccount.findById(bankAccountId);
      const acc2Before = await BankAccount.findById(bankAccountId2);

      // Change account from bankAccountId to bankAccountId2
      const updateRes = await request(app)
        .patch(`/api/v1/transactions/${transitionTxId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ accountId: bankAccountId2 });

      expect(updateRes.status).toBe(200);

      const acc1After = await BankAccount.findById(bankAccountId);
      const acc2After = await BankAccount.findById(bankAccountId2);

      expect(acc1After?.currentBalance).toBe(acc1Before?.currentBalance);
      expect(acc2After?.currentBalance).toBe(acc2Before?.currentBalance);
    });

    it('Deleting a past-recorded transaction does not change account balance', async () => {
      const acc2Before = await BankAccount.findById(bankAccountId2);

      const delRes = await request(app)
        .delete(`/api/v1/transactions/${transitionTxId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(delRes.status).toBe(200);

      const acc2After = await BankAccount.findById(bankAccountId2);
      // Balance remains strictly identical
      expect(acc2After?.currentBalance).toBe(acc2Before?.currentBalance);
    });

    it('Deleting a normal transaction reverses its balance effect', async () => {
      // Create normal expense of 4,000 on Account 1
      const createRes = await request(app)
        .post('/api/v1/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Normal Expense to Delete',
          amount: 4000,
          currency: 'INR',
          date: '2026-10-21',
          category: 'Shopping',
          paymentMethod: PaymentMethod.UPI,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bankAccountId,
          isPastRecorded: false,
        });

      const delTxId = createRes.body.data.id || createRes.body.data._id;
      let acc = await BankAccount.findById(bankAccountId);
      // 30,000 - 4,000 = 26,000
      expect(acc?.currentBalance).toBe(26000);

      // Delete transaction
      await request(app)
        .delete(`/api/v1/transactions/${delTxId}`)
        .set('Authorization', `Bearer ${authToken}`);

      acc = await BankAccount.findById(bankAccountId);
      // 26,000 + 4,000 = 30,000 (reversed effect!)
      expect(acc?.currentBalance).toBe(30000);
    });
  });

  describe('7. Preserved Reports & Analytics Verification', () => {
    it('Monthly Income Summary includes both normal and past-recorded income', async () => {
      const res = await request(app)
        .get('/api/v1/reports/monthly-income?month=2026-10')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      const data = res.body.data;
      // Normal income (25,000) + Past-recorded income (15,000) = 40,000 Total Monthly Income
      expect(data.totalMonthlyIncome).toBe(40000);
      expect(data.allIncomeTotal).toBe(40000);

      // Verify isPastRecorded flag is present on transactions
      const pastIncome = data.allTransactions.find((t: any) => t.title === 'Old Historical Bonus');
      expect(pastIncome).toBeDefined();
      expect(pastIncome.isPastRecorded).toBe(true);

      const normalIncome = data.allTransactions.find((t: any) => t.title === 'Salary Deposit');
      expect(normalIncome).toBeDefined();
      expect(normalIncome.isPastRecorded).toBe(false);
    });

    it('Monthly Expenses Summary includes both normal and past-recorded expenses', async () => {
      const res = await request(app)
        .get('/api/v1/reports/monthly-expenses?month=2026-10')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      const data = res.body.data;
      // Contains both utility bill (3000) and historical grocery run (5000), flight ticket (8000), past flight (12000), cash snacks (500), historical cash (1000)
      expect(data.totalExpenses).toBeGreaterThanOrEqual(29500);

      // Check category breakdown includes past-recorded items
      const foodCategory = data.categoryBreakdown.find((c: any) => c.category === 'Food');
      expect(foodCategory).toBeDefined();
      expect(foodCategory.amount).toBeGreaterThanOrEqual(5000);

      // Check isPastRecorded flag on formatted transaction
      const pastExpense = data.allTransactions.find((t: any) => t.title === 'Historical Grocery Run');
      expect(pastExpense).toBeDefined();
      expect(pastExpense.isPastRecorded).toBe(true);
    });

    it('Financial Report includes past-recorded transactions in total spend/income', async () => {
      const res = await request(app)
        .get('/api/v1/reports?startDate=2026-10-01&endDate=2026-10-31')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      const summary = res.body.data.summary;
      expect(summary.totalIncome).toBeGreaterThanOrEqual(40000);
      expect(summary.totalExpenses).toBeGreaterThanOrEqual(29500);
    });
  });
});
