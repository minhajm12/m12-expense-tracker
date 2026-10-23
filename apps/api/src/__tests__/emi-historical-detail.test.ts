import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import {
  AccountType,
  PaymentMethod,
  PaymentChannel,
  EmiStatus,
  EmiOccurrenceStatus,
} from '@finora/shared';
import { EmiRule } from '../models/EmiRule';
import { EmiOccurrence } from '../models/EmiOccurrence';
import { Transaction } from '../models/Transaction';
import { BankAccount } from '../models/BankAccount';

describe('Phase 1: EMI Historical Tracking & Detail Page Regression Tests (18 Scenarios)', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let bankAccountId: string;
  let initialBankBalance = 100000;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // 1. Register test user
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'emi.historical@finora.test',
        password: 'Password123!',
        fullName: 'EMI Historical Tester',
        currency: 'INR',
      });
    userCookie = regRes.headers['set-cookie'][0];

    // 2. Create Bank Account (₹100,000)
    const accRes = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'Salary HDFC',
        bankName: 'HDFC Bank',
        accountType: AccountType.SAVINGS,
        openingBalance: initialBankBalance,
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

  let createdEmiId: string;

  // 1. Create an EMI with a start date in the past and a next EMI date in the future
  it('1. should create an EMI with past start date and future next EMI date', async () => {
    const res = await request(app)
      .post('/api/v1/emi')
      .set('Cookie', userCookie)
      .send({
        name: 'Personal Loan',
        lender: 'HDFC Bank',
        monthlyAmount: 5000,
        startDate: '2026-05-02T00:00:00.000Z',
        firstDueDate: '2026-05-02T00:00:00.000Z',
        nextEmiDate: '2026-11-02T00:00:00.000Z',
        endDate: '2028-04-02T00:00:00.000Z',
        dueDay: 2,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
        markHistoricalPaid: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    createdEmiId = res.body.data.id;
  });

  // 2. Verify the historical installment count from the calendar schedule
  it('2. should correctly identify 6 historical installments from calendar schedule (May - Oct 2026)', async () => {
    const occurrences = await EmiOccurrence.find({ emiRuleId: createdEmiId }).sort({ installmentNumber: 1 });
    // Total 24 months from May 2026 to April 2028
    expect(occurrences.length).toBe(24);

    const historicalOccs = occurrences.filter((o) => o.isHistorical);
    expect(historicalOccs.length).toBe(6);

    const keys = historicalOccs.map((o) => o.occurrenceKey);
    expect(keys).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  });

  // 3. Confirm historical installments as paid and verify they receive PAID_HISTORICAL status
  it('3. should assign PAID_HISTORICAL status to confirmed historical installments', async () => {
    const occurrences = await EmiOccurrence.find({ emiRuleId: createdEmiId, isHistorical: true });
    for (const occ of occurrences) {
      expect(occ.status).toBe(EmiOccurrenceStatus.PAID_HISTORICAL);
      expect(occ.actualAmountPaid).toBe(5000);
    }
  });

  // 4. Verify historical paid records do not change the bank balance
  it('4. should NOT change the bank balance or create transactions for historical paid records', async () => {
    const acc = await BankAccount.findById(bankAccountId);
    expect(acc?.currentBalance).toBe(initialBankBalance);

    const txCount = await Transaction.countDocuments({
      emiRuleId: createdEmiId,
    });
    expect(txCount).toBe(0);
  });

  // 5. Verify the user can leave previous installments unpaid if they have not been paid
  it('5. should allow leaving past installments unpaid when markHistoricalPaid is false', async () => {
    const res = await request(app)
      .post('/api/v1/emi')
      .set('Cookie', userCookie)
      .send({
        name: 'Unpaid Prior Loan',
        lender: 'SBI',
        monthlyAmount: 3000,
        startDate: '2026-08-05T00:00:00.000Z',
        firstDueDate: '2026-08-05T00:00:00.000Z',
        nextEmiDate: '2026-11-05T00:00:00.000Z',
        endDate: '2027-01-05T00:00:00.000Z',
        dueDay: 5,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
        markHistoricalPaid: false,
      });

    expect(res.status).toBe(201);
    const unpaidLoanId = res.body.data.id;

    const occurrences = await EmiOccurrence.find({ emiRuleId: unpaidLoanId }).sort({ installmentNumber: 1 });
    const historicalOccs = occurrences.filter((o) => o.isHistorical);
    expect(historicalOccs.length).toBe(3); // Aug, Sep, Oct 2026
    for (const occ of historicalOccs) {
      expect(occ.status).not.toBe(EmiOccurrenceStatus.PAID_HISTORICAL);
      expect([EmiOccurrenceStatus.DUE, EmiOccurrenceStatus.OVERDUE]).toContain(occ.status);
    }
  });

  let customEmiId: string;

  // 6. Verify custom actual amounts for individual historical installments
  it('6. should record custom actual amounts for individual historical installments (Mode B)', async () => {
    const res = await request(app)
      .post('/api/v1/emi')
      .set('Cookie', userCookie)
      .send({
        name: 'Gadget Loan with Fees',
        lender: 'Bajaj Finance',
        monthlyAmount: 4000,
        startDate: '2026-07-10T00:00:00.000Z',
        firstDueDate: '2026-07-10T00:00:00.000Z',
        nextEmiDate: '2026-10-10T00:00:00.000Z',
        endDate: '2026-12-10T00:00:00.000Z',
        dueDay: 10,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
        markHistoricalPaid: true,
        historicalInstallments: [
          { occurrenceKey: '2026-07', actualAmount: 4000, notes: 'Standard installment' },
          { occurrenceKey: '2026-08', actualAmount: 4150, notes: 'Includes processing fee' },
          { occurrenceKey: '2026-09', actualAmount: 3900, notes: 'Discount applied' },
        ],
      });

    expect(res.status).toBe(201);
    customEmiId = res.body.data.id;

    const occAug = await EmiOccurrence.findOne({ emiRuleId: customEmiId, occurrenceKey: '2026-08' });
    expect(occAug?.actualAmountPaid).toBe(4150);
    expect(occAug?.notes).toBe('Includes processing fee');

    const occSep = await EmiOccurrence.findOne({ emiRuleId: customEmiId, occurrenceKey: '2026-09' });
    expect(occSep?.actualAmountPaid).toBe(3900);
    expect(occSep?.notes).toBe('Discount applied');
  });

  // 7. Verify editing one historical amount does not change other installments or future EMI defaults
  it('7. should update single historical installment without modifying others or future defaults', async () => {
    const updateRes = await request(app)
      .put(`/api/v1/emi/${customEmiId}/installments/2026-08/historical`)
      .set('Cookie', userCookie)
      .send({
        actualAmount: 4200,
        notes: 'Revised processing charge',
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.success).toBe(true);
    expect(updateRes.body.data.actualAmountPaid).toBe(4200);

    // Verify other historical installment untouched
    const occSep = await EmiOccurrence.findOne({ emiRuleId: customEmiId, occurrenceKey: '2026-09' });
    expect(occSep?.actualAmountPaid).toBe(3900);

    // Verify future installment expected amount untouched
    const occOct = await EmiOccurrence.findOne({ emiRuleId: customEmiId, occurrenceKey: '2026-10' });
    expect(occOct?.expectedAmount).toBe(4000);

    // Verify bank balance still untouched
    const acc = await BankAccount.findById(bankAccountId);
    expect(acc?.currentBalance).toBe(initialBankBalance);
  });

  // 8. Verify the next EMI date is correct
  it('8. should maintain correct next EMI date', async () => {
    const emi = await EmiRule.findById(createdEmiId);
    expect(emi?.nextEmiDate).toBeDefined();
    const nextDate = new Date(emi!.nextEmiDate!);
    expect(nextDate.toISOString().startsWith('2026-11-02')).toBe(true);
  });

  // 9. Verify the end date limits the schedule correctly
  it('9. should limit the schedule strictly to end date', async () => {
    const lastOcc = await EmiOccurrence.findOne({ emiRuleId: createdEmiId }).sort({ installmentNumber: -1 });
    expect(lastOcc?.occurrenceKey).toBe('2028-04');
    expect(lastOcc?.installmentNumber).toBe(24);

    const postEndOcc = await EmiOccurrence.findOne({ emiRuleId: createdEmiId, occurrenceKey: '2028-05' });
    expect(postEndOcc).toBeNull();
  });

  // 10. Verify paid, overdue, unpaid, and upcoming statuses
  it('10. should differentiate paid_historical, due, and paid statuses', async () => {
    const detailRes = await request(app)
      .get(`/api/v1/emi/${createdEmiId}`)
      .set('Cookie', userCookie);

    expect(detailRes.status).toBe(200);
    const occs: Array<any> = detailRes.body.data.occurrences;

    const histPaid = occs.filter((o) => o.status === EmiOccurrenceStatus.PAID_HISTORICAL);
    expect(histPaid.length).toBe(6);

    const upcoming = occs.filter((o) => o.status === EmiOccurrenceStatus.DUE);
    expect(upcoming.length).toBe(18);
  });

  // 11. Verify remaining installment count and amount
  it('11. should accurately calculate remaining installments and remaining amount', async () => {
    const detailRes = await request(app)
      .get(`/api/v1/emi/${createdEmiId}`)
      .set('Cookie', userCookie);

    const emi = detailRes.body.data;
    expect(emi.totalInstallments).toBe(24);
    expect(emi.historicalPaidInstallmentsCount).toBe(6);
    expect(emi.remainingInstallmentsCount).toBe(18);
    expect(emi.totalPaidAmount).toBe(30000); // 6 * 5000
    expect(emi.remainingAmount).toBe(90000); // 18 * 5000
    expect(emi.totalScheduledAmount).toBe(120000); // 24 * 5000
  });

  // 12. Verify the detail page survives browser refresh and direct navigation
  it('12. should return full detail payload for direct navigation and refresh', async () => {
    const res = await request(app)
      .get(`/api/v1/emi/${createdEmiId}`)
      .set('Cookie', userCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(createdEmiId);
    expect(res.body.data.name).toBe('Personal Loan');
    expect(res.body.data.occurrences).toBeInstanceOf(Array);
    expect(res.body.data.occurrences.length).toBe(24);
  });

  let paidTxId: string;

  // 13. Verify linked normal transactions are visible in transaction details
  it('13. should link normal payment to a real transaction and debit bank balance', async () => {
    const payRes = await request(app)
      .post(`/api/v1/emi/${createdEmiId}/pay`)
      .set('Cookie', userCookie)
      .send({
        occurrenceKey: '2026-11',
        actualAmount: 5000,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
      });

    expect(payRes.status).toBe(200);
    const txId = payRes.body.data.transaction?.id || payRes.body.data.occurrence?.transactionId;
    expect(txId).toBeDefined();
    paidTxId = txId;

    // Check bank account debited by 5000
    const acc = await BankAccount.findById(bankAccountId);
    expect(acc?.currentBalance).toBe(initialBankBalance - 5000);

    // Verify detail endpoint returns linked transaction in occurrences
    const detailRes = await request(app)
      .get(`/api/v1/emi/${createdEmiId}`)
      .set('Cookie', userCookie);

    const novOcc = detailRes.body.data.occurrences.find((o: any) => o.occurrenceKey === '2026-11');
    expect(novOcc.status).toBe(EmiOccurrenceStatus.PAID);
    expect(novOcc.transactionId).toBe(paidTxId);
  });

  // 14. Verify historical installments without transactions do not display fake transaction records
  it('14. should not have transactionId for historical paid installments', async () => {
    const detailRes = await request(app)
      .get(`/api/v1/emi/${createdEmiId}`)
      .set('Cookie', userCookie);

    const histOccs = detailRes.body.data.occurrences.filter((o: any) => o.status === EmiOccurrenceStatus.PAID_HISTORICAL);
    for (const occ of histOccs) {
      expect(occ.transactionId).toBeUndefined();
    }
  });

  // 15. Verify deleting a normal linked transaction reopens only the correct installment
  it('15. should reopen installment when linked transaction is deleted, restoring bank balance', async () => {
    const delRes = await request(app)
      .delete(`/api/v1/transactions/${paidTxId}`)
      .set('Cookie', userCookie);

    expect(delRes.status).toBe(200);

    // Bank balance restored
    const acc = await BankAccount.findById(bankAccountId);
    expect(acc?.currentBalance).toBe(initialBankBalance);

    // Nov 2026 occurrence reopened
    const novOcc = await EmiOccurrence.findOne({ emiRuleId: createdEmiId, occurrenceKey: '2026-11' });
    expect(novOcc?.status).not.toBe(EmiOccurrenceStatus.PAID);
    expect(novOcc?.transactionId).toBeUndefined();

    // Historical occurrences still strictly PAID_HISTORICAL
    const histOccs = await EmiOccurrence.find({ emiRuleId: createdEmiId, isHistorical: true });
    for (const h of histOccs) {
      expect(h.status).toBe(EmiOccurrenceStatus.PAID_HISTORICAL);
    }
  });

  // 16. Verify duplicate payments are prevented
  it('16. should reject payment attempts on already paid or paid_historical installments', async () => {
    // Attempt paying historical installment May 2026
    const payHistRes = await request(app)
      .post(`/api/v1/emi/${createdEmiId}/pay`)
      .set('Cookie', userCookie)
      .send({
        occurrenceKey: '2026-05',
        actualAmount: 5000,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
      });

    expect(payHistRes.status).toBe(400);

    // Pay Nov 2026 again
    const payNov = await request(app)
      .post(`/api/v1/emi/${createdEmiId}/pay`)
      .set('Cookie', userCookie)
      .send({
        occurrenceKey: '2026-11',
        actualAmount: 5000,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
      });
    expect(payNov.status).toBe(200);

    // Try paying Nov 2026 a second time
    const dupPayRes = await request(app)
      .post(`/api/v1/emi/${createdEmiId}/pay`)
      .set('Cookie', userCookie)
      .send({
        occurrenceKey: '2026-11',
        actualAmount: 5000,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
      });

    expect(dupPayRes.status).toBe(400);
  });

  // 17. Verify final EMI completion and reopening after a valid correction
  it('17. should mark EMI completed when all installments paid, and reopen upon transaction deletion', async () => {
    // Create short 2-month EMI: 1 historical, 1 current
    const shortEmiRes = await request(app)
      .post('/api/v1/emi')
      .set('Cookie', userCookie)
      .send({
        name: 'Short Mini Loan',
        lender: 'Friend',
        monthlyAmount: 2000,
        startDate: '2026-09-01T00:00:00.000Z',
        firstDueDate: '2026-09-01T00:00:00.000Z',
        nextEmiDate: '2026-10-01T00:00:00.000Z',
        endDate: '2026-10-01T00:00:00.000Z',
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
        markHistoricalPaid: true,
      });

    expect(shortEmiRes.status).toBe(201);
    const shortId = shortEmiRes.body.data.id;

    // Check status is still ACTIVE because Oct 2026 is unpaid
    let emiDoc = await EmiRule.findById(shortId);
    expect(emiDoc?.status).toBe(EmiStatus.ACTIVE);

    // Pay the final Oct 2026 installment
    const payFinalRes = await request(app)
      .post(`/api/v1/emi/${shortId}/pay`)
      .set('Cookie', userCookie)
      .send({
        occurrenceKey: '2026-10',
        actualAmount: 2000,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        accountId: bankAccountId,
      });

    expect(payFinalRes.status).toBe(200);
    const finalTxId = payFinalRes.body.data.transaction?.id || payFinalRes.body.data.occurrence?.transactionId;
    expect(finalTxId).toBeDefined();

    // Now EMI should be COMPLETED
    emiDoc = await EmiRule.findById(shortId);
    expect(emiDoc?.status).toBe(EmiStatus.COMPLETED);

    // Delete transaction of final installment
    await request(app)
      .delete(`/api/v1/transactions/${finalTxId}`)
      .set('Cookie', userCookie);

    // EMI should REOPEN to ACTIVE
    emiDoc = await EmiRule.findById(shortId);
    expect(emiDoc?.status).toBe(EmiStatus.ACTIVE);
  });

  // 18. Verify existing EMI data is preserved
  it('18. should preserve all existing historical paid records when editing EMI configuration', async () => {
    const editRes = await request(app)
      .put(`/api/v1/emi/${createdEmiId}`)
      .set('Cookie', userCookie)
      .send({
        monthlyAmount: 5500,
        endDate: '2028-06-02T00:00:00.000Z', // extend end date
        notes: 'Extended loan duration',
      });

    expect(editRes.status).toBe(200);

    // Verify all 6 historical records still intact
    const histOccs = await EmiOccurrence.find({ emiRuleId: createdEmiId, isHistorical: true });
    expect(histOccs.length).toBe(6);
    for (const h of histOccs) {
      expect(h.status).toBe(EmiOccurrenceStatus.PAID_HISTORICAL);
      expect(h.actualAmountPaid).toBe(5000); // original amount preserved
    }

    // Verify new total installments extended
    const totalOccs = await EmiOccurrence.countDocuments({ emiRuleId: createdEmiId });
    expect(totalOccs).toBe(26); // May 2026 to June 2028 = 26 months
  });
});
