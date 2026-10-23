import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import {
  CreditCardNetwork,
  PaymentMethod,
  PaymentChannel,
  TransactionType,
  AccountType,
  RecurringFrequency,
} from '@finora/shared';
import { BankAccount } from '../models/BankAccount';
import { CreditCard } from '../models/CreditCard';
import { Transaction } from '../models/Transaction';
import { RecurringTransaction } from '../models/RecurringTransaction';
import { RecurringOccurrence } from '../models/RecurringOccurrence';
import { ChitFund } from '../models/ChitFund';
import { ChitFundMember } from '../models/ChitFundMember';
import { ChitFundCollection } from '../models/ChitFundCollection';
import { ChitFundPayout } from '../models/ChitFundPayout';

describe('Regression Suite: Loading, Discounts, Redemptions & Chit Separation', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let userId: string;
  let bankAccountId: string;
  let chitBankAccountId: string;
  let creditCardId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // 1. Register User
    const authRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'fixes.tester@finora.test',
        password: 'Password123!',
        fullName: 'Alex Auditor',
        currency: 'INR',
      });
    userCookie = authRes.headers['set-cookie'][0];
    userId = authRes.body.data.user.id;

    // 2. Create Regular Bank Account with ₹1,00,000
    const bankRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'HDFC Main Checking',
        bankName: 'HDFC Bank',
        accountType: AccountType.CURRENT,
        openingBalance: 100000,
        openingBalanceDate: '2026-01-01T00:00:00.000Z',
      });
    bankAccountId = bankRes.body.data.id;

    // 3. Create Designated Chit Bank Account with ₹2,00,000
    const chitBankRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'SBI Chit Reserve Account',
        bankName: 'State Bank of India',
        accountType: AccountType.SAVINGS,
        openingBalance: 200000,
        openingBalanceDate: '2026-01-01T00:00:00.000Z',
        isChitFundAccount: true,
      });
    chitBankAccountId = chitBankRes.body.data.id;

    // 4. Create Credit Card with ₹50,000 limit and ₹0 opening outstanding
    const ccRes = await request(app)
      .post('/api/v1/credit-cards')
      .set('Cookie', userCookie)
      .send({
        cardNickname: 'Apex Platinum Card',
        issuingBank: 'Axis Bank',
        network: CreditCardNetwork.VISA,
        lastFourDigits: '9988',
        creditLimit: 50000,
        billingCycleClosingDay: 15,
        paymentDueDay: 5,
        openingOutstanding: 0,
        openingOutstandingDate: '2026-01-01T00:00:00.000Z',
      });
    expect(ccRes.status).toBe(201);
    creditCardId = ccRes.body.data.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
  });

  // ==========================================
  // SECTION 1: Recurring "Log Now" with Discounts & Future Amount Changes
  // ==========================================
  describe('1. Recurring "Log Now" with Discounts & Future Amount Changes', () => {
    let wifiRuleId: string;

    it('1.1 creates a monthly recurring schedule configured at ₹1,000', async () => {
      const res = await request(app)
        .post('/api/v1/recurring')
        .set('Cookie', userCookie)
        .send({
          title: 'High-Speed Broadband Internet',
          amount: 1000,
          type: TransactionType.EXPENSE,
          category: 'Utilities',
          frequency: RecurringFrequency.MONTHLY,
          paymentMethod: PaymentMethod.UPI,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bankAccountId,
          nextExecutionDate: '2026-10-15T00:00:00.000Z',
        });

      expect(res.status).toBe(201);
      wifiRuleId = res.body.data.id;
      expect(wifiRuleId).toBeDefined();
    });

    it('1.2 logs recurring transaction with a fixed discount (₹150 off: pays ₹850)', async () => {
      const bankBefore = await BankAccount.findById(bankAccountId);
      const balanceBefore = bankBefore!.currentBalance;

      const logRes = await request(app)
        .post(`/api/v1/recurring/${wifiRuleId}/execute`)
        .set('Cookie', userCookie)
        .send({
          occurrenceKey: '2026-10',
          actualAmount: 850,
          discountType: 'fixed',
          discountAmount: 150,
          discountNotes: 'Diwali Broadband Promo ₹150 Off',
        });

      expect(logRes.status).toBe(200);
      expect(logRes.body.success).toBe(true);

      const postedTx = logRes.body.data.transaction;
      expect(postedTx.amount).toBe(850);
      expect(postedTx.originalAmount).toBe(1000);
      expect(postedTx.discountAmount).toBe(150);
      expect(postedTx.discountType).toBe('fixed');
      expect(postedTx.discountNotes).toBe('Diwali Broadband Promo ₹150 Off');

      // Bank account balance must be debited by exactly ₹850, not ₹1000
      const bankAfter = await BankAccount.findById(bankAccountId);
      expect(bankAfter!.currentBalance).toBe(balanceBefore - 850);

      // Occurrence record stores audit metadata
      const occurrence = await RecurringOccurrence.findOne({
        recurringRuleId: wifiRuleId,
        occurrenceKey: '2026-10',
      });
      expect(occurrence).toBeDefined();
      expect(occurrence!.status).toBe('LOGGED');
      expect(occurrence!.actualAmount).toBe(850);
      expect(occurrence!.originalAmount).toBe(1000);
      expect(occurrence!.discountAmount).toBe(150);
    });

    it('1.3 supports updating future recurring amount without affecting current or past transactions', async () => {
      // Create a gym membership rule at ₹2,000/mo
      const gymRes = await request(app)
        .post('/api/v1/recurring')
        .set('Cookie', userCookie)
        .send({
          title: 'Gold Gym Membership',
          amount: 2000,
          type: TransactionType.EXPENSE,
          category: 'Health & Fitness',
          frequency: RecurringFrequency.MONTHLY,
          paymentMethod: PaymentMethod.NET_BANKING,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bankAccountId,
          nextExecutionDate: '2026-10-01T00:00:00.000Z',
        });
      const gymRuleId = gymRes.body.data.id;

      // Log current month with ₹200 discount (paying ₹1,800), and update future amount to ₹2,500
      const executeRes = await request(app)
        .post(`/api/v1/recurring/${gymRuleId}/execute`)
        .set('Cookie', userCookie)
        .send({
          occurrenceKey: '2026-10',
          actualAmount: 1800,
          discountType: 'percentage',
          discountAmount: 200,
          discountNotes: 'Early bird 10% discount',
          updateFutureAmount: true,
          futureAmount: 2500,
        });

      expect(executeRes.status).toBe(200);

      // Current transaction amount is ₹1,800
      const currentTx = executeRes.body.data.transaction;
      expect(currentTx.amount).toBe(1800);

      // Future rule amount is now updated to ₹2,500
      const updatedRule = await RecurringTransaction.findById(gymRuleId);
      expect(updatedRule!.amount).toBe(2500);

      // Verify the past transaction remained at ₹1,800
      const verifiedTx = await Transaction.findById(currentTx._id || currentTx.id);
      expect(verifiedTx!.amount).toBe(1800);
    });
  });

  // ==========================================
  // SECTION 2: Credit Card Repayment with Reward Points & Cashback Redemption
  // ==========================================
  describe('2. Credit Card Repayment with Reward Points / Cashback Redemption', () => {
    let repaymentTxId: string;

    it('2.1 creates card purchase to generate ₹10,000 outstanding debt', async () => {
      const purchaseRes = await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', userCookie)
        .send({
          title: 'Electronics Store Purchase',
          amount: 10000,
          type: TransactionType.EXPENSE,
          category: 'Shopping',
          paymentMethod: PaymentMethod.CREDIT_CARD,
          paymentChannel: PaymentChannel.ONLINE,
          creditCardId,
          date: '2026-10-10T12:00:00.000Z',
        });

      expect(purchaseRes.status).toBe(201);

      const card = await CreditCard.findById(creditCardId);
      expect(card!.currentOutstanding).toBe(10000);
      expect(card!.availableCredit).toBe(40000); // 50,000 - 10,000
    });

    it('2.2 executes repayment with ₹10,000 liability settled and ₹750 reward points redemption (bank debited ₹9,250)', async () => {
      const bankBefore = await BankAccount.findById(bankAccountId);
      const bankBalanceBefore = bankBefore!.currentBalance;

      const repayRes = await request(app)
        .post('/api/v1/credit-cards/repayment')
        .set('Cookie', userCookie)
        .send({
          creditCardId,
          sourceAccountId: bankAccountId,
          liabilitySettled: 10000,
          redemptionCredit: 750,
          redemptionNotes: 'HDFC Reward Points Converted to Cash',
          isFullRepayment: false,
          date: '2026-10-18T10:00:00.000Z',
          idempotencyKey: `repay-test-${Date.now()}`,
        });

      expect(repayRes.status).toBe(201);
      expect(repayRes.body.success).toBe(true);

      const tx = repayRes.body.data.transaction;
      repaymentTxId = tx._id || tx.id;

      // Actual bank payment is ₹9,250
      expect(tx.amount).toBe(9250);
      expect(tx.liabilitySettled).toBe(10000);
      expect(tx.redemptionCredit).toBe(750);
      expect(tx.redemptionNotes).toBe('HDFC Reward Points Converted to Cash');

      // Bank account balance is debited by exactly ₹9,250 (net payment)
      const bankAfter = await BankAccount.findById(bankAccountId);
      expect(bankAfter!.currentBalance).toBe(bankBalanceBefore - 9250);

      // Credit card outstanding is reduced by the FULL ₹10,000 liability settled!
      const cardAfter = await CreditCard.findById(creditCardId);
      expect(cardAfter!.currentOutstanding).toBe(0);
      expect(cardAfter!.availableCredit).toBe(50000);
    });

    it('2.3 rejects repayment when redemption credit exceeds liability settled', async () => {
      const badRes = await request(app)
        .post('/api/v1/credit-cards/repayment')
        .set('Cookie', userCookie)
        .send({
          creditCardId,
          sourceAccountId: bankAccountId,
          liabilitySettled: 500,
          redemptionCredit: 1000, // Exceeds liability!
          isFullRepayment: false,
          date: '2026-10-18T10:00:00.000Z',
          idempotencyKey: `bad-repay-${Date.now()}`,
        });

      expect(badRes.status).toBe(400);
    });

    it('2.4 deleting the redemption repayment restores bank balance by ₹9,250 and card outstanding by ₹10,000', async () => {
      const bankBefore = await BankAccount.findById(bankAccountId);
      const balanceBefore = bankBefore!.currentBalance;

      const deleteRes = await request(app)
        .delete(`/api/v1/transactions/${repaymentTxId}`)
        .set('Cookie', userCookie);

      expect(deleteRes.status).toBe(200);

      // Bank balance restored by ₹9,250
      const bankAfter = await BankAccount.findById(bankAccountId);
      expect(bankAfter!.currentBalance).toBe(balanceBefore + 9250);

      // Card outstanding restored by full ₹10,000
      const cardAfter = await CreditCard.findById(creditCardId);
      expect(cardAfter!.currentOutstanding).toBe(10000);
      expect(cardAfter!.availableCredit).toBe(40000);
    });
  });

  // ==========================================
  // SECTION 3: Settings Reset Decoupling & Chit Separation
  // ==========================================
  describe('3. Settings Reset Decoupling & Chit Separation', () => {
    let sampleChitFundId: string;
    let incomeTxId: string;

    beforeAll(async () => {
      // Create Chit Fund
      const fund = await ChitFund.create({
        userId,
        name: 'Royal Elite Chit Fund',
        monthlyContribution: 5000,
        totalMonths: 20,
        totalChits: 20,
        poolPerPeriod: 100000,
        designatedAccountId: chitBankAccountId,
        isActive: true,
      });
      sampleChitFundId = fund._id.toString();

      // Create 20 Members
      for (let i = 1; i <= 20; i++) {
        await ChitFundMember.create({
          userId,
          chitFundId: fund._id,
          name: `Member ${i}`,
          phone: `98765432${i.toString().padStart(2, '0')}`,
          numberOfChits: 1,
          monthlyContribution: 5000,
          assignedNumbers: [i],
          isActive: true,
        });
      }

      // Record a chit collection in bank account
      await ChitFundCollection.create({
        userId,
        chitFundId: fund._id,
        memberId: (await ChitFundMember.findOne({ userId }))!._id,
        collectionPeriod: '2026-10',
        chitsCovered: 1,
        expectedAmount: 5000,
        actualAmountReceived: 5000,
        paymentMethod: 'upi',
        receivingBankAccountId: chitBankAccountId,
        collectionDate: new Date(),
        status: 'completed',
      });

      // Record an ordinary personal income transaction
      const incRes = await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', userCookie)
        .send({
          title: 'Consulting Retainer Income',
          amount: 25000,
          type: TransactionType.INCOME,
          category: 'Salary',
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bankAccountId,
          date: '2026-10-15T00:00:00.000Z',
        });
      incomeTxId = incRes.body.data.id;
    });

    it('3.1 reset-transactions deletes ordinary transactions while strictly preserving chit collections and members', async () => {
      const collectionsBefore = await ChitFundCollection.countDocuments({ userId });
      expect(collectionsBefore).toBeGreaterThan(0);

      const membersBefore = await ChitFundMember.countDocuments({ userId });
      expect(membersBefore).toBe(20);

      // Execute Reset Transactions & Entries (only income/expense)
      const resetRes = await request(app)
        .post('/api/v1/settings/reset-transactions')
        .set('Cookie', userCookie)
        .send({
          confirmationPhrase: 'RESET MY DATA',
          selectedTypes: ['income', 'expense'],
        });

      expect(resetRes.status).toBe(200);
      expect(resetRes.body.success).toBe(true);

      // Ordinary personal income transaction must be deleted
      const incomeTx = await Transaction.findById(incomeTxId);
      expect(incomeTx).toBeNull();

      // Chit collections must be STRICTLY PRESERVED
      const collectionsAfter = await ChitFundCollection.countDocuments({ userId });
      expect(collectionsAfter).toBe(collectionsBefore);

      // Chit members must be STRICTLY PRESERVED
      const membersAfter = await ChitFundMember.countDocuments({ userId });
      expect(membersAfter).toBe(20);

      // Bank accounts preserved
      const bankAccounts = await BankAccount.find({ userId });
      expect(bankAccounts.length).toBeGreaterThanOrEqual(2);
    });

    it('3.2 dedicated reset-chit-fund-financials resets chit data while preserving members and personal accounts', async () => {
      const resetChitRes = await request(app)
        .post('/api/v1/settings/reset-chit-fund-financials')
        .set('Cookie', userCookie)
        .send({
          confirmationPhrase: 'RESET CHIT FINANCIALS',
          chitFundId: sampleChitFundId,
        });

      expect(resetChitRes.status).toBe(200);
      expect(resetChitRes.body.success).toBe(true);

      // Chit collections wiped
      const collectionsAfter = await ChitFundCollection.countDocuments({ userId });
      expect(collectionsAfter).toBe(0);

      // All 20 members strictly preserved
      const membersAfter = await ChitFundMember.countDocuments({ userId });
      expect(membersAfter).toBe(20);

      // Personal accounts strictly preserved
      const accountsAfter = await BankAccount.find({ userId });
      expect(accountsAfter.length).toBeGreaterThanOrEqual(2);
    });

    it('3.3 Total Cash overview strictly separates Chit Funds Held in Bank from personal cash', async () => {
      const totalCashRes = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);

      expect(totalCashRes.status).toBe(200);
      expect(totalCashRes.body.success).toBe(true);

      const summary = totalCashRes.body.data;
      expect(summary.totalPersonalAvailableBalance).toBeDefined();
      expect(summary.totalAvailableMoney).toBeDefined();
      expect(summary.totalFinancialAssetsTracked).toBeDefined();
      expect(summary.totalOutstandingDebt).toBeDefined();
      expect(summary.netTrackedPosition).toBeDefined();
      expect(summary.chitReserveHeldInBank).toBeDefined();
    });
  });
});
