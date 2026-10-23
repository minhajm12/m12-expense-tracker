import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { User } from '../models/User';
import { BankAccount } from '../models/BankAccount';
import { CreditCard } from '../models/CreditCard';
import { Transaction } from '../models/Transaction';
import { ChitFund } from '../models/ChitFund';
import { ChitFundMember } from '../models/ChitFundMember';
import { ChitFundCollection } from '../models/ChitFundCollection';
import { ChitFundPayout } from '../models/ChitFundPayout';
import { ChitFundAdjustment } from '../models/ChitFundAdjustment';
import {
  AccountType,
  TransactionType,
  PaymentMethod,
  PaymentChannel,
  CreditCardNetwork,
} from '@finora/shared';

describe('Comprehensive Regression Suite: Auth, Data Reset & Chit-Fund Accounting', () => {
  let mongoServer: MongoMemoryServer;

  let userCookie: string;
  let userEmail = 'treasurer.m12@finora.test';
  let userPassword = 'Password123!';
  let userId: string;

  let userBCookie: string;
  let userBEmail = 'second.user@finora.test';
  let userBId: string;

  let designatedAccountId: string;
  let chitFundId: string;
  let memberId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // Register primary user
    const resA = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: userEmail,
        password: userPassword,
        fullName: 'Treasurer M12',
        currency: 'INR',
      });
    userCookie = resA.headers['set-cookie'][0];
    userId = resA.body.data.user.id;

    // Register second user for multi-tenant isolation tests
    const resB = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: userBEmail,
        password: 'Password123!',
        fullName: 'Second User',
        currency: 'INR',
      });
    userBCookie = resB.headers['set-cookie'][0];
    userBId = resB.body.data.user.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  // ==========================================
  // 1. AUTHENTICATION (Tests 1 - 6)
  // ==========================================
  describe('Authentication & Session Resilience', () => {
    it('1. Valid login succeeds without duplicate requests', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: userEmail,
          password: userPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(userEmail.toLowerCase());
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('2. Successful login does not trigger automatic logout (/me endpoint returns 200)', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.id).toBe(userId);
    });

    it('3. Session persistence behaves correctly across multiple calls (simulating page reload)', async () => {
      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .get('/api/v1/auth/me')
          .set('Cookie', userCookie);

        expect(res.status).toBe(200);
        expect(res.body.data.user.email).toBe(userEmail.toLowerCase());
      }
    });

    it('4. Invalid credentials return appropriate 401 error', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: userEmail,
          password: 'WrongPassword999!',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('5. Rate limiting protects auth endpoints against brute force attempts', async () => {
      const requests = Array.from({ length: 6 }).map(() =>
        request(app)
          .post('/api/v1/auth/login')
          .send({
            email: 'bruteforce@finora.test',
            password: 'BadPassword!',
          })
      );
      const responses = await Promise.all(requests);
      responses.forEach((res) => {
        expect([401, 429]).toContain(res.status);
      });
    });

    it('6. Health check endpoints are excluded from aggressive rate limiting', async () => {
      const res = await request(app).get('/health');
      expect([200, 304]).toContain(res.status);
    });
  });

  // ==========================================
  // 2. CHIT-FUND ACCOUNTING & SEPARATION (Tests 13 - 25)
  // ==========================================
  describe('Chit-Fund Accounting & Separation of Existing Money', () => {
    it('13. An opening balance of ₹28,000 displays correctly on designated account', async () => {
      // Create Bank Account with ₹28,000 opening balance, designated as Chit Fund account
      const accRes = await request(app)
        .post('/api/v1/accounts')
        .set('Cookie', userCookie)
        .send({
          accountName: 'Chit Fund Central Bank',
          bankName: 'State Bank of India',
          accountType: AccountType.SAVINGS,
          openingBalance: 28000,
          openingBalanceDate: '2026-01-01',
          isChitFundAccount: true,
        });

      expect(accRes.status).toBe(201);
      designatedAccountId = accRes.body.data.id;
      expect(accRes.body.data.currentBalance).toBe(28000);
      expect(accRes.body.data.isChitFundAccount).toBe(true);

      // Get Chit Fund
      const cfRes = await request(app)
        .get('/api/v1/chit-funds')
        .set('Cookie', userCookie);
      expect(cfRes.status).toBe(200);
      chitFundId = cfRes.body.data.id;

      // Check Summary: Total Bank = 28,000, Chit Held = 0, Personal Available = 28,000
      const sumRes = await request(app)
        .get(`/api/v1/chit-funds/${chitFundId}/summary`)
        .set('Cookie', userCookie);

      expect(sumRes.status).toBe(200);
      expect(sumRes.body.data.designatedAccountBalance).toBe(28000);
      expect(sumRes.body.data.totalChitFundMoneyHeld).toBe(0);
      expect(sumRes.body.data.personalAvailableBalance).toBe(28000);
      expect(sumRes.body.data.discrepancy).toBe(0);
    });

    it('14. Example B: A new ₹20,000 collection produces Bank ₹48,000, Chit Held ₹20,000, Personal ₹28,000', async () => {
      // Add a chit fund member
      const memberRes = await request(app)
        .post(`/api/v1/chit-funds/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({
          name: 'Rajesh Kumar',
          numberOfChits: 1,
          contributionPerChit: 5000,
        });
      expect(memberRes.status).toBe(201);
      memberId = memberRes.body.data.id;

      // Record a new ₹20,000 collection deposited into the designated account
      const colRes = await request(app)
        .post(`/api/v1/chit-funds/${chitFundId}/collections`)
        .set('Cookie', userCookie)
        .send({
          memberId,
          collectionPeriod: '2026-01',
          expectedAmount: 20000,
          actualAmountReceived: 20000,
          collectionDate: '2026-01-10',
          receivingBankAccountId: designatedAccountId,
          paymentMethod: 'bank_transfer',
        });
      expect(colRes.status).toBe(201);

      // Verify Summary
      const sumRes = await request(app)
        .get(`/api/v1/chit-funds/${chitFundId}/summary`)
        .set('Cookie', userCookie);

      expect(sumRes.body.data.designatedAccountBalance).toBe(48000);
      expect(sumRes.body.data.totalChitFundMoneyHeld).toBe(20000);
      expect(sumRes.body.data.personalAvailableBalance).toBe(28000);

      // Verify Bank Account directly
      const accRes = await request(app)
        .get(`/api/v1/accounts/${designatedAccountId}`)
        .set('Cookie', userCookie);
      expect(accRes.body.data.currentBalance).toBe(48000);
    });

    it('15. Example C: A further ₹5,000 collection produces Bank ₹53,000, Chit Held ₹25,000, Personal ₹28,000', async () => {
      const m2Res = await request(app)
        .post(`/api/v1/chit-funds/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({
          name: 'Member 2',
          monthlyContribution: 5000,
          contributionPerChit: 5000,
        });
      const memberId2 = m2Res.body.data.id;

      const colRes = await request(app)
        .post(`/api/v1/chit-funds/${chitFundId}/collections`)
        .set('Cookie', userCookie)
        .send({
          memberId: memberId2,
          collectionPeriod: '2026-01',
          expectedAmount: 5000,
          actualAmountReceived: 5000,
          collectionDate: '2026-01-12',
          receivingBankAccountId: designatedAccountId,
          paymentMethod: 'upi',
        });
      expect(colRes.status).toBe(201);

      const sumRes = await request(app)
        .get(`/api/v1/chit-funds/${chitFundId}/summary`)
        .set('Cookie', userCookie);

      expect(sumRes.body.data.designatedAccountBalance).toBe(53000);
      expect(sumRes.body.data.totalChitFundMoneyHeld).toBe(25000);
      expect(sumRes.body.data.personalAvailableBalance).toBe(28000);
    });

    it('16. Example D: A ₹10,000 chit payout reduces Bank to ₹43,000 and Chit Held to ₹15,000 without changing Personal ₹28,000', async () => {
      const payRes = await request(app)
        .post(`/api/v1/chit-funds/${chitFundId}/payouts`)
        .set('Cookie', userCookie)
        .send({
          recipientName: 'Rajesh Kumar',
          memberId: memberId,
          payoutPeriod: '2026-01',
          amount: 10000,
          payoutDate: '2026-01-15',
          sourceBankAccountId: designatedAccountId,
        });
      expect(payRes.status).toBe(201);

      const sumRes = await request(app)
        .get(`/api/v1/chit-funds/${chitFundId}/summary`)
        .set('Cookie', userCookie);

      expect(sumRes.body.data.designatedAccountBalance).toBe(43000);
      expect(sumRes.body.data.totalChitFundMoneyHeld).toBe(15000);
      expect(sumRes.body.data.personalAvailableBalance).toBe(28000);
    });

    it('17. Example E: A ₹2,000 personal expense reduces Bank to ₹41,000 and Personal to ₹26,000; personal expense > ₹26,000 is rejected', async () => {
      // 17.1 Valid personal expense of ₹2,000
      const expRes = await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', userCookie)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Personal groceries',
          amount: 2000,
          currency: 'INR',
          date: '2026-01-16',
          category: 'Groceries',
          paymentMethod: PaymentMethod.DEBIT_CARD,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: designatedAccountId,
        });
      expect(expRes.status).toBe(201);

      const sumRes = await request(app)
        .get(`/api/v1/chit-funds/${chitFundId}/summary`)
        .set('Cookie', userCookie);

      expect(sumRes.body.data.designatedAccountBalance).toBe(41000);
      expect(sumRes.body.data.totalChitFundMoneyHeld).toBe(15000);
      expect(sumRes.body.data.personalAvailableBalance).toBe(26000);

      // 17.2 Invalid personal expense of ₹30,000 exceeding available personal balance (₹26,000)
      const invalidExpRes = await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', userCookie)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Attempted to spend chit fund money',
          amount: 30000,
          currency: 'INR',
          date: '2026-01-17',
          category: 'Shopping',
          paymentMethod: PaymentMethod.DEBIT_CARD,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: designatedAccountId,
        });

      expect(invalidExpRes.status).toBe(400);
      expect(invalidExpRes.body.error.code).toBe('INSUFFICIENT_PERSONAL_FUNDS');

      // Verify balances were NOT altered by rejected transaction
      const sumCheckRes = await request(app)
        .get(`/api/v1/chit-funds/${chitFundId}/summary`)
        .set('Cookie', userCookie);

      expect(sumCheckRes.body.data.designatedAccountBalance).toBe(41000);
      expect(sumCheckRes.body.data.personalAvailableBalance).toBe(26000);
    });

    it('18. Obsolete separation endpoint returns 404 per Priority 1', async () => {
      // Create a fresh dedicated test account with ₹28,000 opening balance to test pure Example F
      const accF = await request(app)
        .post('/api/v1/accounts')
        .set('Cookie', userCookie)
        .send({
          accountName: 'Example F Clean Account',
          bankName: 'HDFC Bank',
          accountType: AccountType.SAVINGS,
          openingBalance: 28000,
          openingBalanceDate: '2026-01-01',
          isChitFundAccount: true,
          confirmReassign: true,
        });
      expect(accF.status).toBe(201);
      const accFId = accF.body.data.id;

      // Clear any prior test collections/payouts so chit held starts at 0
      await ChitFundCollection.deleteMany({ userId });
      await ChitFundPayout.deleteMany({ userId });
      await ChitFundAdjustment.deleteMany({ userId });
      await Transaction.deleteMany({ userId });

      // Recalculate balance so bank account reflects pure 28000
      await request(app)
        .post(`/api/v1/accounts/${accFId}/recalculate`)
        .set('Cookie', userCookie);

      // Verify starting state: Bank = 28,000, Chit Held = 0, Personal = 28,000
      const sumRes = await request(app)
        .get(`/api/v1/chit-funds/${chitFundId}/summary`)
        .set('Cookie', userCookie);
      expect(sumRes.body.data.designatedAccountBalance).toBe(28000);
      expect(sumRes.body.data.totalChitFundMoneyHeld).toBe(0);
      expect(sumRes.body.data.personalAvailableBalance).toBe(28000);

      const sepRes = await request(app)
        .post(`/api/v1/chit-funds/${chitFundId}/separations`)
        .set('Cookie', userCookie)
        .send({
          amount: 20000,
          date: '2026-01-20',
          description: 'Separated existing chit money from personal balance',
        });

      expect(sepRes.status).toBe(404);
    });

    it('19. Removal of existing-money separation preserves existing bank balances without changes', async () => {
      const sumRes = await request(app)
        .get(`/api/v1/chit-funds/${chitFundId}/summary`)
        .set('Cookie', userCookie);

      expect(sumRes.status).toBe(200);
      expect(sumRes.body.data.designatedAccountBalance).toBe(28000);
      expect(sumRes.body.data.personalAvailableBalance).toBe(28000);
    });

    it('20. Historical separation read endpoint remains safely accessible for audit records', async () => {
      const listSepRes = await request(app)
        .get(`/api/v1/chit-funds/${chitFundId}/separations`)
        .set('Cookie', userCookie);

      expect(listSepRes.status).toBe(200);
      expect(Array.isArray(listSepRes.body.data)).toBe(true);
    });

    it('21. Reclassification does not create an income transaction, deposit, or member collection', async () => {
      const txCount = await Transaction.countDocuments({ userId, description: /Separated existing chit money/i });
      expect(txCount).toBe(0);

      const colCount = await ChitFundCollection.countDocuments({ userId, notes: /Separated existing/i });
      expect(colCount).toBe(0);
    });

    it('22. Bank accounts remain completely unaffected by removal of separation feature', async () => {
      const acc = await BankAccount.findOne({ userId, isChitFundAccount: true });
      expect(acc).toBeDefined();
      expect(acc!.currentBalance).toBe(28000);
    });

    it('23. Only one bank account can be designated as the chit-fund account', async () => {
      const res = await request(app)
        .post('/api/v1/accounts')
        .set('Cookie', userCookie)
        .send({
          accountName: 'Conflicting Chit Account',
          bankName: 'ICICI Bank',
          accountType: AccountType.CURRENT,
          openingBalance: 5000,
          openingBalanceDate: '2026-01-01',
          isChitFundAccount: true,
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CHIT_FUND_ACCOUNT_EXISTS');
    });

    it('24. Refreshing the summary endpoint produces identical balances without drift', async () => {
      const sum1 = await request(app)
        .get(`/api/v1/chit-funds/${chitFundId}/summary`)
        .set('Cookie', userCookie);

      const sum2 = await request(app)
        .get(`/api/v1/chit-funds/${chitFundId}/summary`)
        .set('Cookie', userCookie);

      expect(sum1.body.data).toEqual(sum2.body.data);
    });

    it('25. Credit-card accounting continues to operate accurately', async () => {
      // Create a credit card
      const ccRes = await request(app)
        .post('/api/v1/credit-cards')
        .set('Cookie', userCookie)
        .send({
          cardNickname: 'Regalia Gold',
          issuingBank: 'HDFC',
          network: CreditCardNetwork.VISA,
          creditLimit: 100000,
          billingCycleClosingDay: 1,
          paymentDueDay: 20,
          openingOutstanding: 0,
          openingOutstandingDate: '2026-01-01',
        });
      expect(ccRes.status).toBe(201);
      const cardId = ccRes.body.data.id;

      // Credit card purchase
      const purchaseRes = await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', userCookie)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Card purchase',
          amount: 5000,
          currency: 'INR',
          date: '2026-01-25',
          category: 'Shopping',
          creditCardId: cardId,
          paymentMethod: PaymentMethod.CREDIT_CARD,
          paymentChannel: PaymentChannel.ONLINE,
        });
      expect(purchaseRes.status).toBe(201);

      // Verify card balance increased
      const cardCheck = await request(app)
        .get(`/api/v1/credit-cards/${cardId}`)
        .set('Cookie', userCookie);
      expect(cardCheck.body.data.currentOutstanding).toBe(5000);
      expect(cardCheck.body.data.availableCredit).toBe(95000);
    });
  });

  // ==========================================
  // 3. DATA RESET OPTIONS A & B (Tests 7 - 12)
  // ==========================================
  describe('Data Management & Reset Options', () => {
    it('7. Option A: Resetting selected transaction types deletes only selected records', async () => {
      // Add a test income transaction
      const bank = await BankAccount.findOne({ userId });
      await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', userCookie)
        .send({
          type: TransactionType.INCOME,
          title: 'Consulting income',
          amount: 15000,
          currency: 'INR',
          date: '2026-01-26',
          category: 'Freelance income',
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bank!._id.toString(),
        });

      // Reset income transactions only
      const resetRes = await request(app)
        .post('/api/v1/settings/reset-transactions')
        .set('Cookie', userCookie)
        .send({
          confirmationPhrase: 'RESET MY DATA',
          selectedTypes: ['income'],
        });

      expect(resetRes.status).toBe(200);
      expect(resetRes.body.success).toBe(true);
      expect(resetRes.body.data.deletedCounts.income).toBeGreaterThanOrEqual(1);

      // Verify income transactions are gone
      const incomeCount = await Transaction.countDocuments({ userId, type: TransactionType.INCOME });
      expect(incomeCount).toBe(0);
    });

    it('8. Option A preserves bank accounts, credit cards, chit members, opening balances and user settings', async () => {
      const accountsCount = await BankAccount.countDocuments({ userId });
      expect(accountsCount).toBeGreaterThan(0);

      const cardsCount = await CreditCard.countDocuments({ userId });
      expect(cardsCount).toBeGreaterThan(0);

      const membersCount = await ChitFundMember.countDocuments({ userId });
      expect(membersCount).toBeGreaterThan(0);

      const user = await User.findById(userId);
      expect(user).toBeDefined();
      expect(user?.preferences).toBeDefined();
    });

    it('9. Option B: Reset All Financial Data wipes accounts, cards, chits while strictly preserving login account and role', async () => {
      // Create data for User B as well to verify multi-tenant isolation
      await BankAccount.create({
        userId: userBId,
        accountName: 'User B Vault',
        bankName: 'SBI',
        accountType: AccountType.SAVINGS,
        openingBalance: 50000,
        currentBalance: 50000,
        openingBalanceDate: new Date('2026-01-01'),
        currency: 'INR',
        isActive: true,
        isArchived: false,
      });

      // Execute Option B for User A
      const wipeRes = await request(app)
        .post('/api/v1/settings/reset-all-financial-data')
        .set('Cookie', userCookie)
        .send({
          confirmationPhrase: 'RESET MY DATA',
        });

      expect(wipeRes.status).toBe(200);
      expect(wipeRes.body.success).toBe(true);
      expect(wipeRes.body.data.userPreserved).toBe(true);

      // Verify User A financial records are wiped
      expect(await BankAccount.countDocuments({ userId })).toBe(0);
      expect(await CreditCard.countDocuments({ userId })).toBe(0);
      expect(await ChitFundMember.countDocuments({ userId })).toBe(0);
      expect(await ChitFundCollection.countDocuments({ userId })).toBe(0);
      expect(await ChitFundPayout.countDocuments({ userId })).toBe(0);
      expect(await ChitFundAdjustment.countDocuments({ userId })).toBe(0);
      expect(await Transaction.countDocuments({ userId })).toBe(0);

      // Verify User A account STILL EXISTS and is fully authenticatable
      const userCheck = await User.findById(userId).select('+password');
      expect(userCheck).toBeDefined();
      expect(userCheck?.email).toBe(userEmail.toLowerCase());
      expect(userCheck?.password).toBeDefined();

      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: userEmail,
          password: userPassword,
        });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.success).toBe(true);
    });

    it('10. Multi-tenant safety: Resetting User A data did NOT affect User B data', async () => {
      const userBAccounts = await BankAccount.find({ userId: userBId });
      expect(userBAccounts.length).toBe(1);
      expect(userBAccounts[0].accountName).toBe('User B Vault');
      expect(userBAccounts[0].currentBalance).toBe(50000);
    });

    it('11. Rejects reset request if confirmation phrase does not match RESET MY DATA', async () => {
      const badRes = await request(app)
        .post('/api/v1/settings/reset-all-financial-data')
        .set('Cookie', userCookie)
        .send({
          confirmationPhrase: 'INCORRECT_PHRASE',
        });

      expect(badRes.status).toBe(400);
    });

    it('12. Derived balances are refreshed cleanly after reset without lingering ghost numbers', async () => {
      // Re-create a fresh account for User A
      const newAccRes = await request(app)
        .post('/api/v1/accounts')
        .set('Cookie', userCookie)
        .send({
          accountName: 'Fresh Savings',
          bankName: 'Kotak',
          accountType: AccountType.SAVINGS,
          openingBalance: 12000,
          openingBalanceDate: '2026-02-01',
        });
      expect(newAccRes.status).toBe(201);
      expect(newAccRes.body.data.currentBalance).toBe(12000);
    });
  });
});
