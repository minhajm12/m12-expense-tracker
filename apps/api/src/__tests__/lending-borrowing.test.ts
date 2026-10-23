import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { AccountType, LendingBorrowingType, LendingBorrowingStatus } from '@finora/shared';

describe('Lending & Borrowing Module & Total Cash Acceptance Test Suite', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let bankAccountId: string;
  let lendRecordAId: string;
  let lendRecordBId: string;
  let borrowRecordCId: string;
  let borrowRecordDId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // Register User
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'lending.tester@finora.test',
        password: 'Password123!',
        fullName: 'Lending Tester',
        currency: 'INR',
      });
    userCookie = regRes.headers['set-cookie'][0];

    // Create Bank Account with ₹50,000 opening balance
    const accRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'Primary HDFC Account',
        bankName: 'HDFC Bank',
        accountType: AccountType.SAVINGS,
        openingBalance: 50000,
        openingBalanceDate: new Date().toISOString(),
        currency: 'INR',
      });
    bankAccountId = accRes.body.data.id;

    // Set opening physical cash in hand to ₹10,000
    await request(app)
      .put('/api/v1/accounts/cash-in-hand')
      .set('Cookie', userCookie)
      .send({
        openingBalance: 10000,
        notes: 'Initial physical cash in safe',
      });
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  it('Verifies initial baseline: Bank = ₹50,000, Cash = ₹10,000, Available = ₹60,000', async () => {
    const res = await request(app)
      .get('/api/v1/accounts/total-cash')
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.totalBankBalance).toBe(50000);
    expect(res.body.data.cashInHand).toBe(10000);
    expect(res.body.data.outstandingLending).toBe(0);
    expect(res.body.data.outstandingBorrowing).toBe(0);
    expect(res.body.data.totalAvailableMoney).toBe(60000);
    expect(res.body.data.totalFinancialAssetsTracked).toBe(60000);
    expect(res.body.data.netTrackedPosition).toBe(60000);
  });

  describe('Test A: Lend Money via UPI', () => {
    it('lends ₹10,000 via UPI: debits bank, leaves cash intact, increases outstanding lending', async () => {
      const res = await request(app)
        .post('/api/v1/lending-borrowing')
        .set('Cookie', userCookie)
        .send({
          type: LendingBorrowingType.LENDING,
          personName: 'Friend A',
          amount: 10000,
          date: new Date().toISOString(),
          paymentMethod: 'upi',
          bankAccountId,
          description: 'Emergency travel assistance',
        });

      expect(res.status).toBe(201);
      lendRecordAId = res.body.data.id;
      expect(res.body.data.status).toBe(LendingBorrowingStatus.OUTSTANDING);
      expect(res.body.data.outstandingAmount).toBe(10000);
      expect(res.body.data.settledAmount).toBe(0);

      // Verify Bank Account decreased to ₹40,000
      const bankRes = await request(app)
        .get(`/api/v1/accounts/${bankAccountId}`)
        .set('Cookie', userCookie);
      expect(bankRes.body.data.currentBalance).toBe(40000);

      // Verify Total Cash Summary: Bank=40000, Cash=10000, Outstanding Lending=10000, Available=50000, Assets=60000
      const cashRes = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);
      expect(cashRes.body.data.totalBankBalance).toBe(40000);
      expect(cashRes.body.data.cashInHand).toBe(10000);
      expect(cashRes.body.data.outstandingLending).toBe(10000);
      expect(cashRes.body.data.totalAvailableMoney).toBe(50000);
      expect(cashRes.body.data.totalFinancialAssetsTracked).toBe(60000);
    });

    it('verifies that no normal Transaction was created (income/expense unpolluted)', async () => {
      const txRes = await request(app)
        .get('/api/v1/transactions')
        .set('Cookie', userCookie);
      expect(txRes.body.data.length).toBe(0);
    });
  });

  describe('Test B: Repay Lending via UPI', () => {
    it('records ₹4,000 partial repayment via UPI: increases bank to ₹44,000, outstanding becomes ₹6,000', async () => {
      const repRes = await request(app)
        .post(`/api/v1/lending-borrowing/${lendRecordAId}/repayments`)
        .set('Cookie', userCookie)
        .send({
          amount: 4000,
          date: new Date().toISOString(),
          paymentMethod: 'upi',
          bankAccountId,
          notes: 'First installment via GPay',
        });

      expect(repRes.status).toBe(200);
      expect(repRes.body.data.status).toBe(LendingBorrowingStatus.PARTIALLY_SETTLED);
      expect(repRes.body.data.settledAmount).toBe(4000);
      expect(repRes.body.data.outstandingAmount).toBe(6000);

      // Verify Bank Account increased to ₹44,000
      const bankRes = await request(app)
        .get(`/api/v1/accounts/${bankAccountId}`)
        .set('Cookie', userCookie);
      expect(bankRes.body.data.currentBalance).toBe(44000);

      // Verify Total Cash Summary
      const cashRes = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);
      expect(cashRes.body.data.totalBankBalance).toBe(44000);
      expect(cashRes.body.data.cashInHand).toBe(10000);
      expect(cashRes.body.data.outstandingLending).toBe(6000);
      expect(cashRes.body.data.totalAvailableMoney).toBe(54000);
      expect(cashRes.body.data.totalFinancialAssetsTracked).toBe(60000);
    });

    it('rejects repayment exceeding outstanding balance', async () => {
      const repRes = await request(app)
        .post(`/api/v1/lending-borrowing/${lendRecordAId}/repayments`)
        .set('Cookie', userCookie)
        .send({
          amount: 7000, // outstanding is 6000
          date: new Date().toISOString(),
          paymentMethod: 'upi',
          bankAccountId,
        });

      expect(repRes.status).toBe(400);
      expect(repRes.body.error.code).toBe('EXCEEDS_OUTSTANDING');
    });
  });

  describe('Test C: Lend Money via Cash in Hand', () => {
    it('lends ₹3,000 physical cash to Friend B: decrements cash in hand to ₹7,000, bank unchanged', async () => {
      const res = await request(app)
        .post('/api/v1/lending-borrowing')
        .set('Cookie', userCookie)
        .send({
          type: LendingBorrowingType.LENDING,
          personName: 'Friend B',
          amount: 3000,
          date: new Date().toISOString(),
          paymentMethod: 'cash',
          description: 'Cash for market purchase',
        });

      expect(res.status).toBe(201);
      lendRecordBId = res.body.data.id;
      expect(res.body.data.outstandingAmount).toBe(3000);

      const cashRes = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);
      expect(cashRes.body.data.totalBankBalance).toBe(44000);
      expect(cashRes.body.data.cashInHand).toBe(7000);
      expect(cashRes.body.data.outstandingLending).toBe(9000); // 6000 + 3000
      expect(cashRes.body.data.totalAvailableMoney).toBe(51000); // 44000 + 7000
      expect(cashRes.body.data.totalFinancialAssetsTracked).toBe(60000);
    });
  });

  describe('Test D: Repay Lending in Cash', () => {
    it('Friend B repays ₹3,000 cash in full: increments cash back to ₹10,000, marks record settled', async () => {
      const repRes = await request(app)
        .post(`/api/v1/lending-borrowing/${lendRecordBId}/repayments`)
        .set('Cookie', userCookie)
        .send({
          amount: 3000,
          date: new Date().toISOString(),
          paymentMethod: 'cash',
          notes: 'Returned cash in envelope',
        });

      expect(repRes.status).toBe(200);
      expect(repRes.body.data.status).toBe(LendingBorrowingStatus.SETTLED);
      expect(repRes.body.data.outstandingAmount).toBe(0);

      const cashRes = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);
      expect(cashRes.body.data.totalBankBalance).toBe(44000);
      expect(cashRes.body.data.cashInHand).toBe(10000);
      expect(cashRes.body.data.outstandingLending).toBe(6000);
    });
  });

  describe('Test E: Borrow Money via UPI', () => {
    it('borrows ₹15,000 from Relative C via UPI: increases bank to ₹59,000, records ₹15,000 liability', async () => {
      const res = await request(app)
        .post('/api/v1/lending-borrowing')
        .set('Cookie', userCookie)
        .send({
          type: LendingBorrowingType.BORROWING,
          personName: 'Relative C',
          amount: 15000,
          date: new Date().toISOString(),
          paymentMethod: 'upi',
          bankAccountId,
          description: 'Short-term bridge borrowing',
        });

      expect(res.status).toBe(201);
      borrowRecordCId = res.body.data.id;
      expect(res.body.data.outstandingAmount).toBe(15000);

      // Verify Bank Account increased to ₹59,000
      const bankRes = await request(app)
        .get(`/api/v1/accounts/${bankAccountId}`)
        .set('Cookie', userCookie);
      expect(bankRes.body.data.currentBalance).toBe(59000);

      // Verify Total Cash Summary
      // B=59000, C=10000, L=6000, D=15000
      // Available = 59000 + 10000 = 69000
      // Assets = 69000 + 6000 = 75000
      // Net Position = 75000 - 15000 = 60000
      const cashRes = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);
      expect(cashRes.body.data.totalBankBalance).toBe(59000);
      expect(cashRes.body.data.cashInHand).toBe(10000);
      expect(cashRes.body.data.outstandingLending).toBe(6000);
      expect(cashRes.body.data.outstandingBorrowing).toBe(15000);
      expect(cashRes.body.data.totalAvailableMoney).toBe(69000);
      expect(cashRes.body.data.totalFinancialAssetsTracked).toBe(75000);
      expect(cashRes.body.data.netTrackedPosition).toBe(60000);
    });
  });

  describe('Test F: Repay Borrowed Money via UPI', () => {
    it('repays ₹5,000 to Relative C via UPI: debits bank to ₹54,000, borrowing reduces to ₹10,000', async () => {
      const repRes = await request(app)
        .post(`/api/v1/lending-borrowing/${borrowRecordCId}/repayments`)
        .set('Cookie', userCookie)
        .send({
          amount: 5000,
          date: new Date().toISOString(),
          paymentMethod: 'upi',
          bankAccountId,
          notes: 'Partial repayment via NEFT',
        });

      expect(repRes.status).toBe(200);
      expect(repRes.body.data.status).toBe(LendingBorrowingStatus.PARTIALLY_SETTLED);
      expect(repRes.body.data.outstandingAmount).toBe(10000);

      const bankRes = await request(app)
        .get(`/api/v1/accounts/${bankAccountId}`)
        .set('Cookie', userCookie);
      expect(bankRes.body.data.currentBalance).toBe(54000);

      const cashRes = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);
      expect(cashRes.body.data.totalBankBalance).toBe(54000);
      expect(cashRes.body.data.outstandingBorrowing).toBe(10000);
      expect(cashRes.body.data.totalAvailableMoney).toBe(64000); // 54000 + 10000
      expect(cashRes.body.data.totalFinancialAssetsTracked).toBe(70000); // 64000 + 6000
      expect(cashRes.body.data.netTrackedPosition).toBe(60000); // 70000 - 10000
    });
  });

  describe('Test G: Borrow Money in Cash & Repay in Cash', () => {
    it('borrows ₹2,000 cash from Neighbor D: increases Cash in Hand to ₹12,000', async () => {
      const res = await request(app)
        .post('/api/v1/lending-borrowing')
        .set('Cookie', userCookie)
        .send({
          type: LendingBorrowingType.BORROWING,
          personName: 'Neighbor D',
          amount: 2000,
          date: new Date().toISOString(),
          paymentMethod: 'cash',
        });

      expect(res.status).toBe(201);
      borrowRecordDId = res.body.data.id;

      const cashRes = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);
      expect(cashRes.body.data.cashInHand).toBe(12000);
      expect(cashRes.body.data.outstandingBorrowing).toBe(12000); // 10000 + 2000
    });

    it('repays ₹2,000 cash to Neighbor D: returns Cash in Hand to ₹10,000', async () => {
      const repRes = await request(app)
        .post(`/api/v1/lending-borrowing/${borrowRecordDId}/repayments`)
        .set('Cookie', userCookie)
        .send({
          amount: 2000,
          date: new Date().toISOString(),
          paymentMethod: 'cash',
        });

      expect(repRes.status).toBe(200);
      expect(repRes.body.data.status).toBe(LendingBorrowingStatus.SETTLED);

      const cashRes = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);
      expect(cashRes.body.data.cashInHand).toBe(10000);
      expect(cashRes.body.data.outstandingBorrowing).toBe(10000);
    });
  });

  describe('Test H: Reversal on Deletion of Repayment and Record', () => {
    it('deleting repayment cleanly reverses bank balance', async () => {
      // Find the repayment on Relative C
      const getRec = await request(app)
        .get(`/api/v1/lending-borrowing/${borrowRecordCId}`)
        .set('Cookie', userCookie);

      const repaymentId = getRec.body.data.repayments[0].id;

      // Delete repayment
      const delRepRes = await request(app)
        .delete(`/api/v1/lending-borrowing/${borrowRecordCId}/repayments/${repaymentId}`)
        .set('Cookie', userCookie);

      expect(delRepRes.status).toBe(200);
      expect(delRepRes.body.data.status).toBe(LendingBorrowingStatus.OUTSTANDING);
      expect(delRepRes.body.data.outstandingAmount).toBe(15000);

      // Bank balance should revert back to ₹59,000 (because the ₹5,000 repayment debit is deleted)
      const bankRes = await request(app)
        .get(`/api/v1/accounts/${bankAccountId}`)
        .set('Cookie', userCookie);
      expect(bankRes.body.data.currentBalance).toBe(59000);
    });

    it('deleting entire record cleanly reverses all remaining movements', async () => {
      const delRes = await request(app)
        .delete(`/api/v1/lending-borrowing/${borrowRecordCId}`)
        .set('Cookie', userCookie);

      expect(delRes.status).toBe(200);

      // With Relative C record completely gone, the ₹15,000 borrowing credit to the bank is removed
      // Bank balance reverts to ₹44,000
      const bankRes = await request(app)
        .get(`/api/v1/accounts/${bankAccountId}`)
        .set('Cookie', userCookie);
      expect(bankRes.body.data.currentBalance).toBe(44000);

      const cashRes = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);
      expect(cashRes.body.data.totalBankBalance).toBe(44000);
      expect(cashRes.body.data.outstandingBorrowing).toBe(0);
    });
  });

  describe('Summary Endpoint Verification', () => {
    it('returns exact summary metrics', async () => {
      const res = await request(app)
        .get('/api/v1/lending-borrowing/summary')
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.totalLent).toBe(13000); // 10000 + 3000
      expect(res.body.data.lentReceivedBack).toBe(7000); // 4000 + 3000
      expect(res.body.data.outstandingLending).toBe(6000); // 13000 - 7000
      expect(res.body.data.totalBorrowed).toBe(2000); // Neighbor D (Relative C was deleted)
      expect(res.body.data.borrowedRepaid).toBe(2000);
      expect(res.body.data.outstandingBorrowing).toBe(0);
    });
  });
});
