import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import {
  AccountType,
  TransactionType,
  RecurringFrequency,
  PaymentMethod,
  PaymentChannel,
  LendingBorrowingType,
  CreditCardNetwork,
} from '@finora/shared';
import { getCycleKey } from '../controllers/recurring';
import { ChitFundAdjustment } from '../models/ChitFundAdjustment';

describe('Total Assets, Personal Available Balance, Debt Separation & Recurring Lifecycle Tests', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let chitBankAccountId: string;
  let personalBankAccountId: string;
  let chitFundId: string;
  let chitMemberId: string;
  let creditCardId: string;
  let recurringRuleId: string;
  let createdTxId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // 1. Register User
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'lifecycle.tester@finora.test',
        password: 'Password123!',
        fullName: 'Lifecycle Tester',
        currency: 'INR',
      });
    userCookie = regRes.headers['set-cookie'][0];

    // 2. Create Designated Chit Bank Account with ₹100,000
    const chitAccRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'Chit Designated HDFC',
        bankName: 'HDFC Bank',
        accountType: AccountType.SAVINGS,
        openingBalance: 100000,
        openingBalanceDate: new Date().toISOString(),
        currency: 'INR',
        isChitFundAccount: true,
      });
    chitBankAccountId = chitAccRes.body.data.id;

    // 3. Create Other Personal Bank Account with ₹50,000
    const personalAccRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'Personal SBI Account',
        bankName: 'State Bank of India',
        accountType: AccountType.SAVINGS,
        openingBalance: 50000,
        openingBalanceDate: new Date().toISOString(),
        currency: 'INR',
        isChitFundAccount: false,
      });
    personalBankAccountId = personalAccRes.body.data.id;

    // 4. Set Opening Personal Cash in Hand to ₹10,000
    await request(app)
      .post('/api/v1/accounts/cash-in-hand/adjust')
      .set('Cookie', userCookie)
      .send({
        type: 'set_balance',
        amount: 10000,
        date: new Date().toISOString(),
        description: 'Personal Cash Initial',
      });

    // 5. Setup Chit Fund and Member
    const cfRes = await request(app)
      .get('/api/v1/chit-funds')
      .set('Cookie', userCookie);
    chitFundId = cfRes.body.data.id;

    const memRes = await request(app)
      .post(`/api/v1/chit-funds/${chitFundId}/members`)
      .set('Cookie', userCookie)
      .send({
        name: 'Member Rajesh',
        phoneNumber: '9876543210',
        numberOfChits: 1,
      });
    chitMemberId = memRes.body.data.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  describe('PART 1: Total Personal Available Balance & Chit Reserve Deduction', () => {
    it('1.1 should correctly calculate initial balances before any chit collections', async () => {
      const res = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      const data = res.body.data;

      expect(data.isChitAccountConfigured).toBe(true);
      expect(data.designatedBankAccountId).toBe(chitBankAccountId);
      expect(data.designatedBankBalance).toBe(100000);
      expect(data.otherBankBalances).toBe(50000);
      expect(data.chitReserveHeldInBank).toBe(0);
      expect(data.personalAvailableBalanceChitBank).toBe(100000);
      expect(data.totalPersonalAvailableBalance).toBe(150000); // 100,000 + 50,000
      expect(data.totalBankBalance).toBe(150000);
      expect(data.personalCashInHand).toBe(10000);
      expect(data.totalAvailableMoney).toBe(160000); // 150,000 + 10,000
    });

    it('1.2 should deduct Chit Funds Held in Bank (R_chit) exclusively from the designated chit account', async () => {
      // Record ₹25,000 chit contribution received in bank via UPI
      await request(app)
        .post(`/api/v1/chit-funds/${chitFundId}/collections`)
        .set('Cookie', userCookie)
        .send({
          memberId: chitMemberId,
          actualAmountReceived: 25000,
          collectionPeriod: '2026-10',
          paymentMethod: 'upi',
          receivingBankAccountId: chitBankAccountId,
          collectionDate: new Date().toISOString(),
        });

      const res = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      const data = res.body.data;

      // Designated bank balance has increased to ₹125,000
      expect(data.designatedBankBalance).toBe(125000);
      // Chit reserve is ₹25,000
      expect(data.chitReserveHeldInBank).toBe(25000);
      // Personal available balance of chit bank: 125,000 - 25,000 = 100,000
      expect(data.personalAvailableBalanceChitBank).toBe(100000);
      // Other bank balance unchanged: 50,000
      expect(data.otherBankBalances).toBe(50000);
      // Total Personal Available Balance: (125,000 - 25,000) + 50,000 = 150,000
      expect(data.totalPersonalAvailableBalance).toBe(150000);
      // Total liquid bank across accounts: 125,000 + 50,000 = 175,000
      expect(data.totalBankBalance).toBe(175000);
      // Total available money: 150,000 + 10,000 cash = 160,000
      expect(data.totalAvailableMoney).toBe(160000);
    });

    it('1.3 should strictly exclude Chit Cash in Hand collections from personal cash and personal available balances', async () => {
      // Record ₹5,000 chit collection in physical cash for period 2026-11
      const colRes = await request(app)
        .post(`/api/v1/chit-funds/${chitFundId}/collections`)
        .set('Cookie', userCookie)
        .send({
          memberId: chitMemberId,
          actualAmountReceived: 5000,
          collectionPeriod: '2026-11',
          paymentMethod: 'cash_in_hand',
          collectionDate: new Date().toISOString(),
        });

      expect(colRes.status).toBe(201);

      const res = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      const data = res.body.data;

      // Personal cash in hand MUST remain ₹10,000 (chit cash strictly excluded!)
      expect(data.personalCashInHand).toBe(10000);
      // Chit reserve held in bank remains ₹25,000 (cash is not in bank)
      expect(data.chitReserveHeldInBank).toBe(25000);
      // Total personal available balance remains ₹150,000
      expect(data.totalPersonalAvailableBalance).toBe(150000);
      // Total available money remains ₹160,000
      expect(data.totalAvailableMoney).toBe(160000);
    });

    it('1.4 should properly handle unconfigured chit bank account without deducting balances', async () => {
      // Register a second user with NO designated chit bank account
      const user2Reg = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'no.chit.bank@finora.test',
          password: 'Password123!',
          fullName: 'No Chit Bank User',
          currency: 'INR',
        });
      const user2Cookie = user2Reg.headers['set-cookie'][0];

      await request(app)
        .post('/api/v1/accounts')
        .set('Cookie', user2Cookie)
        .send({
          accountName: 'General Bank Account',
          bankName: 'Axis Bank',
          accountType: AccountType.SAVINGS,
          openingBalance: 40000,
          openingBalanceDate: new Date().toISOString(),
          currency: 'INR',
          isChitFundAccount: false,
        });

      const res = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', user2Cookie);

      expect(res.status).toBe(200);
      const data = res.body.data;

      // Should indicate not configured
      expect(data.isChitAccountConfigured).toBe(false);
      expect(data.designatedBankAccountId).toBeUndefined();
      expect(data.chitReserveHeldInBank).toBe(0);
      expect(data.totalPersonalAvailableBalance).toBe(40000);
      expect(data.totalBankBalance).toBe(40000);
    });

    it('1.5 should accurately handle deficit condition when R_chit > B_chit with negative personal available balance', async () => {
      // Register a third user to isolate deficit testing
      const user3Reg = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'deficit.tester@finora.test',
          password: 'Password123!',
          fullName: 'Deficit Tester',
          currency: 'INR',
        });
      const user3Cookie = user3Reg.headers['set-cookie'][0];

      // Designated chit bank with balance ₹20,000
      const chitAcc = await request(app)
        .post('/api/v1/accounts')
        .set('Cookie', user3Cookie)
        .send({
          accountName: 'Deficit Chit Account',
          bankName: 'ICICI Bank',
          accountType: AccountType.SAVINGS,
          openingBalance: 20000,
          openingBalanceDate: new Date().toISOString(),
          currency: 'INR',
          isChitFundAccount: true,
        });

      // Other bank account with ₹50,000
      await request(app)
        .post('/api/v1/accounts')
        .set('Cookie', user3Cookie)
        .send({
          accountName: 'Other Bank Account',
          bankName: 'SBI',
          accountType: AccountType.SAVINGS,
          openingBalance: 50000,
          openingBalanceDate: new Date().toISOString(),
          currency: 'INR',
          isChitFundAccount: false,
        });

      const cfRes = await request(app)
        .get('/api/v1/chit-funds')
        .set('Cookie', user3Cookie);
      const user3ChitId = cfRes.body.data.id;

      const memRes = await request(app)
        .post(`/api/v1/chit-funds/${user3ChitId}/members`)
        .set('Cookie', user3Cookie)
        .send({
          name: 'Member Priya',
          numberOfChits: 1,
          contributionPerChit: 30000,
        });

      // Collect ₹30,000 into chit bank (making R_chit = 30,000). But suppose opening balance was ₹0 or bank is ₹25,000.
      // Designated account had opening balance 20,000 + 30,000 collection = 50,000.
      // Now record an expense from designated account of ₹35,000, leaving bank balance at ₹15,000 while chit reserve is ₹30,000.
      await request(app)
        .post(`/api/v1/chit-funds/${user3ChitId}/collections`)
        .set('Cookie', user3Cookie)
        .send({
          memberId: memRes.body.data.id,
          actualAmountReceived: 30000,
          collectionPeriod: '2026-10',
          paymentMethod: 'upi',
          receivingBankAccountId: chitAcc.body.data.id,
          collectionDate: new Date().toISOString(),
        });

      // Add a chit adjustment of ₹35,000 for this chit fund/account to simulate chit reserve exceeding bank balance
      await ChitFundAdjustment.create({
        userId: cfRes.body.data.userId,
        chitFundId: user3ChitId,
        bankAccountId: chitAcc.body.data.id,
        entryType: 'adjustment',
        amount: 35000,
        reason: 'Legacy adjustment',
        date: new Date(),
      });

      // Current state:
      // B_chit = 20,000 + 30,000 = 50,000
      // R_chit = 30,000 + 35,000 = 65,000
      // R_chit > B_chit (65,000 > 50,000) -> Deficit of -15,000!
      // B_other = 50,000
      // Total Personal Available Balance = (50,000 - 65,000) + 50,000 = -15,000 + 50,000 = 35,000!
      const res = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', user3Cookie);

      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.designatedBankBalance).toBe(50000);
      expect(data.chitReserveHeldInBank).toBe(65000);
      expect(data.personalAvailableBalanceChitBank).toBe(-15000);
      expect(data.otherBankBalances).toBe(50000);
      expect(data.totalPersonalAvailableBalance).toBe(35000);
    });
  });

  describe('PART 2: Component Balances Breakdown, Credit Card Debt & Net Financial Position', () => {
    it('2.1 should separate personal borrowing from credit card debt and compute Total Outstanding Debt', async () => {
      // 1. Create a credit card with ₹50,000 limit
      const cardRes = await request(app)
        .post('/api/v1/credit-cards')
        .set('Cookie', userCookie)
        .send({
          cardNickname: 'HDFC Millennia',
          issuingBank: 'HDFC Bank',
          network: CreditCardNetwork.VISA,
          creditLimit: 50000,
          billingCycleClosingDay: 15,
          paymentDueDay: 5,
          openingOutstanding: 0,
          openingOutstandingDate: new Date().toISOString(),
        });
      creditCardId = cardRes.body.data.id;

      // 2. Spend ₹12,000 on the credit card
      await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', userCookie)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Electronics Purchase',
          amount: 12000,
          date: new Date().toISOString(),
          category: 'Shopping',
          paymentMethod: PaymentMethod.CREDIT_CARD,
          paymentChannel: PaymentChannel.ONLINE,
          creditCardId,
        });

      // 3. Lend ₹20,000 to John (Personal Lending, L)
      await request(app)
        .post('/api/v1/lending-borrowing')
        .set('Cookie', userCookie)
        .send({
          type: LendingBorrowingType.LENDING,
          personName: 'John Friend',
          amount: 20000,
          date: new Date().toISOString(),
          paymentMethod: 'upi',
          bankAccountId: personalBankAccountId,
          accountingMode: 'live',
        });

      // 4. Borrow ₹15,000 from Sarah (Personal Borrowing, D_borrowed)
      await request(app)
        .post('/api/v1/lending-borrowing')
        .set('Cookie', userCookie)
        .send({
          type: LendingBorrowingType.BORROWING,
          personName: 'Sarah Colleague',
          amount: 15000,
          date: new Date().toISOString(),
          paymentMethod: 'upi',
          bankAccountId: personalBankAccountId,
          accountingMode: 'live',
        });

      const res = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      const data = res.body.data;

      // Check debt separation:
      expect(data.personalBorrowingOutstanding).toBe(15000); // D_borrowed
      expect(data.creditCardOutstanding).toBe(12000);         // D_cc
      expect(data.totalOutstandingDebt).toBe(27000);          // D_borrowed + D_cc

      // Check lending:
      expect(data.outstandingLending).toBe(20000);            // L

      // Check personal bank balance after personal loan movements:
      // Personal SBI: 50,000 - 20,000 (lent) + 15,000 (borrowed) = 45,000
      expect(data.otherBankBalances).toBe(45000);
      // Designated Chit: 100,000 + 25,000 chit col = 125,000. Chit reserve: 25,000.
      // Personal available of chit bank = 100,000.
      expect(data.personalAvailableBalanceChitBank).toBe(100000);
      // Total personal available = 100,000 + 45,000 = 145,000
      expect(data.totalPersonalAvailableBalance).toBe(145000);

      // Total Available Money = 145,000 + 10,000 cash = 155,000
      expect(data.totalAvailableMoney).toBe(155000);

      // Total Financial Assets Tracked = C (10k) + L (20k) + Total Personal Avail (145k) = 175,000
      expect(data.totalFinancialAssetsTracked).toBe(175000);

      // Net Personal Financial Position = Assets (175,000) - Debt (27,000) = 148,000
      expect(data.netTrackedPosition).toBe(148000);
    });
  });

  describe('PART 3: Recurring Transactions & Bills Lifecycle', () => {
    const currentMonthKey = getCycleKey(new Date(), 'Asia/Kolkata');

    it('3.1 should create a recurring rule with initial DUE occurrence', async () => {
      const today = new Date();
      const res = await request(app)
        .post('/api/v1/recurring')
        .set('Cookie', userCookie)
        .send({
          title: 'Broadband Internet',
          amount: 1500,
          type: TransactionType.EXPENSE,
          category: 'Utilities',
          frequency: RecurringFrequency.MONTHLY,
          paymentMethod: PaymentMethod.UPI,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: personalBankAccountId,
          nextExecutionDate: today.toISOString(),
          notes: 'Fiber broadband monthly plan',
          isActive: true,
        });

      expect(res.status).toBe(201);
      recurringRuleId = res.body.data._id || res.body.data.id;
      expect(recurringRuleId).toBeDefined();

      // Check rules endpoint - should indicate current month is DUE, not yet logged
      const listRes = await request(app)
        .get('/api/v1/recurring')
        .set('Cookie', userCookie);

      expect(listRes.status).toBe(200);
      const ruleItem = listRes.body.data.find((r: any) => (r.id || r._id) === recurringRuleId);
      expect(ruleItem).toBeDefined();
      expect(ruleItem.isLoggedForCurrentMonth).toBe(false);
      expect(ruleItem.currentMonthOccurrenceStatus).toBe('DUE');
      expect(ruleItem.currentMonthCycleKey).toBe(currentMonthKey);
    });

    it('3.2 should log occurrence and advance schedule when "Log Now" is executed', async () => {
      const execRes = await request(app)
        .post(`/api/v1/recurring/${recurringRuleId}/execute`)
        .set('Cookie', userCookie);

      expect(execRes.status).toBe(200);
      expect(execRes.body.success).toBe(true);
      expect(execRes.body.data.transaction).toBeDefined();
      expect(execRes.body.data.transaction.recurringRuleId).toBe(recurringRuleId);
      expect(execRes.body.data.transaction.occurrenceKey).toBe(currentMonthKey);
      createdTxId = execRes.body.data.transaction.id || execRes.body.data.transaction._id;

      // Verify the rule's nextExecutionDate advanced to next month
      const updatedRule = execRes.body.data.recurringRule;
      const originalDate = new Date();
      const nextDate = new Date(updatedRule.nextExecutionDate);
      expect(nextDate.getMonth()).toBe((originalDate.getMonth() + 1) % 12);
      expect(updatedRule.lastExecutedAt).toBeDefined();

      // Check rules endpoint - should now indicate current month IS LOGGED
      const listRes = await request(app)
        .get('/api/v1/recurring')
        .set('Cookie', userCookie);

      const ruleItem = listRes.body.data.find((r: any) => (r.id || r._id) === recurringRuleId);
      expect(ruleItem.isLoggedForCurrentMonth).toBe(true);
      expect(ruleItem.currentMonthOccurrenceStatus).toBe('LOGGED');
      expect(ruleItem.currentMonthTransactionId).toBe(createdTxId);
    });

    it('3.3 should prevent duplicate transaction logging for the same monthly cycle', async () => {
      // Trying to execute again in the same month should fail with 400
      const duplicateRes = await request(app)
        .post(`/api/v1/recurring/${recurringRuleId}/execute`)
        .set('Cookie', userCookie)
        .send({ occurrenceKey: currentMonthKey });

      expect(duplicateRes.status).toBe(400);
      expect(duplicateRes.body.error?.code).toMatch(/ALREADY_LOGGED|TRANSACTION_ALREADY_EXISTS/);
    });

    it('3.4 should revert occurrence to DUE and roll back nextExecutionDate when the linked transaction is deleted', async () => {
      // Delete the created transaction
      const delTxRes = await request(app)
        .delete(`/api/v1/transactions/${createdTxId}`)
        .set('Cookie', userCookie);

      expect(delTxRes.status).toBe(200);

      // Verify recurring schedule has reverted back to DUE and Next Due date rolled back
      const listRes = await request(app)
        .get('/api/v1/recurring')
        .set('Cookie', userCookie);

      const ruleItem = listRes.body.data.find((r: any) => (r.id || r._id) === recurringRuleId);
      expect(ruleItem.isLoggedForCurrentMonth).toBe(false);
      expect(ruleItem.currentMonthOccurrenceStatus).toBe('DUE');
      expect(ruleItem.currentMonthTransactionId).toBeUndefined();

      // NextExecutionDate should be back in the current month!
      const rolledBackDate = new Date(ruleItem.nextExecutionDate);
      const today = new Date();
      expect(rolledBackDate.getMonth()).toBe(today.getMonth());
    });

    it('3.5 should allow re-logging after transaction deletion', async () => {
      // Re-execute after deletion
      const reLogRes = await request(app)
        .post(`/api/v1/recurring/${recurringRuleId}/execute`)
        .set('Cookie', userCookie);

      expect(reLogRes.status).toBe(200);
      expect(reLogRes.body.success).toBe(true);

      const listRes = await request(app)
        .get('/api/v1/recurring')
        .set('Cookie', userCookie);

      const ruleItem = listRes.body.data.find((r: any) => (r.id || r._id) === recurringRuleId);
      expect(ruleItem.isLoggedForCurrentMonth).toBe(true);
      expect(ruleItem.currentMonthOccurrenceStatus).toBe('LOGGED');
    });
  });
});
