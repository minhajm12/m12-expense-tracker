import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { AccountType, TransactionType, EmiStatus, PaymentMethod, PaymentChannel, TransactionStatus } from '@finora/shared';
import { Transaction } from '../models/Transaction';
import { ChitFundCollection } from '../models/ChitFundCollection';
import { BankAccount } from '../models/BankAccount';
import { recalculateAccountBalance } from '../services/financial';

describe('Phase 2: Chit Fund Self Pay & Collection Enhancements Test Suite', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let userId: string;
  let chitBankAccountId: string;
  let personalBankAccountId: string;
  let chitFundId: string;
  let member1Id: string;
  let member2Id: string;
  let selfMemberId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // 1. Register User
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'chit.selfpay@finora.test',
        password: 'Password123!',
        fullName: 'Chit SelfPay Tester',
        currency: 'INR',
      });
    userCookie = regRes.headers['set-cookie'][0];
    userId = regRes.body.data.user.id;

    // 2. Create Designated Chit Bank Account with ₹100,000
    const acc1Res = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'HDFC Chit Fund Account',
        bankName: 'HDFC Bank',
        accountType: AccountType.SAVINGS,
        openingBalance: 100000,
        openingBalanceDate: new Date().toISOString(),
        currency: 'INR',
        isChitFundAccount: true,
      });
    chitBankAccountId = acc1Res.body.data.id;

    // 3. Create Separate Personal Bank Account with ₹50,000
    const acc2Res = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'SBI Personal Account',
        bankName: 'SBI',
        accountType: AccountType.SAVINGS,
        openingBalance: 50000,
        openingBalanceDate: new Date().toISOString(),
        currency: 'INR',
        isChitFundAccount: false,
      });
    personalBankAccountId = acc2Res.body.data.id;

    // 4. Set Initial Personal Cash in Hand to ₹10,000
    await request(app)
      .post('/api/v1/accounts/cash-in-hand/adjust')
      .set('Cookie', userCookie)
      .send({
        type: 'set_balance',
        amount: 10000,
        date: new Date().toISOString(),
        description: 'Opening personal cash',
      });

    // 5. Get Default Chit Fund & Add Members
    const cfRes = await request(app)
      .get('/api/v1/chit-funds')
      .set('Cookie', userCookie);
    chitFundId = cfRes.body.data.id;

    const m1 = await request(app)
      .post(`/api/v1/chit-funds/${chitFundId}/members`)
      .set('Cookie', userCookie)
      .send({ name: 'Rahul', numberOfChits: 1, contributionPerChit: 5000 });
    member1Id = m1.body.data.id;

    const m2 = await request(app)
      .post(`/api/v1/chit-funds/${chitFundId}/members`)
      .set('Cookie', userCookie)
      .send({ name: 'Sneha', numberOfChits: 1, contributionPerChit: 5000 });
    member2Id = m2.body.data.id;

    const mSelf = await request(app)
      .post(`/api/v1/chit-funds/${chitFundId}/members`)
      .set('Cookie', userCookie)
      .send({ name: 'Organizer (Self)', numberOfChits: 1, contributionPerChit: 5000 });
    selfMemberId = mSelf.body.data.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  // Test Case 1: Accepts cash_in_hand and upi, rejects deprecated self_pay
  it('1. Accepts designated payment methods: cash_in_hand and upi, rejects deprecated self_pay', async () => {
    const resCash = await request(app)
      .post(`/api/v1/chit-funds/${chitFundId}/collections`)
      .set('Cookie', userCookie)
      .send({
        memberId: member1Id,
        collectionPeriod: '2026-01',
        actualAmountReceived: 2000,
        expectedAmount: 5000,
        paymentMethod: 'cash_in_hand',
        collectionDate: new Date().toISOString(),
      });
    expect(resCash.status).toBe(201);
    expect(resCash.body.data.paymentMethod).toBe('cash_in_hand');

    const resUpi = await request(app)
      .post(`/api/v1/chit-funds/${chitFundId}/collections`)
      .set('Cookie', userCookie)
      .send({
        memberId: member2Id,
        collectionPeriod: '2026-01',
        actualAmountReceived: 3000,
        expectedAmount: 5000,
        paymentMethod: 'upi',
        collectionDate: new Date().toISOString(),
      });
    expect(resUpi.status).toBe(201);
    expect(resUpi.body.data.paymentMethod).toBe('upi');

    const resSelf = await request(app)
      .post(`/api/v1/chit-funds/${chitFundId}/collections`)
      .set('Cookie', userCookie)
      .send({
        memberId: selfMemberId,
        collectionPeriod: '2026-01',
        actualAmountReceived: 2500,
        expectedAmount: 5000,
        paymentMethod: 'self_pay',
        sourceAccountId: personalBankAccountId,
        collectionDate: new Date().toISOString(),
      });
    expect(resSelf.status).toBe(400);
    expect(resSelf.body.error?.code).toBe('SELF_PAY_DEPRECATED');
  });

  // Test Case 2: Verify Already Paid (isAlreadyPaid: true) for UPI reclassifies bank funds into chit reserve
  it('2. Already Paid (isAlreadyPaid: true) for UPI increases chit reserve and leaves physical bank balance unchanged', async () => {
    // Record baseline balances
    const cashBefore = await request(app).get('/api/v1/accounts/total-cash').set('Cookie', userCookie);
    const summaryBefore = await request(app).get(`/api/v1/chit-funds/${chitFundId}/summary`).set('Cookie', userCookie);
    const accBefore = await request(app).get(`/api/v1/accounts/${chitBankAccountId}`).set('Cookie', userCookie);

    const prevPersonalCash = cashBefore.body.data.personalCashInHand;
    const prevChitCash = summaryBefore.body.data.cashInHandChitFunds;
    const prevChitReserve = summaryBefore.body.data.chitFundsHeldInBank;
    const prevAccBalance = accBefore.body.data.currentBalance;
    const prevPersonalAvailable = summaryBefore.body.data.personalAvailableBalance;

    // Record collection with isAlreadyPaid: true
    const res = await request(app)
      .post(`/api/v1/chit-funds/${chitFundId}/collections`)
      .set('Cookie', userCookie)
      .send({
        memberId: member1Id,
        collectionPeriod: '2026-01',
        actualAmountReceived: 3000, // completes member1's ₹5,000
        expectedAmount: 5000,
        paymentMethod: 'upi',
        receivingBankAccountId: chitBankAccountId,
        isAlreadyPaid: true,
        collectionDate: new Date().toISOString(),
        notes: 'Already paid externally prior to tracking',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.isAlreadyPaid).toBe(true);

    const cashAfter = await request(app).get('/api/v1/accounts/total-cash').set('Cookie', userCookie);
    const summaryAfter = await request(app).get(`/api/v1/chit-funds/${chitFundId}/summary`).set('Cookie', userCookie);
    const accAfter = await request(app).get(`/api/v1/accounts/${chitBankAccountId}`).set('Cookie', userCookie);

    // Personal Cash and Chit Cash in Hand are untouched
    expect(cashAfter.body.data.personalCashInHand).toBe(prevPersonalCash);
    expect(summaryAfter.body.data.cashInHandChitFunds).toBe(prevChitCash);

    // Physical bank balance does NOT change (0 change)
    expect(accAfter.body.data.currentBalance).toBe(prevAccBalance);

    // Chit Funds Held in Bank increases by ₹3,000
    expect(summaryAfter.body.data.chitFundsHeldInBank).toBe(prevChitReserve + 3000);

    // Personal Available Balance decreases by ₹3,000
    expect(summaryAfter.body.data.personalAvailableBalance).toBe(prevPersonalAvailable - 3000);

    // Verify NO bank-debiting or separation transaction was created
    const txRes = await request(app).get('/api/v1/transactions?limit=10').set('Cookie', userCookie);
    const alreadyPaidTx = txRes.body.data.find((t: any) => t.notes?.includes('Already paid'));
    expect(alreadyPaidTx).toBeUndefined();
  });

  // Test Case 3: Verify ordinary UPI collections update the correct chit bank reserve
  it('3. Ordinary UPI collection updates chit bank reserve correctly', async () => {
    const summaryBefore = await request(app).get(`/api/v1/chit-funds/${chitFundId}/summary`).set('Cookie', userCookie);
    const initialReserve = summaryBefore.body.data.chitFundsHeldInBank;

    const res = await request(app)
      .post(`/api/v1/chit-funds/${chitFundId}/collections`)
      .set('Cookie', userCookie)
      .send({
        memberId: member2Id,
        collectionPeriod: '2026-01',
        actualAmountReceived: 2000,
        expectedAmount: 5000,
        paymentMethod: 'upi',
        collectionDate: new Date().toISOString(),
      });
    expect(res.status).toBe(201);

    const summaryAfter = await request(app).get(`/api/v1/chit-funds/${chitFundId}/summary`).set('Cookie', userCookie);
    expect(summaryAfter.body.data.chitFundsHeldInBank).toBe(initialReserve + 2000);
  });

  // Test Case 4: Verify Cash in Hand collections affect Chit Cash in Hand only
  it('4. Cash in Hand collections affect Chit Cash in Hand only and leave Personal Cash untouched', async () => {
    const cashBefore = await request(app).get('/api/v1/accounts/total-cash').set('Cookie', userCookie);
    const summaryBefore = await request(app).get(`/api/v1/chit-funds/${chitFundId}/summary`).set('Cookie', userCookie);

    const initialPersonalCash = cashBefore.body.data.personalCashInHand;
    const initialChitCash = summaryBefore.body.data.cashInHandChitFunds;

    // Use cycle 2026-02 for member 1
    const res = await request(app)
      .post(`/api/v1/chit-funds/${chitFundId}/collections`)
      .set('Cookie', userCookie)
      .send({
        memberId: member1Id,
        collectionPeriod: '2026-02',
        actualAmountReceived: 5000,
        expectedAmount: 5000,
        paymentMethod: 'cash_in_hand',
        collectionDate: new Date().toISOString(),
      });
    expect(res.status).toBe(201);

    const cashAfter = await request(app).get('/api/v1/accounts/total-cash').set('Cookie', userCookie);
    const summaryAfter = await request(app).get(`/api/v1/chit-funds/${chitFundId}/summary`).set('Cookie', userCookie);

    // Personal cash untouched
    expect(cashAfter.body.data.personalCashInHand).toBe(initialPersonalCash);
    // Chit cash increased by ₹5,000
    expect(summaryAfter.body.data.cashInHandChitFunds).toBe(initialChitCash + 5000);
  });

  // Test Case 5: Verify new Self Pay requests are rejected with SELF_PAY_DEPRECATED
  it('5. Rejects any new collection using deprecated self_pay payment method', async () => {
    const res = await request(app)
      .post(`/api/v1/chit-funds/${chitFundId}/collections`)
      .set('Cookie', userCookie)
      .send({
        memberId: selfMemberId,
        collectionPeriod: '2026-02',
        actualAmountReceived: 5000,
        expectedAmount: 5000,
        paymentMethod: 'self_pay',
        sourceAccountId: personalBankAccountId,
        collectionDate: new Date().toISOString(),
      });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('SELF_PAY_DEPRECATED');
  });

  // Test Case 6: Verify Already Paid UPI reclassifies personal funds to chit reserve without changing bank balance
  it('6. Already Paid UPI reclassifies personal funds to chit reserve: bank balance unchanged, personal available decreased', async () => {
    const accBefore = await request(app).get(`/api/v1/accounts/${chitBankAccountId}`).set('Cookie', userCookie);
    const summaryBefore = await request(app).get(`/api/v1/chit-funds/${chitFundId}/summary`).set('Cookie', userCookie);

    const initialAccBal = accBefore.body.data.currentBalance;
    const initialReserve = summaryBefore.body.data.chitFundsHeldInBank;
    const initialPersonalAvail = summaryBefore.body.data.personalAvailableBalance;

    const res = await request(app)
      .post(`/api/v1/chit-funds/${chitFundId}/collections`)
      .set('Cookie', userCookie)
      .send({
        memberId: selfMemberId,
        collectionPeriod: '2026-02',
        actualAmountReceived: 5000,
        expectedAmount: 5000,
        paymentMethod: 'upi',
        receivingBankAccountId: chitBankAccountId,
        isAlreadyPaid: true,
        collectionDate: new Date().toISOString(),
      });
    expect(res.status).toBe(201);
    expect(res.body.data.isAlreadyPaid).toBe(true);

    const accAfter = await request(app).get(`/api/v1/accounts/${chitBankAccountId}`).set('Cookie', userCookie);
    const summaryAfter = await request(app).get(`/api/v1/chit-funds/${chitFundId}/summary`).set('Cookie', userCookie);

    // Actual bank balance remains completely unchanged (NO debit, NO credit)
    expect(accAfter.body.data.currentBalance).toBe(initialAccBal);
    // Chit reserve increased by ₹5,000
    expect(summaryAfter.body.data.chitFundsHeldInBank).toBe(initialReserve + 5000);
    // Personal available balance decreased by ₹5,000
    expect(summaryAfter.body.data.personalAvailableBalance).toBe(initialPersonalAvail - 5000);
  });

  // Test Case 7: Verify Already Paid UPI does not increase Chit Cash in Hand
  it('7. Already Paid UPI does NOT increase Chit Cash in Hand', async () => {
    const summaryBefore = await request(app).get(`/api/v1/chit-funds/${chitFundId}/summary`).set('Cookie', userCookie);
    const initialChitCash = summaryBefore.body.data.cashInHandChitFunds;

    const res = await request(app)
      .post(`/api/v1/chit-funds/${chitFundId}/collections`)
      .set('Cookie', userCookie)
      .send({
        memberId: selfMemberId,
        collectionPeriod: '2026-03',
        actualAmountReceived: 5000,
        expectedAmount: 5000,
        paymentMethod: 'upi',
        receivingBankAccountId: personalBankAccountId,
        isAlreadyPaid: true,
        collectionDate: new Date().toISOString(),
      });
    expect(res.status).toBe(201);

    const summaryAfter = await request(app).get(`/api/v1/chit-funds/${chitFundId}/summary`).set('Cookie', userCookie);
    expect(summaryAfter.body.data.cashInHandChitFunds).toBe(initialChitCash);
  });

  // Test Case 8: Verify historical self_pay records in DB do NOT debit account balance in recalculation
  let collectionWithTxId: string;
  let linkedTransactionId: string;
  it('8. Historical self_pay records with CHIT_SEPARATION do NOT debit physical bank balance', async () => {
    // Manually insert a historical collection & transaction
    const sepTx = await Transaction.create({
      userId,
      title: `Chit Separation: Historical - Self (${'2026-04'})`,
      amount: 5000,
      type: TransactionType.CHIT_SEPARATION,
      category: 'Chits',
      paymentMethod: PaymentMethod.BANK_TRANSFER,
      paymentChannel: PaymentChannel.ONLINE,
      accountId: personalBankAccountId,
      status: TransactionStatus.COMPLETED,
      date: new Date(),
    });
    linkedTransactionId = sepTx._id.toString();

    const histCol = await ChitFundCollection.create({
      userId,
      chitFundId,
      memberId: selfMemberId,
      collectionPeriod: '2026-04',
      chitsCovered: 1,
      expectedAmount: 5000,
      actualAmountReceived: 5000,
      isSeparation: true,
      isAlreadyPaid: false,
      collectionDate: new Date(),
      receivingBankAccountId: personalBankAccountId,
      sourceAccountId: personalBankAccountId,
      transactionId: sepTx._id,
      paymentMethod: 'self_pay',
      status: 'completed',
    });
    collectionWithTxId = histCol._id.toString();

    // Recalculate account balance: physical balance should NOT be debited by CHIT_SEPARATION
    await recalculateAccountBalance(personalBankAccountId, userId);
    const acc = await BankAccount.findById(personalBankAccountId);
    expect(acc?.currentBalance).toBe(50000); // 50,000 initial balance unchanged!
  });

  // Test Case 9: Verify duplicate collection submission is rejected
  it('9. Rejects duplicate collection if member has already fully paid the cycle', async () => {
    // selfMemberId already paid ₹5,000 for cycle 2026-04
    const resDup = await request(app)
      .post(`/api/v1/chit-funds/${chitFundId}/collections`)
      .set('Cookie', userCookie)
      .send({
        memberId: selfMemberId,
        collectionPeriod: '2026-04',
        actualAmountReceived: 1000,
        expectedAmount: 5000,
        paymentMethod: 'upi',
        receivingBankAccountId: personalBankAccountId,
        collectionDate: new Date().toISOString(),
      });
    expect(resDup.status).toBe(400);
    expect(JSON.stringify(resDup.body)).toMatch(/exceed|fully paid|more than|already/i);
  });

  // Test Case 10: Deleting a collection deletes linked transaction and maintains account balance
  it('10. Deleting a historical collection safely removes linked transaction and maintains balance', async () => {
    const accBefore = await request(app).get(`/api/v1/accounts/${personalBankAccountId}`).set('Cookie', userCookie);
    const balBefore = accBefore.body.data.currentBalance;

    // Delete the historical collection from Test Case 8
    const delRes = await request(app)
      .delete(`/api/v1/chit-funds/${chitFundId}/collections/${collectionWithTxId}`)
      .set('Cookie', userCookie);
    expect(delRes.status).toBe(200);

    // Verify linked transaction is deleted
    const txRes = await request(app).get(`/api/v1/transactions/${linkedTransactionId}`).set('Cookie', userCookie);
    expect(txRes.status).toBe(404);

    // Verify account balance remains consistent
    const accAfter = await request(app).get(`/api/v1/accounts/${personalBankAccountId}`).set('Cookie', userCookie);
    expect(accAfter.body.data.currentBalance).toBe(balBefore);
  });

  // Test Case 11: Verify the Chits expense category works in create/edit/filter workflows
  it('11. Standard transactions can be created and queried with category "Chits"', async () => {
    const createTx = await request(app)
      .post('/api/v1/transactions')
      .set('Cookie', userCookie)
      .send({
        title: 'Personal chit payment for external friends circle',
        type: TransactionType.EXPENSE,
        amount: 1500,
        category: 'Chits',
        accountId: personalBankAccountId,
        paymentMethod: PaymentMethod.UPI,
        paymentChannel: PaymentChannel.ONLINE,
        date: new Date().toISOString(),
      });
    expect(createTx.status).toBe(201);
    expect(createTx.body.data.category).toBe('Chits');
    const createdId = createTx.body.data.id;

    // Filter by category Chits
    const listRes = await request(app)
      .get('/api/v1/transactions?category=Chits')
      .set('Cookie', userCookie);
    expect(listRes.status).toBe(200);
    const found = listRes.body.data.find((t: any) => t.id === createdId);
    expect(found).toBeDefined();
    expect(found.category).toBe('Chits');
  });

  // Test Case 12: Verify EMI schedules, payments, history, and bank calculations remain unchanged
  it('12. EMI tracking, schedules, and calculations remain isolated and unchanged', async () => {
    // Create an EMI
    const emiRes = await request(app)
      .post('/api/v1/emi')
      .set('Cookie', userCookie)
      .send({
        name: 'Test Phone Loan',
        lender: 'HDFC Bank',
        monthlyAmount: 5177,
        startDate: '2026-01-01T00:00:00.000Z',
        firstDueDate: '2026-01-05T00:00:00.000Z',
        nextEmiDate: '2026-01-05T00:00:00.000Z',
        endDate: '2026-06-05T00:00:00.000Z',
        dueDay: 5,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: personalBankAccountId,
        markHistoricalPaid: true,
      });
    expect(emiRes.status).toBe(201);
    const emiId = emiRes.body.data.id;
    expect(emiRes.body.data.status).toBe(EmiStatus.ACTIVE);

    // Chit operations performed above did not affect EMI schedule or status
    const emiGet = await request(app).get(`/api/v1/emi/${emiId}`).set('Cookie', userCookie);
    expect(emiGet.status).toBe(200);
    expect(emiGet.body.data.status).toBe(EmiStatus.ACTIVE);
    expect(emiGet.body.data.paidInstallmentsCount).toBe(0);
    expect(emiGet.body.data.nextEmiDate).toBe('2026-01-05T00:00:00.000Z');
  });
});
