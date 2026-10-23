import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { AccountType, LendingBorrowingType, LendingBorrowingStatus } from '@finora/shared';

describe('Chit vs Personal Cash Independence & Historical Lending Acceptance Test Suite', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let bankAccountId: string;
  let chitFundId: string;
  let chitMemberId: string;
  let pastLoanAId: string;
  let pastLoanBId: string;
  let liveLoanCId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // 1. Register User
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'cash.separation@finora.test',
        password: 'Password123!',
        fullName: 'Cash Separation Tester',
        currency: 'INR',
      });
    userCookie = regRes.headers['set-cookie'][0];

    // 2. Create Designated Bank Account with ₹100,000
    const accRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'ICICI Savings Account',
        bankName: 'ICICI Bank',
        accountType: AccountType.SAVINGS,
        openingBalance: 100000,
        openingBalanceDate: new Date().toISOString(),
        currency: 'INR',
        isChitFundAccount: true,
      });
    bankAccountId = accRes.body.data.id;

    // 3. Set Opening Personal Cash in Hand to ₹15,000
    await request(app)
      .post('/api/v1/accounts/cash-in-hand/adjust')
      .set('Cookie', userCookie)
      .send({
        type: 'set_balance',
        amount: 15000,
        date: new Date().toISOString(),
        description: 'Opening personal wallet cash',
      });

    // 4. Get/Create Chit Fund & Member
    const cfRes = await request(app)
      .get('/api/v1/chit-funds')
      .set('Cookie', userCookie);
    chitFundId = cfRes.body.data.id;

    const memRes = await request(app)
      .post(`/api/v1/chit-funds/${chitFundId}/members`)
      .set('Cookie', userCookie)
      .send({
        name: 'Member Vikram',
        numberOfChits: 1,
        contributionPerChit: 5000,
      });
    chitMemberId = memRes.body.data.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  // =========================================================================
  // SECTION 1: Baseline Verification
  // =========================================================================
  it('1. Verifies initial baseline: Bank = ₹100,000, Personal Cash = ₹15,000, Chit Cash = ₹0', async () => {
    const cashRes = await request(app)
      .get('/api/v1/accounts/total-cash')
      .set('Cookie', userCookie);

    expect(cashRes.status).toBe(200);
    expect(cashRes.body.data.totalBankBalance).toBe(100000);
    expect(cashRes.body.data.personalCashInHand).toBe(15000);
    expect(cashRes.body.data.totalAvailableMoney).toBe(115000); // 100k + 15k
    expect(cashRes.body.data.totalFinancialAssetsTracked).toBe(115000);
    expect(cashRes.body.data.netTrackedPosition).toBe(115000);

    const chitRes = await request(app)
      .get(`/api/v1/chit-funds/${chitFundId}/summary`)
      .set('Cookie', userCookie);
    expect(chitRes.body.data.cashInHandChitFunds).toBe(0);
  });

  // =========================================================================
  // SECTION 2: Chit Cash Collections and Payouts vs Personal Cash Independence
  // =========================================================================
  describe('2. Chit Cash Movements vs Personal Cash Independence', () => {
    it('recording chit collection in cash increases Chit Cash in Hand, leaving Personal Cash completely untouched', async () => {
      // Record ₹5,000 chit collection in Cash
      const colRes = await request(app)
        .post(`/api/v1/chit-funds/${chitFundId}/collections`)
        .set('Cookie', userCookie)
        .send({
          memberId: chitMemberId,
          collectionPeriod: '2026-10',
          actualAmountReceived: 5000,
          collectionDate: '2026-10-15',
          paymentMethod: 'cash_in_hand',
        });
      expect(colRes.status).toBe(201);

      // Verify Chit Cash in Hand increased to ₹5,000
      const chitSummary = await request(app)
        .get(`/api/v1/chit-funds/${chitFundId}/summary`)
        .set('Cookie', userCookie);
      expect(chitSummary.body.data.cashInHandChitFunds).toBe(5000);

      // Verify Personal Cash in Hand and Total Cash are 100% untouched
      const personalCash = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);
      expect(personalCash.body.data.personalCashInHand).toBe(15000); // Still 15,000!
      expect(personalCash.body.data.totalBankBalance).toBe(100000);
      expect(personalCash.body.data.totalAvailableMoney).toBe(115000);
    });

    it('paying a chit winner in cash decreases Chit Cash in Hand, leaving Personal Cash completely untouched', async () => {
      // Record ₹3,000 chit payout in cash
      const payoutRes = await request(app)
        .post(`/api/v1/chit-funds/${chitFundId}/payouts`)
        .set('Cookie', userCookie)
        .send({
          recipientName: 'Member Vikram',
          memberId: chitMemberId,
          payoutPeriod: '2026-10',
          amount: 3000,
          cashAmount: 3000,
          upiAmount: 0,
          payoutDate: '2026-10-16',
        });
      expect(payoutRes.status).toBe(201);

      // Chit Cash in Hand decreases: 5000 - 3000 = 2000
      const chitSummary = await request(app)
        .get(`/api/v1/chit-funds/${chitFundId}/summary`)
        .set('Cookie', userCookie);
      expect(chitSummary.body.data.cashInHandChitFunds).toBe(2000);

      // Personal Cash in Hand is STILL exactly 15,000!
      const personalCash = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);
      expect(personalCash.body.data.personalCashInHand).toBe(15000);
      expect(personalCash.body.data.totalAvailableMoney).toBe(115000);
    });
  });

  // =========================================================================
  // SECTION 3: Personal Cash in Hand Adjustments & Guardrails
  // =========================================================================
  describe('3. Personal Cash in Hand Adjustments', () => {
    it('adding cash increases Personal Cash in Hand and records audit entry without touching Chit Cash', async () => {
      const adjRes = await request(app)
        .post('/api/v1/accounts/cash-in-hand/adjust')
        .set('Cookie', userCookie)
        .send({
          type: 'add_cash',
          amount: 5000,
          date: new Date().toISOString(),
          description: 'Withdrew from ATM',
        });

      expect(adjRes.status).toBe(200);
      expect(adjRes.body.data.personalCashInHand).toBe(20000); // 15k + 5k
      expect(adjRes.body.data.totalAvailableMoney).toBe(120000); // 100k + 20k

      // Chit Cash is unchanged
      const chitSummary = await request(app)
        .get(`/api/v1/chit-funds/${chitFundId}/summary`)
        .set('Cookie', userCookie);
      expect(chitSummary.body.data.cashInHandChitFunds).toBe(2000);
    });

    it('removing cash decreases Personal Cash in Hand without touching Chit Cash', async () => {
      const adjRes = await request(app)
        .post('/api/v1/accounts/cash-in-hand/adjust')
        .set('Cookie', userCookie)
        .send({
          type: 'remove_cash',
          amount: 2000,
          date: new Date().toISOString(),
          description: 'Cash spent on groceries',
        });

      expect(adjRes.status).toBe(200);
      expect(adjRes.body.data.personalCashInHand).toBe(18000); // 20k - 2k
      expect(adjRes.body.data.totalAvailableMoney).toBe(118000); // 100k + 18k
    });

    it('rejects removing more cash than available balance', async () => {
      const adjRes = await request(app)
        .post('/api/v1/accounts/cash-in-hand/adjust')
        .set('Cookie', userCookie)
        .send({
          type: 'remove_cash',
          amount: 50000, // Available is only 18,000
          date: new Date().toISOString(),
          description: 'Excess withdrawal',
        });

      expect(adjRes.status).toBe(400);
      expect(adjRes.body.error.code).toBe('EXCEEDS_CASH_BALANCE');

      // Balance remains 18,000
      const summary = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);
      expect(summary.body.data.personalCashInHand).toBe(18000);
    });
  });

  // =========================================================================
  // SECTION 4: Past Lending (Historical Loan)
  // =========================================================================
  describe('4. Past Lending (Historical Loan) Accounting', () => {
    it('creates past loan with initial settlement: does NOT debit bank or cash, sets correct outstanding', async () => {
      // Past loan of ₹20,000 to Amit, with ₹5,000 already settled prior to tracking
      const loanRes = await request(app)
        .post('/api/v1/lending-borrowing')
        .set('Cookie', userCookie)
        .send({
          type: LendingBorrowingType.LENDING,
          personName: 'Amit Verma',
          amount: 20000,
          date: '2026-01-10',
          paymentMethod: 'upi', // UPI in the past, no bank account required
          isHistorical: true,
          initialSettledAmount: 5000,
          description: 'Loan for wedding expenses back in January',
        });

      expect(loanRes.status).toBe(201);
      pastLoanAId = loanRes.body.data.id;
      expect(loanRes.body.data.isHistorical).toBe(true);
      expect(loanRes.body.data.amount).toBe(20000);
      expect(loanRes.body.data.settledAmount).toBe(5000);
      expect(loanRes.body.data.outstandingAmount).toBe(15000);
      expect(loanRes.body.data.status).toBe(LendingBorrowingStatus.PARTIALLY_SETTLED);
      expect(loanRes.body.data.repayments).toHaveLength(1);
      expect(loanRes.body.data.repayments[0].isHistorical).toBe(true);

      // Verify Bank Account was NOT debited (still ₹100,000)
      const bankRes = await request(app)
        .get(`/api/v1/accounts/${bankAccountId}`)
        .set('Cookie', userCookie);
      expect(bankRes.body.data.currentBalance).toBe(100000);

      // Verify Personal Cash was NOT debited (still ₹18,000)
      const cashRes = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);
      expect(cashRes.body.data.personalCashInHand).toBe(18000);
      expect(cashRes.body.data.totalBankBalance).toBe(100000);
      expect(cashRes.body.data.totalAvailableMoney).toBe(118000); // B + C

      // Total Assets Tracked = B + C + L = 100k + 18k + 15k = 133,000
      expect(cashRes.body.data.outstandingLending).toBe(15000);
      expect(cashRes.body.data.totalFinancialAssetsTracked).toBe(133000);
      expect(cashRes.body.data.netTrackedPosition).toBe(133000);
    });

    it('creates past loan with 0 initial settlement via Cash without debiting Personal Cash', async () => {
      // Past loan of ₹10,000 to Deepa
      const loanRes = await request(app)
        .post('/api/v1/lending-borrowing')
        .set('Cookie', userCookie)
        .send({
          type: LendingBorrowingType.LENDING,
          personName: 'Deepa Sen',
          amount: 10000,
          date: '2026-02-15',
          paymentMethod: 'cash',
          isHistorical: true,
          initialSettledAmount: 0,
        });

      expect(loanRes.status).toBe(201);
      pastLoanBId = loanRes.body.data.id;
      expect(loanRes.body.data.isHistorical).toBe(true);
      expect(loanRes.body.data.outstandingAmount).toBe(10000);
      expect(loanRes.body.data.status).toBe(LendingBorrowingStatus.OUTSTANDING);

      // Personal cash must still be ₹18,000
      const cashRes = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);
      expect(cashRes.body.data.personalCashInHand).toBe(18000);
      // Total Outstanding Lending is now 15k + 10k = 25,000
      expect(cashRes.body.data.outstandingLending).toBe(25000);
      expect(cashRes.body.data.totalFinancialAssetsTracked).toBe(143000); // 118k + 25k
    });
  });

  // =========================================================================
  // SECTION 5: Live Repayments on Past Loans
  // =========================================================================
  describe('5. Live Repayments on Past Loans', () => {
    it('live cash repayment on past loan increases Personal Cash in Hand and decreases outstanding lending', async () => {
      // Amit repays ₹5,000 today in physical cash
      const repayRes = await request(app)
        .post(`/api/v1/lending-borrowing/${pastLoanAId}/repayments`)
        .set('Cookie', userCookie)
        .send({
          amount: 5000,
          date: new Date().toISOString(),
          paymentMethod: 'cash',
          notes: 'Received in cash today',
          isHistorical: false, // Live repayment!
        });

      expect(repayRes.status).toBe(200);
      expect(repayRes.body.data.settledAmount).toBe(10000); // 5k prior + 5k live
      expect(repayRes.body.data.outstandingAmount).toBe(10000); // 20k - 10k

      // Real cash arrived: Personal Cash in Hand increases from 18,000 to 23,000!
      const cashRes = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);
      expect(cashRes.body.data.personalCashInHand).toBe(23000);
      // Chit Cash in Hand is still 2,000!
      const chitSummary = await request(app)
        .get(`/api/v1/chit-funds/${chitFundId}/summary`)
        .set('Cookie', userCookie);
      expect(chitSummary.body.data.cashInHandChitFunds).toBe(2000);

      // Outstanding Lending is now 10k (Amit) + 10k (Deepa) = 20,000
      expect(cashRes.body.data.outstandingLending).toBe(20000);
      // Total Available Money = 100k (Bank) + 23k (Cash) = 123,000
      expect(cashRes.body.data.totalAvailableMoney).toBe(123000);
      // Total Assets Tracked = 123k + 20k = 143,000 (conserved!)
      expect(cashRes.body.data.totalFinancialAssetsTracked).toBe(143000);
    });

    it('live UPI repayment on past loan increases bank balance and decreases outstanding lending', async () => {
      // Deepa repays ₹4,000 today via UPI into ICICI Bank
      const repayRes = await request(app)
        .post(`/api/v1/lending-borrowing/${pastLoanBId}/repayments`)
        .set('Cookie', userCookie)
        .send({
          amount: 4000,
          date: new Date().toISOString(),
          paymentMethod: 'upi',
          bankAccountId,
          notes: 'Received via GPay',
          isHistorical: false,
        });

      expect(repayRes.status).toBe(200);
      expect(repayRes.body.data.settledAmount).toBe(4000);
      expect(repayRes.body.data.outstandingAmount).toBe(6000); // 10k - 4k

      // Bank balance increases from 100,000 to 104,000!
      const bankRes = await request(app)
        .get(`/api/v1/accounts/${bankAccountId}`)
        .set('Cookie', userCookie);
      expect(bankRes.body.data.currentBalance).toBe(104000);

      // Personal Cash in Hand stays 23,000
      const cashRes = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);
      expect(cashRes.body.data.personalCashInHand).toBe(23000);
      expect(cashRes.body.data.totalBankBalance).toBe(104000);
      expect(cashRes.body.data.totalAvailableMoney).toBe(127000); // 104k + 23k
      expect(cashRes.body.data.outstandingLending).toBe(16000); // 10k (Amit) + 6k (Deepa)
      expect(cashRes.body.data.totalFinancialAssetsTracked).toBe(143000); // Conserved!
    });
  });

  // =========================================================================
  // SECTION 6: Historical Repayment on Past Loan
  // =========================================================================
  describe('6. Historical Repayments on Past Loan', () => {
    it('recording historical settlement decreases outstanding lending with zero current balance impact', async () => {
      // Record a historical settlement of ₹2,000 on Amit's loan that occurred months ago
      const repayRes = await request(app)
        .post(`/api/v1/lending-borrowing/${pastLoanAId}/repayments`)
        .set('Cookie', userCookie)
        .send({
          amount: 2000,
          date: '2026-03-01',
          paymentMethod: 'cash',
          isHistorical: true, // Historical!
          notes: 'Settled in cash back in March',
        });

      expect(repayRes.status).toBe(200);
      expect(repayRes.body.data.settledAmount).toBe(12000);
      expect(repayRes.body.data.outstandingAmount).toBe(8000); // 20k - 12k

      // Neither bank nor cash changed!
      const bankRes = await request(app)
        .get(`/api/v1/accounts/${bankAccountId}`)
        .set('Cookie', userCookie);
      expect(bankRes.body.data.currentBalance).toBe(104000);

      const cashRes = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);
      expect(cashRes.body.data.personalCashInHand).toBe(23000);
      expect(cashRes.body.data.outstandingLending).toBe(14000); // 8k + 6k
    });
  });

  // =========================================================================
  // SECTION 7: Deletion & Reversals Safeguards
  // =========================================================================
  describe('7. Deletion and Reversal Guardrails', () => {
    it('deleting a historical repayment does NOT alter bank or cash balances', async () => {
      const getRec = await request(app)
        .get(`/api/v1/lending-borrowing/${pastLoanAId}`)
        .set('Cookie', userCookie);

      const histRep = getRec.body.data.repayments.find((r: any) => r.amount === 2000 && r.isHistorical);
      expect(histRep).toBeDefined();

      const delRes = await request(app)
        .delete(`/api/v1/lending-borrowing/${pastLoanAId}/repayments/${histRep.id}`)
        .set('Cookie', userCookie);
      expect(delRes.status).toBe(200);

      // Balances must remain strictly unchanged
      const bankRes = await request(app)
        .get(`/api/v1/accounts/${bankAccountId}`)
        .set('Cookie', userCookie);
      expect(bankRes.body.data.currentBalance).toBe(104000);

      const cashRes = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);
      expect(cashRes.body.data.personalCashInHand).toBe(23000);
    });

    it('deleting a live repayment cleanly reverses the credit', async () => {
      const getRec = await request(app)
        .get(`/api/v1/lending-borrowing/${pastLoanBId}`)
        .set('Cookie', userCookie);

      const liveRep = getRec.body.data.repayments.find((r: any) => r.amount === 4000);
      expect(liveRep).toBeDefined();

      // Delete the ₹4,000 live UPI repayment on Deepa's loan
      const delRes = await request(app)
        .delete(`/api/v1/lending-borrowing/${pastLoanBId}/repayments/${liveRep.id}`)
        .set('Cookie', userCookie);
      expect(delRes.status).toBe(200);

      // Bank balance reverses by ₹4,000 back to ₹100,000!
      const bankRes = await request(app)
        .get(`/api/v1/accounts/${bankAccountId}`)
        .set('Cookie', userCookie);
      expect(bankRes.body.data.currentBalance).toBe(100000);
    });

    it('deleting a past loan does NOT credit back the principal to bank or cash', async () => {
      // Delete Deepa's past loan of ₹10,000
      const delRes = await request(app)
        .delete(`/api/v1/lending-borrowing/${pastLoanBId}`)
        .set('Cookie', userCookie);
      expect(delRes.status).toBe(200);

      // Balances must NOT receive a ₹10,000 credit (because it was never debited)
      const bankRes = await request(app)
        .get(`/api/v1/accounts/${bankAccountId}`)
        .set('Cookie', userCookie);
      expect(bankRes.body.data.currentBalance).toBe(100000);

      const cashRes = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);
      expect(cashRes.body.data.personalCashInHand).toBe(23000);
    });

    it('deleting a live loan cleanly reverses its principal debit', async () => {
      // Create a live loan of ₹10,000 in cash to Ramesh
      const liveLoanRes = await request(app)
        .post('/api/v1/lending-borrowing')
        .set('Cookie', userCookie)
        .send({
          type: LendingBorrowingType.LENDING,
          personName: 'Ramesh Live',
          amount: 10000,
          date: new Date().toISOString(),
          paymentMethod: 'cash',
          isHistorical: false, // LIVE loan!
        });

      expect(liveLoanRes.status).toBe(201);
      liveLoanCId = liveLoanRes.body.data.id;

      // Cash debited from 23,000 to 13,000
      let cashRes = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);
      expect(cashRes.body.data.personalCashInHand).toBe(13000);

      // Now delete the live loan
      const delRes = await request(app)
        .delete(`/api/v1/lending-borrowing/${liveLoanCId}`)
        .set('Cookie', userCookie);
      expect(delRes.status).toBe(200);

      // Cash is cleanly restored to ₹23,000!
      cashRes = await request(app)
        .get('/api/v1/accounts/total-cash')
        .set('Cookie', userCookie);
      expect(cashRes.body.data.personalCashInHand).toBe(23000);
    });
  });
});
