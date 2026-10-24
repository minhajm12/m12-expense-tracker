import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { User } from '../models/User';
import { BankAccount } from '../models/BankAccount';
import { Transaction } from '../models/Transaction';
import { LendingBorrowing } from '../models/LendingBorrowing';
import { EmiRule } from '../models/EmiRule';
import { Investment } from '../models/Investment';
import { ChitFund } from '../models/ChitFund';
import {
  AccountType,
  TransactionType,
  TransactionStatus,
  PaymentMethod,
  PaymentChannel,
  LendingBorrowingType,
} from '@finora/shared';

describe('Settings: Permanent Account Deletion & Feature-Aware Resets', () => {
  let mongoServer: MongoMemoryServer;
  let user1Token: string;
  let user1Cookie: string;
  let user1Id: string;
  let user2Token: string;
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
        email: 'user1.deletion@finora.test',
        password: 'Password123!',
        fullName: 'User To Delete',
        currency: 'INR',
      });
    user1Cookie = Array.isArray(res1.headers['set-cookie'])
      ? res1.headers['set-cookie'][0]
      : res1.headers['set-cookie'];
    user1Token = res1.body.data.token;
    user1Id = res1.body.data.user.id;

    // Register User 2 (multi-tenant safety verification)
    const res2 = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'user2.preserved@finora.test',
        password: 'Password123!',
        fullName: 'Preserved User',
        currency: 'INR',
      });
    user2Cookie = Array.isArray(res2.headers['set-cookie'])
      ? res2.headers['set-cookie'][0]
      : res2.headers['set-cookie'];
    user2Token = res2.body.data.token;
    user2Id = res2.body.data.user.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
  });

  describe('Feature-Aware Reset Endpoints', () => {
    it('1. blocks chit fund reset when chit fund module is disabled', async () => {
      // Disable chitFund for user 2
      await request(app)
        .patch('/api/v1/settings/module-preferences')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ chitFund: false });

      const res = await request(app)
        .post('/api/v1/settings/reset-all-chit-winners')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ confirmationPhrase: 'RESET ALL WINNERS' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('MODULE_DISABLED');
    });

    it('2. blocks investment reset when investment module is disabled', async () => {
      // Disable investment for user 2
      await request(app)
        .patch('/api/v1/settings/module-preferences')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ investment: false });

      const res = await request(app)
        .post('/api/v1/investments/reset-all')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ confirmationPhrase: 'RESET INVESTMENTS' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('MODULE_DISABLED');
    });

    it('3. blocks lending & borrowing reset when module is disabled', async () => {
      // Disable lendingBorrowing for user 2
      await request(app)
        .patch('/api/v1/settings/module-preferences')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ lendingBorrowing: false });

      const res = await request(app)
        .post('/api/v1/settings/reset-lending-borrowing')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ confirmationPhrase: 'RESET LENDING DATA' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('MODULE_DISABLED');
    });

    it('4. blocks EMI reset when EMI module is disabled', async () => {
      // Disable emi for user 2
      await request(app)
        .patch('/api/v1/settings/module-preferences')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ emi: false });

      const res = await request(app)
        .post('/api/v1/settings/reset-emi')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ confirmationPhrase: 'RESET EMI DATA' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('MODULE_DISABLED');
    });

    it('5. allows reset-all-financial-data regardless of optional module status', async () => {
      // User 2 has modules disabled, but reset-all-financial-data must remain active
      const res = await request(app)
        .post('/api/v1/settings/reset-all-financial-data')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ confirmationPhrase: 'RESET MY DATA' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.resetCompleted).toBe(true);
      expect(res.body.data.userPreserved).toBe(true);
    });
  });

  describe('Dedicated Lending & EMI Resets', () => {
    it('6. resets lending & borrowing data when feature is enabled and phrase matches', async () => {
      // Re-enable lendingBorrowing for user 2
      await request(app)
        .patch('/api/v1/settings/module-preferences')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ lendingBorrowing: true });

      // Create a test lending record
      await LendingBorrowing.create({
        userId: user2Id,
        type: LendingBorrowingType.LENDING,
        personName: 'Borrower Friend',
        amount: 5000,
        outstandingAmount: 5000,
        currency: 'INR',
        date: new Date(),
        paymentMethod: 'cash',
        isHistorical: false,
      });

      const res = await request(app)
        .post('/api/v1/settings/reset-lending-borrowing')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ confirmationPhrase: 'RESET LENDING DATA' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const remainingRecords = await LendingBorrowing.find({ userId: user2Id });
      expect(remainingRecords).toHaveLength(0);
    });

    it('7. resets EMI data when feature is enabled and phrase matches', async () => {
      // Re-enable emi for user 2
      await request(app)
        .patch('/api/v1/settings/module-preferences')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ emi: true });

      // Create a test EMI rule
      await EmiRule.create({
        userId: user2Id,
        name: 'Home Loan',
        lender: 'HDFC Bank',
        monthlyAmount: 20000,
        startDate: new Date(),
        firstDueDate: new Date(),
        endDate: new Date(Date.now() + 365 * 86400000),
        dueDay: 5,
        totalInstallments: 12,
        status: 'active',
        isHistorical: false,
      });

      const res = await request(app)
        .post('/api/v1/settings/reset-emi')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ confirmationPhrase: 'RESET EMI DATA' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const remainingRules = await EmiRule.find({ userId: user2Id });
      expect(remainingRules).toHaveLength(0);
    });
  });

  describe('Permanent Account Deletion', () => {
    it('8. rejects deletion if confirmation phrase is incorrect', async () => {
      const res = await request(app)
        .post('/api/v1/settings/delete-account')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ confirmationPhrase: 'INCORRECT' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('9. rejects deletion if password verification fails', async () => {
      const res = await request(app)
        .post('/api/v1/settings/delete-account')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ confirmationPhrase: 'DELETE', password: 'WrongPassword999!' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_PASSWORD');
    });

    it('10. permanently deletes user account and all personal and financial data', async () => {
      // Create user 1 data across multiple collections
      const acc = await BankAccount.create({
        userId: user1Id,
        accountName: 'User 1 Savings',
        bankName: 'HDFC',
        accountType: AccountType.SAVINGS,
        currentBalance: 50000,
        openingBalance: 50000,
        currency: 'INR',
      });

      await Transaction.create({
        userId: user1Id,
        bankAccountId: acc._id,
        title: 'Food Expense',
        amount: 2000,
        type: TransactionType.EXPENSE,
        category: 'Food',
        date: new Date(),
        paymentMethod: PaymentMethod.UPI,
        paymentChannel: PaymentChannel.ONLINE,
        status: TransactionStatus.COMPLETED,
        currency: 'INR',
      });

      await LendingBorrowing.create({
        userId: user1Id,
        type: LendingBorrowingType.LENDING,
        personName: 'Debtor',
        amount: 10000,
        outstandingAmount: 10000,
        currency: 'INR',
        date: new Date(),
        paymentMethod: 'cash',
        isHistorical: false,
      });

      // Also ensure user 2 has a bank account to confirm other users are untouched
      const user2Acc = await BankAccount.create({
        userId: user2Id,
        accountName: 'User 2 Preserved',
        bankName: 'SBI',
        accountType: AccountType.SAVINGS,
        currentBalance: 75000,
        openingBalance: 75000,
        currency: 'INR',
      });

      // Execute permanent deletion for User 1
      const res = await request(app)
        .post('/api/v1/settings/delete-account')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ confirmationPhrase: 'DELETE', password: 'Password123!' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accountPermanentlyDeleted).toBe(true);

      // Verify User 1 is completely gone from the database
      const deletedUser = await User.findById(user1Id);
      expect(deletedUser).toBeNull();

      // Verify User 1's data is completely purged
      const user1Accounts = await BankAccount.find({ userId: user1Id });
      expect(user1Accounts).toHaveLength(0);

      const user1Transactions = await Transaction.find({ userId: user1Id });
      expect(user1Transactions).toHaveLength(0);

      const user1Lending = await LendingBorrowing.find({ userId: user1Id });
      expect(user1Lending).toHaveLength(0);

      // CRITICAL: Verify User 2 and User 2's data are completely preserved
      const preservedUser = await User.findById(user2Id);
      expect(preservedUser).not.toBeNull();
      expect(preservedUser!.email).toBe('user2.preserved@finora.test');

      const user2Accounts = await BankAccount.find({ userId: user2Id });
      expect(user2Accounts).toHaveLength(1);
      expect(user2Accounts[0]._id.toString()).toBe(user2Acc._id.toString());
    });

    it('11. prevents deleted user from accessing protected APIs using previously issued token', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('USER_NOT_FOUND');
    });

    it('12. prevents deleted user from logging in again', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'user1.deletion@finora.test',
          password: 'Password123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });
  });
});
