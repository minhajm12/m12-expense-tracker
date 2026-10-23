import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { User } from '../models/User';
import { BankAccount } from '../models/BankAccount';
import { Transaction } from '../models/Transaction';
import { AccountType, TransactionType, TransactionStatus, PaymentMethod } from '@finora/shared';

describe('Phase 2: Settings Feature Toggles & Preferences Persistence', () => {
  let mongoServer: MongoMemoryServer;
  let user1Cookie: string;
  let user1Id: string;
  let user2Cookie: string;
  let user2Id: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await connectDatabase(uri);

    // Register User 1
    const res1 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'user1.toggles@finora.test',
        password: 'Password123!',
        fullName: 'User One',
        currency: 'INR',
      });
    user1Cookie = Array.isArray(res1.headers['set-cookie'])
      ? res1.headers['set-cookie'][0]
      : res1.headers['set-cookie'];
    user1Id = res1.body.data.user.id;

    // Register User 2
    const res2 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'user2.toggles@finora.test',
        password: 'Password123!',
        fullName: 'User Two',
        currency: 'INR',
      });
    user2Cookie = Array.isArray(res2.headers['set-cookie'])
      ? res2.headers['set-cookie'][0]
      : res2.headers['set-cookie'];
    user2Id = res2.body.data.user.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
  });

  it('Default preferences: All 7 modules are enabled by default for existing users', async () => {
    const res = await request(app)
      .get('/api/v1/settings/modules')
      .set('Cookie', user1Cookie);

    expect(res.status).toBe(200);
    const prefs = res.body.data.modulePreferences;
    expect(prefs.expenseTracker).toBe(true);
    expect(prefs.emi).toBe(true);
    expect(prefs.lendingBorrowing).toBe(true);
    expect(prefs.budget).toBe(true);
    expect(prefs.recurringTransactions).toBe(true);
    expect(prefs.creditCards).toBe(true);
    expect(prefs.chitFund).toBe(true);
  });

  it('Independent toggle: can toggle each module independently without affecting others', async () => {
    // Disable EMI and Chit Fund
    const updateRes = await request(app)
      .patch('/api/v1/settings/modules')
      .set('Cookie', user1Cookie)
      .send({
        emi: false,
        chitFund: false,
      });

    expect(updateRes.status).toBe(200);
    const prefs = updateRes.body.data.modulePreferences;
    expect(prefs.emi).toBe(false);
    expect(prefs.chitFund).toBe(false);
    // Others remain enabled
    expect(prefs.expenseTracker).toBe(true);
    expect(prefs.lendingBorrowing).toBe(true);
    expect(prefs.budget).toBe(true);
    expect(prefs.recurringTransactions).toBe(true);
    expect(prefs.creditCards).toBe(true);
  });

  it('Persistence across logout and login: preferences remain intact in database', async () => {
    // Logout user 1
    await request(app).post('/api/v1/auth/logout').set('Cookie', user1Cookie);

    // Login user 1 again
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: 'user1.toggles@finora.test',
        password: 'Password123!',
      });
    expect(loginRes.status).toBe(200);
    const newCookie = Array.isArray(loginRes.headers['set-cookie'])
      ? loginRes.headers['set-cookie'][0]
      : loginRes.headers['set-cookie'];

    // Verify preferences in profile
    const profilePrefs = loginRes.body.data.user.modulePreferences;
    expect(profilePrefs.emi).toBe(false);
    expect(profilePrefs.chitFund).toBe(false);
    expect(profilePrefs.expenseTracker).toBe(true);

    // Verify via settings endpoint
    const checkRes = await request(app)
      .get('/api/v1/settings/modules')
      .set('Cookie', newCookie);
    expect(checkRes.status).toBe(200);
    expect(checkRes.body.data.modulePreferences.emi).toBe(false);
    expect(checkRes.body.data.modulePreferences.chitFund).toBe(false);

    user1Cookie = newCookie;
  });

  it('Isolation between users: User 1 preferences NEVER affect User 2', async () => {
    const res2 = await request(app)
      .get('/api/v1/settings/modules')
      .set('Cookie', user2Cookie);

    expect(res2.status).toBe(200);
    // User 2 must still have all modules enabled
    const prefs2 = res2.body.data.modulePreferences;
    expect(prefs2.emi).toBe(true);
    expect(prefs2.chitFund).toBe(true);
    expect(prefs2.expenseTracker).toBe(true);
  });

  it('Financial data preservation: toggling modules off and on never deletes or alters financial records', async () => {
    // Create an account and transaction for user 1
    const acc = await BankAccount.create({
      userId: user1Id,
      accountName: 'Test Savings',
      bankName: 'HDFC Bank',
      accountType: AccountType.SAVINGS,
      openingBalance: 50000,
      openingBalanceDate: new Date(),
      currentBalance: 50000,
    });

    const tx = await Transaction.create({
      userId: user1Id,
      title: 'Groceries',
      amount: 2500,
      type: TransactionType.EXPENSE,
      category: 'Food & Dining',
      paymentMethod: PaymentMethod.UPI,
      paymentChannel: 'online',
      accountId: acc._id,
      date: new Date(),
      status: TransactionStatus.COMPLETED,
    });

    // Disable expenseTracker
    await request(app)
      .patch('/api/v1/settings/modules')
      .set('Cookie', user1Cookie)
      .send({ expenseTracker: false });

    // Verify records exist in database untouched
    const txCount = await Transaction.countDocuments({ userId: user1Id });
    expect(txCount).toBeGreaterThanOrEqual(1);
    const accFound = await BankAccount.findById(acc._id);
    expect(accFound).not.toBeNull();
    expect(accFound?.currentBalance).toBe(50000);

    // Re-enable expenseTracker
    const reEnableRes = await request(app)
      .patch('/api/v1/settings/modules')
      .set('Cookie', user1Cookie)
      .send({ expenseTracker: true });

    expect(reEnableRes.status).toBe(200);
    expect(reEnableRes.body.data.modulePreferences.expenseTracker).toBe(true);
  });
});
