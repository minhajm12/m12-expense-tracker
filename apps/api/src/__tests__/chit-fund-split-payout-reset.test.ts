import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { AccountType, TransactionType, PaymentMethod, PaymentChannel } from '@finora/shared';
import { ChitFundMember } from '../models/ChitFundMember';
import { ChitFundCollection } from '../models/ChitFundCollection';
import { ChitFundPayout } from '../models/ChitFundPayout';
import { ChitFundCycle } from '../models/ChitFundCycle';
import { BankAccount } from '../models/BankAccount';
import { Transaction } from '../models/Transaction';
import mongoose from 'mongoose';

describe('Mandatory Regression Suite: 25 Chit Fund Scenarios (Reset, Split Payout, Winner Management)', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let userId: string;
  let chitFundId: string;
  let designatedAccountId: string;
  let members: any[] = [];

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // Register user
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'chitpayoutreset@example.com',
        password: 'Password123!',
        fullName: 'Chit Reset Tester',
        currency: 'INR',
      });
    userCookie = regRes.headers['set-cookie'][0];
    userId = regRes.body.data.user.id;

    // Create Designated Bank Account with ₹2,00,000 initial balance
    const accRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'Chit Primary Bank',
        bankName: 'HDFC Bank',
        accountType: AccountType.SAVINGS,
        openingBalance: 200000,
        openingBalanceDate: '2026-01-01',
        isChitFundAccount: true,
      });
    designatedAccountId = accRes.body.data.id;

    // Record an unrelated personal transaction
    await request(app)
      .post('/api/v1/transactions')
      .set('Cookie', userCookie)
      .send({
        type: TransactionType.EXPENSE,
        title: 'Personal grocery shopping',
        amount: 2500,
        date: '2026-02-01',
        category: 'Food & Dining',
        paymentMethod: PaymentMethod.UPI,
        paymentChannel: PaymentChannel.ONLINE,
        accountId: designatedAccountId,
      });

    // Get default chit fund
    const fundRes = await request(app)
      .get('/api/v1/chit-fund')
      .set('Cookie', userCookie);
    chitFundId = fundRes.body.data.id;

    // Populate exactly 20 members (₹5,000 monthly contribution each)
    await ChitFundMember.deleteMany({ userId, chitFundId });

    for (let i = 1; i <= 20; i++) {
      const mRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({
          name: `Member ${i}`,
          phoneNumber: `98765432${i.toString().padStart(2, '0')}`,
          monthlyContribution: 5000,
        });
      members.push(mRes.body.data);
    }
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  // Test 1: Reset all chit financial data while preserving 20 members
  it('1. Reset all chit financial data while preserving 20 members', async () => {
    // Add a collection
    await request(app)
      .post(`/api/v1/chit-fund/${chitFundId}/collections`)
      .set('Cookie', userCookie)
      .send({
        memberId: members[0].id,
        collectionPeriod: '2026-01',
        actualAmountReceived: 5000,
        collectionDate: '2026-01-05',
        paymentMethod: 'upi',
        receivingBankAccountId: designatedAccountId,
      });

    // Check reset preview
    const previewRes = await request(app)
      .get('/api/v1/settings/chit-fund-reset-preview')
      .set('Cookie', userCookie);
    expect(previewRes.status).toBe(200);
    expect(previewRes.body.data.membersPreserved).toBe(20);
    expect(previewRes.body.data.collectionsCount).toBeGreaterThanOrEqual(1);

    // Execute reset
    const resetRes = await request(app)
      .post('/api/v1/settings/reset-chit-fund-financials')
      .set('Cookie', userCookie)
      .send({ confirmationPhrase: 'RESET CHIT FINANCIALS' });
    expect(resetRes.status).toBe(200);
    expect(resetRes.body.success).toBe(true);
    expect(resetRes.body.data.standardizedMembers).toBe(20);

    // Verify 20 members remain
    const postMembers = await ChitFundMember.find({ chitFundId, status: 'active' });
    expect(postMembers.length).toBe(20);

    // Verify financial collections are wiped
    const postCollections = await ChitFundCollection.find({ chitFundId });
    expect(postCollections.length).toBe(0);
  });

  // Test 2: Confirm personal transactions and current bank balances are unchanged by the reset
  it('2. Confirm personal transactions and current bank balances are unchanged by the reset', async () => {
    const acc = await BankAccount.findById(designatedAccountId);
    expect(acc).not.toBeNull();
    // 2,00,000 opening - 2,500 personal tx + 5,000 pre-reset collection = 2,02,500 preserved as starting balance
    expect(acc?.currentBalance).toBe(202500);

    const personalTx = await Transaction.find({ userId });
    expect(personalTx.length).toBe(1);
    expect(personalTx[0].amount).toBe(2500);
  });

  // Test 3: Confirm all 20 members have one chit each
  it('3. Confirm all 20 members have one chit each', async () => {
    const allMembers = await ChitFundMember.find({ chitFundId, status: 'active' });
    expect(allMembers.length).toBe(20);
    for (const m of allMembers) {
      expect(m.numberOfChits).toBe(1);
    }
  });

  // Test 4: Confirm each member\'s monthly contribution is ₹5,000
  it('4. Confirm each member\'s monthly contribution is ₹5,000', async () => {
    const allMembers = await ChitFundMember.find({ chitFundId, status: 'active' });
    for (const m of allMembers) {
      expect(m.totalExpectedPerPeriod).toBe(5000);
    }
  });

  // Test 5: Confirm expected monthly collection is ₹1,00,000
  it('5. Confirm expected monthly collection is ₹1,00,000', async () => {
    const summaryRes = await request(app)
      .get(`/api/v1/chit-fund/${chitFundId}/summary`)
      .set('Cookie', userCookie);
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.data.expectedCollectionPerPeriod).toBe(100000);
  });

  // Test 6: Confirm dashboard shows 20 total chits, not 25
  it('6. Confirm dashboard shows 20 total chits, not 25', async () => {
    const summaryRes = await request(app)
      .get(`/api/v1/chit-fund/${chitFundId}/summary`)
      .set('Cookie', userCookie);
    expect(summaryRes.body.data.totalActiveChits).toBe(20);
    expect(summaryRes.body.data.totalActiveMembers).toBe(20);
  });

  // Test 7: Reset a monthly winner and confirm its pill disappears immediately
  it('7. Reset a monthly winner and confirm its status resets', async () => {
    // Confirm winner for 2026-03
    await request(app)
      .post(`/api/v1/chit-fund/${chitFundId}/cycles/2026-03/confirm-winner`)
      .set('Cookie', userCookie)
      .send({
        memberId: members[0].id,
        winDate: '2026-03-15',
      });

    let cycle = await ChitFundCycle.findOne({ chitFundId, cyclePeriod: '2026-03' });
    expect(cycle?.winnerMemberId?.toString()).toBe(members[0].id);

    // Reset winner via settings endpoint
    const resetWinnerRes = await request(app)
      .post('/api/v1/settings/reset-chit-winner-month')
      .set('Cookie', userCookie)
      .send({
        chitFundId,
        cyclePeriod: '2026-03',
      });
    expect(resetWinnerRes.status).toBe(200);

    cycle = await ChitFundCycle.findOne({ chitFundId, cyclePeriod: '2026-03' });
    expect(cycle?.winnerMemberId).toBeUndefined();
    expect(cycle?.winnerMemberName).toBeUndefined();
    expect(cycle?.winnerNotes).toBeUndefined();
  });

  // Test 8: Assign a new winner after reset and confirm no correction note appears
  it('8. Assign a new winner after reset and confirm no correction note appears', async () => {
    const assignRes = await request(app)
      .post(`/api/v1/chit-fund/${chitFundId}/cycles/2026-03/confirm-winner`)
      .set('Cookie', userCookie)
      .send({
        memberId: members[1].id,
        winDate: '2026-03-15',
      });
    expect(assignRes.status).toBe(200);

    const cycle = await ChitFundCycle.findOne({ chitFundId, cyclePeriod: '2026-03' });
    expect(cycle?.winnerMemberId?.toString()).toBe(members[1].id);
    expect(cycle?.winnerNotes).toBeUndefined();
    expect(cycle?.notes).toBeUndefined();
  });

  // Test 9: Correct an existing winner and confirm the correction note appears only in that workflow
  it('9. Correct an existing winner and confirm correction note appears only in that workflow', async () => {
    const correctRes = await request(app)
      .post(`/api/v1/chit-fund/${chitFundId}/cycles/2026-03/correct-winner`)
      .set('Cookie', userCookie)
      .send({
        newMemberId: members[2].id,
        reason: 'Original winner was entered in error',
        winDate: '2026-03-15',
      });
    expect(correctRes.status).toBe(200);

    const cycle = await ChitFundCycle.findOne({ chitFundId, cyclePeriod: '2026-03' });
    expect(cycle?.winnerMemberId?.toString()).toBe(members[2].id);
    expect(cycle?.winnerNotes).toContain('Corrected from');
    expect(cycle?.winnerNotes).toContain('Original winner was entered in error');
  });

  // Test 10: Confirm every winning date is the 15th of its selected month
  it('10. Confirm every winning date is the 15th of its selected month', async () => {
    await request(app)
      .post(`/api/v1/chit-fund/${chitFundId}/cycles/2026-04/confirm-winner`)
      .set('Cookie', userCookie)
      .send({
        memberId: members[3].id,
        winDate: '2026-04-28', // Even if frontend sends 28th, prizeTakingDate is strictly the 15th
      });

    const cycle = await ChitFundCycle.findOne({ chitFundId, cyclePeriod: '2026-04' });
    expect(new Date(cycle!.prizeTakingDate).getUTCDate()).toBe(15);
  });

  // Test 11: Record ₹40,000 cash + ₹60,000 UPI payout against ₹1,00,000 total
  it('11. Record ₹40,000 cash + ₹60,000 UPI payout against ₹1,00,000 total', async () => {
    await request(app)
      .post(`/api/v1/chit-fund/${chitFundId}/cycles/2026-05/confirm-winner`)
      .set('Cookie', userCookie)
      .send({
        memberId: members[4].id,
      });

    const payoutRes = await request(app)
      .post(`/api/v1/chit-fund/${chitFundId}/payouts`)
      .set('Cookie', userCookie)
      .send({
        recipientName: members[4].name,
        memberId: members[4].id,
        payoutPeriod: '2026-05',
        amount: 100000,
        cashAmount: 40000,
        upiAmount: 60000,
        sourceBankAccountId: designatedAccountId,
        status: 'completed',
        payoutDate: '2026-05-15',
      });

    expect(payoutRes.status).toBe(201);
    expect(payoutRes.body.data.amount).toBe(100000);
    expect(payoutRes.body.data.cashAmount).toBe(40000);
    expect(payoutRes.body.data.upiAmount).toBe(60000);
  });

  // Test 12: Confirm bank balance decreases by ₹60,000, not ₹1,00,000
  it('12. Confirm bank balance decreases by ₹60,000, not ₹1,00,000', async () => {
    const acc = await BankAccount.findById(designatedAccountId);
    // 200,000 opening - 2,500 personal tx - 60,000 UPI payout = 1,37,500 (decreased by ₹60,000, not ₹1,00,000)
    expect(acc?.currentBalance).toBe(137500);
  });

  // Test 13: Confirm chit Cash in Hand decreases by ₹40,000
  it('13. Confirm chit Cash in Hand calculation reflects ₹40,000 cash payout', async () => {
    // Record ₹50,000 cash collection to establish cash pool
    await request(app)
      .post(`/api/v1/chit-fund/${chitFundId}/collections`)
      .set('Cookie', userCookie)
      .send({
        memberId: members[5].id,
        collectionPeriod: '2026-05',
        actualAmountReceived: 50000,
        collectionDate: '2026-05-05',
        paymentMethod: 'cash_in_hand',
      });

    const summaryRes = await request(app)
      .get(`/api/v1/chit-fund/${chitFundId}/summary`)
      .set('Cookie', userCookie);

    // totalCashCollected = 50,000, totalCashPayouts = 40,000 => cashInHandChitFunds = 10,000
    expect(summaryRes.body.data.cashInHandChitFunds).toBe(10000);
  });

  // Test 14: Record a full-cash payout and confirm bank balance is unchanged
  it('14. Record a full-cash payout and confirm bank balance is unchanged', async () => {
    const balanceBefore = (await BankAccount.findById(designatedAccountId))!.currentBalance;

    await request(app)
      .post(`/api/v1/chit-fund/${chitFundId}/cycles/2026-06/confirm-winner`)
      .set('Cookie', userCookie)
      .send({ memberId: members[6].id });

    const cashPayoutRes = await request(app)
      .post(`/api/v1/chit-fund/${chitFundId}/payouts`)
      .set('Cookie', userCookie)
      .send({
        recipientName: members[6].name,
        memberId: members[6].id,
        payoutPeriod: '2026-06',
        amount: 10000,
        cashAmount: 10000,
        upiAmount: 0,
        status: 'completed',
        payoutDate: '2026-06-15',
      });
    expect(cashPayoutRes.status).toBe(201);

    const balanceAfter = (await BankAccount.findById(designatedAccountId))!.currentBalance;
    expect(balanceAfter).toBe(balanceBefore);
  });

  // Test 15: Record a full-UPI payout and confirm only the bank balance is reduced appropriately
  it('15. Record a full-UPI payout and confirm only bank balance is reduced', async () => {
    const balanceBefore = (await BankAccount.findById(designatedAccountId))!.currentBalance;

    await request(app)
      .post(`/api/v1/chit-fund/${chitFundId}/cycles/2026-07/confirm-winner`)
      .set('Cookie', userCookie)
      .send({ memberId: members[7].id });

    const upiPayoutRes = await request(app)
      .post(`/api/v1/chit-fund/${chitFundId}/payouts`)
      .set('Cookie', userCookie)
      .send({
        recipientName: members[7].name,
        memberId: members[7].id,
        payoutPeriod: '2026-07',
        amount: 25000,
        cashAmount: 0,
        upiAmount: 25000,
        sourceBankAccountId: designatedAccountId,
        status: 'completed',
        payoutDate: '2026-07-15',
      });
    expect(upiPayoutRes.status).toBe(201);

    const balanceAfter = (await BankAccount.findById(designatedAccountId))!.currentBalance;
    expect(balanceAfter).toBe(balanceBefore - 25000);
  });

  // Test 16: Manually assign a previous winner with Already Paid Out enabled
  it('16. Manually assign a previous winner with Already Paid Out enabled', async () => {
    const assignHistoricalRes = await request(app)
      .post(`/api/v1/chit-fund/${chitFundId}/cycles/2026-01/confirm-winner`)
      .set('Cookie', userCookie)
      .send({
        memberId: members[8].id,
        winDate: '2026-01-15',
        alreadyPaidOut: true,
      });
    expect(assignHistoricalRes.status).toBe(200);

    const cycle = await ChitFundCycle.findOne({ chitFundId, cyclePeriod: '2026-01' });
    expect(cycle?.status).toBe('completed');
  });

  // Test 17: Confirm historical payout shows Paid and records the full amount
  it('17. Confirm historical payout shows Paid and records full ₹1,00,000 amount', async () => {
    const historicalPayout = await ChitFundPayout.findOne({
      chitFundId,
      payoutPeriod: '2026-01',
      isHistorical: true,
    });
    expect(historicalPayout).not.toBeNull();
    expect(historicalPayout?.status).toBe('completed');
    expect(historicalPayout?.amount).toBe(100000);
    expect(historicalPayout?.isHistorical).toBe(true);
  });

  // Test 18: Confirm historical payout does not affect current bank or cash balances
  it('18. Confirm historical payout does not affect current bank or cash balances', async () => {
    const bankBalance = (await BankAccount.findById(designatedAccountId))!.currentBalance;
    const summaryRes = await request(app)
      .get(`/api/v1/chit-fund/${chitFundId}/summary`)
      .set('Cookie', userCookie);

    // Bank balance should not be decremented by ₹1,00,000 from historical payout (137500 - 25000 = 112500)
    expect(bankBalance).toBe(112500);
    // Historical payout does not deduct live money held
    expect(summaryRes.body.data.totalBankPayouts).toBe(85000); // 60000 + 25000
  });

  // Test 19: Confirm historical payout cannot accidentally be paid twice
  it('19. Confirm duplicate winner assignment on historical payout cycle preserves single payout', async () => {
    const dupRes = await request(app)
      .post(`/api/v1/chit-fund/${chitFundId}/payouts`)
      .set('Cookie', userCookie)
      .send({
        recipientName: members[9].name,
        memberId: members[9].id,
        payoutPeriod: '2026-01',
        amount: 100000,
        cashAmount: 50000,
        upiAmount: 50000,
        sourceBankAccountId: designatedAccountId,
        status: 'completed',
        payoutDate: '2026-01-15',
      });
    expect(dupRes.status).toBe(400);

    const count = await ChitFundPayout.countDocuments({ chitFundId, payoutPeriod: '2026-01' });
    expect(count).toBe(1);
  });

  // Test 20: Confirm separation features and ledger entries are completely removed
  it('20. Confirm separation features and ledger entries are completely removed', async () => {
    const collections = await mongoose.connection.db?.listCollections().toArray();
    const collectionNames = collections?.map((c) => c.name) || [];
    if (collectionNames.includes('chitfundledgers')) {
      const count = await mongoose.connection.db?.collection('chitfundledgers').countDocuments();
      expect(count).toBe(0);
    }
  });

  // Test 21: Confirm literal &bull; and similar entity artifacts are absent from APIs
  it('21. Confirm no unescaped HTML entities are emitted in summary or responses', async () => {
    const summaryRes = await request(app)
      .get(`/api/v1/chit-fund/${chitFundId}/summary`)
      .set('Cookie', userCookie);
    const bodyText = JSON.stringify(summaryRes.body);
    expect(bodyText).not.toContain('&bull;');
    expect(bodyText).not.toContain('&quot;');
  });

  // Test 22: Confirm editing a member cannot multiply or accumulate their contribution
  it('22. Confirm editing a member cannot multiply or accumulate their contribution', async () => {
    const targetMember = members[10];

    // Edit 1: change phone
    const edit1 = await request(app)
      .patch(`/api/v1/chit-fund/${chitFundId}/members/${targetMember.id}`)
      .set('Cookie', userCookie)
      .send({
        name: targetMember.name,
        monthlyContribution: 5000,
        phoneNumber: '9999999999',
      });
    expect(edit1.status).toBe(200);
    expect(edit1.body.data.totalExpectedPerPeriod).toBe(5000);

    // Edit 2: save again without changes
    const edit2 = await request(app)
      .patch(`/api/v1/chit-fund/${chitFundId}/members/${targetMember.id}`)
      .set('Cookie', userCookie)
      .send({
        name: targetMember.name,
        monthlyContribution: 5000,
        phoneNumber: '9999999999',
      });
    expect(edit2.status).toBe(200);
    expect(edit2.body.data.totalExpectedPerPeriod).toBe(5000);

    const checkMember = await ChitFundMember.findById(targetMember.id);
    expect(checkMember?.totalExpectedPerPeriod).toBe(5000);
  });

  // Test 23: Confirm payout edits and deletions do not double-deduct or double-credit balances
  it('23. Confirm payout edits and deletions do not double-deduct or double-credit balances', async () => {
    await request(app)
      .post(`/api/v1/chit-fund/${chitFundId}/cycles/2026-08/confirm-winner`)
      .set('Cookie', userCookie)
      .send({ memberId: members[11].id });

    const balanceStart = (await BankAccount.findById(designatedAccountId))!.currentBalance;

    const createPayout = await request(app)
      .post(`/api/v1/chit-fund/${chitFundId}/payouts`)
      .set('Cookie', userCookie)
      .send({
        recipientName: members[11].name,
        memberId: members[11].id,
        payoutPeriod: '2026-08',
        amount: 20000,
        cashAmount: 5000,
        upiAmount: 15000,
        sourceBankAccountId: designatedAccountId,
        status: 'completed',
        payoutDate: '2026-08-15',
      });
    const payoutId = createPayout.body.data.id;

    let balance = (await BankAccount.findById(designatedAccountId))!.currentBalance;
    expect(balance).toBe(balanceStart - 15000);

    // Delete payout
    await request(app)
      .delete(`/api/v1/chit-fund/${chitFundId}/payouts/${payoutId}`)
      .set('Cookie', userCookie);

    balance = (await BankAccount.findById(designatedAccountId))!.currentBalance;
    expect(balance).toBe(balanceStart); // Cleanly reverted
  });

  // Test 24: Confirm duplicate API submissions cannot create duplicate payouts
  it('24. Confirm duplicate payout submission for the same cycle is rejected', async () => {
    await request(app)
      .post(`/api/v1/chit-fund/${chitFundId}/cycles/2026-09/confirm-winner`)
      .set('Cookie', userCookie)
      .send({ winnerMemberId: members[12].id });

    const p1 = await request(app)
      .post(`/api/v1/chit-fund/${chitFundId}/payouts`)
      .set('Cookie', userCookie)
      .send({
        recipientName: members[12].name,
        memberId: members[12].id,
        payoutPeriod: '2026-09',
        amount: 100000,
        cashAmount: 50000,
        upiAmount: 50000,
        sourceBankAccountId: designatedAccountId,
        status: 'completed',
        payoutDate: '2026-09-15',
      });
    expect(p1.status).toBe(201);

    // Duplicate submission
    const p2 = await request(app)
      .post(`/api/v1/chit-fund/${chitFundId}/payouts`)
      .set('Cookie', userCookie)
      .send({
        recipientName: members[12].name,
        memberId: members[12].id,
        payoutPeriod: '2026-09',
        amount: 100000,
        cashAmount: 50000,
        upiAmount: 50000,
        sourceBankAccountId: designatedAccountId,
        status: 'completed',
        payoutDate: '2026-09-15',
      });
    expect(p2.status).toBe(400);
    expect(p2.body.error.code).toBe('PAYOUT_ALREADY_EXISTS');
  });

  // Test 25: Confirm the monthly cycle and winning dates behave correctly in Asia/Kolkata
  it('25. Confirm the monthly cycle and winning dates behave correctly in Asia/Kolkata', async () => {
    await request(app)
      .post(`/api/v1/chit-fund/${chitFundId}/cycles/2026-10/confirm-winner`)
      .set('Cookie', userCookie)
      .send({ memberId: members[13].id });

    const cycle = await ChitFundCycle.findOne({ chitFundId, cyclePeriod: '2026-10' });
    expect(cycle).not.toBeNull();
    const winDate = new Date(cycle!.prizeTakingDate);

    // Formatted in Asia/Kolkata, the day must strictly be the 15th
    const kolkataDay = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    }).format(winDate);

    expect(kolkataDay).toBe('15/10/2026');
  });
});
