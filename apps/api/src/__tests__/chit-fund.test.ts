import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { AccountType } from '@finora/shared';
import { Transaction } from '../models/Transaction';
import { BankAccount } from '../models/BankAccount';

describe('Priority 1 & 2: Chit Fund Management, Bank Account Separation & Module Settings', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let bankAccountId1: string;
  let bankAccountId2: string;
  let chitFundId: string;
  let member1Id: string;
  let member2Id: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // Register User
    const authRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'chitfund.family@finora.test',
        password: 'Password123!',
        fullName: 'Family Treasurer',
        currency: 'INR',
      });
    userCookie = authRes.headers['set-cookie'][0];
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  describe('Module Preferences & Settings', () => {
    it('retrieves default module preferences (chitFund: true, creditCards: true, recurring: false)', async () => {
      const res = await request(app)
        .get('/api/v1/settings')
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.modulePreferences).toMatchObject({
        chitFund: true,
        creditCards: true,
      });
    });

    it('updates module preferences successfully', async () => {
      const res = await request(app)
        .patch('/api/v1/settings')
        .set('Cookie', userCookie)
        .send({
          preferences: {
            modulePreferences: {
              recurringTransactions: true,
            },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.modulePreferences.recurringTransactions).toBe(true);
      expect(res.body.data.modulePreferences.chitFund).toBe(true);
    });
  });

  describe('Bank Account Integration & Single Designated Account Enforcement', () => {
    it('creates initial bank account designated as the Chit Fund account', async () => {
      const res = await request(app)
        .post('/api/v1/accounts')
        .set('Cookie', userCookie)
        .send({
          accountName: 'SBI Chit Pool Account',
          bankName: 'State Bank of India',
          accountType: AccountType.SAVINGS,
          openingBalance: 20000,
          openingBalanceDate: '2026-01-01T00:00:00.000Z',
          isChitFundAccount: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.isChitFundAccount).toBe(true);
      bankAccountId1 = res.body.data.id;
    });

    it('rejects creating a second Chit Fund account without confirmReassign flag', async () => {
      const res = await request(app)
        .post('/api/v1/accounts')
        .set('Cookie', userCookie)
        .send({
          accountName: 'HDFC Secondary',
          bankName: 'HDFC Bank',
          accountType: AccountType.CURRENT,
          openingBalance: 10000,
          openingBalanceDate: '2026-01-01T00:00:00.000Z',
          isChitFundAccount: true,
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CHIT_FUND_ACCOUNT_EXISTS');
      expect(res.body.error.message).toContain('SBI Chit Pool Account');
    });

    it('reassigns Chit Fund account designation when confirmReassign is true', async () => {
      const res = await request(app)
        .post('/api/v1/accounts')
        .set('Cookie', userCookie)
        .send({
          accountName: 'HDFC Secondary',
          bankName: 'HDFC Bank',
          accountType: AccountType.CURRENT,
          openingBalance: 10000,
          openingBalanceDate: '2026-01-01T00:00:00.000Z',
          isChitFundAccount: true,
          confirmReassign: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.isChitFundAccount).toBe(true);
      bankAccountId2 = res.body.data.id;

      // Verify account 1 is no longer designated
      const acc1 = await BankAccount.findById(bankAccountId1);
      expect(acc1?.isChitFundAccount).toBe(false);

      // Switch designation back to Account 1 with PATCH
      const patchRes = await request(app)
        .patch(`/api/v1/accounts/${bankAccountId1}`)
        .set('Cookie', userCookie)
        .send({
          isChitFundAccount: true,
          confirmReassign: true,
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.isChitFundAccount).toBe(true);

      const acc2 = await BankAccount.findById(bankAccountId2);
      expect(acc2?.isChitFundAccount).toBe(false);
    });
  });

  describe('Chit Fund Initialization, Members & Multi-Chit Support', () => {
    it('retrieves or creates default 20-person monthly Chit Fund', async () => {
      const res = await request(app)
        .get('/api/v1/chit-funds')
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalChits).toBe(20);
      expect(res.body.data.defaultContributionPerChit).toBe(5000);
      chitFundId = res.body.data.id;
    });

    it('adds Member A holding 1 Chit (₹5,000 expected)', async () => {
      const res = await request(app)
        .post(`/api/v1/chit-funds/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({
          name: 'Member A',
          numberOfChits: 1,
          contributionPerChit: 5000,
          phone: '9876543210',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.numberOfChits).toBe(1);
      expect(res.body.data.contributionPerChit).toBe(5000);
      expect(res.body.data.totalExpectedPerPeriod).toBe(5000);
      member1Id = res.body.data.id;
    });

    it('adds Member B holding 1 Chit (₹10,000 configured contribution)', async () => {
      const res = await request(app)
        .post(`/api/v1/chit-funds/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({
          name: 'Member B',
          monthlyContribution: 10000,
          contributionPerChit: 10000,
          phone: '9876543211',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.numberOfChits).toBe(1);
      expect(res.body.data.contributionPerChit).toBe(10000);
      expect(res.body.data.totalExpectedPerPeriod).toBe(10000);
      member2Id = res.body.data.id;
    });
  });

  describe('Chit Fund Collections & Financial Accounting Separation', () => {
    it('records full collection for Member A (₹5,000) and increases bank balance without creating personal income', async () => {
      const initialBank = await BankAccount.findById(bankAccountId1);
      const initialBalance = initialBank!.currentBalance;

      const res = await request(app)
        .post(`/api/v1/chit-funds/${chitFundId}/collections`)
        .set('Cookie', userCookie)
        .send({
          memberId: member1Id,
          collectionPeriod: '2026-10',
          chitsCovered: 1,
          expectedAmount: 5000,
          actualAmountReceived: 5000,
          collectionDate: '2026-10-05T00:00:00.000Z',
          receivingBankAccountId: bankAccountId1,
          paymentMethod: 'Bank Transfer',
          reference: 'UPI/CHIT001',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('completed');

      // Bank account balance increased
      const updatedBank = await BankAccount.findById(bankAccountId1);
      expect(updatedBank!.currentBalance).toBe(initialBalance + 5000);

      // Crucial: Must NOT create personal income transaction in Transaction model!
      const personalTransactions = await Transaction.find({
        userId: initialBank!.userId,
      });
      expect(personalTransactions.length).toBe(0);
    });

    it('records partial collection for Member B (₹6,000 of ₹10,000)', async () => {
      const initialBank = await BankAccount.findById(bankAccountId1);
      const initialBalance = initialBank!.currentBalance;

      const res = await request(app)
        .post(`/api/v1/chit-funds/${chitFundId}/collections`)
        .set('Cookie', userCookie)
        .send({
          memberId: member2Id,
          collectionPeriod: '2026-10',
          chitsCovered: 2,
          expectedAmount: 10000,
          actualAmountReceived: 6000,
          collectionDate: '2026-10-06T00:00:00.000Z',
          receivingBankAccountId: bankAccountId1,
          paymentMethod: 'UPI',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('partial');

      const updatedBank = await BankAccount.findById(bankAccountId1);
      expect(updatedBank!.currentBalance).toBe(initialBalance + 6000);
    });

    it('calculates Chit Fund summary and balance hierarchy accurately', async () => {
      const res = await request(app)
        .get(`/api/v1/chit-funds/${chitFundId}/summary?period=2026-10`)
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      const summary = res.body.data;

      expect(summary.totalActiveMembers).toBe(2);
      expect(summary.totalActiveChits).toBe(2); // 1 + 1
      expect(summary.expectedCollectionPerPeriod).toBe(15000); // 5000 + 10000
      expect(summary.actualCollectionForPeriod).toBe(11000); // 5000 + 6000
      expect(summary.outstandingForPeriod).toBe(4000); // 15000 - 11000
      expect(summary.totalChitFundMoneyHeld).toBe(11000); // 5000 + 6000

      // Bank account balance: opening 20,000 + 11,000 collections = 31,000
      expect(summary.designatedAccountBalance).toBe(31000);
      // Personal available balance: 31,000 - 11,000 = 20,000
      expect(summary.personalAvailableBalance).toBe(20000);
      expect(summary.discrepancy).toBe(0);
    });
  });

  describe('Chit Fund Payouts & Reserve Settlement', () => {
    it('records payout of ₹10,000 to winning member and debits bank account without creating personal expense', async () => {
      const initialBank = await BankAccount.findById(bankAccountId1);
      const initialBalance = initialBank!.currentBalance;

      const res = await request(app)
        .post(`/api/v1/chit-funds/${chitFundId}/payouts`)
        .set('Cookie', userCookie)
        .send({
          recipientName: 'Member A',
          memberId: member1Id,
          payoutPeriod: '2026-10',
          amount: 10000,
          payoutDate: '2026-10-10T00:00:00.000Z',
          sourceBankAccountId: bankAccountId1,
          reference: 'NEFT/PAYOUT001',
          notes: 'Winner at ₹5,000 dividend',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.amount).toBe(10000);

      // Bank balance debited
      const updatedBank = await BankAccount.findById(bankAccountId1);
      expect(updatedBank!.currentBalance).toBe(initialBalance - 10000);

      // Crucial: Must NOT create personal expense in Transaction model
      const personalExpenses = await Transaction.find({
        userId: initialBank!.userId,
      });
      expect(personalExpenses.length).toBe(0);

      // Chit Fund Money Held should now be 1,000 (11,000 - 10,000)
      const summaryRes = await request(app)
        .get(`/api/v1/chit-funds/${chitFundId}/summary?period=2026-10`)
        .set('Cookie', userCookie);
      expect(summaryRes.body.data.totalChitFundMoneyHeld).toBe(1000);
      expect(summaryRes.body.data.totalPayouts).toBe(10000);
    });
  });

  describe('Unified Fund Ledger & Reconciliation Diagnostics', () => {
    it('generates chronological ledger with running liability balance', async () => {
      const res = await request(app)
        .get(`/api/v1/chit-funds/${chitFundId}/ledger`)
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(3); // 2 collections + 1 payout
    });

    it('records manual adjustment and updates ledger balance', async () => {
      const res = await request(app)
        .post(`/api/v1/chit-funds/${chitFundId}/adjustments`)
        .set('Cookie', userCookie)
        .send({
          amount: 500,
          reason: 'Cash pool interest reconciliation',
          notes: 'Audit adjustment for October',
          date: '2026-10-12T00:00:00.000Z',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.amount).toBe(500);

      const summaryRes = await request(app)
        .get(`/api/v1/chit-funds/${chitFundId}/summary?period=2026-10`)
        .set('Cookie', userCookie);
      expect(summaryRes.body.data.totalChitFundMoneyHeld).toBe(1500); // 1000 + 500
    });

    it('provides reconciliation diagnostics including member dues', async () => {
      const res = await request(app)
        .get(`/api/v1/chit-funds/${chitFundId}/reconciliation`)
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      const recon = res.body.data;

      expect(recon.hasDiscrepancy).toBe(false);
      expect(recon.chitFundLedgerBalance).toBe(1500);
      expect(recon.recordedBankBalance).toBe(21000); // 20000 + 5000 + 6000 - 10000
      expect(recon.expectedPersonalAvailableBalance).toBe(19500); // 21000 - 1500

      // Member B owes ₹4,000 for 2026-10
      expect(recon.outstandingMemberDues.length).toBe(1);
      expect(recon.outstandingMemberDues[0].memberName).toBe('Member B');
      expect(recon.outstandingMemberDues[0].outstanding).toBe(4000);
    });
  });
});
