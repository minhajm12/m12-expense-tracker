import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { BankAccount } from '../models/BankAccount';
import { ChitFund } from '../models/ChitFund';
import { ChitFundMember } from '../models/ChitFundMember';
import { ChitFundCycle } from '../models/ChitFundCycle';
import { ChitFundPayout } from '../models/ChitFundPayout';
import { AccountType, getPrizeTakingDateForCycle, getRolloverDateForCycle } from '@finora/shared';

describe('Regression Suite: Chit Contribution Doubling, Winner Reset & Trial Spin', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let userId: string;
  let chitFundId: string;
  let bankAccountId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // Register test user
    const authRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'chit.reset.suite@finora.test',
        password: 'Password123!',
        fullName: 'Chit Regression Tester',
        currency: 'INR',
      });
    userCookie = authRes.headers['set-cookie'][0];
    userId = authRes.body.data.user.id;

    // Create a bank account
    const accRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'Chit Operating Account',
        bankName: 'SBI Bank',
        accountType: AccountType.SAVINGS,
        openingBalance: 100000,
        openingBalanceDate: '2026-01-01T00:00:00.000Z',
        isChitFundAccount: true,
      });
    bankAccountId = accRes.body.data.id;

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

  // =========================================================================
  // 1. Fix Member Editing and Monthly Contribution Doubling
  // =========================================================================
  describe('1. Member Editing and Contribution Doubling Fix', () => {
    let memberId: string;

    it('creates a chit member with monthly contribution of ₹5,000', async () => {
      const res = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({
          name: 'Ramesh Patel',
          numberOfChits: 1,
          monthlyContribution: 5000,
          contributionPerChit: 5000,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalExpectedPerPeriod).toBe(5000);
      expect(res.body.data.contributionPerChit).toBe(5000);
      memberId = res.body.data.id;
    });

    it('saving without changing amount preserves ₹5,000 (never doubles to ₹10,000)', async () => {
      const res = await request(app)
        .patch(`/api/v1/chit-fund/${chitFundId}/members/${memberId}`)
        .set('Cookie', userCookie)
        .send({
          name: 'Ramesh Patel Updated',
          numberOfChits: 1,
          monthlyContribution: 5000,
          contributionPerChit: 5000,
          notes: 'Added note without changing amount',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Ramesh Patel Updated');
      expect(res.body.data.totalExpectedPerPeriod).toBe(5000);
      expect(res.body.data.contributionPerChit).toBe(5000);
    });

    it('changing amount from ₹5,000 to ₹6,000 saves exactly ₹6,000', async () => {
      const res = await request(app)
        .patch(`/api/v1/chit-fund/${chitFundId}/members/${memberId}`)
        .set('Cookie', userCookie)
        .send({
          monthlyContribution: 6000,
          contributionPerChit: 6000,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.totalExpectedPerPeriod).toBe(6000);
      expect(res.body.data.contributionPerChit).toBe(6000);
    });

    it('saving 3 additional times in succession keeps amount at ₹6,000 (no exponential doubling)', async () => {
      for (let i = 1; i <= 3; i++) {
        const res = await request(app)
          .patch(`/api/v1/chit-fund/${chitFundId}/members/${memberId}`)
          .set('Cookie', userCookie)
          .send({
            notes: `Successive save #${i}`,
            monthlyContribution: 6000,
            contributionPerChit: 6000,
          });

        expect(res.status).toBe(200);
        expect(res.body.data.totalExpectedPerPeriod).toBe(6000);
        expect(res.body.data.contributionPerChit).toBe(6000);
      }
    });

    it('handles member editing correctly with single chit enforcement and without compounding', async () => {
      const multiRes = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/members`)
        .set('Cookie', userCookie)
        .send({
          name: 'Suresh Single Chit',
          monthlyContribution: 10000,
        });

      expect(multiRes.status).toBe(201);
      const multiId = multiRes.body.data.id;
      expect(multiRes.body.data.numberOfChits).toBe(1);
      expect(multiRes.body.data.totalExpectedPerPeriod).toBe(10000);
      expect(multiRes.body.data.contributionPerChit).toBe(10000);

      // Edit without changing amount
      const editRes = await request(app)
        .patch(`/api/v1/chit-fund/${chitFundId}/members/${multiId}`)
        .set('Cookie', userCookie)
        .send({
          name: 'Suresh Single Chit Renamed',
          monthlyContribution: 10000,
        });

      expect(editRes.status).toBe(200);
      expect(editRes.body.data.numberOfChits).toBe(1);
      expect(editRes.body.data.totalExpectedPerPeriod).toBe(10000);
      expect(editRes.body.data.contributionPerChit).toBe(10000);
    });
  });

  // =========================================================================
  // 2. Enforce Exactly One Confirmed Winner Per Monthly Cycle
  // =========================================================================
  describe('2. Single Confirmed Winner Atomicity and Eligibility', () => {
    let candidate1Id: string;
    let candidate2Id: string;
    const testCycle = '2026-10';

    beforeAll(async () => {
      const m1 = await ChitFundMember.create({
        userId,
        chitFundId,
        name: 'Candidate One',
        numberOfChits: 1,
        contributionPerChit: 5000,
        totalExpectedPerPeriod: 5000,
        status: 'active',
      });
      candidate1Id = m1._id.toString();

      const m2 = await ChitFundMember.create({
        userId,
        chitFundId,
        name: 'Candidate Two',
        numberOfChits: 1,
        contributionPerChit: 5000,
        totalExpectedPerPeriod: 5000,
        status: 'active',
      });
      candidate2Id = m2._id.toString();
    });

    it('confirms candidate 1 as the winner for cycle 2026-10', async () => {
      const res = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/cycles/${testCycle}/confirm-winner`)
        .set('Cookie', userCookie)
        .send({
          memberId: candidate1Id,
          notes: 'Official live lot spin',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.winnerMemberId).toBe(candidate1Id);
      expect(res.body.data.status).toBe('winner_selected');

      const updatedMember = await ChitFundMember.findById(candidate1Id);
      expect(updatedMember?.hasPreviouslyWon).toBe(true);
      expect(updatedMember?.previousWinCycle).toBe(testCycle);
    });

    it('prevents second winner confirmation for the same cycle (returns 400 WINNER_ALREADY_CONFIRMED)', async () => {
      const res = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/cycles/${testCycle}/confirm-winner`)
        .set('Cookie', userCookie)
        .send({
          memberId: candidate2Id,
          notes: 'Attempting duplicate winner',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('WINNER_ALREADY_CONFIRMED');
    });

    it('candidate 1 is now excluded from eligible members list for subsequent cycles', async () => {
      const res = await request(app)
        .get(`/api/v1/chit-fund/${chitFundId}/eligible-members`)
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      const eligibleIds = res.body.data.eligibleMembers.map((m: any) => m.id);
      expect(eligibleIds).not.toContain(candidate1Id);
      expect(eligibleIds).toContain(candidate2Id);
    });
  });

  // =========================================================================
  // 3. Free Trial Spin Isolation
  // =========================================================================
  describe('3. Free Trial Spin Isolation', () => {
    const trialCycle = '2026-11';

    it('generates a trial spin preview without altering database state', async () => {
      const res = await request(app)
        .post(`/api/v1/chit-fund/${chitFundId}/cycles/${trialCycle}/trial-spin`)
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isTrial).toBe(true);
      expect(res.body.data.selectedMember).toBeDefined();
      const trialSelectedId = res.body.data.selectedMember.id;

      // Verify cycle in database was NOT altered
      const cycle = await ChitFundCycle.findOne({ userId, chitFundId, cyclePeriod: trialCycle });
      if (cycle) {
        expect(cycle.winnerMemberId).toBeFalsy();
        expect(cycle.status).not.toBe('winner_selected');
      }

      // Verify trial-selected member's eligibility is unchanged
      const member = await ChitFundMember.findById(trialSelectedId);
      expect(member?.hasPreviouslyWon).toBe(false);
    });
  });

  // =========================================================================
  // 4. Chit Winner Reset (Option A: Reset Selected Month)
  // =========================================================================
  describe('4. Reset Winner for Selected Month (Option A)', () => {
    const resetCyclePeriod = '2026-10';

    it('blocks reset if a completed payout exists (PAYOUT_ALREADY_COMPLETED)', async () => {
      // Create a completed payout for this cycle
      const payout = await ChitFundPayout.create({
        userId,
        chitFundId,
        recipientName: 'Candidate One',
        payoutPeriod: resetCyclePeriod,
        amount: 50000,
        payoutDate: new Date('2026-10-15'),
        sourceBankAccountId: bankAccountId,
        status: 'completed',
      });

      const res = await request(app)
        .post('/api/v1/settings/reset-chit-winner-month')
        .set('Cookie', userCookie)
        .send({
          chitFundId,
          cyclePeriod: resetCyclePeriod,
          reason: 'Attempt with completed payout',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PAYOUT_ALREADY_COMPLETED');

      // Cleanup completed payout to test successful reset
      await payout.deleteOne();
    });

    it('successfully resets the winner and restores member eligibility when no completed payout exists', async () => {
      const cycleBefore = await ChitFundCycle.findOne({ userId, chitFundId, cyclePeriod: resetCyclePeriod });
      const winningMemberId = cycleBefore?.winnerMemberId?.toString();
      expect(winningMemberId).toBeDefined();

      const res = await request(app)
        .post('/api/v1/settings/reset-chit-winner-month')
        .set('Cookie', userCookie)
        .send({
          chitFundId,
          cyclePeriod: resetCyclePeriod,
          reason: 'Lot redraw approved',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify cycle winner fields cleared
      const cycleAfter = await ChitFundCycle.findOne({ userId, chitFundId, cyclePeriod: resetCyclePeriod });
      expect(cycleAfter?.winnerMemberId).toBeFalsy();
      expect(cycleAfter?.status).toBe('collecting');

      // Verify winning member's hasPreviouslyWon restored to false
      const memberAfter = await ChitFundMember.findById(winningMemberId);
      expect(memberAfter?.hasPreviouslyWon).toBe(false);
      expect(memberAfter?.previousWinCycle).toBeFalsy();
    });
  });

  // =========================================================================
  // 5. Reset All Chit Winner Assignments (Option B)
  // =========================================================================
  describe('5. Reset All Chit Winners (Option B)', () => {
    let winnerAId: string;
    let winnerBId: string;

    beforeAll(async () => {
      const mA = await ChitFundMember.create({
        userId,
        chitFundId,
        name: 'Winner Alpha',
        numberOfChits: 1,
        contributionPerChit: 5000,
        totalExpectedPerPeriod: 5000,
        hasPreviouslyWon: true,
        previousWinCycle: '2026-08',
        status: 'active',
      });
      winnerAId = mA._id.toString();

      await ChitFundCycle.create({
        userId,
        chitFundId,
        cyclePeriod: '2026-08',
        year: 2026,
        month: 8,
        prizeTakingDate: getPrizeTakingDateForCycle('2026-08'),
        rolloverDate: getRolloverDateForCycle('2026-08'),
        winnerMemberId: mA._id,
        winnerMemberName: mA.name,
        status: 'winner_selected',
      });

      const mB = await ChitFundMember.create({
        userId,
        chitFundId,
        name: 'Winner Beta',
        numberOfChits: 1,
        contributionPerChit: 5000,
        totalExpectedPerPeriod: 5000,
        hasPreviouslyWon: true,
        previousWinCycle: '2026-09',
        status: 'active',
      });
      winnerBId = mB._id.toString();

      await ChitFundCycle.create({
        userId,
        chitFundId,
        cyclePeriod: '2026-09',
        year: 2026,
        month: 9,
        prizeTakingDate: getPrizeTakingDateForCycle('2026-09'),
        rolloverDate: getRolloverDateForCycle('2026-09'),
        winnerMemberId: mB._id,
        winnerMemberName: mB.name,
        status: 'winner_selected',
      });
    });

    it('requires exact confirmation phrase "RESET WINNERS"', async () => {
      const res = await request(app)
        .post('/api/v1/settings/reset-all-chit-winners')
        .set('Cookie', userCookie)
        .send({
          chitFundId,
          confirmationPhrase: 'WRONG PHRASE',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('safely clears all cycle winners and restores member eligibility without deleting members or accounts', async () => {
      const res = await request(app)
        .post('/api/v1/settings/reset-all-chit-winners')
        .set('Cookie', userCookie)
        .send({
          chitFundId,
          confirmationPhrase: 'RESET WINNERS',
          reason: 'Full yearly cycle reset',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.resetCyclesCount).toBeGreaterThanOrEqual(2);

      // Verify all cycles now have no winners
      const cyclesWithWinners = await ChitFundCycle.find({
        userId,
        chitFundId,
        winnerMemberId: { $exists: true, $ne: null },
      });
      expect(cyclesWithWinners.length).toBe(0);

      // Verify members have hasPreviouslyWon set to false
      const mAAfter = await ChitFundMember.findById(winnerAId);
      const mBAfter = await ChitFundMember.findById(winnerBId);
      expect(mAAfter?.hasPreviouslyWon).toBe(false);
      expect(mBAfter?.hasPreviouslyWon).toBe(false);

      // Verify members, accounts, and fund are preserved
      const memberCount = await ChitFundMember.countDocuments({ userId, chitFundId });
      expect(memberCount).toBeGreaterThan(0);
      const acc = await BankAccount.findById(bankAccountId);
      expect(acc).not.toBeNull();
    });
  });
});
