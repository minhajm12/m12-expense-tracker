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
  PaymentChannel,
  EmiStatus,
  EmiOccurrenceStatus,
  TransactionType,
  TransactionStatus,
} from '@finora/shared';

describe('Phase 1: EMI Status and Upcoming Monthly Payments Synchronization Suite', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let userId: string;
  let bankAccountId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await connectDatabase(uri);

    // Register user
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'phase1.emisync@finora.test',
        password: 'Password123!',
        fullName: 'EMI Sync Tester',
        currency: 'INR',
      });

    expect(res.status).toBe(201);
    const cookies = res.headers['set-cookie'];
    userCookie = Array.isArray(cookies) ? cookies[0] : cookies;
    userId = res.body.data.user.id;

    // Create a bank account with 100,000 balance
    const accRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'HDFC Savings',
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
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  describe('Scenario 1, 2, 3: October EMI paid vs November EMI due & Month Navigation', () => {
    let emiId: string;

    it('creates an EMI spanning October 2026 to March 2027 with October paid', async () => {
      // Create EMI: 6 months (2026-10 to 2027-03), monthly amount ₹5,000
      const emiRes = await request(app)
        .post('/api/v1/emi')
        .set('Cookie', userCookie)
        .send({
          name: 'Home Renovation EMI',
          lender: 'HDFC Bank',
          monthlyAmount: 5000,
          startDate: '2026-10-01',
          firstDueDate: '2026-10-15',
          nextEmiDate: '2026-11-15', // October is historical/previously paid
          dueDay: 15,
          endDate: '2027-03-15',
          totalInstallments: 6,
          paymentMethod: PaymentMethod.UPI,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bankAccountId,
          markHistoricalPaid: true,
        });

      expect(emiRes.status).toBe(201);
      emiId = emiRes.body.data.id;

      // Verify October occurrence in DB has status PAID_HISTORICAL
      const octOcc = await EmiOccurrence.findOne({ emiRuleId: emiId, occurrenceKey: '2026-10' });
      expect(octOcc).toBeDefined();
      expect(octOcc!.status).toBe(EmiOccurrenceStatus.PAID_HISTORICAL);

      // Verify November occurrence in DB has status DUE
      const novOcc = await EmiOccurrence.findOne({ emiRuleId: emiId, occurrenceKey: '2026-11' });
      expect(novOcc).toBeDefined();
      expect(novOcc!.status).toBe(EmiOccurrenceStatus.DUE);
    });

    it('Scenario 1: October 2026 dashboard view shows October EMI as Paid with no Pay button and 0 remaining', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/upcoming-forecast?month=2026-10')
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;

      expect(data.month).toBe('2026-10');
      expect(data.totalExpectedPayments).toBe(5000);
      expect(data.totalPaid).toBe(5000);
      expect(data.emiPaymentsRemaining).toBe(0);
      expect(data.remainingAmountNeeded).toBe(0);

      // Exactly 1 item for October 2026
      expect(data.items).toHaveLength(1);
      const item = data.items[0];
      expect(item.occurrenceKey).toBe('2026-10');
      expect(item.status).toBe('paid');
      expect(item.actualAmount).toBe(5000);
    });

    it('Scenario 2: November 2026 dashboard view shows November EMI as Due with 5000 remaining', async () => {
      const res = await request(app)
        .get('/api/v1/analytics/upcoming-forecast?month=2026-11')
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;

      expect(data.month).toBe('2026-11');
      expect(data.totalExpectedPayments).toBe(5000);
      expect(data.totalPaid).toBe(0);
      expect(data.emiPaymentsRemaining).toBe(5000);
      expect(data.remainingAmountNeeded).toBe(5000);

      expect(data.items).toHaveLength(1);
      const item = data.items[0];
      expect(item.occurrenceKey).toBe('2026-11');
      expect(item.status).toBe('unpaid');
    });

    it('Scenario 3: Switching between Current Month and Next Month maintains isolated authoritative data', async () => {
      // October check
      const octRes = await request(app)
        .get('/api/v1/analytics/upcoming-forecast?month=2026-10')
        .set('Cookie', userCookie);
      expect(octRes.body.data.totalPaid).toBe(5000);
      expect(octRes.body.data.emiPaymentsRemaining).toBe(0);
      expect(octRes.body.data.items[0].status).toBe('paid');

      // November check
      const novRes = await request(app)
        .get('/api/v1/analytics/upcoming-forecast?month=2026-11')
        .set('Cookie', userCookie);
      expect(novRes.body.data.totalPaid).toBe(0);
      expect(novRes.body.data.emiPaymentsRemaining).toBe(5000);
      expect(novRes.body.data.items[0].status).toBe('unpaid');
    });

    it('Scenario 4: Previously paid October installment cannot be paid again', async () => {
      const payRes = await request(app)
        .post(`/api/v1/emi/${emiId}/pay`)
        .set('Cookie', userCookie)
        .send({
          occurrenceKey: '2026-10',
          actualAmount: 5000,
          paymentMethod: PaymentMethod.UPI,
          accountId: bankAccountId,
        });

      expect(payRes.status).toBe(400);
      expect(payRes.body.success).toBe(false);
      expect(payRes.body.error.code).toBe('EMI_ALREADY_PAID');
    });

    it('Scenario 5: Paying November installment updates dashboard totals immediately', async () => {
      // Record payment for November
      const payRes = await request(app)
        .post(`/api/v1/emi/${emiId}/pay`)
        .set('Cookie', userCookie)
        .send({
          occurrenceKey: '2026-11',
          actualAmount: 5000,
          paymentMethod: PaymentMethod.UPI,
          accountId: bankAccountId,
        });

      expect(payRes.status).toBe(200);
      expect(payRes.body.success).toBe(true);

      // Verify November dashboard immediately shows Paid and 0 remaining
      const novRes = await request(app)
        .get('/api/v1/analytics/upcoming-forecast?month=2026-11')
        .set('Cookie', userCookie);

      const data = novRes.body.data;
      expect(data.month).toBe('2026-11');
      expect(data.totalExpectedPayments).toBe(5000);
      expect(data.totalPaid).toBe(5000);
      expect(data.emiPaymentsRemaining).toBe(0);
      expect(data.remainingAmountNeeded).toBe(0);
      expect(data.items[0].status).toBe('paid');
      expect(data.items[0].occurrenceKey).toBe('2026-11');
    });

    it('Scenario 6: Paying a future installment (December 2026) records correct period', async () => {
      const payRes = await request(app)
        .post(`/api/v1/emi/${emiId}/pay`)
        .set('Cookie', userCookie)
        .send({
          occurrenceKey: '2026-12',
          actualAmount: 4800, // ₹200 discount/adjustment
          discountAmount: 200,
          paymentMethod: PaymentMethod.UPI,
          accountId: bankAccountId,
        });

      expect(payRes.status).toBe(200);
      expect(payRes.body.success).toBe(true);

      // Verify December 2026 forecast
      const decRes = await request(app)
        .get('/api/v1/analytics/upcoming-forecast?month=2026-12')
        .set('Cookie', userCookie);

      const data = decRes.body.data;
      expect(data.month).toBe('2026-12');
      expect(data.totalExpectedPayments).toBe(5000); // Expected planning amount retained
      expect(data.totalPaid).toBe(4800); // Actual payment recorded
      expect(data.emiPaymentsRemaining).toBe(0);
      expect(data.remainingAmountNeeded).toBe(0);
      expect(data.items[0].status).toBe('paid');
      expect(data.items[0].actualAmount).toBe(4800);
    });

    it('Scenario 9: Deleting payment transaction restores installment status correctly', async () => {
      // Find the transaction created for December payment
      const decOcc = await EmiOccurrence.findOne({ emiRuleId: emiId, occurrenceKey: '2026-12' });
      expect(decOcc!.transactionId).toBeDefined();

      const txId = decOcc!.transactionId!.toString();

      // Delete the transaction
      const delTxRes = await request(app)
        .delete(`/api/v1/transactions/${txId}`)
        .set('Cookie', userCookie);

      expect(delTxRes.status).toBe(200);

      // Verify December installment is now DUE again
      const refreshedOcc = await EmiOccurrence.findOne({ emiRuleId: emiId, occurrenceKey: '2026-12' });
      expect(refreshedOcc!.status).toBe(EmiOccurrenceStatus.DUE);
      expect(refreshedOcc!.transactionId).toBeUndefined();

      // Verify December forecast reflects unpaid state
      const decRes = await request(app)
        .get('/api/v1/analytics/upcoming-forecast?month=2026-12')
        .set('Cookie', userCookie);

      expect(decRes.body.data.emiPaymentsRemaining).toBe(5000);
      expect(decRes.body.data.totalPaid).toBe(0);
      expect(decRes.body.data.items[0].status).toBe('unpaid');
    });

    it('Scenario 8: Complete an EMI and verify it appears in Completed tab and has no upcoming obligations', async () => {
      // Create a short 2-month EMI (2026-08 to 2026-09) and pay both installments
      const shortEmiRes = await request(app)
        .post('/api/v1/emi')
        .set('Cookie', userCookie)
        .send({
          name: 'Short Completed Loan',
          lender: 'Axis Bank',
          monthlyAmount: 3000,
          startDate: '2026-08-01',
          firstDueDate: '2026-08-10',
          nextEmiDate: '2026-08-10',
          endDate: '2026-09-10',
          totalInstallments: 2,
          paymentMethod: PaymentMethod.UPI,
          accountId: bankAccountId,
        });

      expect(shortEmiRes.status).toBe(201);
      const completedEmiId = shortEmiRes.body.data.id;

      // Pay installment 1
      await request(app)
        .post(`/api/v1/emi/${completedEmiId}/pay`)
        .set('Cookie', userCookie)
        .send({
          occurrenceKey: '2026-08',
          actualAmount: 3000,
          paymentMethod: PaymentMethod.UPI,
          accountId: bankAccountId,
        });

      // Pay installment 2
      await request(app)
        .post(`/api/v1/emi/${completedEmiId}/pay`)
        .set('Cookie', userCookie)
        .send({
          occurrenceKey: '2026-09',
          actualAmount: 3000,
          paymentMethod: PaymentMethod.UPI,
          accountId: bankAccountId,
        });

      // Verify rule status in DB is COMPLETED
      const completedRule = await EmiRule.findById(completedEmiId);
      expect(completedRule!.status).toBe(EmiStatus.COMPLETED);

      // Query listEmis with status=completed
      const listRes = await request(app)
        .get('/api/v1/emi?status=completed')
        .set('Cookie', userCookie);

      expect(listRes.status).toBe(200);
      const found = listRes.body.data.find((e: any) => e.id === completedEmiId);
      expect(found).toBeDefined();
      expect(found.status).toBe(EmiStatus.COMPLETED);

      // Verify in upcoming forecast for October 2026, completed loan has NO obligations
      const octRes = await request(app)
        .get('/api/v1/analytics/upcoming-forecast?month=2026-10')
        .set('Cookie', userCookie);

      const completedInOct = octRes.body.data.items.find((i: any) => i.ruleId === completedEmiId);
      expect(completedInOct).toBeUndefined();
    });

    it('Scenario 7: Delete an EMI and verify it disappears from active All EMI and upcoming obligations', async () => {
      // Create an EMI to delete
      const delEmiRes = await request(app)
        .post('/api/v1/emi')
        .set('Cookie', userCookie)
        .send({
          name: 'Temporary Appliance EMI',
          lender: 'Bajaj Finserv',
          monthlyAmount: 2000,
          startDate: '2026-10-01',
          firstDueDate: '2026-10-20',
          nextEmiDate: '2026-10-20',
          endDate: '2026-12-20',
          paymentMethod: PaymentMethod.UPI,
          accountId: bankAccountId,
        });

      expect(delEmiRes.status).toBe(201);
      const tempEmiId = delEmiRes.body.data.id;

      // Delete the EMI agreement
      const delRes = await request(app)
        .delete(`/api/v1/emi/${tempEmiId}`)
        .set('Cookie', userCookie);

      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);

      // Verify it does NOT appear in GET /api/v1/emi
      const listRes = await request(app)
        .get('/api/v1/emi')
        .set('Cookie', userCookie);

      const foundInList = listRes.body.data.find((e: any) => e.id === tempEmiId);
      expect(foundInList).toBeUndefined();

      // Verify no occurrences remain for this EMI
      const occsCount = await EmiOccurrence.countDocuments({ emiRuleId: tempEmiId });
      expect(occsCount).toBe(0);

      // Verify not in upcoming obligations
      const octRes = await request(app)
        .get('/api/v1/analytics/upcoming-forecast?month=2026-10')
        .set('Cookie', userCookie);

      const foundInForecast = octRes.body.data.items.find((i: any) => i.ruleId === tempEmiId);
      expect(foundInForecast).toBeUndefined();
    });

    it('Scenario 10: Refreshing page and multiple re-fetches maintain consistent totals and status', async () => {
      const fetch1 = await request(app)
        .get('/api/v1/analytics/upcoming-forecast?month=2026-10')
        .set('Cookie', userCookie);

      const fetch2 = await request(app)
        .get('/api/v1/analytics/upcoming-forecast?month=2026-10')
        .set('Cookie', userCookie);

      expect(fetch1.body.data).toEqual(fetch2.body.data);
    });

    it('Scenario 11: Verify no duplicate expense or bank debit is created', async () => {
      // Check bank balance and transactions for user
      const account = await BankAccount.findById(bankAccountId);
      expect(account).toBeDefined();

      // Opening was 100,000.
      // November payment: ₹5,000
      // Short EMI payments: ₹3,000 + ₹3,000 = ₹6,000
      // December payment was ₹4,800 and subsequently deleted, restoring ₹4,800.
      // Net balance must be 100,000 - 5,000 - 6,000 = 89,000.
      expect(account!.currentBalance).toBe(89000);

      const transactions = await Transaction.find({ userId, accountId: bankAccountId });
      expect(transactions).toHaveLength(3); // Exactly 1 (Nov) + 2 (Short EMI), exactly once each without duplicates
    });
  });
});
