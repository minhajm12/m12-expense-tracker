import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import {
  AccountType,
  TransactionType,
  PaymentMethod,
  PaymentChannel,
  EmiStatus,
  EmiOccurrenceStatus,
  CreditCardNetwork,
} from '@finora/shared';

describe('Phase 4: Cross-Module Final Audit Test Suite (EMI + Chit Fund + Reports + Balances)', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let chitBankAccountId: string;
  let personalBankAccountId: string;
  let creditCardId: string;
  let chitFundId: string;
  let memberRahulId: string;
  let memberSelfId: string;
  let emiRuleId: string;
  let selfPayCollectionId: string;
  let linkedSepTxId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // 1. Register User
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'audit.crossmodule@finora.test',
        password: 'Password123!',
        fullName: 'Cross Module Auditor',
        currency: 'INR',
      });
    userCookie = regRes.headers['set-cookie'][0];

    // 2. Designated Chit Bank Account with ₹1,50,000
    const acc1 = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'HDFC Chit Fund Account',
        bankName: 'HDFC Bank',
        accountType: AccountType.SAVINGS,
        openingBalance: 150000,
        openingBalanceDate: '2026-01-01T00:00:00.000Z',
        currency: 'INR',
        isChitFundAccount: true,
      });
    chitBankAccountId = acc1.body.data.id;

    // 3. Separate Personal Bank Account with ₹80,000
    const acc2 = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'SBI Personal Checking',
        bankName: 'SBI',
        accountType: AccountType.SAVINGS,
        openingBalance: 80000,
        openingBalanceDate: '2026-01-01T00:00:00.000Z',
        currency: 'INR',
        isChitFundAccount: false,
      });
    personalBankAccountId = acc2.body.data.id;

    // 4. Personal Cash in Hand ₹15,000
    await request(app)
      .post('/api/v1/accounts/cash-in-hand/adjust')
      .set('Cookie', userCookie)
      .send({
        type: 'set_balance',
        amount: 15000,
        date: '2026-01-01T00:00:00.000Z',
        description: 'Opening personal wallet cash',
      });

    // 5. Credit Card
    const ccRes = await request(app)
      .post('/api/v1/credit-cards')
      .set('Cookie', userCookie)
      .send({
        cardNickname: 'Millennia Card',
        issuingBank: 'HDFC Bank',
        network: CreditCardNetwork.VISA,
        lastFourDigits: '1234',
        creditLimit: 150000,
        billingCycleClosingDay: 15,
        paymentDueDay: 5,
        openingOutstanding: 0,
        openingOutstandingDate: '2026-01-01T00:00:00.000Z',
      });
    creditCardId = ccRes.body.data.id;

    // 6. Chit Fund Setup
    const cfRes = await request(app).get('/api/v1/chit-funds').set('Cookie', userCookie);
    chitFundId = cfRes.body.data.id;

    const m1 = await request(app)
      .post(`/api/v1/chit-funds/${chitFundId}/members`)
      .set('Cookie', userCookie)
      .send({ name: 'Rahul Member', numberOfChits: 1, contributionPerChit: 5000 });
    memberRahulId = m1.body.data.id;

    const mSelf = await request(app)
      .post(`/api/v1/chit-funds/${chitFundId}/members`)
      .set('Cookie', userCookie)
      .send({ name: 'Organizer Self', numberOfChits: 1, contributionPerChit: 5000 });
    memberSelfId = mSelf.body.data.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  // Scenario 1: Setup EMI with historical installments
  it('Scenario 1: Creates EMI schedule with historical installments without phantom bank deductions', async () => {
    const emiRes = await request(app)
      .post('/api/v1/emi')
      .set('Cookie', userCookie)
      .send({
        name: 'Vehicle Loan',
        lender: 'HDFC Bank',
        monthlyAmount: 6000,
        startDate: '2026-01-10T00:00:00.000Z',
        firstDueDate: '2026-01-10T00:00:00.000Z',
        nextEmiDate: '2026-03-10T00:00:00.000Z',
        endDate: '2026-06-10T00:00:00.000Z',
        totalInstallments: 6,
        originalLoanAmount: 36000,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: personalBankAccountId,
        markHistoricalPaid: true,
      });

    expect(emiRes.status).toBe(201);
    emiRuleId = emiRes.body.data.id;
    expect(emiRes.body.data.status).toBe(EmiStatus.ACTIVE);

    const detailRes = await request(app).get(`/api/v1/emi/${emiRuleId}`).set('Cookie', userCookie);
    expect(detailRes.body.data.paidInstallmentsCount).toBe(2);
    expect(detailRes.body.data.historicalPaidInstallmentsCount).toBe(2);

    // Verify Personal Bank Account was NOT deducted by historical EMIs (still ₹80,000)
    const accRes = await request(app).get(`/api/v1/accounts/${personalBankAccountId}`).set('Cookie', userCookie);
    expect(accRes.body.data.currentBalance).toBe(80000);
  });

  // Scenario 2: Already Paid Chit Collection allocates bank funds without modifying EMI schedules or counts
  it('Scenario 2: Already Paid UPI collection allocates chit reserve without modifying EMI schedules or counts', async () => {
    const colRes = await request(app)
      .post(`/api/v1/chit-funds/${chitFundId}/collections`)
      .set('Cookie', userCookie)
      .send({
        memberId: memberSelfId,
        collectionPeriod: '2026-03',
        actualAmountReceived: 5000,
        paymentMethod: 'upi',
        receivingBankAccountId: chitBankAccountId,
        isAlreadyPaid: true,
        collectionDate: '2026-03-01T10:00:00.000Z',
      });

    expect(colRes.status).toBe(201);
    selfPayCollectionId = colRes.body.data.id;

    // Verify personal bank account is untouched (still ₹80,000)
    const accRes = await request(app).get(`/api/v1/accounts/${personalBankAccountId}`).set('Cookie', userCookie);
    expect(accRes.body.data.currentBalance).toBe(80000);

    // Verify EMI is completely untouched
    const emiRes = await request(app).get(`/api/v1/emi/${emiRuleId}`).set('Cookie', userCookie);
    expect(emiRes.body.data.status).toBe(EmiStatus.ACTIVE);
    expect(emiRes.body.data.paidInstallmentsCount).toBe(2);
    expect(emiRes.body.data.nextEmiDate).toBe('2026-03-10T00:00:00.000Z');
  });

  // Scenario 3: Pay EMI installment creates exactly one expense transaction and does not affect Chit Fund
  it('Scenario 3: Paying current EMI installment debits bank and creates exactly one expense without affecting chit fund', async () => {
    const payRes = await request(app)
      .post(`/api/v1/emi/${emiRuleId}/pay`)
      .set('Cookie', userCookie)
      .send({
        occurrenceKey: '2026-03',
        actualAmount: 6000,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: personalBankAccountId,
        date: '2026-03-10T10:00:00.000Z',
      });

    expect(payRes.status).toBe(200);
    expect(payRes.body.data.occurrence.status).toBe(EmiOccurrenceStatus.PAID);

    // Personal bank account decreased by ₹6,000 (80k -> 74k)
    const accRes = await request(app).get(`/api/v1/accounts/${personalBankAccountId}`).set('Cookie', userCookie);
    expect(accRes.body.data.currentBalance).toBe(74000);

    // Verify Chit Fund held in bank is completely untouched (still ₹5,000 from Scenario 2)
    const cfSummary = await request(app).get(`/api/v1/chit-funds/${chitFundId}/summary`).set('Cookie', userCookie);
    expect(cfSummary.body.data.chitFundsHeldInBank).toBe(5000);
  });

  // Scenario 4: Already Paid collection records member completion and increases chit reserve
  it('Scenario 4: Already Paid collection records member completion and increases chit reserve', async () => {
    const accBefore = await request(app).get(`/api/v1/accounts/${chitBankAccountId}`).set('Cookie', userCookie);
    const cfBefore = await request(app).get(`/api/v1/chit-funds/${chitFundId}/summary`).set('Cookie', userCookie);

    const prevBankBal = accBefore.body.data.currentBalance;
    const prevChitReserve = cfBefore.body.data.chitFundsHeldInBank;
    const prevChitCash = cfBefore.body.data.cashInHandChitFunds;

    const colRes = await request(app)
      .post(`/api/v1/chit-funds/${chitFundId}/collections`)
      .set('Cookie', userCookie)
      .send({
        memberId: memberRahulId,
        collectionPeriod: '2026-03',
        actualAmountReceived: 5000,
        paymentMethod: 'upi',
        receivingBankAccountId: chitBankAccountId,
        isAlreadyPaid: true,
        collectionDate: '2026-03-12T10:00:00.000Z',
      });
    expect(colRes.status).toBe(201);
    expect(colRes.body.data.isAlreadyPaid).toBe(true);

    const accAfter = await request(app).get(`/api/v1/accounts/${chitBankAccountId}`).set('Cookie', userCookie);
    const cfAfter = await request(app).get(`/api/v1/chit-funds/${chitFundId}/summary`).set('Cookie', userCookie);

    expect(accAfter.body.data.currentBalance).toBe(prevBankBal);
    expect(cfAfter.body.data.chitFundsHeldInBank).toBe(prevChitReserve + 5000);
    expect(cfAfter.body.data.cashInHandChitFunds).toBe(prevChitCash);
  });

  // Scenario 5: Genuine personal expense in 'Chits' category debits personal account and is tracked
  it('Scenario 5: Genuine personal "Chits" expense is recorded without affecting Chit Fund accounting', async () => {
    const cfBefore = await request(app).get(`/api/v1/chit-funds/${chitFundId}/summary`).set('Cookie', userCookie);

    const txRes = await request(app)
      .post('/api/v1/transactions')
      .set('Cookie', userCookie)
      .send({
        title: 'Office Monthly Chit Fund Contribution',
        amount: 3000,
        type: TransactionType.EXPENSE,
        category: 'Chits',
        accountId: personalBankAccountId,
        paymentMethod: PaymentMethod.UPI,
        paymentChannel: PaymentChannel.ONLINE,
        date: '2026-03-15T12:00:00.000Z',
      });
    expect(txRes.status).toBe(201);

    // Personal bank account decreased by ₹3,000 (74k -> 71k)
    const accRes = await request(app).get(`/api/v1/accounts/${personalBankAccountId}`).set('Cookie', userCookie);
    expect(accRes.body.data.currentBalance).toBe(71000);

    // Internal Chit Fund summary is completely unaffected
    const cfAfter = await request(app).get(`/api/v1/chit-funds/${chitFundId}/summary`).set('Cookie', userCookie);
    expect(cfAfter.body.data.chitFundsHeldInBank).toBe(cfBefore.body.data.chitFundsHeldInBank);
  });

  // Scenario 6: Reports module correctly isolates personal activity from internal chit operations
  it('Scenario 6: Reports module includes personal Chits & EMI while strictly excluding CHIT_SEPARATION', async () => {
    const res = await request(app)
      .get('/api/v1/reports?startDate=2026-03-01&endDate=2026-03-31')
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);

    // Expenses = 6,000 (EMI) + 3,000 (Personal Chits) = 9,000
    // CHIT_SEPARATION of 5,000 MUST NOT be included!
    expect(res.body.data.summary.totalExpenses).toBe(9000);
    expect(res.body.data.summary.emiExpenses).toBe(6000);
    expect(res.body.data.summary.transactionCount).toBe(2);

    // Category breakdown check
    const emiCat = res.body.data.categoryBreakdown.find((c: any) => c.category === 'EMI');
    expect(emiCat).toBeDefined();
    expect(emiCat.totalAmount).toBe(6000);

    const chitsCat = res.body.data.categoryBreakdown.find((c: any) => c.category === 'Chits');
    expect(chitsCat).toBeDefined();
    expect(chitsCat.totalAmount).toBe(3000);
  });

  // Scenario 7: Cash in Hand Chit Collection isolates Chit Cash from Personal Cash
  it('Scenario 7: Cash in Hand chit collection increases Chit Cash only and leaves Personal Cash untouched', async () => {
    const cashBefore = await request(app).get('/api/v1/accounts/total-cash').set('Cookie', userCookie);
    const cfBefore = await request(app).get(`/api/v1/chit-funds/${chitFundId}/summary`).set('Cookie', userCookie);

    const prevPersonalCash = cashBefore.body.data.personalCashInHand;
    const prevChitCash = cfBefore.body.data.cashInHandChitFunds;

    const colRes = await request(app)
      .post(`/api/v1/chit-funds/${chitFundId}/collections`)
      .set('Cookie', userCookie)
      .send({
        memberId: memberRahulId,
        collectionPeriod: '2026-04',
        actualAmountReceived: 5000,
        paymentMethod: 'cash_in_hand',
        collectionDate: '2026-04-05T10:00:00.000Z',
      });
    expect(colRes.status).toBe(201);

    const cashAfter = await request(app).get('/api/v1/accounts/total-cash').set('Cookie', userCookie);
    const cfAfter = await request(app).get(`/api/v1/chit-funds/${chitFundId}/summary`).set('Cookie', userCookie);

    expect(cashAfter.body.data.personalCashInHand).toBe(prevPersonalCash); // 15,000 unchanged
    expect(cfAfter.body.data.cashInHandChitFunds).toBe(prevChitCash + 5000);
  });

  // Scenario 8: Deletion of collection adjusts chit reserves safely without affecting personal balances
  it('Scenario 8: Deleting Already Paid collection adjusts chit reserves safely without affecting bank balance', async () => {
    const accBefore = await request(app).get(`/api/v1/accounts/${personalBankAccountId}`).set('Cookie', userCookie);
    const prevBal = accBefore.body.data.currentBalance; // 71,000

    const cfBefore = await request(app).get(`/api/v1/chit-funds/${chitFundId}/summary`).set('Cookie', userCookie);
    const prevReserve = cfBefore.body.data.chitFundsHeldInBank;

    // Delete collection
    const delRes = await request(app)
      .delete(`/api/v1/chit-funds/${chitFundId}/collections/${selfPayCollectionId}`)
      .set('Cookie', userCookie);
    expect(delRes.status).toBe(200);

    // Personal bank account balance remains unchanged
    const accAfter = await request(app).get(`/api/v1/accounts/${personalBankAccountId}`).set('Cookie', userCookie);
    expect(accAfter.body.data.currentBalance).toBe(prevBal);

    // Chit reserve decreased by 5,000
    const cfAfter = await request(app).get(`/api/v1/chit-funds/${chitFundId}/summary`).set('Cookie', userCookie);
    expect(cfAfter.body.data.chitFundsHeldInBank).toBe(prevReserve - 5000);

    // EMI and Reports remain consistent
    const emiRes = await request(app).get(`/api/v1/emi/${emiRuleId}`).set('Cookie', userCookie);
    expect(emiRes.body.data.status).toBe(EmiStatus.ACTIVE);
  });

  // Scenario 9: Total Personal Available Balance calculation
  it('Scenario 9: Total Personal Available Balance correctly accounts for chit fund reserves', async () => {
    const totalCashRes = await request(app).get('/api/v1/accounts/total-cash').set('Cookie', userCookie);
    expect(totalCashRes.status).toBe(200);

    // Bank account balances:
    // HDFC Chit Fund Account: 150,000
    // SBI Personal Checking: 71,000
    // Total Bank = 221,000
    expect(totalCashRes.body.data.totalBankBalance).toBe(221000);
    expect(totalCashRes.body.data.personalCashInHand).toBe(15000);
  });

  // Scenario 10: Forecast integration in Reports isolates upcoming payments
  it('Scenario 10: Reports forecast projection captures upcoming May EMI without affecting actuals', async () => {
    const repRes = await request(app)
      .get('/api/v1/reports?startDate=2026-05-01&endDate=2026-05-31&includeForecast=true')
      .set('Cookie', userCookie);

    expect(repRes.status).toBe(200);
    // Settled expenses for May are 0
    expect(repRes.body.data.summary.totalExpenses).toBe(0);

    // Upcoming EMI for May is 6,000
    expect(repRes.body.data.forecast).toBeDefined();
    expect(repRes.body.data.forecast.upcomingEmi).toBe(6000);
    expect(repRes.body.data.forecast.totalProjectedExpenses).toBe(6000);
  });
});
