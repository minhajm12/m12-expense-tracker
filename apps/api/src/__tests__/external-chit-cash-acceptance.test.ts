import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { BankAccount } from '../models/BankAccount';
import { CashAccount } from '../models/CashAccount';
import { Transaction } from '../models/Transaction';
import { Investment } from '../models/Investment';
import { InvestmentContribution } from '../models/InvestmentContribution';
import {
  AccountType,
  PaymentMethod,
  PaymentChannel,
  TransactionType,
  InvestmentContributionStatus,
  InvestmentStatus,
} from '@finora/shared';

describe('Acceptance Test Suite: External Chit Lifecycle, Cash-in-Hand Accounting & Midway Range', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let userId: string;
  let pnbBankAccountId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await connectDatabase(uri);

    // Register user
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'acceptance.chit.cash@finora.test',
        password: 'Password123!',
        fullName: 'Chit Cash Tester',
        currency: 'INR',
      });

    expect(res.status).toBe(201);
    const cookies = res.headers['set-cookie'];
    userCookie = Array.isArray(cookies) ? cookies[0] : cookies;
    userId = res.body.data.user.id;

    // Create PNB Bank Account with ₹50,000
    const accRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'PNB Savings',
        bankName: 'Punjab National Bank',
        accountType: AccountType.SAVINGS,
        openingBalance: 50000,
        openingBalanceDate: '2026-06-01',
      });
    expect(accRes.status).toBe(201);
    pnbBankAccountId = accRes.body.data.id;

    // Initialize Cash in Hand with ₹10,000 baseline
    const cashRes = await request(app)
      .post('/api/v1/accounts/cash-in-hand/adjust')
      .set('Cookie', userCookie)
      .send({
        type: 'set_balance',
        amount: 10000,
        date: '2026-06-01',
        description: 'Opening Cash in Hand',
      });
    expect(cashRes.status).toBe(200);
    expect(cashRes.body.data.personalCashInHand).toBe(10000);
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  // ==========================================
  // Test Scenario A: 20-Month Chit Won in Month 1 (June 2026)
  // ==========================================
  it('Scenario A: 20-month external chit won in June 2026 retains July through month 20 as DUE and upcoming', async () => {
    const createRes = await request(app)
      .post('/api/v1/investments')
      .set('Cookie', userCookie)
      .send({
        name: '20-Month Chit Group A',
        category: 'CHIT',
        startDate: '2026-06-10',
        durationMonths: 20,
        monthlyContribution: 5000,
        isMonthlyPaymentEnabled: true,
      });

    expect(createRes.status).toBe(201);
    const chitId = createRes.body.data._id || createRes.body.data.id;

    // Verify 20 contribution occurrences generated
    const contribs = await InvestmentContribution.find({ investmentId: chitId, userId }).sort({ cycleKey: 1 });
    expect(contribs.length).toBe(20);
    expect(contribs[0].cycleKey).toBe('2026-06');
    expect(contribs[19].cycleKey).toBe('2028-01');

    // Mark June 2026 as won with ₹80,000 payout into PNB
    const wonRes = await request(app)
      .post(`/api/v1/investments/${chitId}/won`)
      .set('Cookie', userCookie)
      .send({
        winningDate: '2026-06-15',
        payoutAmount: 80000,
        payoutDestinationType: 'bank',
        payoutAccountId: pnbBankAccountId,
        payoutNotes: 'Won 1st month auction',
      });

    expect(wonRes.status).toBe(200);

    // Verify winning chit status is WON
    const wonInv = await Investment.findById(chitId);
    expect(wonInv!.isWon).toBe(true);
    expect(wonInv!.status).toBe(InvestmentStatus.WON);

    // Crucial requirement: July 2026 through month 20 (Jan 2028) MUST REMAIN DUE!
    const futureDue = await InvestmentContribution.find({
      investmentId: chitId,
      status: InvestmentContributionStatus.DUE,
    }).sort({ cycleKey: 1 });

    // June was not paid, so all 20 are still DUE (or 19 future if June paid)
    expect(futureDue.length).toBe(20);
    expect(futureDue[1].cycleKey).toBe('2026-07');
    expect(futureDue[19].cycleKey).toBe('2028-01');

    // Verify upcoming monthly obligations for July 2026 returns this won chit
    const forecastRes = await request(app)
      .get('/api/v1/analytics/upcoming-forecast?month=2026-07')
      .set('Cookie', userCookie);

    expect(forecastRes.status).toBe(200);
    const items = forecastRes.body.data.items;
    const chitItem = items.find((i: any) => i.ruleId === chitId);
    expect(chitItem).toBeTruthy();
    expect(chitItem.status).toBe('unpaid');
    expect(chitItem.expectedAmount).toBe(5000);
  });

  // ==========================================
  // Test Scenario B: Midway Historical Range (June–Sept 2026 = 4 Months = ₹20,000)
  // ==========================================
  it('Scenario B: Midway historical range June–Sept 2026 marks 4 months as historical (₹20,000) with ₹0 bank deduction', async () => {
    // Check initial PNB balance (₹50,000 initial + ₹80,000 payout from Scenario A = ₹1,30,000)
    const initialBankRes = await request(app)
      .get(`/api/v1/accounts/${pnbBankAccountId}`)
      .set('Cookie', userCookie);
    const pnbStartBalance = initialBankRes.body.data.currentBalance;

    const createRes = await request(app)
      .post('/api/v1/investments')
      .set('Cookie', userCookie)
      .send({
        name: 'Royal Gold Chit 20M',
        category: 'CHIT',
        startDate: '2026-06-10',
        durationMonths: 20,
        monthlyContribution: 5000,
        isMonthlyPaymentEnabled: true,
        historicalRange: {
          startMonth: '2026-06',
          endMonth: '2026-09',
        },
      });

    expect(createRes.status).toBe(201);
    const chitId = createRes.body.data._id || createRes.body.data.id;

    // Verify detail
    const detailRes = await request(app)
      .get(`/api/v1/investments/${chitId}`)
      .set('Cookie', userCookie);

    expect(detailRes.status).toBe(200);
    const inv = detailRes.body.data.investment;
    expect(inv.totalHistoricalContributed).toBe(20000); // 4 months * 5000 = 20,000
    expect(inv.totalActualContributed).toBe(0);
    expect(inv.totalContributionsInvested).toBe(20000);
    expect(inv.paidMonthsCount).toBe(4);
    expect(inv.unpaidMonthsCount).toBe(16);
    expect(inv.nextDueCycle).toBe('2026-10');

    // Verify PNB balance remains 100% UNTOUCHED
    const bankAfterRes = await request(app)
      .get(`/api/v1/accounts/${pnbBankAccountId}`)
      .set('Cookie', userCookie);
    expect(bankAfterRes.body.data.currentBalance).toBe(pnbStartBalance);

    // Verify Cash in Hand remains 100% UNTOUCHED at ₹10,000
    const cashRes = await request(app)
      .get('/api/v1/accounts/total-cash')
      .set('Cookie', userCookie);
    expect(cashRes.body.data.personalCashInHand).toBe(10000);
  });

  // ==========================================
  // Test Scenario C: Oct Paid via Bank (₹5,000 Debited) & Deletion Restores Balance
  // ==========================================
  it('Scenario C: October paid via bank debits ₹5,000; transaction deletion reverses bank debit and restores DUE status', async () => {
    const inv = await Investment.findOne({ name: 'Royal Gold Chit 20M', userId });
    expect(inv).toBeTruthy();

    const bankBeforeRes = await request(app)
      .get(`/api/v1/accounts/${pnbBankAccountId}`)
      .set('Cookie', userCookie);
    const balanceBeforePay = bankBeforeRes.body.data.currentBalance;

    // 1. Pay October 2026 via PNB
    const payRes = await request(app)
      .post(`/api/v1/investments/${inv!._id}/pay`)
      .set('Cookie', userCookie)
      .send({
        cycleKey: '2026-10',
        amount: 5000,
        paymentDate: '2026-10-10',
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: pnbBankAccountId,
      });

    expect(payRes.status).toBe(200);

    // Verify bank balance is debited by exactly ₹5,000
    const bankAfterPayRes = await request(app)
      .get(`/api/v1/accounts/${pnbBankAccountId}`)
      .set('Cookie', userCookie);
    expect(bankAfterPayRes.body.data.currentBalance).toBe(balanceBeforePay - 5000);

    // Verify investment totals: historical (20,000) + actual (5,000) = 25,000
    const detailAfterPay = await request(app)
      .get(`/api/v1/investments/${inv!._id}`)
      .set('Cookie', userCookie);
    expect(detailAfterPay.body.data.investment.totalHistoricalContributed).toBe(20000);
    expect(detailAfterPay.body.data.investment.totalActualContributed).toBe(5000);
    expect(detailAfterPay.body.data.investment.totalContributionsInvested).toBe(25000);

    // 2. Delete October payment transaction
    const octContribution = await InvestmentContribution.findOne({
      investmentId: inv!._id,
      cycleKey: '2026-10',
    });
    expect(octContribution!.transactionId).toBeTruthy();

    const delRes = await request(app)
      .delete(`/api/v1/transactions/${octContribution!.transactionId}`)
      .set('Cookie', userCookie);
    expect(delRes.status).toBe(200);

    // Verify bank balance is restored back
    const bankAfterDelRes = await request(app)
      .get(`/api/v1/accounts/${pnbBankAccountId}`)
      .set('Cookie', userCookie);
    expect(bankAfterDelRes.body.data.currentBalance).toBe(balanceBeforePay);

    // Verify October is restored to DUE
    const restoredContrib = await InvestmentContribution.findById(octContribution!._id);
    expect(restoredContrib!.status).toBe(InvestmentContributionStatus.DUE);

    // Verify total invested returns to ₹20,000
    const detailAfterDel = await request(app)
      .get(`/api/v1/investments/${inv!._id}`)
      .set('Cookie', userCookie);
    expect(detailAfterDel.body.data.investment.totalContributionsInvested).toBe(20000);
  });

  // ==========================================
  // Test Scenario D: Cash in Hand Contributions (Tracked vs Untracked)
  // ==========================================
  it('Scenario D1: Tracked Cash in Hand payment deducts Cash in Hand balance and NEVER debits PNB Bank', async () => {
    const inv = await Investment.findOne({ name: 'Royal Gold Chit 20M', userId });
    expect(inv).toBeTruthy();

    const bankBeforeRes = await request(app)
      .get(`/api/v1/accounts/${pnbBankAccountId}`)
      .set('Cookie', userCookie);
    const pnbBalanceBefore = bankBeforeRes.body.data.currentBalance;

    // Check cash in hand before (₹10,000)
    let cashSummary = await request(app).get('/api/v1/accounts/total-cash').set('Cookie', userCookie);
    expect(cashSummary.body.data.personalCashInHand).toBe(10000);

    // Pay October 2026 via Tracked Cash in Hand
    // Notice accountId is passed as pnbBankAccountId from form state to verify the backend NEVER debits PNB!
    const payRes = await request(app)
      .post(`/api/v1/investments/${inv!._id}/pay`)
      .set('Cookie', userCookie)
      .send({
        cycleKey: '2026-10',
        amount: 5000,
        paymentDate: '2026-10-10',
        paymentMethod: PaymentMethod.CASH,
        cashSource: 'tracked_personal_cash',
        accountId: pnbBankAccountId, // Frontend state artifact - MUST BE IGNORED by backend!
      });

    expect(payRes.status).toBe(200);

    // 1. Verify PNB Bank Account balance is completely UNTOUCHED (0 debit)
    const bankAfterRes = await request(app)
      .get(`/api/v1/accounts/${pnbBankAccountId}`)
      .set('Cookie', userCookie);
    expect(bankAfterRes.body.data.currentBalance).toBe(pnbBalanceBefore);

    // 2. Verify Tracked Cash in Hand is debited by ₹5,000 (from 10,000 to 5,000)
    cashSummary = await request(app).get('/api/v1/accounts/total-cash').set('Cookie', userCookie);
    expect(cashSummary.body.data.personalCashInHand).toBe(5000);

    // 3. Verify contribution record
    const octContribution = await InvestmentContribution.findOne({
      investmentId: inv!._id,
      cycleKey: '2026-10',
    });
    expect(octContribution!.status).toBe(InvestmentContributionStatus.PAID);
    expect(octContribution!.paymentMethod).toBe(PaymentMethod.CASH);
    expect(octContribution!.cashSource).toBe('tracked_personal_cash');
    expect(octContribution!.accountId).toBeUndefined(); // Must not have bank account linkage!
  });

  it('Scenario D2: Untracked External Cash payment marks contribution PAID with ZERO deduction from Tracked Cash in Hand or PNB', async () => {
    const inv = await Investment.findOne({ name: 'Royal Gold Chit 20M', userId });
    expect(inv).toBeTruthy();

    const bankBeforeRes = await request(app)
      .get(`/api/v1/accounts/${pnbBankAccountId}`)
      .set('Cookie', userCookie);
    const pnbBalanceBefore = bankBeforeRes.body.data.currentBalance;

    // Check cash in hand before (₹5,000)
    let cashSummary = await request(app).get('/api/v1/accounts/total-cash').set('Cookie', userCookie);
    expect(cashSummary.body.data.personalCashInHand).toBe(5000);

    // Pay November 2026 via Untracked External Cash
    const payRes = await request(app)
      .post(`/api/v1/investments/${inv!._id}/pay`)
      .set('Cookie', userCookie)
      .send({
        cycleKey: '2026-11',
        amount: 5000,
        paymentDate: '2026-11-10',
        paymentMethod: PaymentMethod.CASH,
        cashSource: 'untracked_cash',
        accountId: pnbBankAccountId, // Must be ignored!
      });

    expect(payRes.status).toBe(200);

    // 1. Verify PNB Bank Account balance remains 100% UNTOUCHED
    const bankAfterRes = await request(app)
      .get(`/api/v1/accounts/${pnbBankAccountId}`)
      .set('Cookie', userCookie);
    expect(bankAfterRes.body.data.currentBalance).toBe(pnbBalanceBefore);

    // 2. Verify Tracked Cash in Hand is NOT deducted (remains ₹5,000)
    cashSummary = await request(app).get('/api/v1/accounts/total-cash').set('Cookie', userCookie);
    expect(cashSummary.body.data.personalCashInHand).toBe(5000);

    // 3. Verify total contributed includes November: 20k historical + 5k Oct + 5k Nov = 30k
    const detailRes = await request(app)
      .get(`/api/v1/investments/${inv!._id}`)
      .set('Cookie', userCookie);
    expect(detailRes.body.data.investment.totalContributionsInvested).toBe(30000);
  });

  // ==========================================
  // Test Scenario E: Cash Withdrawal from PNB (ATM / Bank Transfer to Cash in Hand)
  // ==========================================
  it('Scenario E: Cash withdrawal from PNB debits PNB by ₹2,000, credits Cash in Hand by ₹2,000, and leaves Total Tracked Assets unchanged', async () => {
    // Current state before withdrawal:
    const initialSummary = await request(app).get('/api/v1/accounts/total-cash').set('Cookie', userCookie);
    const initialCash = initialSummary.body.data.personalCashInHand; // 5000
    const initialAssets = initialSummary.body.data.totalFinancialAssetsTracked;

    const bankBefore = await request(app).get(`/api/v1/accounts/${pnbBankAccountId}`).set('Cookie', userCookie);
    const initialPnbBalance = bankBefore.body.data.currentBalance;

    // Withdraw ₹2,000 from PNB to Cash in Hand
    const withdrawRes = await request(app)
      .post('/api/v1/accounts/cash-in-hand/adjust')
      .set('Cookie', userCookie)
      .send({
        type: 'add_cash',
        source: 'bank_account',
        bankAccountId: pnbBankAccountId,
        amount: 2000,
        date: '2026-11-15',
        description: 'ATM Cash Withdrawal',
      });

    expect(withdrawRes.status).toBe(200);

    // 1. PNB bank balance decreased by exactly ₹2,000
    const bankAfter = await request(app).get(`/api/v1/accounts/${pnbBankAccountId}`).set('Cookie', userCookie);
    expect(bankAfter.body.data.currentBalance).toBe(initialPnbBalance - 2000);

    // 2. Cash in Hand increased by exactly ₹2,000 (from 5,000 to 7,000)
    const afterSummary = await request(app).get('/api/v1/accounts/total-cash').set('Cookie', userCookie);
    expect(afterSummary.body.data.personalCashInHand).toBe(initialCash + 2000);

    // 3. Total Tracked Financial Assets is 100% UNCHANGED (net zero impact)
    expect(afterSummary.body.data.totalFinancialAssetsTracked).toBe(initialAssets);

    // 4. Verify transfer transaction was recorded
    const tx = await Transaction.findOne({
      userId,
      type: TransactionType.TRANSFER,
      accountId: pnbBankAccountId,
      amount: 2000,
    });
    expect(tx).toBeTruthy();
    expect(tx!.isExcludedFromBudget).toBe(true);

    // 5. Test clean reversal: Deleting this transfer transaction restores PNB and Cash in Hand
    const delRes = await request(app)
      .delete(`/api/v1/transactions/${tx!._id}`)
      .set('Cookie', userCookie);
    expect(delRes.status).toBe(200);

    const bankRestored = await request(app).get(`/api/v1/accounts/${pnbBankAccountId}`).set('Cookie', userCookie);
    expect(bankRestored.body.data.currentBalance).toBe(initialPnbBalance);

    const cashRestored = await request(app).get('/api/v1/accounts/total-cash').set('Cookie', userCookie);
    expect(cashRestored.body.data.personalCashInHand).toBe(initialCash);
  });

  // ==========================================
  // Test Scenario F: Cash In by Person
  // ==========================================
  it('Scenario F: Cash In by Person credits Cash in Hand by ₹1,000 with zero bank debit', async () => {
    const bankBefore = await request(app).get(`/api/v1/accounts/${pnbBankAccountId}`).set('Cookie', userCookie);
    const pnbBalanceBefore = bankBefore.body.data.currentBalance;

    const cashBefore = await request(app).get('/api/v1/accounts/total-cash').set('Cookie', userCookie);
    const cashBeforeBalance = cashBefore.body.data.personalCashInHand;

    const personRes = await request(app)
      .post('/api/v1/accounts/cash-in-hand/adjust')
      .set('Cookie', userCookie)
      .send({
        type: 'add_cash',
        source: 'person',
        personName: 'Uncle Bob',
        amount: 1000,
        date: '2026-11-20',
        description: 'Birthday Cash Gift',
      });

    expect(personRes.status).toBe(200);

    // 1. Cash in Hand increased by ₹1,000
    const cashAfter = await request(app).get('/api/v1/accounts/total-cash').set('Cookie', userCookie);
    expect(cashAfter.body.data.personalCashInHand).toBe(cashBeforeBalance + 1000);

    // 2. PNB Bank balance is 100% UNTOUCHED
    const bankAfter = await request(app).get(`/api/v1/accounts/${pnbBankAccountId}`).set('Cookie', userCookie);
    expect(bankAfter.body.data.currentBalance).toBe(pnbBalanceBefore);
  });
});
