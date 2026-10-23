import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { AccountType, TransactionType, EmiStatus, PaymentMethod, PaymentChannel, EmiOccurrenceStatus } from '@finora/shared';

describe('Phase 2 & 3: EMI Down Payment & Schedule Eligibility Test Suite', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let bankAccountId: string;
  let liveEmiId: string;
  let historicalEmiId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // 1. Register User
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'emi.downpayment@finora.test',
        password: 'Password123!',
        fullName: 'EMI DownPayment Tester',
        currency: 'INR',
      });
    userCookie = regRes.headers['set-cookie'][0];

    // 2. Create Bank Account with ₹100,000
    const accRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'HDFC Salary Checking',
        bankName: 'HDFC Bank',
        accountType: AccountType.SAVINGS,
        openingBalance: 100000,
        openingBalanceDate: '2026-01-01T00:00:00.000Z',
        currency: 'INR',
      });
    bankAccountId = accRes.body.data.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  // Test 1: Live Down Payment creates linked Transaction and debits bank account
  it('1. Live down payment creates linked EXPENSE transaction and debits bank account once', async () => {
    const accBefore = await request(app).get(`/api/v1/accounts/${bankAccountId}`).set('Cookie', userCookie);
    const balBefore = accBefore.body.data.currentBalance; // 100,000

    const emiRes = await request(app)
      .post('/api/v1/emi')
      .set('Cookie', userCookie)
      .send({
        name: 'MacBook Pro Loan',
        lender: 'HDFC Consumer Finance',
        monthlyAmount: 8000,
        startDate: '2026-01-01T00:00:00.000Z',
        firstDueDate: '2026-02-05T00:00:00.000Z',
        nextEmiDate: '2026-02-05T00:00:00.000Z',
        endDate: '2026-07-05T00:00:00.000Z', // 6 monthly installments
        dueDay: 5,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
        downPaymentAmount: 20000,
        downPaymentAlreadyPaid: false,
        downPaymentPaymentMethod: PaymentMethod.BANK_TRANSFER,
        downPaymentAccountId: bankAccountId,
        downPaymentNotes: 'Initial down payment at Apple Store',
      });

    expect(emiRes.status).toBe(201);
    const emi = emiRes.body.data;
    liveEmiId = emi.id;

    // Rule level down payment checks
    expect(emi.downPaymentAmount).toBe(20000);
    expect(emi.downPaymentStatus).toBe('paid');
    expect(emi.downPaymentAlreadyPaid).toBe(false);
    expect(emi.downPaymentTransactionId).toBeDefined();

    // Down payment is NOT a monthly installment: totalInstallments is 6
    expect(emi.totalInstallments).toBe(6);

    // Bank account debited by ₹20,000 (100k -> 80k)
    const accAfter = await request(app).get(`/api/v1/accounts/${bankAccountId}`).set('Cookie', userCookie);
    expect(accAfter.body.data.currentBalance).toBe(balBefore - 20000);

    // Linked Transaction check
    const txRes = await request(app).get(`/api/v1/transactions/${emi.downPaymentTransactionId}`).set('Cookie', userCookie);
    expect(txRes.status).toBe(200);
    expect(txRes.body.data.title).toBe('EMI Down Payment — MacBook Pro Loan');
    expect(txRes.body.data.amount).toBe(20000);
    expect(txRes.body.data.type).toBe(TransactionType.EXPENSE);
    expect(txRes.body.data.category).toBe('EMI');
  });

  // Test 2: Down payment does not inflate monthly installment count or paidInstallmentsCount
  it('2. Down payment does NOT increase installment count or paidInstallmentsCount', async () => {
    const detailRes = await request(app).get(`/api/v1/emi/${liveEmiId}`).set('Cookie', userCookie);
    expect(detailRes.status).toBe(200);
    const data = detailRes.body.data;

    expect(data.totalInstallments).toBe(6);
    expect(data.paidInstallmentsCount).toBe(0);
    expect(data.remainingInstallmentsCount).toBe(6);
    expect(data.downPaymentAmount).toBe(20000);
    expect(data.downPaymentStatus).toBe('paid');
  });

  // Test 3: Historical Down Payment records paid_historical status with ZERO bank movement
  it('3. Historical down payment (downPaymentAlreadyPaid: true) records without bank transaction or debit', async () => {
    const accBefore = await request(app).get(`/api/v1/accounts/${bankAccountId}`).set('Cookie', userCookie);
    const balBefore = accBefore.body.data.currentBalance; // 80,000

    const emiRes = await request(app)
      .post('/api/v1/emi')
      .set('Cookie', userCookie)
      .send({
        name: 'Car Loan',
        lender: 'SBI Auto Loans',
        monthlyAmount: 15000,
        startDate: '2025-10-01T00:00:00.000Z',
        firstDueDate: '2025-11-10T00:00:00.000Z',
        nextEmiDate: '2026-03-10T00:00:00.000Z',
        endDate: '2026-10-10T00:00:00.000Z', // 12 monthly installments
        dueDay: 10,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
        markHistoricalPaid: true,
        downPaymentAmount: 50000,
        downPaymentAlreadyPaid: true,
        downPaymentDate: '2025-10-01T00:00:00.000Z',
        downPaymentNotes: 'Down payment paid to showroom before tracking',
      });

    expect(emiRes.status).toBe(201);
    const emi = emiRes.body.data;
    historicalEmiId = emi.id;

    expect(emi.downPaymentAmount).toBe(50000);
    expect(emi.downPaymentStatus).toBe('paid_historical');
    expect(emi.downPaymentAlreadyPaid).toBe(true);
    expect(emi.downPaymentTransactionId).toBeUndefined();

    // Bank balance is completely UNCHANGED (80k -> 80k)
    const accAfter = await request(app).get(`/api/v1/accounts/${bankAccountId}`).set('Cookie', userCookie);
    expect(accAfter.body.data.currentBalance).toBe(balBefore);

    // Verify detail endpoint reflects historical down payment
    const detailRes = await request(app).get(`/api/v1/emi/${historicalEmiId}`).set('Cookie', userCookie);
    expect(detailRes.body.data.downPaymentStatus).toBe('paid_historical');
    expect(detailRes.body.data.downPaymentAmount).toBe(50000);
  });

  // Test 4: Prevent paying installments that are already marked PAID or PAID_HISTORICAL
  it('4. Rejects payment attempts for installments already marked PAID or PAID_HISTORICAL', async () => {
    // Car Loan has historical installments from 2025-11 through 2026-02 (all PAID_HISTORICAL)
    const resHistoricalPay = await request(app)
      .post(`/api/v1/emi/${historicalEmiId}/pay`)
      .set('Cookie', userCookie)
      .send({
        occurrenceKey: '2025-11',
        actualAmount: 15000,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
      });

    expect(resHistoricalPay.status).toBe(400);
    expect(resHistoricalPay.body.error?.code).toBe('EMI_ALREADY_PAID');
  });

  // Test 5: Paying eligible current installment advances nextEmiDate correctly
  it('5. Paying eligible upcoming installment debits bank, marks PAID, and advances nextEmiDate', async () => {
    const accBefore = await request(app).get(`/api/v1/accounts/${bankAccountId}`).set('Cookie', userCookie);
    const balBefore = accBefore.body.data.currentBalance; // 80,000

    // Pay installment #1 of MacBook Pro (2026-02)
    const payRes = await request(app)
      .post(`/api/v1/emi/${liveEmiId}/pay`)
      .set('Cookie', userCookie)
      .send({
        occurrenceKey: '2026-02',
        actualAmount: 8000,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
        date: '2026-02-05T10:00:00.000Z',
      });

    expect(payRes.status).toBe(200);
    expect(payRes.body.data.occurrence.status).toBe(EmiOccurrenceStatus.PAID);
    expect(payRes.body.data.occurrence.actualAmountPaid).toBe(8000);

    // Bank account debited by ₹8,000 (80k -> 72k)
    const accAfter = await request(app).get(`/api/v1/accounts/${bankAccountId}`).set('Cookie', userCookie);
    expect(accAfter.body.data.currentBalance).toBe(balBefore - 8000);

    // Check that paying 2026-02 again is rejected
    const dupRes = await request(app)
      .post(`/api/v1/emi/${liveEmiId}/pay`)
      .set('Cookie', userCookie)
      .send({
        occurrenceKey: '2026-02',
        actualAmount: 8000,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
      });
    expect(dupRes.status).toBe(400);
    expect(dupRes.body.error?.code).toBe('EMI_ALREADY_PAID');

    // Verify nextEmiDate advanced to 2026-03
    const detailRes = await request(app).get(`/api/v1/emi/${liveEmiId}`).set('Cookie', userCookie);
    expect(detailRes.body.data.paidInstallmentsCount).toBe(1);
    expect(detailRes.body.data.nextEmiDate).toMatch(/^2026-03/);
  });
});
