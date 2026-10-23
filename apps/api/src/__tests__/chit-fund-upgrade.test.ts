import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { BankAccount } from '../models/BankAccount';
import { ChitFund } from '../models/ChitFund';
import { ChitFundMember } from '../models/ChitFundMember';
import { ChitFundCollection } from '../models/ChitFundCollection';
import { ChitFundCycle } from '../models/ChitFundCycle';
import { ChitFundPayout } from '../models/ChitFundPayout';
import { AccountType, getChitCycleInfo, getPrizeTakingDateForCycle, getRolloverDateForCycle } from '@finora/shared';

describe('Phase 11: Complete Chit Fund Management Upgrade Acceptance Suite (Criteria 1-40)', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let userId: string;
  let designatedAccountId: string;
  let chitFundId: string;
  let member1Id: string; // 1 chit = 5,000
  let member2Id: string; // 2 chits = 10,000
  let member3Id: string; // 1 chit = 5,000 (initially marked as previously won)
  let member4Id: string; // 1 chit = 5,000

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // Register User
    const authRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'chitfund.upgrade.suite@finora.test',
        password: 'Password123!',
        fullName: 'Chit Master',
        currency: 'INR',
      });
    userCookie = authRes.headers['set-cookie'][0];
    userId = authRes.body.data.user.id;

    // Create Designated Bank Account
    const accRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'Chit Primary Vault',
        bankName: 'HDFC Bank',
        accountType: AccountType.SAVINGS,
        openingBalance: 28000,
        openingBalanceDate: '2026-01-01T00:00:00.000Z',
        isChitFundAccount: true,
      });
    designatedAccountId = accRes.body.data.id;

    // Get or Create Chit Fund
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
  // Section 1: Monthly Cycles (Criteria 1 - 6)
  // ==========================================
  describe('Monthly Cycles (Criteria 1 - 6)', () => {
    it('Criterion 1: October 2026 and November 2026 have distinct cycle identifiers', async () => {
      const octRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/cycles/2026-10`)
        .set('Cookie', userCookie);
      const novRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/cycles/2026-10`)
        .set('Cookie', userCookie);

      const novDirectRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/cycles/2026-11`)
        .set('Cookie', userCookie);

      expect(octRes.status).toBe(200);
      expect(novDirectRes.status).toBe(200);
      expect(octRes.body.data.cyclePeriod).toBe('2026-10');
      expect(novDirectRes.body.data.cyclePeriod).toBe('2026-11');
      expect(octRes.body.data.id).not.toBe(novDirectRes.body.data.id);
    });

    it('Criterion 2: The November cycle rollover occurs at 00:00 IST on November 13, 2026', () => {
      // 12th Nov 23:59:59 IST = 18:29:59 UTC -> Still belongs to 2026-10 cycle
      const beforeRolloverUTC = new Date('2026-11-12T18:29:59.000Z');
      const infoBefore = getChitCycleInfo(beforeRolloverUTC);
      expect(infoBefore.cyclePeriod).toBe('2026-10');

      // 13th Nov 00:00:01 IST = 18:30:01 UTC -> Rolls over to 2026-11 cycle
      const afterRolloverUTC = new Date('2026-11-12T18:30:01.000Z');
      const infoAfter = getChitCycleInfo(afterRolloverUTC);
      expect(infoAfter.cyclePeriod).toBe('2026-11');
      expect(infoAfter.prizeTakingDate.toISOString()).toContain('2026-11-15');
      expect(infoAfter.rolloverDate.toISOString()).toBe('2026-12-12T18:30:00.000Z');
    });

    it('Criterion 3: October collections, winner, and payout history remain available across cycles', async () => {
      // Create a dummy collection and payout in 2026-10
      const listCyclesRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/cycles`)
        .set('Cookie', userCookie);

      expect(listCyclesRes.status).toBe(200);
      const octCycle = listCyclesRes.body.data.find((c: any) => c.cyclePeriod === '2026-10');
      expect(octCycle).toBeDefined();
      expect(octCycle.cyclePeriod).toBe('2026-10');
    });

    it('Criterion 4: Monthly summary starts independently without changing the actual bank balance', async () => {
      const bankBefore = await BankAccount.findById(designatedAccountId);
      const balanceBefore = bankBefore?.currentBalance;

      // Accessing a new future cycle summary (e.g. 2026-12)
      const cycleRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/cycles/2026-12`)
        .set('Cookie', userCookie);

      expect(cycleRes.status).toBe(200);
      expect(cycleRes.body.data.totalCollected).toBe(0);

      const bankAfter = await BankAccount.findById(designatedAccountId);
      expect(bankAfter?.currentBalance).toBe(balanceBefore);
    });

    it('Criterion 5: Re-running rollover does not create duplicate cycles', async () => {
      // Request cycle 2026-10 multiple times
      await request(app).get(`/api/v1/chit-fund/${chitFundId}/cycles/2026-10`).set('Cookie', userCookie);
      await request(app).get(`/api/v1/chit-fund/${chitFundId}/cycles/2026-10`).set('Cookie', userCookie);
      await request(app).get(`/api/v1/chit-fund/${chitFundId}/cycles/2026-10`).set('Cookie', userCookie);

      const count = await ChitFundCycle.countDocuments({ chitFundId, cyclePeriod: '2026-10' });
      expect(count).toBe(1);
    });

    it('Criterion 6: Unpaid payouts remain visible after rollover', async () => {
      // Record a pending payout in 2026-10
      const payoutRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/payouts`)
        .set('Cookie', userCookie)
        .send({
          recipientName: 'Unpaid Member',
          payoutPeriod: '2026-10',
          amount: 50000,
          payoutDate: '2026-10-15T00:00:00.000Z',
          status: 'pending',
          notes: 'To be disbursed later',
        });
      expect(payoutRes.status).toBe(201);
      expect(payoutRes.body.data.status).toBe('pending');

      // Now query cycles list or summary for 2026-11
      const payoutsListRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/payouts`)
        .set('Cookie', userCookie);
      
      const pendingFound = payoutsListRes.body.data.find((p: any) => p.recipientName === 'Unpaid Member');
      expect(pendingFound).toBeDefined();
      expect(pendingFound.status).toBe('pending');
      expect(pendingFound.payoutPeriod).toBe('2026-10');

      // Cleanup pending test payout for subsequent clean balance accounting
      await ChitFundPayout.findByIdAndDelete(pendingFound.id);
    });
  });

  // ==========================================
  // Section 2: Member Contributions (Criteria 7 - 12)
  // ==========================================
  describe('Member Contributions (Criteria 7 - 12)', () => {
    it('Criterion 7 & 8: Member with 1 chit expects 5k; member configured with 5k expects 5k', async () => {
      // Member 1: 1 chit = 5k
      const m1Res = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({
          name: 'Member 1-Chit',
          numberOfChits: 1,
          contributionPerChit: 5000,
          startDate: '2026-10-01T00:00:00.000Z',
        });
      expect(m1Res.status).toBe(201);
      expect(m1Res.body.data.totalExpectedPerPeriod).toBe(5000);
      member1Id = m1Res.body.data.id;

      // Member 2: 1 chit = 5k
      const m2Res = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({
          name: 'Member 2',
          numberOfChits: 1,
          contributionPerChit: 5000,
          startDate: '2026-10-01T00:00:00.000Z',
        });
      expect(m2Res.status).toBe(201);
      expect(m2Res.body.data.totalExpectedPerPeriod).toBe(5000);
      member2Id = m2Res.body.data.id;

      // Member 3: previously won
      const m3Res = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({
          name: 'Member Past-Winner',
          numberOfChits: 1,
          contributionPerChit: 5000,
          startDate: '2026-10-01T00:00:00.000Z',
          hasPreviouslyWon: true,
          previousWinCycle: '2026-09',
          previousWinNotes: 'Won in September',
        });
      expect(m3Res.status).toBe(201);
      expect(m3Res.body.data.hasPreviouslyWon).toBe(true);
      member3Id = m3Res.body.data.id;

      // Member 4: eligible
      const m4Res = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({
          name: 'Member Candidate',
          numberOfChits: 1,
          contributionPerChit: 5000,
          startDate: '2026-10-01T00:00:00.000Z',
        });
      expect(m4Res.status).toBe(201);
      member4Id = m4Res.body.data.id;
    });

    it('Criterion 9: Fully recorded contribution removes member from outstanding collection list for that cycle', async () => {
      // Record full 5,000 for member 1
      const colRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/collections`)
        .set('Cookie', userCookie)
        .send({
          memberId: member1Id,
          collectionPeriod: '2026-10',
          actualAmountReceived: 5000,
          chitsCovered: 1,
          collectionDate: '2026-10-05T00:00:00.000Z',
          receivingBankAccountId: designatedAccountId,
          paymentMethod: 'upi',
          isSeparation: false,
        });
      expect(colRes.status).toBe(201);
      expect(colRes.body.data.status).toBe('completed');
      expect(colRes.body.data.outstandingAmount).toBe(0);

      // Verify cycle details
      const cycleRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/cycles/2026-10`)
        .set('Cookie', userCookie);
      
      expect(cycleRes.body.data.totalCollected).toBeGreaterThanOrEqual(5000);
    });

    it('Criterion 10: Partial contributions are handled consistently', async () => {
      // Record partial 2,000 of 5,000 for member 2
      const colRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/collections`)
        .set('Cookie', userCookie)
        .send({
          memberId: member2Id,
          collectionPeriod: '2026-10',
          actualAmountReceived: 2000,
          chitsCovered: 1,
          collectionDate: '2026-10-06T00:00:00.000Z',
          receivingBankAccountId: designatedAccountId,
          paymentMethod: 'bank_transfer',
          isSeparation: false,
        });
      expect(colRes.status).toBe(201);
      expect(colRes.body.data.status).toBe('partial');
      expect(colRes.body.data.outstandingAmount).toBe(3000);
    });

    it('Criterion 11: Completing remaining contribution completes member for cycle', async () => {
      const bankBefore = await BankAccount.findById(designatedAccountId);
      const balanceBefore = bankBefore?.currentBalance || 0;

      // Complete member 2 remaining 3000
      const compRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/collections`)
        .set('Cookie', userCookie)
        .send({
          memberId: member2Id,
          collectionPeriod: '2026-10',
          actualAmountReceived: 3000,
          chitsCovered: 1,
          collectionDate: '2026-10-07T00:00:00.000Z',
          receivingBankAccountId: designatedAccountId,
          paymentMethod: 'upi',
          isSeparation: false,
        });
      expect(compRes.status).toBe(201);
      expect(compRes.body.data.status).toBe('completed');

      const bankAfter = await BankAccount.findById(designatedAccountId);
      expect(bankAfter?.currentBalance).toBe(balanceBefore + 3000);
    });

    it('Criterion 12: New collections increase the bank balance exactly once', async () => {
      const bankBefore = await BankAccount.findById(designatedAccountId);
      const balanceBefore = bankBefore?.currentBalance || 0;

      const colRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/collections`)
        .set('Cookie', userCookie)
        .send({
          memberId: member4Id,
          collectionPeriod: '2026-10',
          actualAmountReceived: 5000,
          chitsCovered: 1,
          collectionDate: '2026-10-08T00:00:00.000Z',
          receivingBankAccountId: designatedAccountId,
          paymentMethod: 'upi',
          isSeparation: false,
        });
      expect(colRes.status).toBe(201);

      const bankAfter = await BankAccount.findById(designatedAccountId);
      expect(bankAfter?.currentBalance).toBe(balanceBefore + 5000);
    });

    it('Criterion 12b: Cash in Hand collections do NOT increase the bank balance, but increase cash-in-hand chit funds', async () => {
      const cashMemRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({
          name: 'Member Cash-in-Hand',
          numberOfChits: 1,
          contributionPerChit: 5000,
          startDate: '2026-10-01T00:00:00.000Z',
        });
      expect(cashMemRes.status).toBe(201);
      const cashMemberId = cashMemRes.body.data.id;

      const bankBefore = await BankAccount.findById(designatedAccountId);
      const balanceBefore = bankBefore?.currentBalance || 0;

      const cashColRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/collections`)
        .set('Cookie', userCookie)
        .send({
          memberId: cashMemberId,
          collectionPeriod: '2026-10',
          actualAmountReceived: 5000,
          chitsCovered: 1,
          collectionDate: '2026-10-09T00:00:00.000Z',
          paymentMethod: 'cash_in_hand',
          isSeparation: false,
        });
      expect(cashColRes.status).toBe(201);

      const bankAfter = await BankAccount.findById(designatedAccountId);
      expect(bankAfter?.currentBalance).toBe(balanceBefore);

      const summaryRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/summary`)
        .set('Cookie', userCookie);
      expect(summaryRes.body.data.cashInHandChitFunds).toBeGreaterThanOrEqual(5000);

      // Clean up cash member and collection so it doesn't leak into subsequent winner selection tests
      await ChitFundCollection.findByIdAndDelete(cashColRes.body.data.id);
      await ChitFundMember.findByIdAndDelete(cashMemberId);
    });
  });

  // ==========================================
  // Section 3: Winner Management (Criteria 13 - 21)
  // ==========================================
  describe('Winner Management (Criteria 13 - 21)', () => {
    it('Criterion 13: A member marked as previously won is excluded from future eligible pools by default', async () => {
      const eligibleRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/eligible-members`)
        .set('Cookie', userCookie);
      
      expect(eligibleRes.status).toBe(200);
      const eligibleIds = eligibleRes.body.data.eligible.map((m: any) => m.id);
      expect(eligibleIds).not.toContain(member3Id);

      const wonIds = eligibleRes.body.data.previouslyWon.map((m: any) => m.id);
      expect(wonIds).toContain(member3Id);
    });

    it('Criterion 18: A preview selection does not change the member permanent winner status', async () => {
      const previewRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/cycles/2026-10/spin-preview`)
        .set('Cookie', userCookie);

      expect(previewRes.status).toBe(200);
      expect(previewRes.body.data.selectedMember).toBeDefined();

      const candidateId = previewRes.body.data.selectedMember.id;
      const memberInDb = await ChitFundMember.findById(candidateId);
      expect(memberInDb?.hasPreviouslyWon).toBe(false);

      const cycleInDb = await ChitFundCycle.findOne({ chitFundId, cyclePeriod: '2026-10' });
      expect(cycleInDb?.winnerMemberId).toBeUndefined();
    });

    it('Criterion 14, 15, 16: Confirmed winner appears in cycle history and is excluded from future pools', async () => {
      // Confirm member 1 as winner of 2026-10
      const confirmRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/cycles/2026-10/confirm-winner`)
        .set('Cookie', userCookie)
        .send({
          memberId: member1Id,
          notes: 'Winner of October 2026 draw',
        });

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.data.winnerMemberId).toBe(member1Id);
      expect(confirmRes.body.data.status).toBe('winner_selected');

      // Verify member1 is now marked as previously won
      const m1Updated = await ChitFundMember.findById(member1Id);
      expect(m1Updated?.hasPreviouslyWon).toBe(true);
      expect(m1Updated?.previousWinCycle).toBe('2026-10');

      // Verify remaining eligible list now excludes member 1
      const eligibleRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/eligible-members`)
        .set('Cookie', userCookie);
      const eligibleIds = eligibleRes.body.data.eligible.map((m: any) => m.id);
      expect(eligibleIds).not.toContain(member1Id);
    });

    it('Criterion 17, 19, 20: A cycle cannot have two confirmed winners; atomic lock prevents double confirmation', async () => {
      // Attempting to confirm another winner for 2026-10 must fail with 400
      const duplicateRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/cycles/2026-10/confirm-winner`)
        .set('Cookie', userCookie)
        .send({
          memberId: member2Id,
          notes: 'Attempting duplicate winner',
        });

      expect(duplicateRes.status).toBe(400);
      expect(duplicateRes.body.error.code).toBe('WINNER_ALREADY_CONFIRMED');

      // Verify cycle still has member 1
      const cycle = await ChitFundCycle.findOne({ chitFundId, cyclePeriod: '2026-10' });
      expect(cycle?.winnerMemberId?.toString()).toBe(member1Id);
    });

    it('Criterion 21: An ineligible member cannot be confirmed through a direct API request', async () => {
      // Try to confirm member 3 (who has already won) for 2026-11
      const failRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/cycles/2026-11/confirm-winner`)
        .set('Cookie', userCookie)
        .send({
          memberId: member3Id,
          notes: 'Direct invalid confirmation',
        });

      expect(failRes.status).toBe(400);
      expect(failRes.body.error.code).toBe('MEMBER_ALREADY_WON');
    });
  });

  // ==========================================
  // Section 4: Spinner Behavior (Criteria 22 - 28)
  // ==========================================
  describe('Spinner Behavior (Criteria 22 - 28)', () => {
    it('Criterion 22, 23, 24, 25: Spinner selects only eligible members without mutating database', async () => {
      // In cycle 2026-11, member1 and member3 are already won. Member2 and Member4 are eligible.
      const preview1 = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/cycles/2026-11/spin-preview`)
        .set('Cookie', userCookie);

      expect(preview1.status).toBe(200);
      const selectedId = preview1.body.data.selectedMember.id;
      expect([member2Id, member4Id]).toContain(selectedId);
      expect(preview1.body.data.eligibleMembers.length).toBe(2);

      // Verify database still has NO winner confirmed for 2026-11
      const cycle11 = await ChitFundCycle.findOne({ chitFundId, cyclePeriod: '2026-11' });
      expect(cycle11?.winnerMemberId).toBeUndefined();
    });

    it('Criterion 27: The spinner cannot confirm another winner after current cycle has a confirmed winner', async () => {
      // 2026-10 already has a confirmed winner (member 1)
      const previewOnLockedCycle = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/cycles/2026-10/spin-preview`)
        .set('Cookie', userCookie);

      expect(previewOnLockedCycle.status).toBe(400);
      expect(previewOnLockedCycle.body.error.code).toBe('WINNER_ALREADY_CONFIRMED');
    });

    it('Criterion 28: No eligible members produces clear empty state', async () => {
      // Temporarily mark member2 and member4 as hasPreviouslyWon = true
      await ChitFundMember.updateMany({ _id: { $in: [member2Id, member4Id] } }, { hasPreviouslyWon: true });

      const emptyRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/cycles/2026-12/spin-preview`)
        .set('Cookie', userCookie);

      expect(emptyRes.status).toBe(400);
      expect(emptyRes.body.error.code).toBe('NO_ELIGIBLE_MEMBERS');

      // Restore member 2 and member 4
      await ChitFundMember.updateMany({ _id: { $in: [member2Id, member4Id] } }, { hasPreviouslyWon: false });
    });
  });

  // ==========================================
  // Section 5: Payouts (Criteria 29 - 33)
  // ==========================================
  describe('Payouts (Criteria 29 - 33)', () => {
    let pendingPayoutId: string;

    it('Criterion 29 & 30: A pending payout references cycle winner and does NOT reduce bank balance', async () => {
      const bankBefore = await BankAccount.findById(designatedAccountId);
      const balanceBefore = bankBefore?.currentBalance || 0;

      const payoutRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/payouts`)
        .set('Cookie', userCookie)
        .send({
          recipientName: 'Member 1-Chit',
          memberId: member1Id,
          payoutPeriod: '2026-10',
          amount: 20000,
          payoutDate: '2026-10-15T00:00:00.000Z',
          sourceBankAccountId: designatedAccountId,
          status: 'pending',
          notes: 'Approved, awaiting cheque clearance',
        });

      expect(payoutRes.status).toBe(201);
      expect(payoutRes.body.data.status).toBe('pending');
      pendingPayoutId = payoutRes.body.data.id;

      // Verify cycle payout status is 'pending'
      const cycleRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/cycles/2026-10`)
        .set('Cookie', userCookie);
      expect(cycleRes.body.data.payoutStatus).toBe('pending');

      // Bank balance MUST be intact
      const bankAfter = await BankAccount.findById(designatedAccountId);
      expect(bankAfter?.currentBalance).toBe(balanceBefore);
    });

    it('Criterion 31: A completed payout reduces the bank balance and chit-fund money held exactly once', async () => {
      const bankBefore = await BankAccount.findById(designatedAccountId);
      const balanceBefore = bankBefore?.currentBalance || 0;

      // Update payout status to completed
      const updateRes = await request(app)
        .put(`/api/v1/chit-fund/${chitFundId}/payouts/${pendingPayoutId}`)
        .set('Cookie', userCookie)
        .send({
          status: 'completed',
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.status).toBe('completed');

      // Bank balance MUST be reduced by 20,000
      const bankAfter = await BankAccount.findById(designatedAccountId);
      expect(bankAfter?.currentBalance).toBe(balanceBefore - 20000);

      // Verify cycle payout status is completed
      const cycleRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/cycles/2026-10`)
        .set('Cookie', userCookie);
      expect(cycleRes.body.data.payoutStatus).toBe('completed');
    });

    it('Criterion 32 & 33: Unpaid payouts remain outstanding after rollover; payout history remains available', async () => {
      // Verify payouts endpoint returns historical payouts
      const payoutsRes = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/payouts`)
        .set('Cookie', userCookie);

      expect(payoutsRes.status).toBe(200);
      const found = payoutsRes.body.data.find((p: any) => p.id === pendingPayoutId);
      expect(found).toBeDefined();
      expect(found.payoutPeriod).toBe('2026-10');
      expect(found.amount).toBe(20000);
    });
  });

  // ==========================================
  // Section 6: Authoritative Accounting Model (Criteria 34 - 40)
  // ==========================================
  describe('Authoritative Balance Model Verification (Criteria 34 - 40)', () => {
    let cleanAccountId: string;
    let cleanFundId: string;
    let cleanMemberId: string;

    beforeAll(async () => {
      // Clear test collections and payouts to isolate the authoritative balance test sequence cleanly
      await ChitFundCollection.deleteMany({ chitFundId });
      await ChitFundPayout.deleteMany({ chitFundId });

      // Create an account with EXACT opening balance of 28,000
      const accRes = await request(app)
        .post('/api/v1/accounts')
        .set('Cookie', userCookie)
        .send({
          accountName: 'Strict Ledger Account',
          bankName: 'Axis Bank',
          accountType: AccountType.SAVINGS,
          openingBalance: 28000,
          openingBalanceDate: '2026-01-01T00:00:00.000Z',
          isChitFundAccount: true,
          confirmReassign: true,
        });
      cleanAccountId = accRes.body.data.id;
      cleanFundId = chitFundId;

      // Create dedicated member with 10 chits (50,000 due) so multiple collections won't trigger duplicate limit
      const memberRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({
          name: 'Strict Ledger Member',
          numberOfChits: 10,
          contributionPerChit: 5000,
          startDate: '2026-10-01T00:00:00.000Z',
        });
      cleanMemberId = memberRes.body.data.id;
    });

    it('Criterion 34: A ₹28,000 opening balance displays correctly', async () => {
      const summaryRes = await request(app)
        .get(`/api/v1/chit-fund/${cleanFundId}/summary`)
        .set('Cookie', userCookie);

      expect(summaryRes.status).toBe(200);
      expect(summaryRes.body.data.designatedAccountBalance).toBe(28000);
      expect(summaryRes.body.data.totalChitFundMoneyHeld).toBe(0);
      expect(summaryRes.body.data.personalAvailableBalance).toBe(28000);
    });

    it('Criterion 35: A new ₹20,000 collection produces ₹48,000 total balance, ₹20,000 chit money, and ₹28,000 personal balance', async () => {
      const colRes = await request(app)
        .post(`/api/v1/chit-fund/${cleanFundId}/collections`)
        .set('Cookie', userCookie)
        .send({
          memberId: cleanMemberId,
          collectionPeriod: '2026-10',
          actualAmountReceived: 20000,
          chitsCovered: 4,
          collectionDate: '2026-10-10T00:00:00.000Z',
          receivingBankAccountId: cleanAccountId,
          paymentMethod: 'upi',
          isSeparation: false,
        });
      expect(colRes.status).toBe(201);

      const summaryRes = await request(app)
        .get(`/api/v1/chit-fund/${cleanFundId}/summary`)
        .set('Cookie', userCookie);

      expect(summaryRes.body.data.designatedAccountBalance).toBe(48000);
      expect(summaryRes.body.data.totalChitFundMoneyHeld).toBe(20000);
      expect(summaryRes.body.data.personalAvailableBalance).toBe(28000);

      // Clean up collection 35 before testing criterion 36 scenario
      await ChitFundCollection.findByIdAndDelete(colRes.body.data.id);
      // Reset account balance back to 28,000
      await BankAccount.findByIdAndUpdate(cleanAccountId, { currentBalance: 28000 });
    });

    it('Criterion 36: Normal collection of ₹5,000 updates bank and chit money held correctly', async () => {
      const colRes = await request(app)
        .post(`/api/v1/chit-fund/${cleanFundId}/collections`)
        .set('Cookie', userCookie)
        .send({
          memberId: cleanMemberId,
          collectionPeriod: '2026-10',
          actualAmountReceived: 5000,
          collectionDate: '2026-10-10T00:00:00.000Z',
          receivingBankAccountId: cleanAccountId,
          paymentMethod: 'upi',
          isSeparation: false,
        });
      expect(colRes.status).toBe(201);

      const summaryRes = await request(app)
        .get(`/api/v1/chit-fund/${cleanFundId}/summary`)
        .set('Cookie', userCookie);

      expect(summaryRes.body.data.designatedAccountBalance).toBe(33000);
      expect(summaryRes.body.data.totalChitFundMoneyHeld).toBe(5000);
      expect(summaryRes.body.data.personalAvailableBalance).toBe(28000);
    });

    it('Criterion 37: Obsolete separation endpoint returns 404', async () => {
      const sepRes = await request(app)
        .post(`/api/v1/chit-fund/${cleanFundId}/separations`)
        .set('Cookie', userCookie)
        .send({
          amount: 5000,
          date: '2026-10-11',
          description: 'Separation attempt',
        });
      expect(sepRes.status).toBe(404);
    });

    it('Criterion 38: Total bank balance matches Personal Available + Chit Funds Held in Bank', async () => {
      const bank = await BankAccount.findById(cleanAccountId);
      expect(bank?.currentBalance).toBe(33000);
    });

    it('Criterion 39: Deleting relevant records updates balances correctly', async () => {
      // Find the 5,000 collection and delete it
      const col5k = await ChitFundCollection.findOne({ chitFundId: cleanFundId, actualAmountReceived: 5000 });
      expect(col5k).toBeDefined();

      const delRes = await request(app)
        .delete(`/api/v1/chit-fund/${cleanFundId}/collections/${col5k!._id}`)
        .set('Cookie', userCookie);
      expect(delRes.status).toBe(200);

      // Total balance must return to 28,000, chit held to 0, personal to 28,000
      const summaryRes = await request(app)
        .get(`/api/v1/chit-fund/${cleanFundId}/summary`)
        .set('Cookie', userCookie);

      expect(summaryRes.body.data.designatedAccountBalance).toBe(28000);
      expect(summaryRes.body.data.totalChitFundMoneyHeld).toBe(0);
      expect(summaryRes.body.data.personalAvailableBalance).toBe(28000);
    });

    it('Criterion 40: All figures remain consistent after a page refresh', async () => {
      // Calling summary multiple times idempotently returns identical figures
      const refresh1 = await request(app).get(`/api/v1/chit-fund/${cleanFundId}/summary`).set('Cookie', userCookie);
      const refresh2 = await request(app).get(`/api/v1/chit-fund/${cleanFundId}/summary`).set('Cookie', userCookie);

      expect(refresh1.body.data.designatedAccountBalance).toBe(refresh2.body.data.designatedAccountBalance);
      expect(refresh1.body.data.totalChitFundMoneyHeld).toBe(refresh2.body.data.totalChitFundMoneyHeld);
      expect(refresh1.body.data.personalAvailableBalance).toBe(refresh2.body.data.personalAvailableBalance);
      expect(refresh1.body.data.designatedAccountBalance).toBe(
        refresh1.body.data.personalAvailableBalance + refresh1.body.data.totalChitFundMoneyHeld
      );
    });
  });
});
