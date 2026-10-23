import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { RecurringTransaction } from '../models/RecurringTransaction';
import { RecurringOccurrence } from '../models/RecurringOccurrence';
import { Transaction } from '../models/Transaction';
import { BankAccount } from '../models/BankAccount';
import {
  AccountType,
  TransactionType,
  RecurringFrequency,
  PaymentMethod,
  PaymentChannel,
} from '@finora/shared';

describe('Phase 6: Recurring Transactions Improvements & Lifecycle Test Suite', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let bankAccountId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // Register User
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'recurring.tester@finora.test',
        password: 'Password123!',
        fullName: 'Recurring Tester',
        currency: 'INR',
      });
    userCookie = regRes.headers['set-cookie'][0];

    // Create Bank Account with ₹100,000
    const accRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'Operating Account',
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
    await mongoServer.stop();
  });

  it('Step 1: Creates recurring rule with isFlexibleDate: true', async () => {
    const res = await request(app)
      .post('/api/v1/recurring')
      .set('Cookie', userCookie)
      .send({
        title: 'Broadband Internet',
        amount: 1500,
        type: TransactionType.EXPENSE,
        category: 'Utilities',
        frequency: RecurringFrequency.MONTHLY,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        paymentChannel: PaymentChannel.ONLINE,
        accountId: bankAccountId,
        nextExecutionDate: '2026-10-15',
        notes: 'Monthly optical fiber bill',
        isActive: true,
        isFlexibleDate: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isFlexibleDate).toBe(true);
    expect(res.body.data.status).toBe('active');

    // Verify initial DUE occurrence was created
    const occ = await RecurringOccurrence.findOne({
      recurringRuleId: res.body.data.id || res.body.data._id,
      occurrenceKey: '2026-10',
    });
    expect(occ).not.toBeNull();
    expect(occ?.status).toBe('DUE');
  });

  it('Step 2: Upcoming forecast includes flexible date recurring item in remaining needed', async () => {
    const res = await request(app)
      .get('/api/v1/analytics/upcoming-forecast?month=2026-10')
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.month).toBe('2026-10');
    expect(res.body.data.recurringPaymentsRemaining).toBe(1500);
    expect(res.body.data.remainingAmountNeeded).toBe(1500);

    const item = res.body.data.items.find((i: any) => i.title === 'Broadband Internet');
    expect(item).toBeDefined();
    expect(item.type).toBe('recurring');
    expect(item.status).toBe('unpaid');
    expect(item.isFlexibleDate).toBe(true);
  });

  it('Step 3: "Skip This Month" marks occurrence as SKIPPED, does not debit balance, and omits from remaining needed', async () => {
    const rulesRes = await request(app)
      .get('/api/v1/recurring')
      .set('Cookie', userCookie);
    const rule = rulesRes.body.data.find((r: any) => r.title === 'Broadband Internet');

    // Initial bank balance
    const bankBefore = await BankAccount.findById(bankAccountId);
    expect(bankBefore?.currentBalance).toBe(100000);

    // Skip the 2026-10 installment
    const skipRes = await request(app)
      .post(`/api/v1/recurring/${rule.id || rule._id}/skip`)
      .set('Cookie', userCookie)
      .send({ occurrenceKey: '2026-10' });

    expect(skipRes.status).toBe(200);
    expect(skipRes.body.success).toBe(true);
    expect(skipRes.body.data.occurrence.status).toBe('SKIPPED');

    // Verify bank balance is strictly preserved (no money debited)
    const bankAfter = await BankAccount.findById(bankAccountId);
    expect(bankAfter?.currentBalance).toBe(100000);

    // Verify no Transaction was created
    const txCount = await Transaction.countDocuments({ recurringRuleId: rule.id || rule._id });
    expect(txCount).toBe(0);

    // Check Upcoming Forecast for 2026-10: obligation shows status "skipped", omitted from remaining needed
    const forecastRes = await request(app)
      .get('/api/v1/analytics/upcoming-forecast?month=2026-10')
      .set('Cookie', userCookie);

    expect(forecastRes.status).toBe(200);
    expect(forecastRes.body.data.recurringPaymentsRemaining).toBe(0);
    expect(forecastRes.body.data.remainingAmountNeeded).toBe(0);

    const skippedItem = forecastRes.body.data.items.find((i: any) => i.title === 'Broadband Internet');
    expect(skippedItem).toBeDefined();
    expect(skippedItem.status).toBe('skipped');

    // Next month (2026-11) has an automatically scheduled DUE occurrence
    const occNov = await RecurringOccurrence.findOne({
      recurringRuleId: rule.id || rule._id,
      occurrenceKey: '2026-11',
    });
    expect(occNov).not.toBeNull();
    expect(occNov?.status).toBe('DUE');
  });

  it('Step 4: Execute payment for November and block subsequent skip attempt on paid cycle', async () => {
    const rulesRes = await request(app)
      .get('/api/v1/recurring')
      .set('Cookie', userCookie);
    const rule = rulesRes.body.data.find((r: any) => r.title === 'Broadband Internet');

    // Execute November payment
    const execRes = await request(app)
      .post(`/api/v1/recurring/${rule.id || rule._id}/execute`)
      .set('Cookie', userCookie)
      .send({
        occurrenceKey: '2026-11',
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
      });

    expect(execRes.status).toBe(200);
    expect(execRes.body.success).toBe(true);

    // Bank balance debited by 1500
    const bankAfterExec = await BankAccount.findById(bankAccountId);
    expect(bankAfterExec?.currentBalance).toBe(98500);

    // Attempting to skip November must fail
    const skipFailRes = await request(app)
      .post(`/api/v1/recurring/${rule.id || rule._id}/skip`)
      .set('Cookie', userCookie)
      .send({ occurrenceKey: '2026-11' });

    expect(skipFailRes.status).toBe(400);
    expect(skipFailRes.body.error?.code).toBe('CANNOT_SKIP_PAID_OCCURRENCE');
  });

  it('Step 5: "Mark as Completed" sets status: completed, isActive: false, and cleans up future DUE occurrences', async () => {
    const rulesRes = await request(app)
      .get('/api/v1/recurring')
      .set('Cookie', userCookie);
    const rule = rulesRes.body.data.find((r: any) => r.title === 'Broadband Internet');

    const compRes = await request(app)
      .post(`/api/v1/recurring/${rule.id || rule._id}/complete`)
      .set('Cookie', userCookie);

    expect(compRes.status).toBe(200);
    expect(compRes.body.success).toBe(true);
    expect(compRes.body.data.status).toBe('completed');
    expect(compRes.body.data.isActive).toBe(false);

    // Future DUE occurrence for December (2026-12) is cleaned up
    const decOcc = await RecurringOccurrence.findOne({
      recurringRuleId: rule.id || rule._id,
      occurrenceKey: '2026-12',
      status: 'DUE',
    });
    expect(decOcc).toBeNull();

    // Past occurrences (2026-10 SKIPPED, 2026-11 LOGGED) remain preserved
    const pastOccurrences = await RecurringOccurrence.find({
      recurringRuleId: rule.id || rule._id,
    });
    expect(pastOccurrences.length).toBe(2);
  });

  it('Step 6: "Cancel Future Payments" cancels an active rule cleanly', async () => {
    // Create another rule
    const res = await request(app)
      .post('/api/v1/recurring')
      .set('Cookie', userCookie)
      .send({
        title: 'Gym Membership',
        amount: 2000,
        type: TransactionType.EXPENSE,
        category: 'Health',
        frequency: RecurringFrequency.MONTHLY,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        paymentChannel: PaymentChannel.ONLINE,
        accountId: bankAccountId,
        nextExecutionDate: '2026-10-20',
        isActive: true,
      });

    const ruleId = res.body.data.id || res.body.data._id;

    const cancelRes = await request(app)
      .post(`/api/v1/recurring/${ruleId}/cancel`)
      .set('Cookie', userCookie);

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe('cancelled');
    expect(cancelRes.body.data.isActive).toBe(false);

    // DUE occurrence was cleaned up
    const dueOcc = await RecurringOccurrence.findOne({
      recurringRuleId: ruleId,
      status: 'DUE',
    });
    expect(dueOcc).toBeNull();
  });

  it('Step 7: Deleting a rule cascades and removes its occurrences safely', async () => {
    const rulesRes = await request(app)
      .get('/api/v1/recurring')
      .set('Cookie', userCookie);
    const rule = rulesRes.body.data.find((r: any) => r.title === 'Gym Membership');

    const delRes = await request(app)
      .delete(`/api/v1/recurring/${rule.id || rule._id}`)
      .set('Cookie', userCookie);

    expect(delRes.status).toBe(200);

    const occurrencesLeft = await RecurringOccurrence.find({ recurringRuleId: rule.id || rule._id });
    expect(occurrencesLeft.length).toBe(0);
  });
});
