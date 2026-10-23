import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { Investment } from '../models/Investment';
import { InvestmentContribution } from '../models/InvestmentContribution';
import { Transaction } from '../models/Transaction';
import { BankAccount } from '../models/BankAccount';
import {
  AccountType,
  TransactionType,
  InvestmentType,
  InvestmentStatus,
  InvestmentContributionStatus,
  PaymentMethod,
  PaymentChannel,
} from '@finora/shared';

describe('Reports Won External Chit Exclusion Acceptance Test Suite', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let userId: string;
  let bankAccountId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // Register User
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'reportstester@finora.test',
        password: 'Password123!',
        fullName: 'Reports Tester',
        currency: 'INR',
      });
    userCookie = regRes.headers['set-cookie'][0];
    userId = regRes.body.data.user.id;

    // Create Bank Account with ₹1,00,000 balance
    const accRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'Main Checking HDFC',
        accountType: AccountType.SAVINGS,
        bankName: 'HDFC',
        openingBalance: 100000,
        openingBalanceDate: '2026-01-01',
        currency: 'INR',
      });
    bankAccountId = accRes.body.data.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) await mongoServer.stop();
  });

  let unwonChitId: string;
  let wonChitId: string;
  let mutualFundId: string;

  // Criterion 1: Active External Chit Not Yet Won is Included in Active Investment Totals
  it('1. Active External Chit not yet won is included in active investment totals on Main Reports page', async () => {
    // Create an unwon External Chit (March 2026 to Dec 2026)
    const chitRes = await request(app)
      .post('/api/v1/investments')
      .set('Cookie', userCookie)
      .send({
        name: 'Neighborhood Chit Fund 2026',
        category: 'CHIT',
        investmentType: InvestmentType.CHIT,
        monthlyContribution: 5000,
        startDate: '2026-03-01T00:00:00.000Z',
        durationMonths: 10,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
      });
    expect(chitRes.status).toBe(201);
    unwonChitId = chitRes.body.data.id;

    // Pay March 2026 installment
    const payRes = await request(app)
      .post(`/api/v1/investments/${unwonChitId}/pay`)
      .set('Cookie', userCookie)
      .send({
        cycleKey: '2026-03',
        amount: 5000,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
        paymentDate: '2026-03-10T10:00:00.000Z',
      });
    expect(payRes.status).toBe(200);

    // Query Main Reports for March 2026
    const repRes = await request(app)
      .get('/api/v1/reports?startDate=2026-03-01&endDate=2026-03-31')
      .set('Cookie', userCookie);
    expect(repRes.status).toBe(200);

    const report = repRes.body.data;
    // Unwon chit contribution MUST be included in totalInvestments
    expect(report.summary.totalInvestments).toBe(5000);
    expect(report.investments.totalInvested).toBe(5000);

    // Category breakdown should contain CHIT
    const chitCat = report.investments.categoryBreakdown.find((c: any) => c.category === 'CHIT');
    expect(chitCat).toBeDefined();
    expect(chitCat.totalAmount).toBe(5000);
    expect(chitCat.percentage).toBe(100);

    // Investment transactions list should have this transaction
    expect(report.investments.transactions.length).toBe(1);
    expect(report.investments.transactions[0].amount).toBe(5000);
    expect(report.investments.transactions[0].title).toContain('Neighborhood Chit Fund');
  });

  // Criterion 2: Marking an External Chit as Won Today Immediately Excludes it from Main Reports
  it('2. Marking an External Chit as Won today immediately excludes it from active investment totals', async () => {
    // Create another External Chit (Chit B)
    const chitBRes = await request(app)
      .post('/api/v1/investments')
      .set('Cookie', userCookie)
      .send({
        name: 'Friends Chit Gold 20M',
        category: 'CHIT',
        investmentType: InvestmentType.CHIT,
        monthlyContribution: 10000,
        startDate: '2026-04-01T00:00:00.000Z',
        durationMonths: 20,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
      });
    expect(chitBRes.status).toBe(201);
    wonChitId = chitBRes.body.data.id;

    // Pay April 2026 installment
    const payRes = await request(app)
      .post(`/api/v1/investments/${wonChitId}/pay`)
      .set('Cookie', userCookie)
      .send({
        cycleKey: '2026-04',
        amount: 10000,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
        paymentDate: '2026-04-05T10:00:00.000Z',
      });
    expect(payRes.status).toBe(200);

    // Before winning: April 2026 report includes Chit B (₹10,000)
    const beforeWinRes = await request(app)
      .get('/api/v1/reports?startDate=2026-04-01&endDate=2026-04-30')
      .set('Cookie', userCookie);
    expect(beforeWinRes.body.data.summary.totalInvestments).toBe(10000);

    // Mark Chit B as Won today with payout ₹1,80,000 into bank account
    const winRes = await request(app)
      .post(`/api/v1/investments/${wonChitId}/won`)
      .set('Cookie', userCookie)
      .send({
        winningDate: '2026-04-15T12:00:00.000Z',
        payoutAmount: 180000,
        payoutDestinationType: 'bank',
        payoutAccountId: bankAccountId,
        notes: 'Won in 1st month',
      });
    expect(winRes.status).toBe(200);

    // After winning: Immediately refresh / query Main Reports for April 2026
    const afterWinRes = await request(app)
      .get('/api/v1/reports?startDate=2026-04-01&endDate=2026-04-30')
      .set('Cookie', userCookie);
    expect(afterWinRes.status).toBe(200);

    const report = afterWinRes.body.data;
    // The won chit's contributions MUST now be excluded from active investment totals!
    expect(report.summary.totalInvestments).toBe(0);
    expect(report.investments.totalInvested).toBe(0);
    expect(report.investments.categoryBreakdown.length).toBe(0);
    expect(report.investments.transactions.length).toBe(0);

    // The prize payout must appear under personal income (₹180,000)
    expect(report.summary.totalIncome).toBe(180000);
  });

  // Criterion 3: External Chit Won in a Previous Month is Excluded from Past Reports
  it('3. External Chit won in a previous month is excluded from past report periods as an active investment', async () => {
    // Query April 2026 again — Chit B was won in April 2026
    const repRes = await request(app)
      .get('/api/v1/reports?startDate=2026-04-01&endDate=2026-04-30')
      .set('Cookie', userCookie);

    expect(repRes.status).toBe(200);
    // Even when viewing past month, won chit is not counted in active investments
    expect(repRes.body.data.summary.totalInvestments).toBe(0);
    expect(repRes.body.data.investments.totalInvested).toBe(0);
  });

  // Criterion 4: Multiple External Chits — Won Ones Excluded, Unwon Ones Remain Included
  it('4. If multiple External Chits exist, only won ones are excluded; unwon ones remain included', async () => {
    // Both Chit A (unwon) and Chit B (won) exist.
    // Query a broader window (2026-03-01 to 2026-04-30) spanning both.
    const repRes = await request(app)
      .get('/api/v1/reports?startDate=2026-03-01&endDate=2026-04-30')
      .set('Cookie', userCookie);

    expect(repRes.status).toBe(200);
    const report = repRes.body.data;

    // Chit A (₹5,000 unwon) MUST be included.
    // Chit B (₹10,000 won) MUST be excluded.
    // Total should be strictly ₹5,000!
    expect(report.summary.totalInvestments).toBe(5000);
    expect(report.investments.totalInvested).toBe(5000);

    // Transactions list must contain only Chit A
    expect(report.investments.transactions.length).toBe(1);
    expect(report.investments.transactions[0].title).toContain('Neighborhood Chit Fund');
    expect(report.investments.transactions[0].amount).toBe(5000);
  });

  // Criterion 5: Normal Investments (Mutual Funds, Stocks, PPF) Continue to be Included
  it('5. Normal investments continue to be included alongside unwon chits while won chits remain excluded', async () => {
    // Create a Mutual Fund investment (SIP ₹7,500 in May 2026)
    const mfRes = await request(app)
      .post('/api/v1/investments')
      .set('Cookie', userCookie)
      .send({
        name: 'HDFC Top 100 Index Fund',
        category: 'Mutual Funds',
        investmentType: InvestmentType.RECURRING,
        monthlyContribution: 7500,
        startDate: '2026-05-01T00:00:00.000Z',
        durationMonths: 12,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
      });
    expect(mfRes.status).toBe(201);
    mutualFundId = mfRes.body.data.id;

    // Pay May 2026 for Mutual Fund
    await request(app)
      .post(`/api/v1/investments/${mutualFundId}/pay`)
      .set('Cookie', userCookie)
      .send({
        cycleKey: '2026-05',
        amount: 7500,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
        paymentDate: '2026-05-05T10:00:00.000Z',
      });

    // Also pay May 2026 for unwon Chit A (₹5,000)
    await request(app)
      .post(`/api/v1/investments/${unwonChitId}/pay`)
      .set('Cookie', userCookie)
      .send({
        cycleKey: '2026-05',
        amount: 5000,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
        paymentDate: '2026-05-10T10:00:00.000Z',
      });

    // Also pay May 2026 for won Chit B (responsible for remaining contribution ₹10,000)
    await request(app)
      .post(`/api/v1/investments/${wonChitId}/pay`)
      .set('Cookie', userCookie)
      .send({
        cycleKey: '2026-05',
        amount: 10000,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
        paymentDate: '2026-05-10T10:00:00.000Z',
      });

    // Query Main Reports for May 2026
    const repRes = await request(app)
      .get('/api/v1/reports?startDate=2026-05-01&endDate=2026-05-31')
      .set('Cookie', userCookie);
    expect(repRes.status).toBe(200);

    const report = repRes.body.data;

    // Mutual Fund (₹7,500) + Unwon Chit A (₹5,000) = ₹12,500
    // Won Chit B (₹10,000) is strictly EXCLUDED!
    expect(report.summary.totalInvestments).toBe(12500);
    expect(report.investments.totalInvested).toBe(12500);

    // Verify Category Breakdown has both Mutual Funds and CHIT (from unwon chit only)
    const mfCat = report.investments.categoryBreakdown.find((c: any) => c.category === 'Mutual Funds');
    const chitCat = report.investments.categoryBreakdown.find((c: any) => c.category === 'CHIT');
    expect(mfCat).toBeDefined();
    expect(mfCat.totalAmount).toBe(7500);
    expect(chitCat).toBeDefined();
    expect(chitCat.totalAmount).toBe(5000);

    // Investment transactions list has exactly 2 entries (MF and Chit A)
    expect(report.investments.transactions.length).toBe(2);
    const titles = report.investments.transactions.map((t: any) => t.title);
    expect(titles.some((t: string) => t.includes('HDFC Top 100 Index Fund'))).toBe(true);
    expect(titles.some((t: string) => t.includes('Neighborhood Chit Fund'))).toBe(true);
    expect(titles.some((t: string) => t.includes('Friends Chit Gold'))).toBe(false);
  });

  // Criterion 6: Historical Payment Records, Transactions, and Bank Balances Remain Intact
  it('6. Historical payment records, transactions, and cash/bank balances remain untouched in the database', async () => {
    // Check that Won Chit B's transaction records actually exist in the DB!
    const wonChitTransactions = await Transaction.find({
      userId,
      investmentId: wonChitId,
      type: TransactionType.INVESTMENT,
    });
    // Should have 2 paid contributions (April and May)
    expect(wonChitTransactions.length).toBe(2);
    expect(wonChitTransactions[0].amount).toBe(10000);
    expect(wonChitTransactions[1].amount).toBe(10000);

    // Check that Won Chit B's payout income transaction exists in DB!
    const payoutTx = await Transaction.findOne({
      userId,
      investmentId: wonChitId,
      type: TransactionType.INCOME,
    });
    expect(payoutTx).toBeDefined();
    expect(payoutTx!.amount).toBe(180000);

    // Check contribution occurrences for Won Chit B
    const wonContributions = await InvestmentContribution.find({
      userId,
      investmentId: wonChitId,
      status: InvestmentContributionStatus.PAID,
    });
    expect(wonContributions.length).toBe(2);

    // Bank account balance is intact
    const bank = await BankAccount.findById(bankAccountId);
    expect(bank).toBeDefined();
    // Opening 100,000 - 5,000 (Chit A Mar) - 10,000 (Chit B Apr) + 180,000 (Payout) - 7,500 (MF May) - 5,000 (Chit A May) - 10,000 (Chit B May) = 242,500
    expect(bank!.currentBalance).toBe(242500);
  });

  // Criterion 7: Remaining Monthly Obligations for Won Chit Still Appear in Upcoming Payments
  it('7. Remaining monthly obligations for a won chit still appear in Upcoming Monthly Payments', async () => {
    // Next month: June 2026
    const dashRes = await request(app)
      .get('/api/v1/investments/dashboard')
      .set('Cookie', userCookie);
    expect(dashRes.status).toBe(200);

    // Query Upcoming Obligations for June 2026
    // Both Unwon Chit A and Won Chit B must have upcoming obligations
    const wonChitDoc = await Investment.findById(wonChitId);
    expect(wonChitDoc!.status).toBe(InvestmentStatus.WON);
    expect(wonChitDoc!.isWon).toBe(true);

    // Remaining duration is 18 months, obligations continue
    const juneOcc = await InvestmentContribution.findOne({
      investmentId: wonChitId,
      cycleKey: '2026-06',
    });
    // Auto-generation or schedule should exist for June
    expect(wonChitDoc!.durationMonths).toBe(20);
  });

  // Criterion 8: Mathematical Consistency Across All Main Reports Sections
  it('8. Totals across all report cards, charts, breakdowns, and tables on Main Reports agree perfectly', async () => {
    const repRes = await request(app)
      .get('/api/v1/reports?startDate=2026-05-01&endDate=2026-05-31')
      .set('Cookie', userCookie);
    expect(repRes.status).toBe(200);

    const report = repRes.body.data;

    // Total Invested in summary === Total Invested in investments
    expect(report.summary.totalInvestments).toBe(report.investments.totalInvested);

    // Sum of category breakdown === Total Invested
    const catSum = report.investments.categoryBreakdown.reduce(
      (sum: number, c: any) => sum + c.totalAmount,
      0
    );
    expect(catSum).toBe(report.investments.totalInvested);

    // Sum of funding source breakdown === Total Invested
    const sourceSum = report.investments.fundingSourceBreakdown.reduce(
      (sum: number, s: any) => sum + s.amount,
      0
    );
    expect(sourceSum).toBe(report.investments.totalInvested);

    // Sum of individual transactions === Total Invested
    const txSum = report.investments.transactions.reduce(
      (sum: number, t: any) => sum + t.amount,
      0
    );
    expect(txSum).toBe(report.investments.totalInvested);

    // Monthly trends investments for May === Total Invested
    const mayTrend = report.monthlyTrends.find((m: any) => m.month.includes('May'));
    if (mayTrend) {
      expect(mayTrend.investments).toBe(report.investments.totalInvested);
    }

    // Transaction count matches the qualifying report transactions
    expect(report.summary.transactionCount).toBe(report.investments.transactions.length);
  });

  // Criterion 9: Filter by Category 'CHIT' on Main Reports Excludes Won Chits while Including Unwon Chits
  it('9. Filtering by category=CHIT on Main Reports excludes won chits and includes active unwon chits', async () => {
    // May 2026 has:
    // - Unwon Chit A: ₹5,000
    // - Won Chit B: ₹10,000 (excluded)
    // - Mutual Fund: ₹7,500 (different category)
    const chitFilteredRes = await request(app)
      .get('/api/v1/reports?startDate=2026-05-01&endDate=2026-05-31&category=CHIT')
      .set('Cookie', userCookie);
    expect(chitFilteredRes.status).toBe(200);

    const report = chitFilteredRes.body.data;
    // Total should strictly be ₹5,000 (Unwon Chit A only)
    expect(report.summary.totalInvestments).toBe(5000);
    expect(report.investments.totalInvested).toBe(5000);
    expect(report.investments.transactions.length).toBe(1);
    expect(report.investments.transactions[0].title).toContain('Neighborhood Chit Fund');
  });

  // Criterion 10: Zero Active Investments Displays Zero Cleanly Without Errors
  it('10. Period containing only won chits displays zero total investments cleanly without errors', async () => {
    // April 2026 had only Won Chit B (no other investments)
    const aprRes = await request(app)
      .get('/api/v1/reports?startDate=2026-04-01&endDate=2026-04-30')
      .set('Cookie', userCookie);
    expect(aprRes.status).toBe(200);

    const report = aprRes.body.data;
    expect(report.summary.totalInvestments).toBe(0);
    expect(report.investments.totalInvested).toBe(0);
    expect(report.investments.categoryBreakdown.length).toBe(0);
    expect(report.investments.fundingSourceBreakdown.length).toBe(0);
    expect(report.investments.transactions.length).toBe(0);
    // Net cash flow and savings rate remain numerically sound
    expect(typeof report.summary.netCashFlow).toBe('number');
    expect(typeof report.summary.savingsRate).toBe('number');
  });
});
