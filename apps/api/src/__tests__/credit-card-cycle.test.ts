import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import {
  CreditCardNetwork,
  CreditCardRepaymentMode,
  PaymentMethod,
  PaymentChannel,
  TransactionType,
  AccountType,
  StatementStatus,
} from '@finora/shared';
import {
  calculateCardCycleDates,
  calculateDueDateFromClosingDate,
  clampDay,
  getDaysInMonth,
  getHistoricalCycleBoundaries,
} from '../services/credit-card-cycle';

describe('Credit Card Cycle, Outstanding Separation & Details Test Suite', () => {
  describe('Unit Tests: Cycle Boundary and Date Math', () => {
    it('correctly calculates days in month and clamps days', () => {
      // Leap year Feb 2024 has 29 days
      expect(getDaysInMonth(2024, 1)).toBe(29);
      expect(clampDay(2024, 1, 31)).toBe(29);

      // Non-leap year Feb 2025 has 28 days
      expect(getDaysInMonth(2025, 1)).toBe(28);
      expect(clampDay(2025, 1, 31)).toBe(28);

      // April has 30 days
      expect(getDaysInMonth(2026, 3)).toBe(30);
      expect(clampDay(2026, 3, 31)).toBe(30);
      expect(clampDay(2026, 3, 15)).toBe(15);
    });

    it('accurately calculates payment due date as exactly 15 calendar days after statement closing date', () => {
      // Leap year 2024: Feb 15 + 15 days -> March 1, 2024 (29 days in Feb)
      const feb2024Closing = new Date(2024, 1, 15);
      const feb2024Due = calculateDueDateFromClosingDate(feb2024Closing);
      expect(feb2024Due.getFullYear()).toBe(2024);
      expect(feb2024Due.getMonth()).toBe(2); // March
      expect(feb2024Due.getDate()).toBe(1);

      // Non-leap year 2025: Feb 15 + 15 days -> March 2, 2025 (28 days in Feb)
      const feb2025Closing = new Date(2025, 1, 15);
      const feb2025Due = calculateDueDateFromClosingDate(feb2025Closing);
      expect(feb2025Due.getFullYear()).toBe(2025);
      expect(feb2025Due.getMonth()).toBe(2); // March
      expect(feb2025Due.getDate()).toBe(2);

      // Year boundary transition: Dec 20, 2026 + 15 days -> Jan 4, 2027 (31 days in Dec)
      const dec2026Closing = new Date(2026, 11, 20);
      const dec2026Due = calculateDueDateFromClosingDate(dec2026Closing);
      expect(dec2026Due.getFullYear()).toBe(2027);
      expect(dec2026Due.getMonth()).toBe(0); // January
      expect(dec2026Due.getDate()).toBe(4);

      // 30-day month transition: April 20, 2026 + 15 days -> May 5, 2026 (30 days in April)
      const apr2026Closing = new Date(2026, 3, 20);
      const apr2026Due = calculateDueDateFromClosingDate(apr2026Closing);
      expect(apr2026Due.getFullYear()).toBe(2026);
      expect(apr2026Due.getMonth()).toBe(4); // May
      expect(apr2026Due.getDate()).toBe(5);
    });

    it('calculates cycle boundaries when reference date is after closing day', () => {
      // Reference date: Oct 20, 2026. Closing day: 15
      const ref = new Date(2026, 9, 20); // Oct 20, 2026
      const dates = calculateCardCycleDates(15, undefined, ref);

      // Last closed cycle closed on Oct 15, 2026
      expect(dates.lastClosingDate.getFullYear()).toBe(2026);
      expect(dates.lastClosingDate.getMonth()).toBe(9); // October
      expect(dates.lastClosingDate.getDate()).toBe(15);

      // Last closed cycle due date is Oct 30, 2026 (15 calendar days after Oct 15)
      expect(dates.lastDueDate.getFullYear()).toBe(2026);
      expect(dates.lastDueDate.getMonth()).toBe(9); // October
      expect(dates.lastDueDate.getDate()).toBe(30);

      // Ongoing cycle starts on Oct 16, 2026 and closes on Nov 15, 2026
      expect(dates.ongoingPeriodStart.getDate()).toBe(16);
      expect(dates.ongoingPeriodStart.getMonth()).toBe(9);
      expect(dates.nextClosingDate.getDate()).toBe(15);
      expect(dates.nextClosingDate.getMonth()).toBe(10); // November
      // Next cycle due date is Nov 30, 2026 (15 calendar days after Nov 15)
      expect(dates.nextDueDate.getDate()).toBe(30);
      expect(dates.nextDueDate.getMonth()).toBe(10);
    });

    it('calculates cycle boundaries when reference date is before or on closing day', () => {
      // Reference date: Oct 10, 2026. Closing day: 15
      const ref = new Date(2026, 9, 10); // Oct 10, 2026
      const dates = calculateCardCycleDates(15, undefined, ref);

      // Last closed cycle closed on Sep 15, 2026
      expect(dates.lastClosingDate.getFullYear()).toBe(2026);
      expect(dates.lastClosingDate.getMonth()).toBe(8); // September
      expect(dates.lastClosingDate.getDate()).toBe(15);

      // Last closed cycle due date is Sep 30, 2026 (15 calendar days after Sep 15)
      expect(dates.lastDueDate.getFullYear()).toBe(2026);
      expect(dates.lastDueDate.getMonth()).toBe(8); // September
      expect(dates.lastDueDate.getDate()).toBe(30);

      // Ongoing cycle starts on Sep 16, 2026 and closes on Oct 15, 2026
      expect(dates.ongoingPeriodStart.getDate()).toBe(16);
      expect(dates.ongoingPeriodStart.getMonth()).toBe(8); // September
      expect(dates.nextClosingDate.getDate()).toBe(15);
      expect(dates.nextClosingDate.getMonth()).toBe(9); // October
    });

    it('generates non-overlapping historical cycle boundaries with zero gaps', () => {
      const boundaries = getHistoricalCycleBoundaries(15, 5, 4, new Date(2026, 9, 20));
      // 1 ongoing cycle + 4 closed historical cycles = 5 cycles total
      expect(boundaries.length).toBe(5);

      // Chronological: boundaries[0] is ongoing, boundaries[1..4] are closed
      expect(boundaries[0].isOngoing).toBe(true);
      expect(boundaries[1].isOngoing).toBe(false);

      // Verify consecutive boundary continuity: periodStart of cycle i = periodEnd of cycle i+1 + 1ms
      for (let i = 0; i < boundaries.length - 1; i++) {
        const cur = boundaries[i];
        const prev = boundaries[i + 1];
        const diffMs = cur.periodStart.getTime() - prev.periodEnd.getTime();
        expect(diffMs).toBe(1); // Exactly 1 ms between 23:59:59.999 and 00:00:00.000
      }
    });
  });

  describe('Integration Tests: Multi-Cycle Outstanding, Repayment Modes, and Card Details', () => {
    let mongoServer: MongoMemoryServer;
    let userCookieA: string;
    let userCookieB: string;
    let bankAccountAId: string;
    let cardAId: string;

    beforeAll(async () => {
      mongoServer = await MongoMemoryServer.create();
      await connectDatabase(mongoServer.getUri());

      // User A
      const authResA = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'usera@finora.test',
          password: 'Password123!',
          fullName: 'User A',
          currency: 'INR',
        });
      userCookieA = authResA.headers['set-cookie'][0];

      // User B (for isolation tests)
      const authResB = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'userb@finora.test',
          password: 'Password123!',
          fullName: 'User B',
          currency: 'INR',
        });
      userCookieB = authResB.headers['set-cookie'][0];

      // Bank account for User A with ₹100,000
      const bankRes = await request(app)
        .post('/api/v1/accounts')
        .set('Cookie', userCookieA)
        .send({
          accountName: 'HDFC Salary Account',
          bankName: 'HDFC Bank',
          accountType: AccountType.SAVINGS,
          openingBalance: 100000,
          openingBalanceDate: '2026-01-01T00:00:00.000Z',
        });
      bankAccountAId = bankRes.body.data.id;

      // Credit Card for User A with limit ₹100,000, closing 15th, due 5th
      const cardRes = await request(app)
        .post('/api/v1/credit-cards')
        .set('Cookie', userCookieA)
        .send({
          cardNickname: 'ICICI Sapphiro',
          issuingBank: 'ICICI Bank',
          network: CreditCardNetwork.VISA,
          lastFourDigits: '1234',
          creditLimit: 100000,
          billingCycleClosingDay: 15,
          paymentDueDay: 5,
          openingOutstanding: 0,
          openingOutstandingDate: '2026-01-01T00:00:00.000Z',
        });
      cardAId = cardRes.body.data.id;
    });

    afterAll(async () => {
      await disconnectDatabase();
      if (mongoServer) {
        await mongoServer.stop();
      }
    });

    it('records purchases in previous-cycle and ongoing-cycle, correctly separating balances', async () => {
      const dates = calculateCardCycleDates(15, 5, new Date());

      // Purchase 1: In previous cycle (3 days before last closing date)
      const prevDate = new Date(dates.lastClosingDate);
      prevDate.setDate(prevDate.getDate() - 3);

      await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', userCookieA)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Flight Ticket (Previous Cycle)',
          amount: 8000,
          currency: 'INR',
          date: prevDate.toISOString(),
          category: 'Travel',
          paymentMethod: PaymentMethod.CREDIT_CARD,
          paymentChannel: PaymentChannel.ONLINE,
          creditCardId: cardAId,
        });

      // Purchase 2: In ongoing cycle (current date or 1 day after start of ongoing cycle)
      const ongoingDate = new Date(dates.ongoingPeriodStart);
      ongoingDate.setHours(12, 0, 0, 0);

      await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', userCookieA)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Electronics (Ongoing Cycle)',
          amount: 5000,
          currency: 'INR',
          date: ongoingDate.toISOString(),
          category: 'Shopping',
          paymentMethod: PaymentMethod.CREDIT_CARD,
          paymentChannel: PaymentChannel.ONLINE,
          creditCardId: cardAId,
        });

      // Verify list response contains separated cycle outstandings
      const listRes = await request(app)
        .get('/api/v1/credit-cards')
        .set('Cookie', userCookieA);

      expect(listRes.status).toBe(200);
      const card = listRes.body.data.find((c: any) => c.id === cardAId);
      expect(card).toBeDefined();
      expect(card.currentOutstanding).toBe(13000); // 8000 + 5000
      expect(card.previousCycleOutstanding).toBe(8000);
      expect(card.ongoingCycleOutstanding).toBe(5000);
      expect(card.availableCredit).toBe(87000); // 100000 - 13000

      // Invariant: Total Outstanding = Previous-Cycle + Ongoing-Cycle
      expect(card.currentOutstanding).toBe(card.previousCycleOutstanding + card.ongoingCycleOutstanding);
    });

    it('fetches card full details at /:id/details with grouped cycles and KPI metrics', async () => {
      const detailsRes = await request(app)
        .get(`/api/v1/credit-cards/${cardAId}/details`)
        .set('Cookie', userCookieA);

      expect(detailsRes.status).toBe(200);
      expect(detailsRes.body.success).toBe(true);
      const detail = detailsRes.body.data;

      expect(detail.totalOutstanding).toBe(13000);
      expect(detail.previousCycleOutstanding).toBe(8000);
      expect(detail.ongoingCycleOutstanding).toBe(5000);
      expect(detail.availableCredit).toBe(87000);
      expect(detail.cycles).toBeDefined();
      expect(detail.cycles.length).toBeGreaterThan(0);

      // Verify ongoing cycle has the ongoing purchase
      const ongoing = detail.cycles.find((c: any) => c.isCurrentCycle);
      expect(ongoing).toBeDefined();
      expect(ongoing.transactions.some((t: any) => t.title === 'Electronics (Ongoing Cycle)')).toBe(true);

      // Verify previous closed cycle has the flight purchase
      const closed = detail.cycles.find((c: any) => !c.isCurrentCycle && c.transactions.length > 0);
      expect(closed).toBeDefined();
      expect(closed.transactions.some((t: any) => t.title === 'Flight Ticket (Previous Cycle)')).toBe(true);
    });

    it('settles previous-cycle debt using CreditCardRepaymentMode.PREVIOUS_CYCLE', async () => {
      const repayRes = await request(app)
        .post('/api/v1/credit-cards/repayment')
        .set('Cookie', userCookieA)
        .send({
          creditCardId: cardAId,
          sourceAccountId: bankAccountAId,
          repaymentMode: CreditCardRepaymentMode.PREVIOUS_CYCLE,
          idempotencyKey: 'test-repay-prev-cycle-1',
          date: new Date().toISOString(),
        });

      expect(repayRes.status).toBe(201);
      expect(repayRes.body.success).toBe(true);
      expect(repayRes.body.data.transaction.liabilitySettled).toBe(8000);
      expect(repayRes.body.data.transaction.amount).toBe(8000);

      // Fetch card details to verify reconciliation
      const detailsRes = await request(app)
        .get(`/api/v1/credit-cards/${cardAId}/details`)
        .set('Cookie', userCookieA);

      const detail = detailsRes.body.data;
      // Previous cycle debt is settled!
      expect(detail.previousCycleOutstanding).toBe(0);
      // Ongoing cycle debt remains intact
      expect(detail.ongoingCycleOutstanding).toBe(5000);
      // Total outstanding is 5000
      expect(detail.totalOutstanding).toBe(5000);
      expect(detail.availableCredit).toBe(95000);
      expect(detail.totalOutstanding).toBe(detail.previousCycleOutstanding + detail.ongoingCycleOutstanding);
    });

    it('supports partial repayment using CreditCardRepaymentMode.CUSTOM_PARTIAL with reward points redemption', async () => {
      // Settle ₹2,000 of ongoing debt with ₹500 reward redemption and ₹1,500 bank payment
      const repayRes = await request(app)
        .post('/api/v1/credit-cards/repayment')
        .set('Cookie', userCookieA)
        .send({
          creditCardId: cardAId,
          sourceAccountId: bankAccountAId,
          repaymentMode: CreditCardRepaymentMode.CUSTOM_PARTIAL,
          liabilitySettled: 2000,
          redemptionCredit: 500,
          redemptionNotes: 'ICICI Reward Points',
          idempotencyKey: 'test-repay-partial-1',
          date: new Date().toISOString(),
        });

      expect(repayRes.status).toBe(201);
      expect(repayRes.body.success).toBe(true);
      const tx = repayRes.body.data.transaction;
      expect(tx.liabilitySettled).toBe(2000);
      expect(tx.amount).toBe(1500); // 2000 - 500 net bank deduction
      expect(tx.redemptionCredit).toBe(500);

      // Verify card balance reduced by full liability settled (2000)
      const detailsRes = await request(app)
        .get(`/api/v1/credit-cards/${cardAId}/details`)
        .set('Cookie', userCookieA);

      const detail = detailsRes.body.data;
      expect(detail.totalOutstanding).toBe(3000); // 5000 - 2000
      expect(detail.ongoingCycleOutstanding).toBe(3000);
      expect(detail.availableCredit).toBe(97000);
    });

    it('settles remaining debt completely using CreditCardRepaymentMode.FULL_CURRENT', async () => {
      const repayRes = await request(app)
        .post('/api/v1/credit-cards/repayment')
        .set('Cookie', userCookieA)
        .send({
          creditCardId: cardAId,
          sourceAccountId: bankAccountAId,
          repaymentMode: CreditCardRepaymentMode.FULL_CURRENT,
          idempotencyKey: 'test-repay-full-1',
          date: new Date().toISOString(),
        });

      expect(repayRes.status).toBe(201);
      expect(repayRes.body.success).toBe(true);
      expect(repayRes.body.data.transaction.liabilitySettled).toBe(3000);
      expect(repayRes.body.data.transaction.amount).toBe(3000);

      // Verify zero outstanding
      const detailsRes = await request(app)
        .get(`/api/v1/credit-cards/${cardAId}/details`)
        .set('Cookie', userCookieA);

      const detail = detailsRes.body.data;
      expect(detail.totalOutstanding).toBe(0);
      expect(detail.previousCycleOutstanding).toBe(0);
      expect(detail.ongoingCycleOutstanding).toBe(0);
      expect(detail.availableCredit).toBe(100000);
    });

    it('records a merchant refund which reduces outstanding and restores available credit', async () => {
      // First make a purchase of ₹4,000
      await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', userCookieA)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Online Retail',
          amount: 4000,
          currency: 'INR',
          date: new Date().toISOString(),
          category: 'Shopping',
          paymentMethod: PaymentMethod.CREDIT_CARD,
          paymentChannel: PaymentChannel.ONLINE,
          creditCardId: cardAId,
        });

      // Record ₹1,000 refund
      const refundRes = await request(app)
        .post(`/api/v1/credit-cards/${cardAId}/refund`)
        .set('Cookie', userCookieA)
        .send({
          amount: 1000,
          title: 'Order Item Return',
          idempotencyKey: 'test-refund-1',
        });

      expect(refundRes.status).toBe(201);
      expect(refundRes.body.success).toBe(true);

      const detailsRes = await request(app)
        .get(`/api/v1/credit-cards/${cardAId}/details`)
        .set('Cookie', userCookieA);

      const detail = detailsRes.body.data;
      expect(detail.totalOutstanding).toBe(3000); // 4000 - 1000
      expect(detail.availableCredit).toBe(97000);
    });

    it('enforces strict tenant isolation: User B cannot access User A card details', async () => {
      const res = await request(app)
        .get(`/api/v1/credit-cards/${cardAId}/details`)
        .set('Cookie', userCookieB);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('enforces strict tenant isolation: User B cannot repay User A card', async () => {
      const res = await request(app)
        .post('/api/v1/credit-cards/repayment')
        .set('Cookie', userCookieB)
        .send({
          creditCardId: cardAId,
          sourceAccountId: bankAccountAId,
          repaymentMode: CreditCardRepaymentMode.FULL_CURRENT,
          idempotencyKey: 'cross-tenant-repay-attempt',
          date: new Date().toISOString(),
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('creates opening outstanding with custom date as a past-recorded expense and assigns to cycle without overdue flag', async () => {
      const today = new Date();
      const openDate = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();

      const cardRes = await request(app)
        .post('/api/v1/credit-cards')
        .set('Cookie', userCookieA)
        .send({
          cardNickname: 'New Travel Card',
          issuingBank: 'Axis Bank',
          network: CreditCardNetwork.VISA,
          creditLimit: 200000,
          billingCycleClosingDay: 20,
          openingOutstanding: 15000,
          openingOutstandingDate: openDate,
        });

      expect(cardRes.status).toBe(201);
      expect(cardRes.body.success).toBe(true);
      const newCardId = cardRes.body.data.id;

      // Verify Transaction was created with isPastRecorded: true
      const { Transaction } = await import('../models/Transaction');
      const openTx = await Transaction.findOne({
        creditCardId: newCardId,
        isPastRecorded: true,
      });
      expect(openTx).not.toBeNull();
      expect(openTx?.amount).toBe(15000);
      expect(openTx?.category).toBe('Other expenses');

      // Verify card details
      const detailsRes = await request(app)
        .get(`/api/v1/credit-cards/${newCardId}/details`)
        .set('Cookie', userCookieA);

      expect(detailsRes.status).toBe(200);
      const detail = detailsRes.body.data;
      expect(detail.totalOutstanding).toBe(15000);
      expect(detail.availableCredit).toBe(185000);

      // Verify latest statement is not erroneously marked OVERDUE
      if (detail.latestStatement) {
        expect(detail.latestStatement.status).not.toBe(StatementStatus.OVERDUE);
      }
    });

    it('correctly marks closed statement as PAID when payment is made after closing date and associates payment to closed cycle', async () => {
      // 1. Create a card with closing day on the 20th
      const cardRes = await request(app)
        .post('/api/v1/credit-cards')
        .set('Cookie', userCookieA)
        .send({
          cardNickname: 'IDFC Statement Test Card',
          issuingBank: 'IDFC FIRST',
          network: CreditCardNetwork.VISA,
          creditLimit: 100000,
          billingCycleClosingDay: 20,
          openingOutstanding: 0,
        });

      expect(cardRes.status).toBe(201);
      const testCardId = cardRes.body.data.id;

      // 2. Add an expense in the previous cycle (e.g. 15th of current month if today > 20, or last month)
      const dates = calculateCardCycleDates(20, undefined, new Date());
      // A date safely inside the last closed cycle
      const closedCycleTxDate = new Date(dates.lastPeriodStart.getTime() + 2 * 86400000); // 2 days after period start

      await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', userCookieA)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Umma Recharge',
          amount: 373.19,
          date: closedCycleTxDate.toISOString(),
          category: 'Mobile recharge',
          paymentMethod: PaymentMethod.CREDIT_CARD,
          paymentChannel: PaymentChannel.ONLINE,
          creditCardId: testCardId,
        });

      // 3. Add an expense in the ongoing cycle
      const ongoingTxDate = new Date(dates.ongoingPeriodStart.getTime() + 86400000); // 1 day into ongoing cycle
      await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', userCookieA)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Kallumakkai',
          amount: 280,
          date: ongoingTxDate.toISOString(),
          category: 'Groceries',
          paymentMethod: PaymentMethod.CREDIT_CARD,
          paymentChannel: PaymentChannel.ONLINE,
          creditCardId: testCardId,
        });

      // Check details before payment: previous cycle should have 373.19 due
      let detailsRes = await request(app)
        .get(`/api/v1/credit-cards/${testCardId}/details`)
        .set('Cookie', userCookieA);
      expect(detailsRes.status).toBe(200);
      expect(detailsRes.body.data.previousCycleOutstanding).toBe(373.19);
      expect(detailsRes.body.data.ongoingCycleOutstanding).toBe(280);

      // 4. Now user repays the previous cycle statement on a date AFTER statement closing (in ongoing cycle)
      const repaymentDate = new Date(dates.ongoingPeriodStart.getTime() + 2 * 86400000);
      const repayRes = await request(app)
        .post('/api/v1/credit-cards/repayment')
        .set('Cookie', userCookieA)
        .send({
          creditCardId: testCardId,
          sourceAccountId: bankAccountAId,
          repaymentMode: CreditCardRepaymentMode.PREVIOUS_CYCLE,
          amount: 373.19,
          liabilitySettled: 373.19,
          date: repaymentDate.toISOString(),
          notes: 'Full previous cycle bill repayment',
          idempotencyKey: 'repay-test-post-closing',
        });
      expect(repayRes.status).toBe(201);

      // 5. Fetch full details after payment
      detailsRes = await request(app)
        .get(`/api/v1/credit-cards/${testCardId}/details`)
        .set('Cookie', userCookieA);
      expect(detailsRes.status).toBe(200);
      const detail = detailsRes.body.data;

      // Outstanding checks
      expect(detail.previousCycleOutstanding).toBe(0);
      expect(detail.ongoingCycleOutstanding).toBe(280);
      expect(detail.totalOutstanding).toBe(280);

      // Statement snapshots check: latest closed statement must show PAID with 0 remaining
      const statements = detail.statements;
      expect(statements.length).toBeGreaterThan(0);
      const latestStmt = statements[0];
      expect(latestStmt.statementBalance).toBe(373.19);
      expect(latestStmt.paymentsReceived).toBe(373.19);
      expect(latestStmt.amountPaid).toBe(373.19);
      expect(latestStmt.remainingBalance).toBe(0);
      expect(latestStmt.status).toBe(StatementStatus.PAID);

      // Cycle grouping checks:
      const ongoingCycle = detail.cycles.find((c: any) => c.isCurrentCycle);
      const closedCycle = detail.cycles.find((c: any) => !c.isCurrentCycle);

      // Ongoing cycle should ONLY contain the ongoing purchase (280), not the previous cycle repayment
      expect(ongoingCycle.statementAmount).toBe(280);
      expect(ongoingCycle.transactions.length).toBe(1);
      expect(ongoingCycle.transactions[0].title).toBe('Kallumakkai');

      // Closed cycle should contain the purchase AND the repayment transaction
      expect(closedCycle.statementAmount).toBe(373.19);
      expect(closedCycle.amountPaid).toBe(373.19);
      expect(closedCycle.remainingDue).toBe(0);
      expect(closedCycle.status).toBe(StatementStatus.PAID);
      const paymentInClosed = closedCycle.transactions.find((t: any) => t.type === TransactionType.CREDIT_CARD_PAYMENT);
      expect(paymentInClosed).toBeDefined();
      expect(paymentInClosed.amount).toBe(373.19);
    });

    it('handles card deletion: permanently deletes card when 0 transactions exist, archives when transactions exist', async () => {
      // 1. Create a card with 0 transactions
      const emptyCardRes = await request(app)
        .post('/api/v1/credit-cards')
        .set('Cookie', userCookieA)
        .send({
          cardNickname: 'Empty Delete Card',
          issuingBank: 'HDFC Bank',
          network: CreditCardNetwork.VISA,
          creditLimit: 50000,
          billingCycleClosingDay: 10,
          openingOutstanding: 0,
        });
      expect(emptyCardRes.status).toBe(201);
      const emptyCardId = emptyCardRes.body.data.id;

      // Delete the empty card
      const delEmptyRes = await request(app)
        .delete(`/api/v1/credit-cards/${emptyCardId}`)
        .set('Cookie', userCookieA);
      expect(delEmptyRes.status).toBe(200);

      // Card should be completely gone from database
      const { CreditCard } = await import('../models/CreditCard');
      const foundEmpty = await CreditCard.findById(emptyCardId);
      expect(foundEmpty).toBeNull();

      // 2. Card with transactions should be archived
      const cardWithTxRes = await request(app)
        .post('/api/v1/credit-cards')
        .set('Cookie', userCookieA)
        .send({
          cardNickname: 'Card With Tx',
          issuingBank: 'ICICI Bank',
          network: CreditCardNetwork.MASTERCARD,
          creditLimit: 50000,
          billingCycleClosingDay: 10,
          openingOutstanding: 0,
        });
      expect(cardWithTxRes.status).toBe(201);
      const cardWithTxId = cardWithTxRes.body.data.id;

      await request(app)
        .post('/api/v1/transactions')
        .set('Cookie', userCookieA)
        .send({
          type: TransactionType.EXPENSE,
          title: 'Coffee',
          amount: 250,
          date: new Date().toISOString(),
          category: 'Food',
          paymentMethod: PaymentMethod.CREDIT_CARD,
          paymentChannel: PaymentChannel.OFFLINE,
          creditCardId: cardWithTxId,
        });

      // Delete card with transactions
      const delWithTxRes = await request(app)
        .delete(`/api/v1/credit-cards/${cardWithTxId}`)
        .set('Cookie', userCookieA);
      expect(delWithTxRes.status).toBe(200);

      // Card record still exists in database, but marked archived
      const foundArchived = await CreditCard.findById(cardWithTxId);
      expect(foundArchived).not.toBeNull();
      expect(foundArchived?.isArchived).toBe(true);

      // Card does not appear in active credit cards list
      const listRes = await request(app)
        .get('/api/v1/credit-cards')
        .set('Cookie', userCookieA);
      expect(listRes.status).toBe(200);
      const activeIds = listRes.body.data.map((c: any) => c.id);
      expect(activeIds).not.toContain(cardWithTxId);
    });
  });
});
