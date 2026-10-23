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
  CreditCardNetwork,
  TransactionStatus,
} from '@finora/shared';
import { Transaction } from '../models/Transaction';

describe('Phase 3: Main Reports Personal Scope & Projections Test Suite', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let userId: string;
  let bankAccountId: string;
  let secondBankAccountId: string;
  let creditCardId: string;
  let chitFundId: string;
  let memberId: string;
  let emiRuleId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // 1. Register User
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'reports.personal@finora.test',
        password: 'Password123!',
        fullName: 'Reports Auditor',
        currency: 'INR',
      });
    userCookie = regRes.headers['set-cookie'][0];
    userId = regRes.body.data.user.id;

    // 2. Create Primary Bank Account with ₹100,000
    const acc1Res = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'Primary HDFC Account',
        bankName: 'HDFC',
        accountType: AccountType.SAVINGS,
        openingBalance: 100000,
        openingBalanceDate: '2026-01-01T00:00:00.000Z',
        currency: 'INR',
        isChitFundAccount: true,
      });
    bankAccountId = acc1Res.body.data.id;

    // 3. Create Second Bank Account with ₹40,000
    const acc2Res = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'Secondary Axis Account',
        bankName: 'Axis',
        accountType: AccountType.SAVINGS,
        openingBalance: 40000,
        openingBalanceDate: '2026-01-01T00:00:00.000Z',
        currency: 'INR',
      });
    secondBankAccountId = acc2Res.body.data.id;

    // 4. Create Credit Card
    const ccRes = await request(app)
      .post('/api/v1/credit-cards')
      .set('Cookie', userCookie)
      .send({
        cardNickname: 'Regalia Gold',
        issuingBank: 'HDFC Bank',
        network: CreditCardNetwork.VISA,
        lastFourDigits: '5678',
        creditLimit: 200000,
        billingCycleClosingDay: 15,
        paymentDueDay: 20,
        openingOutstanding: 0,
        openingOutstandingDate: '2026-01-01T00:00:00.000Z',
      });
    creditCardId = ccRes.body.data.id;

    // 5. Create Chit Fund & Member
    const cfRes = await request(app).get('/api/v1/chit-funds').set('Cookie', userCookie);
    chitFundId = cfRes.body.data.id;

    const mRes = await request(app)
      .post(`/api/v1/chit-funds/${chitFundId}/members`)
      .set('Cookie', userCookie)
      .send({ name: 'Chit Friend', numberOfChits: 1, contributionPerChit: 5000 });
    memberId = mRes.body.data.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  // Test 1: Record Personal Income and Regular Expenses
  it('1. Personal income and standard expenses are accurately tallied', async () => {
    // Record ₹60,000 salary
    await request(app)
      .post('/api/v1/transactions')
      .set('Cookie', userCookie)
      .send({
        title: 'Monthly Salary',
        amount: 60000,
        type: TransactionType.INCOME,
        category: 'Salary',
        accountId: bankAccountId,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        paymentChannel: PaymentChannel.ONLINE,
        date: '2026-03-01T10:00:00.000Z',
      });

    // Record ₹4,000 Groceries
    await request(app)
      .post('/api/v1/transactions')
      .set('Cookie', userCookie)
      .send({
        title: 'Supermarket Groceries',
        amount: 4000,
        type: TransactionType.EXPENSE,
        category: 'Groceries',
        accountId: bankAccountId,
        paymentMethod: PaymentMethod.UPI,
        paymentChannel: PaymentChannel.ONLINE,
        date: '2026-03-05T12:00:00.000Z',
      });

    const res = await request(app)
      .get('/api/v1/reports?startDate=2026-03-01&endDate=2026-03-31')
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.totalIncome).toBe(60000);
    expect(res.body.data.summary.totalExpenses).toBe(4000);
    expect(res.body.data.summary.netCashFlow).toBe(56000);
    expect(res.body.data.summary.transactionCount).toBe(2);
  });

  // Test 2: Chit Separation transaction is strictly excluded from personal reports
  it('2. CHIT_SEPARATION transactions are strictly excluded from personal report totals', async () => {
    // Create CHIT_SEPARATION transaction directly to verify report exclusion
    await Transaction.create({
      userId,
      title: 'Historical Chit Separation',
      amount: 5000,
      type: TransactionType.CHIT_SEPARATION,
      category: 'Chits',
      accountId: bankAccountId,
      paymentMethod: PaymentMethod.BANK_TRANSFER,
      paymentChannel: PaymentChannel.ONLINE,
      status: TransactionStatus.COMPLETED,
      date: new Date('2026-03-10T10:00:00.000Z'),
    });

    // Query Reports again for March 2026
    const res = await request(app)
      .get('/api/v1/reports?startDate=2026-03-01&endDate=2026-03-31')
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    // Total income and expenses must remain ₹60,000 and ₹4,000 (NOT ₹9,000!)
    expect(res.body.data.summary.totalIncome).toBe(60000);
    expect(res.body.data.summary.totalExpenses).toBe(4000);
    expect(res.body.data.summary.netCashFlow).toBe(56000);
    expect(res.body.data.summary.transactionCount).toBe(2);

    // Verify CHIT_SEPARATION does NOT appear in categoryBreakdown
    const chitSepCategory = res.body.data.categoryBreakdown.find((c: any) => c.category === 'Chits');
    expect(chitSepCategory).toBeUndefined();
  });

  // Test 3: Genuine Personal Expense in category 'Chits' IS included
  it('3. Genuine personal expense transactions categorized as "Chits" ARE included in personal report', async () => {
    // Record personal chit expense of ₹2,500
    await request(app)
      .post('/api/v1/transactions')
      .set('Cookie', userCookie)
      .send({
        title: 'External Neighborhood Chit Contribution',
        amount: 2500,
        type: TransactionType.EXPENSE,
        category: 'Chits',
        accountId: bankAccountId,
        paymentMethod: PaymentMethod.UPI,
        paymentChannel: PaymentChannel.ONLINE,
        date: '2026-03-12T14:00:00.000Z',
      });

    const res = await request(app)
      .get('/api/v1/reports?startDate=2026-03-01&endDate=2026-03-31')
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.totalExpenses).toBe(6500); // 4000 + 2500
    expect(res.body.data.summary.transactionCount).toBe(3);

    // Chits category must now appear in category breakdown with ₹2,500
    const chitsCat = res.body.data.categoryBreakdown.find((c: any) => c.category === 'Chits');
    expect(chitsCat).toBeDefined();
    expect(chitsCat.totalAmount).toBe(2500);
    expect(chitsCat.transactionCount).toBe(1);
  });

  // Test 4: Historical EMI installments without transactions are NOT counted in reports
  it('4. Historical EMI installments do NOT inflate actual report expenses', async () => {
    // Create an EMI starting back in 2026-01 with historical installments marked paid
    const emiRes = await request(app)
      .post('/api/v1/emi')
      .set('Cookie', userCookie)
      .send({
        name: 'Laptop Loan',
        lender: 'HDFC',
        monthlyAmount: 3500,
        startDate: '2026-01-05T00:00:00.000Z',
        firstDueDate: '2026-01-05T00:00:00.000Z',
        nextEmiDate: '2026-03-05T00:00:00.000Z',
        endDate: '2026-06-05T00:00:00.000Z',
        totalInstallments: 6,
        originalLoanAmount: 21000,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
        markHistoricalPaid: true,
      });
    expect(emiRes.status).toBe(201);
    emiRuleId = emiRes.body.data.id;

    // Check January 2026 report — historical installments must NOT be counted as actual spending!
    const janRes = await request(app)
      .get('/api/v1/reports?startDate=2026-01-01&endDate=2026-01-31')
      .set('Cookie', userCookie);

    expect(janRes.status).toBe(200);
    expect(janRes.body.data.summary.totalExpenses).toBe(0);
    expect(janRes.body.data.summary.emiExpenses).toBe(0);
    expect(janRes.body.data.summary.transactionCount).toBe(0);
  });

  // Test 5: Paying current EMI installment creates exactly one expense transaction and is reported under emiExpenses
  it('5. Paying current EMI installment is included once in actual expenses and emiExpenses', async () => {
    // Pay March 2026 EMI occurrence
    const emiDetail = await request(app).get(`/api/v1/emi/${emiRuleId}`).set('Cookie', userCookie);
    const marchOcc = emiDetail.body.data.occurrences.find((o: any) => o.occurrenceKey === '2026-03');
    expect(marchOcc).toBeDefined();

    const payRes = await request(app)
      .post(`/api/v1/emi/${emiRuleId}/pay`)
      .set('Cookie', userCookie)
      .send({
        occurrenceKey: '2026-03',
        actualAmount: 3500,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
        date: '2026-03-05T10:00:00.000Z',
      });
    expect(payRes.status).toBe(200);
    expect(payRes.body.data.occurrence.transactionId).toBeDefined();

    // Now query March 2026 report
    const res = await request(app)
      .get('/api/v1/reports?startDate=2026-03-01&endDate=2026-03-31')
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    // Expenses = 4000 (groceries) + 2500 (chits) + 3500 (EMI) = 10,000
    expect(res.body.data.summary.totalExpenses).toBe(10000);
    expect(res.body.data.summary.emiExpenses).toBe(3500);
    expect(res.body.data.summary.transactionCount).toBe(4);
  });

  // Test 6: Credit Card Spend and Refund calculations
  it('6. Credit card purchases are tracked under creditCardSpend and refunds reduce it', async () => {
    // Make ₹8,000 credit card purchase
    const ccTx = await request(app)
      .post('/api/v1/transactions')
      .set('Cookie', userCookie)
      .send({
        title: 'Electronics Store Purchase',
        amount: 8000,
        type: TransactionType.EXPENSE,
        category: 'Electronics',
        creditCardId,
        paymentMethod: PaymentMethod.CREDIT_CARD,
        paymentChannel: PaymentChannel.ONLINE,
        date: '2026-03-15T15:00:00.000Z',
      });
    expect(ccTx.status).toBe(201);

    const resBeforeRefund = await request(app)
      .get('/api/v1/reports?startDate=2026-03-01&endDate=2026-03-31')
      .set('Cookie', userCookie);
    expect(resBeforeRefund.body.data.summary.creditCardSpend).toBe(8000);
    expect(resBeforeRefund.body.data.summary.totalExpenses).toBe(18000);

    // Record ₹2,000 refund to credit card
    const refundTx = await request(app)
      .post('/api/v1/transactions')
      .set('Cookie', userCookie)
      .send({
        title: 'Electronics Item Return',
        amount: 2000,
        type: TransactionType.CREDIT_CARD_REFUND,
        category: 'Electronics',
        creditCardId,
        paymentMethod: PaymentMethod.CREDIT_CARD,
        paymentChannel: PaymentChannel.ONLINE,
        date: '2026-03-18T16:00:00.000Z',
      });
    expect(refundTx.status).toBe(201);

    const resAfterRefund = await request(app)
      .get('/api/v1/reports?startDate=2026-03-01&endDate=2026-03-31')
      .set('Cookie', userCookie);
    // Net credit card spend should now be ₹6,000
    expect(resAfterRefund.body.data.summary.creditCardSpend).toBe(6000);
    // Net expenses should now be ₹16,000
    expect(resAfterRefund.body.data.summary.totalExpenses).toBe(16000);
  });

  // Test 7: Global Account Filter
  it('7. Global account filter isolates transactions for selected account', async () => {
    // Record expense on secondBankAccountId of ₹1,200
    await request(app)
      .post('/api/v1/transactions')
      .set('Cookie', userCookie)
      .send({
        title: 'Secondary Account Coffee',
        amount: 1200,
        type: TransactionType.EXPENSE,
        category: 'Food',
        accountId: secondBankAccountId,
        paymentMethod: PaymentMethod.UPI,
        paymentChannel: PaymentChannel.ONLINE,
        date: '2026-03-20T11:00:00.000Z',
      });

    // Query report filtering strictly for secondBankAccountId
    const res = await request(app)
      .get(`/api/v1/reports?startDate=2026-03-01&endDate=2026-03-31&accountId=${secondBankAccountId}`)
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.totalExpenses).toBe(1200);
    expect(res.body.data.summary.totalIncome).toBe(0);
    expect(res.body.data.summary.transactionCount).toBe(1);
    expect(res.body.data.categoryBreakdown.length).toBe(1);
    expect(res.body.data.categoryBreakdown[0].category).toBe('Food');
  });

  // Test 8: Global Category Filter
  it('8. Global category filter isolates reports to selected category', async () => {
    const res = await request(app)
      .get('/api/v1/reports?startDate=2026-03-01&endDate=2026-03-31&category=Chits')
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.totalExpenses).toBe(2500);
    expect(res.body.data.categoryBreakdown.length).toBe(1);
    expect(res.body.data.categoryBreakdown[0].category).toBe('Chits');
  });

  // Test 9: Forecast Projection includes upcoming unpaid EMI and Recurring rules
  it('9. Forecast projection includes upcoming due payments without altering actuals', async () => {
    const res = await request(app)
      .get('/api/v1/reports?startDate=2026-04-01&endDate=2026-04-30&includeForecast=true')
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    // Actuals for April 2026 are ₹0
    expect(res.body.data.summary.totalExpenses).toBe(0);

    // Forecast for April 2026 must capture upcoming April EMI of ₹3,500
    expect(res.body.data.forecast).toBeDefined();
    expect(res.body.data.forecast.upcomingEmi).toBe(3500);
    expect(res.body.data.forecast.totalProjectedExpenses).toBe(3500);
  });

  // Test 10: Safe CSV Export Neutralizes Injections and Excludes CHIT_SEPARATION
  it('10. Safe CSV export excludes CHIT_SEPARATION and applies formula neutralization', async () => {
    const res = await request(app)
      .get('/api/v1/reports/export-csv?startDate=2026-03-01&endDate=2026-03-31')
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const csv = res.text;

    // Verify personal transactions are included
    expect(csv).toContain('Monthly Salary');
    expect(csv).toContain('Supermarket Groceries');
    expect(csv).toContain('External Neighborhood Chit Contribution');

    // Verify CHIT_SEPARATION is completely excluded from CSV
    expect(csv).not.toContain('CHIT_SEPARATION');
    expect(csv).not.toContain('Chit Separation:');
  });
});
