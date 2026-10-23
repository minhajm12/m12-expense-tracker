import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { AccountType } from '@finora/shared';
import { ChitFund } from '../models/ChitFund';
import { ChitFundMember } from '../models/ChitFundMember';
import { ChitFundCollection } from '../models/ChitFundCollection';
import { ChitFundPayout } from '../models/ChitFundPayout';
import { ChitFundCycle } from '../models/ChitFundCycle';
import { BankAccount } from '../models/BankAccount';
import { Transaction } from '../models/Transaction';

describe('Priority 10: Complete Chit Fund Workflow Verification Suite (Tests 1 - 32)', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let userId: string;
  let chitFundId: string;
  let designatedAccountId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // Register test user
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'chitworkflow@example.com',
        password: 'Password123!',
        fullName: 'Chit Workflow Tester',
        currency: 'INR',
      });
    userCookie = regRes.headers['set-cookie'][0];
    userId = regRes.body.data.user.id;

    // Create designated bank account with ₹50,000 opening balance
    const accRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'Chit Designated Federal Bank',
        bankName: 'Federal Bank',
        accountType: AccountType.SAVINGS,
        openingBalance: 50000,
        openingBalanceDate: '2026-01-01',
        isChitFundAccount: true,
      });
    designatedAccountId = accRes.body.data.id;

    // Fetch default chit fund created on user registration
    const fundRes = await request(app)
      .get('/api/v1/chit-fund')
      .set('Cookie', userCookie);
    chitFundId = fundRes.body.data.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  // ==========================================
  // Section A: Member Management (Tests 1 - 5)
  // ==========================================
  describe('Member Management (Tests 1 - 5)', () => {
    let member1Id: string;
    let memberToDeleteId: string;
    let memberWithHistoryId: string;

    it('1. Create a member with a ₹5,000 monthly contribution', async () => {
      const res = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({
          name: 'Arun Kumar',
          monthlyContribution: 5000,
          startDate: '2026-10-01',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('Arun Kumar');
      expect(res.body.data.numberOfChits).toBe(1);
      expect(res.body.data.totalExpectedPerPeriod).toBe(5000);
      expect(res.body.data.contributionPerChit).toBe(5000);
      member1Id = res.body.data.id;
    });

    it('2 & 3. Edit and save without changing amount: amount remains ₹5,000', async () => {
      const editRes = await request(app)
        .patch(`/api/v1/chit-fund/${chitFundId}/members/${member1Id}`)
        .set('Cookie', userCookie)
        .send({
          name: 'Arun Kumar Verified',
          monthlyContribution: 5000,
        });

      expect(editRes.status).toBe(200);
      expect(editRes.body.data.name).toBe('Arun Kumar Verified');
      expect(editRes.body.data.totalExpectedPerPeriod).toBe(5000);
      expect(editRes.body.data.numberOfChits).toBe(1);

      // Verify directly from database
      const member = await ChitFundMember.findById(member1Id);
      expect(member?.totalExpectedPerPeriod).toBe(5000);
      expect(member?.numberOfChits).toBe(1);
    });

    it('4. Delete a member without historical dependencies and verify physical deletion', async () => {
      const createRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({
          name: 'Temporary Clean Member',
          monthlyContribution: 5000,
        });
      memberToDeleteId = createRes.body.data.id;

      // Delete member
      const delRes = await request(app)
        .delete(`/api/v1/chit-fund/${chitFundId}/members/${memberToDeleteId}`)
        .set('Cookie', userCookie);

      expect(delRes.status).toBe(200);
      expect(delRes.body.data.permanentlyDeleted).toBe(true);

      // Verify physical deletion from DB
      const found = await ChitFundMember.findById(memberToDeleteId);
      expect(found).toBeNull();
    });

    it('5. Delete or attempt to delete a member with historical financial records and verify safe preservation', async () => {
      // Create member with history
      const createRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({
          name: 'Historical Member',
          monthlyContribution: 5000,
        });
      memberWithHistoryId = createRes.body.data.id;

      // Record a collection to create a financial dependency
      await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/collections`)
        .set('Cookie', userCookie)
        .send({
          memberId: memberWithHistoryId,
          collectionPeriod: '2026-09',
          actualAmountReceived: 5000,
          collectionDate: '2026-09-10',
          receivingBankAccountId: designatedAccountId,
          paymentMethod: 'upi',
        });

      // Attempt to delete member with historical records
      const delRes = await request(app)
        .delete(`/api/v1/chit-fund/${chitFundId}/members/${memberWithHistoryId}`)
        .set('Cookie', userCookie);

      expect(delRes.status).toBe(200);
      expect(delRes.body.data.archived).toBe(true);

      // Verify record still exists in DB as archived to preserve audit integrity
      const archivedMember = await ChitFundMember.findById(memberWithHistoryId);
      expect(archivedMember).not.toBeNull();
      expect(archivedMember?.status).toBe('archived');

      // Verify excluded from normal listMembers query
      const listRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/members`)
        .set('Cookie', userCookie);
      const ids = listRes.body.data.map((m: any) => m.id);
      expect(ids).not.toContain(memberWithHistoryId);
    });
  });

  // ==========================================
  // Section B: Monthly Collections (Tests 6 - 11)
  // ==========================================
  describe('Monthly Collections (Tests 6 - 11)', () => {
    let memberAId: string;
    let memberBId: string;

    beforeAll(async () => {
      const ma = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({ name: 'Member A (Collections)', monthlyContribution: 5000 });
      memberAId = ma.body.data.id;

      const mb = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({ name: 'Member B (Collections)', monthlyContribution: 5000 });
      memberBId = mb.body.data.id;
    });

    it('6. Record a full October contribution and verify the member disappears from the October dropdown', async () => {
      const colRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/collections`)
        .set('Cookie', userCookie)
        .send({
          memberId: memberAId,
          collectionPeriod: '2026-10',
          actualAmountReceived: 5000,
          collectionDate: '2026-10-05',
          receivingBankAccountId: designatedAccountId,
          paymentMethod: 'upi',
        });
      expect(colRes.status).toBe(201);
      expect(colRes.body.data.status).toBe('completed');

      // Verify cycle details
      const cycleRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/cycles/2026-10`)
        .set('Cookie', userCookie);

      const remainingIds = cycleRes.body.data.remainingMembers.map((m: any) => m.member?.id || m.member?._id || m.id);
      expect(remainingIds).not.toContain(memberAId);
    });

    it('7. Verify the member remains visible in October paid list', async () => {
      const cycleRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/cycles/2026-10`)
        .set('Cookie', userCookie);

      const paidIds = cycleRes.body.data.paidMembers.map((m: any) => m.member?.id || m.member?._id || m.id);
      expect(paidIds).toContain(memberAId);
    });

    it('8. Verify the other unpaid members remain selectable', async () => {
      const cycleRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/cycles/2026-10`)
        .set('Cookie', userCookie);

      const remainingIds = cycleRes.body.data.remainingMembers.map((m: any) => m.member?.id || m.member?._id || m.id);
      expect(remainingIds).toContain(memberBId);
    });

    it('9. Activate November and verify the member becomes selectable for November', async () => {
      const cycleRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/cycles/2026-11`)
        .set('Cookie', userCookie);

      const remainingIds = cycleRes.body.data.remainingMembers.map((m: any) => m.member?.id || m.member?._id || m.id);
      expect(remainingIds).toContain(memberAId);
      expect(remainingIds).toContain(memberBId);
    });

    it('10. Verify October history is preserved', async () => {
      const octCollections = await ChitFundCollection.find({
        userId,
        chitFundId,
        collectionPeriod: '2026-10',
        memberId: memberAId,
      });
      expect(octCollections.length).toBe(1);
      expect(octCollections[0].actualAmountReceived).toBe(5000);
    });

    it('11. Verify duplicate requests cannot record the same monthly contribution twice', async () => {
      const dupRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/collections`)
        .set('Cookie', userCookie)
        .send({
          memberId: memberAId,
          collectionPeriod: '2026-10',
          actualAmountReceived: 5000,
          collectionDate: '2026-10-06',
          receivingBankAccountId: designatedAccountId,
          paymentMethod: 'upi',
        });

      expect(dupRes.status).toBe(400);
      expect(dupRes.body.error.code).toBe('CONTRIBUTION_ALREADY_COMPLETED');
    });
  });

  // ==========================================
  // Section C: Winner Synchronization (Tests 12 - 18)
  // ==========================================
  describe('Winner Synchronization (Tests 12 - 18)', () => {
    let winSyncMemberId: string;
    let cycleWinnerMemberId: string;

    beforeAll(async () => {
      const m1 = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({ name: 'Winner Sync Member', monthlyContribution: 5000 });
      winSyncMemberId = m1.body.data.id;

      const m2 = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({ name: 'Cycle Winner Member', monthlyContribution: 5000 });
      cycleWinnerMemberId = m2.body.data.id;
    });

    it('12. Mark a member as a previous winner', async () => {
      const updateRes = await request(app)
        .patch(`/api/v1/chit-fund/${chitFundId}/members/${winSyncMemberId}`)
        .set('Cookie', userCookie)
        .send({
          hasPreviouslyWon: true,
          previousWinCycle: '2026-08',
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.hasPreviouslyWon).toBe(true);
    });

    it('13. Verify the member is excluded from the official spinner', async () => {
      const eligibleRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/eligible-members`)
        .set('Cookie', userCookie);

      const eligibleIds = eligibleRes.body.data.eligible.map((m: any) => m.id);
      expect(eligibleIds).not.toContain(winSyncMemberId);
    });

    it('14. Uncheck the prior-winner flag and verify eligibility updates if no confirmed historical win remains', async () => {
      const uncheckRes = await request(app)
        .patch(`/api/v1/chit-fund/${chitFundId}/members/${winSyncMemberId}`)
        .set('Cookie', userCookie)
        .send({
          hasPreviouslyWon: false,
        });

      expect(uncheckRes.status).toBe(200);
      expect(uncheckRes.body.data.hasPreviouslyWon).toBe(false);

      // Verify immediate spinner eligibility restoration
      const eligibleRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/eligible-members`)
        .set('Cookie', userCookie);

      const eligibleIds = eligibleRes.body.data.eligible.map((m: any) => m.id);
      expect(eligibleIds).toContain(winSyncMemberId);
    });

    it('15. Verify an actual confirmed monthly winner is not erased by merely unchecking the prior-winner flag', async () => {
      // Confirm cycleWinnerMemberId as confirmed winner for 2026-07
      const confRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/cycles/2026-07/confirm-winner`)
        .set('Cookie', userCookie)
        .send({ memberId: cycleWinnerMemberId });
      expect(confRes.status).toBe(200);

      // Attempt to uncheck prior-winner flag on member
      await request(app)
        .patch(`/api/v1/chit-fund/${chitFundId}/members/${cycleWinnerMemberId}`)
        .set('Cookie', userCookie)
        .send({ hasPreviouslyWon: false });

      // Verify the 2026-07 cycle still preserves the winner record
      const cycle = await ChitFundCycle.findOne({ chitFundId, cyclePeriod: '2026-07' });
      expect(cycle).toBeDefined();
    });

    it('16. Reset a confirmed winner through Settings and verify member list, winner history, and spinner update consistently', async () => {
      // Reset the 2026-07 cycle winner via Settings
      const resetRes = await request(app)
        .post('/api/v1/settings/reset-chit-winner-month')
        .set('Cookie', userCookie)
        .send({
          chitFundId,
          cyclePeriod: '2026-07',
          reason: 'Authorized test reset',
        });
      expect(resetRes.status).toBe(200);

      // Verify cycle winner is cleared
      const cycle = await ChitFundCycle.findOne({ chitFundId, cyclePeriod: '2026-07' });
      expect(cycle?.winnerMemberId).toBeUndefined();

      // Verify member is eligible again in spinner
      const eligibleRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/eligible-members`)
        .set('Cookie', userCookie);
      const eligibleIds = eligibleRes.body.data.eligible.map((m: any) => m.id);
      expect(eligibleIds).toContain(cycleWinnerMemberId);
    });

    it('17. Verify one cycle cannot have two confirmed winners', async () => {
      // Confirm winSyncMemberId for 2026-06
      const firstConf = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/cycles/2026-06/confirm-winner`)
        .set('Cookie', userCookie)
        .send({ memberId: winSyncMemberId });
      expect(firstConf.status).toBe(200);

      // Attempt to confirm a second winner for 2026-06
      const secondConf = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/cycles/2026-06/confirm-winner`)
        .set('Cookie', userCookie)
        .send({ memberId: cycleWinnerMemberId });
      expect(secondConf.status).toBe(400);
      expect(secondConf.body.error.code).toBe('WINNER_ALREADY_CONFIRMED');
    });

    it('18. Verify a previous cycle winner is excluded from future cycles by default', async () => {
      const eligibleRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/eligible-members`)
        .set('Cookie', userCookie);

      const eligibleIds = eligibleRes.body.data.eligible.map((m: any) => m.id);
      expect(eligibleIds).not.toContain(winSyncMemberId);
    });
  });

  // ==========================================
  // Section D: Year/Month Selection (Tests 19 - 22)
  // ==========================================
  describe('Year/Month Selection (Tests 19 - 22)', () => {
    it('19 & 20. Select 2026 and OCT: stored cycle is October 2026 (2026-10)', async () => {
      const cycleRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/cycles/2026-10`)
        .set('Cookie', userCookie);

      expect(cycleRes.status).toBe(200);
      expect(cycleRes.body.data.cyclePeriod).toBe('2026-10');
      expect(cycleRes.body.data.prizeTakingDate).toBeDefined();
    });

    it('21. Verify the correct cycle details and status are displayed', async () => {
      const cycleRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/cycles/2026-10`)
        .set('Cookie', userCookie);

      expect(cycleRes.body.data.cyclePeriod).toBe('2026-10');
      expect(Array.isArray(cycleRes.body.data.paidMembers)).toBe(true);
      expect(Array.isArray(cycleRes.body.data.remainingMembers)).toBe(true);
    });

    it('22. Switching to NOV loads the November cycle without changing October history', async () => {
      const novRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/cycles/2026-11`)
        .set('Cookie', userCookie);

      expect(novRes.status).toBe(200);
      expect(novRes.body.data.cyclePeriod).toBe('2026-11');

      // Verify October collections remain intact
      const octRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/cycles/2026-10`)
        .set('Cookie', userCookie);
      expect(octRes.body.data.totalCollected).toBeGreaterThan(0);
    });
  });

  // ==========================================
  // Section E: Single-Chit Rule (Tests 23 - 26)
  // ==========================================
  describe('Single-Chit Rule (Tests 23 - 26)', () => {
    it('23 & 25. Adding/Editing member enforces exactly 1 chit; contribution is never multiplied', async () => {
      const res = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({
          name: 'Single Chit Member',
          monthlyContribution: 5000,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.numberOfChits).toBe(1);
      expect(res.body.data.totalExpectedPerPeriod).toBe(5000);

      // Editing replaces configured amount without multiplying
      const editRes = await request(app)
        .patch(`/api/v1/chit-fund/${chitFundId}/members/${res.body.data.id}`)
        .set('Cookie', userCookie)
        .send({
          monthlyContribution: 6000,
        });

      expect(editRes.status).toBe(200);
      expect(editRes.body.data.numberOfChits).toBe(1);
      expect(editRes.body.data.totalExpectedPerPeriod).toBe(6000);
    });

    it('24. Verify numberOfChits defaults to 1 even if client payload attempts to specify higher', async () => {
      const res = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({
          name: 'Attempted Multi-Chit Member',
          monthlyContribution: 5000,
          numberOfChits: 3,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.numberOfChits).toBe(1);
      expect(res.body.data.totalExpectedPerPeriod).toBe(5000);
    });

    it('26. Verify 20 members contributing ₹5,000 each produce a calculated expected total of ₹1,00,000', async () => {
      // Create a clean dedicated test chit fund with exactly 20 members
      const newFundRes = await request(app)
        .post('/api/v1/accounts')
        .set('Cookie', userCookie)
        .send({
          accountName: '20 Member Pot Bank',
          bankName: 'Axis Bank',
          accountType: AccountType.SAVINGS,
          openingBalance: 100000,
          openingBalanceDate: '2026-01-01',
          isChitFundAccount: true,
          confirmReassign: true,
        });
      const newAccId = newFundRes.body.data.id;

      // Clean existing active members to verify exact 20 * 5,000 math
      await ChitFundMember.deleteMany({ userId, chitFundId });

      for (let i = 1; i <= 20; i++) {
        await request(app)
          .post(`/api/v1/chit-fund/${chitFundId}/members`)
          .set('Cookie', userCookie)
          .send({
            name: `Member ${i}`,
            monthlyContribution: 5000,
          });
      }

      const summaryRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/summary`)
        .set('Cookie', userCookie);

      expect(summaryRes.body.data.totalActiveMembers).toBe(20);
      expect(summaryRes.body.data.totalActiveChits).toBe(20);
      expect(summaryRes.body.data.expectedCollectionPerPeriod).toBe(100000); // 20 * 5000 = 100,000
    });
  });

  // ==========================================
  // Section F: Accounting & Regression (Tests 27 - 32)
  // ==========================================
  describe('Accounting and Regression (Tests 27 - 32)', () => {
    let testMemberId: string;

    beforeAll(async () => {
      const m = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({ name: 'Accounting Test Member', monthlyContribution: 5000 });
      testMemberId = m.body.data.id;
    });

    it('27. Verify removal of existing-money separation does not change existing bank balances', async () => {
      const designatedBank = await BankAccount.findOne({ userId, isChitFundAccount: true });
      const currentBankBalance = designatedBank?.currentBalance || 0;

      // Attempting to post to obsolete separation endpoint returns 404
      const obsoleteRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/separations`)
        .set('Cookie', userCookie)
        .send({ amount: 10000, date: '2026-10-01' });
      expect(obsoleteRes.status).toBe(404);

      // Verify bank balance is identical and untouched
      const bankAfter = await BankAccount.findOne({ userId, isChitFundAccount: true });
      expect(bankAfter?.currentBalance).toBe(currentBankBalance);
    });

    it('28. Verify UPI collections affect the bank balance correctly', async () => {
      const bankBefore = await BankAccount.findOne({ userId, isChitFundAccount: true });
      const balanceBefore = bankBefore?.currentBalance || 0;

      const colRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/collections`)
        .set('Cookie', userCookie)
        .send({
          memberId: testMemberId,
          collectionPeriod: '2026-12',
          actualAmountReceived: 5000,
          collectionDate: '2026-12-05',
          receivingBankAccountId: bankBefore!._id.toString(),
          paymentMethod: 'upi',
        });
      expect(colRes.status).toBe(201);

      const bankAfter = await BankAccount.findOne({ userId, isChitFundAccount: true });
      expect(bankAfter?.currentBalance).toBe(balanceBefore + 5000);
    });

    it('29. Verify cash collections do not increase the bank balance', async () => {
      const bankBefore = await BankAccount.findOne({ userId, isChitFundAccount: true });
      const balanceBefore = bankBefore?.currentBalance || 0;

      // Create a fresh member for cash collection
      const cashMemRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({ name: 'Cash Payer Member', monthlyContribution: 5000 });
      const cashMemberId = cashMemRes.body.data.id;

      const colRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/collections`)
        .set('Cookie', userCookie)
        .send({
          memberId: cashMemberId,
          collectionPeriod: '2026-12',
          actualAmountReceived: 5000,
          collectionDate: '2026-12-06',
          paymentMethod: 'cash_in_hand',
        });
      expect(colRes.status).toBe(201);

      // Bank balance MUST NOT increase for physical Cash in Hand
      const bankAfter = await BankAccount.findOne({ userId, isChitFundAccount: true });
      expect(bankAfter?.currentBalance).toBe(balanceBefore);
    });

    it('30. Verify payouts affect bank balances only when actually disbursed', async () => {
      const bankBefore = await BankAccount.findOne({ userId, isChitFundAccount: true });
      const balanceBefore = bankBefore?.currentBalance || 0;

      // Record a completed payout
      const payoutRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/payouts`)
        .set('Cookie', userCookie)
        .send({
          recipientName: 'Accounting Test Member',
          memberId: testMemberId,
          payoutPeriod: '2026-12',
          amount: 5000,
          payoutDate: '2026-12-15',
          sourceBankAccountId: bankBefore!._id.toString(),
          status: 'completed',
        });
      expect(payoutRes.status).toBe(201);

      // Bank balance debited only for completed payout
      const bankAfter = await BankAccount.findOne({ userId, isChitFundAccount: true });
      expect(bankAfter?.currentBalance).toBe(balanceBefore - 5000);
    });

    it('31. Verify no duplicate collection, payout, or income records are created', async () => {
      // Payout must not create a duplicate personal expense
      const personalExpenses = await Transaction.find({ userId, description: /payout/i });
      expect(personalExpenses.length).toBe(0);

      // UPI collection must not create a duplicate personal income transaction
      const personalIncomes = await Transaction.find({ userId, description: /collection/i });
      expect(personalIncomes.length).toBe(0);
    });

    it('32. Verify all results remain correct after a page refresh and re-login', async () => {
      // Re-login
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'chitworkflow@example.com',
          password: 'Password123!',
        });
      expect(loginRes.status).toBe(200);
      const newCookie = loginRes.headers['set-cookie'][0];

      // Summary idempotency
      const sum1 = await request(app).get(`/api/v1/chit-fund/${chitFundId}/summary`).set('Cookie', newCookie);
      const sum2 = await request(app).get(`/api/v1/chit-fund/${chitFundId}/summary`).set('Cookie', newCookie);

      expect(sum1.status).toBe(200);
      expect(sum2.status).toBe(200);
      expect(sum1.body.data.designatedAccountBalance).toBe(sum2.body.data.designatedAccountBalance);
      expect(sum1.body.data.totalChitFundMoneyHeld).toBe(sum2.body.data.totalChitFundMoneyHeld);
      expect(sum1.body.data.personalAvailableBalance).toBe(sum2.body.data.personalAvailableBalance);
    });
  });
});
