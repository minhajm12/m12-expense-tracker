import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../app';
import { connectDatabase, disconnectDatabase } from '../config/database';
import {
  AccountType,
  TransactionType,
  RecurringFrequency,
  PaymentMethod,
  PaymentChannel,
  CreditCardNetwork,
  EmiStatus,
  EmiOccurrenceStatus,
} from '@finora/shared';
import { getCycleKey } from '../controllers/recurring';
import { EmiRule } from '../models/EmiRule';
import { EmiOccurrence } from '../models/EmiOccurrence';
import { Transaction } from '../models/Transaction';
import { BankAccount } from '../models/BankAccount';
import { CreditCard } from '../models/CreditCard';

describe('Recurring Payment Method Editing, EMI Module & Monthly Forecast Regression Suite', () => {
  let mongoServer: MongoMemoryServer;
  let userCookie: string;
  let bankAccount1Id: string;
  let bankAccount2Id: string;
  let creditCardId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase(mongoServer.getUri());

    // 1. Register test user
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'emi.tester@finora.test',
        password: 'Password123!',
        fullName: 'EMI Tester',
        currency: 'INR',
      });
    userCookie = regRes.headers['set-cookie'][0];

    // 2. Create Bank Account 1 (₹100,000)
    const acc1Res = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'Primary Salary HDFC',
        bankName: 'HDFC Bank',
        accountType: AccountType.SAVINGS,
        openingBalance: 100000,
        openingBalanceDate: new Date().toISOString(),
        currency: 'INR',
      });
    bankAccount1Id = acc1Res.body.data.id;

    // 3. Create Bank Account 2 (₹50,000)
    const acc2Res = await request(app)
      .post('/api/v1/accounts')
      .set('Cookie', userCookie)
      .send({
        accountName: 'Secondary ICICI',
        bankName: 'ICICI Bank',
        accountType: AccountType.SAVINGS,
        openingBalance: 50000,
        openingBalanceDate: new Date().toISOString(),
        currency: 'INR',
      });
    bankAccount2Id = acc2Res.body.data.id;

    // 4. Create Credit Card (Limit ₹100,000, Outstanding ₹0)
    const ccRes = await request(app)
      .post('/api/v1/credit-cards')
      .set('Cookie', userCookie)
      .send({
        cardNickname: 'SBI Prime Card',
        issuingBank: 'State Bank of India',
        network: CreditCardNetwork.VISA,
        lastFourDigits: '4433',
        creditLimit: 100000,
        billingCycleClosingDay: 20,
        paymentDueDay: 10,
        openingOutstanding: 0,
        openingOutstandingDate: new Date().toISOString(),
        annualFee: 0,
      });
    creditCardId = ccRes.body.data.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  // =========================================================================
  // SECTION 1: Recurring Payment Method Editing (Scenarios 1-9)
  // =========================================================================
  describe('Part 1: Recurring Payment Method Editing & Integrity', () => {
    let recurringRuleId: string;
    let recurringTxId: string;
    const currentMonthKey = getCycleKey(new Date(), 'Asia/Kolkata');

    it('Scenario 1: Creates a recurring rule with a bank account as default', async () => {
      const res = await request(app)
        .post('/api/v1/recurring')
        .set('Cookie', userCookie)
        .send({
          title: 'Disney+ Hotstar Annual/Monthly',
          amount: 499,
          type: TransactionType.EXPENSE,
          category: 'Subscriptions',
          frequency: RecurringFrequency.MONTHLY,
          paymentMethod: PaymentMethod.UPI,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bankAccount1Id,
          nextExecutionDate: new Date().toISOString(),
          isActive: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      recurringRuleId = res.body.data.id;
      expect(res.body.data.paymentMethod).toBe(PaymentMethod.UPI);
      expect(res.body.data.accountId).toBe(bankAccount1Id);
    });

    it('Scenario 2-4: Executes Log Now changing payment method to Credit Card (no bank debit, card outstanding increases)', async () => {
      // Execute for current occurrence using Credit Card and ₹50 discount
      const execRes = await request(app)
        .post(`/api/v1/recurring/${recurringRuleId}/execute`)
        .set('Cookie', userCookie)
        .send({
          occurrenceKey: currentMonthKey,
          actualAmount: 449,
          discountAmount: 50,
          discountType: 'fixed',
          discountNotes: 'Diwali Promo',
          paymentMethod: PaymentMethod.CREDIT_CARD,
          creditCardId: creditCardId,
          updateFuturePaymentSettings: false, // do not alter future default
        });

      expect(execRes.status).toBe(200);
      expect(execRes.body.success).toBe(true);
      recurringTxId = execRes.body.data.transaction.id;

      // Verify transaction details
      const tx = await Transaction.findById(recurringTxId);
      expect(tx?.amount).toBe(449);
      expect(tx?.originalAmount).toBe(499);
      expect(tx?.discountAmount).toBe(50);
      expect(tx?.paymentMethod).toBe(PaymentMethod.CREDIT_CARD);
      expect(tx?.creditCardId?.toString()).toBe(creditCardId);
      expect(tx?.accountId).toBeUndefined();

      // Verify Scenario 3: Credit card outstanding increased by ₹449
      const card = await CreditCard.findById(creditCardId);
      expect(card?.currentOutstanding).toBe(449);

      // Verify Scenario 4: Bank Account 1 balance was NOT debited (remains ₹100,000)
      const acc1 = await BankAccount.findById(bankAccount1Id);
      expect(acc1?.currentBalance).toBe(100000);
    });

    it('Scenario 6: Verifies rule defaults were preserved when updateFuturePaymentSettings was false', async () => {
      const ruleRes = await request(app)
        .get(`/api/v1/recurring/${recurringRuleId}`)
        .set('Cookie', userCookie);

      expect(ruleRes.status).toBe(200);
      expect(ruleRes.body.data.paymentMethod).toBe(PaymentMethod.UPI);
      expect(ruleRes.body.data.accountId).toBe(bankAccount1Id);
    });

    it('Scenario 9: Deleting generated transaction reopens occurrence and reverses card balance exactly once', async () => {
      const delRes = await request(app)
        .delete(`/api/v1/transactions/${recurringTxId}`)
        .set('Cookie', userCookie);

      expect(delRes.status).toBe(200);

      // Card outstanding reversed back to 0
      const card = await CreditCard.findById(creditCardId);
      expect(card?.currentOutstanding).toBe(0);

      // Rule list should now show occurrence is DUE again
      const listRes = await request(app)
        .get('/api/v1/recurring')
        .set('Cookie', userCookie);

      const found = listRes.body.data.find((r: any) => r.id === recurringRuleId);
      expect(found.isLoggedForCurrentMonth).toBe(false);
      expect(found.currentMonthOccurrenceStatus).toBe('DUE');
    });

    it('Scenario 5 & 7: Re-logs with Bank Account 2 and updates future defaults', async () => {
      const reLogRes = await request(app)
        .post(`/api/v1/recurring/${recurringRuleId}/execute`)
        .set('Cookie', userCookie)
        .send({
          occurrenceKey: currentMonthKey,
          actualAmount: 499,
          paymentMethod: PaymentMethod.UPI,
          accountId: bankAccount2Id,
          updateFuturePaymentSettings: true, // explicitly update future default
        });

      expect(reLogRes.status).toBe(200);

      // Bank Account 2 debited by ₹499 (₹50,000 - 499 = ₹49,501)
      const acc2 = await BankAccount.findById(bankAccount2Id);
      expect(acc2?.currentBalance).toBe(49501);

      // Bank Account 1 remains untouched at ₹100,000
      const acc1 = await BankAccount.findById(bankAccount1Id);
      expect(acc1?.currentBalance).toBe(100000);

      // Rule future default updated to Bank Account 2
      const ruleRes = await request(app)
        .get(`/api/v1/recurring/${recurringRuleId}`)
        .set('Cookie', userCookie);
      expect(ruleRes.body.data.accountId).toBe(bankAccount2Id);
    });
  });

  // =========================================================================
  // SECTION 2: Complete EMI Module (Scenarios 10-22)
  // =========================================================================
  describe('Part 2: Dedicated EMI Management Module', () => {
    let emiId: string;
    let firstInstallmentTxId: string;

    it('Scenario 10 & 11: Creates an EMI and generates valid monthly schedule through end date', async () => {
      const res = await request(app)
        .post('/api/v1/emi')
        .set('Cookie', userCookie)
        .send({
          name: 'iPhone 16 Pro EMI',
          lender: 'HDFC SmartPay',
          monthlyAmount: 5000,
          startDate: '2026-10-01',
          firstDueDate: '2026-11-15',
          dueDay: 15,
          endDate: '2027-10-15', // 12 months: Nov 2026 through Oct 2027
          totalInstallments: 12,
          originalLoanAmount: 60000,
          paymentMethod: PaymentMethod.UPI,
          accountId: bankAccount1Id,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      emiId = res.body.data.id;
      expect(res.body.data.totalInstallments).toBe(12);

      // Verify occurrences count in DB
      const occs = await EmiOccurrence.find({ emiRuleId: emiId }).sort({ installmentNumber: 1 });
      expect(occs.length).toBe(12);
      expect(occs[0].occurrenceKey).toBe('2026-11');
      expect(occs[11].occurrenceKey).toBe('2027-10');
      // No occurrence beyond 2027-10
      const extraOcc = await EmiOccurrence.findOne({ emiRuleId: emiId, occurrenceKey: '2027-11' });
      expect(extraOcc).toBeNull();
    });

    it('Scenario 12: Pays first installment with discount and verifies balance & occurrence', async () => {
      const payRes = await request(app)
        .post(`/api/v1/emi/${emiId}/pay`)
        .set('Cookie', userCookie)
        .send({
          occurrenceKey: '2026-11',
          actualAmount: 4900,
          discountAmount: 100,
          discountType: 'fixed',
          discountNotes: 'Cashback Offer',
          paymentMethod: PaymentMethod.UPI,
          accountId: bankAccount1Id,
        });

      expect(payRes.status).toBe(200);
      expect(payRes.body.success).toBe(true);
      firstInstallmentTxId = payRes.body.data.transaction.id;

      // Verify transaction
      const tx = await Transaction.findById(firstInstallmentTxId);
      expect(tx?.amount).toBe(4900);
      expect(tx?.originalAmount).toBe(5000);
      expect(tx?.discountAmount).toBe(100);
      expect(tx?.emiRuleId?.toString()).toBe(emiId);

      // Bank Account 1 balance debited by ₹4,900 (₹100,000 - 4,900 = ₹95,100)
      const acc1 = await BankAccount.findById(bankAccount1Id);
      expect(acc1?.currentBalance).toBe(95100);

      // Occurrence is marked PAID
      const occ = await EmiOccurrence.findOne({ emiRuleId: emiId, occurrenceKey: '2026-11' });
      expect(occ?.status).toBe(EmiOccurrenceStatus.PAID);
      expect(occ?.actualAmountPaid).toBe(4900);
      expect(occ?.transactionId?.toString()).toBe(firstInstallmentTxId);
    });

    it('Scenario 13: Attempt to pay same occurrence twice is rejected', async () => {
      const dupRes = await request(app)
        .post(`/api/v1/emi/${emiId}/pay`)
        .set('Cookie', userCookie)
        .send({
          occurrenceKey: '2026-11',
          actualAmount: 5000,
          paymentMethod: PaymentMethod.UPI,
          accountId: bankAccount1Id,
        });

      expect(dupRes.status).toBe(400);
      expect(dupRes.body.error.code).toBe('EMI_ALREADY_PAID');
    });

    it('Scenario 14: Deleting linked transaction reopens installment and reverses balance', async () => {
      const delRes = await request(app)
        .delete(`/api/v1/transactions/${firstInstallmentTxId}`)
        .set('Cookie', userCookie);

      expect(delRes.status).toBe(200);

      // Bank Account 1 restored to ₹100,000
      const acc1 = await BankAccount.findById(bankAccount1Id);
      expect(acc1?.currentBalance).toBe(100000);

      // Installment 2026-11 reopened to DUE
      const occ = await EmiOccurrence.findOne({ emiRuleId: emiId, occurrenceKey: '2026-11' });
      expect(occ?.status).toBe(EmiOccurrenceStatus.DUE);
      expect(occ?.transactionId).toBeUndefined();
    });

    it('Scenario 15: Re-pays the same installment successfully with a single active transaction', async () => {
      const payRes = await request(app)
        .post(`/api/v1/emi/${emiId}/pay`)
        .set('Cookie', userCookie)
        .send({
          occurrenceKey: '2026-11',
          actualAmount: 5000,
          paymentMethod: PaymentMethod.UPI,
          accountId: bankAccount1Id,
        });

      expect(payRes.status).toBe(200);
      firstInstallmentTxId = payRes.body.data.transaction.id;

      // Exactly 1 transaction exists for 2026-11
      const txCount = await Transaction.countDocuments({ emiRuleId: emiId, occurrenceKey: '2026-11' });
      expect(txCount).toBe(1);

      // Account 1 debited by ₹5,000 (₹100,000 - 5,000 = ₹95,000)
      const acc1 = await BankAccount.findById(bankAccount1Id);
      expect(acc1?.currentBalance).toBe(95000);
    });

    it('Scenario 16: Pays installment 2 using Credit Card (charges card, does NOT debit bank)', async () => {
      const payRes = await request(app)
        .post(`/api/v1/emi/${emiId}/pay`)
        .set('Cookie', userCookie)
        .send({
          occurrenceKey: '2026-12',
          actualAmount: 5000,
          paymentMethod: PaymentMethod.CREDIT_CARD,
          creditCardId: creditCardId,
        });

      expect(payRes.status).toBe(200);

      // Credit card outstanding increases by ₹5,000
      const card = await CreditCard.findById(creditCardId);
      expect(card?.currentOutstanding).toBe(5000);

      // Bank Account 1 is unchanged at ₹95,000
      const acc1 = await BankAccount.findById(bankAccount1Id);
      expect(acc1?.currentBalance).toBe(95000);
    });

    it('Scenario 17: Editing EMI monthly amount updates future unpaid installments only', async () => {
      const editRes = await request(app)
        .put(`/api/v1/emi/${emiId}`)
        .set('Cookie', userCookie)
        .send({
          monthlyAmount: 5200,
        });

      expect(editRes.status).toBe(200);

      // Past paid installment (2026-11) remains 5000 / actualAmountPaid 5000
      const paidOcc = await EmiOccurrence.findOne({ emiRuleId: emiId, occurrenceKey: '2026-11' });
      expect(paidOcc?.expectedAmount).toBe(5000);

      // Future unpaid installment (2027-01) updated to 5200
      const futureOcc = await EmiOccurrence.findOne({ emiRuleId: emiId, occurrenceKey: '2027-01' });
      expect(futureOcc?.expectedAmount).toBe(5200);
    });

    it('Scenario 18: EMI remains ACTIVE while any installment remains unpaid', async () => {
      const emi = await EmiRule.findById(emiId);
      expect(emi?.status).toBe(EmiStatus.ACTIVE);
    });

    it('Scenario 19 & 20: Settling all remaining installments marks EMI COMPLETED, and deleting one reverts to ACTIVE', async () => {
      // Pay all remaining installments (months 3 to 12)
      const unpaidOccs = await EmiOccurrence.find({
        emiRuleId: emiId,
        status: EmiOccurrenceStatus.DUE,
      }).sort({ installmentNumber: 1 });

      let lastTxId = '';
      for (const occ of unpaidOccs) {
        const res = await request(app)
          .post(`/api/v1/emi/${emiId}/pay`)
          .set('Cookie', userCookie)
          .send({
            occurrenceKey: occ.occurrenceKey,
            actualAmount: occ.expectedAmount,
            paymentMethod: PaymentMethod.UPI,
            accountId: bankAccount1Id,
          });
        expect(res.status).toBe(200);
        lastTxId = res.body.data.transaction.id;
      }

      // Verify Scenario 19: EMI is now COMPLETED
      let emi = await EmiRule.findById(emiId);
      expect(emi?.status).toBe(EmiStatus.COMPLETED);

      // Verify Scenario 20: Deleting the final installment reverts EMI to ACTIVE
      const delRes = await request(app)
        .delete(`/api/v1/transactions/${lastTxId}`)
        .set('Cookie', userCookie);
      expect(delRes.status).toBe(200);

      emi = await EmiRule.findById(emiId);
      expect(emi?.status).toBe(EmiStatus.ACTIVE);
    });

    it('Scenario 22: Preserves historical payment records while cleanly deleting EMI rule and schedule occurrences', async () => {
      const delRes = await request(app)
        .delete(`/api/v1/emi/${emiId}`)
        .set('Cookie', userCookie);

      expect(delRes.status).toBe(200);

      // EMI agreement and its installment occurrences are cleanly deleted
      const emi = await EmiRule.findById(emiId);
      expect(emi).toBeNull();

      const occCount = await EmiOccurrence.countDocuments({ emiRuleId: emiId });
      expect(occCount).toBe(0);

      // Note: Historical payment transactions remain intact in the Transaction collection
      const txCount = await Transaction.countDocuments();
      expect(txCount).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // SECTION 3: Dashboard Monthly Payment Forecast (Scenarios 23-30)
  // =========================================================================
  describe('Part 3: Upcoming Monthly Payments Forecast Endpoint', () => {
    const targetForecastMonth = '2026-11';
    let testRecurringRuleId: string;
    let testEmiRuleId: string;

    beforeAll(async () => {
      // 1. Create a recurring rule for 2026-11
      const recRes = await request(app)
        .post('/api/v1/recurring')
        .set('Cookie', userCookie)
        .send({
          title: 'Airtel Broadband',
          amount: 1199,
          type: TransactionType.EXPENSE,
          category: 'Utilities',
          frequency: RecurringFrequency.MONTHLY,
          paymentMethod: PaymentMethod.UPI,
          paymentChannel: PaymentChannel.ONLINE,
          accountId: bankAccount1Id,
          nextExecutionDate: '2026-11-05T00:00:00.000Z',
          isActive: true,
        });
      testRecurringRuleId = recRes.body.data.id;

      // 2. Create a clean active EMI starting in 2026-11
      const emiRes = await request(app)
        .post('/api/v1/emi')
        .set('Cookie', userCookie)
        .send({
          name: 'Two Wheeler Loan',
          lender: 'TVS Credit',
          monthlyAmount: 3500,
          startDate: '2026-11-01',
          firstDueDate: '2026-11-10',
          endDate: '2027-04-10', // 6 months
          totalInstallments: 6,
          paymentMethod: PaymentMethod.UPI,
          accountId: bankAccount1Id,
        });
      testEmiRuleId = emiRes.body.data.id;
    });

    it('Scenario 23 & 30: Returns obligations for target month without altering bank balances or creating transactions', async () => {
      const preAcc1 = await BankAccount.findById(bankAccount1Id);
      const preTxCount = await Transaction.countDocuments();

      const res = await request(app)
        .get(`/api/v1/analytics/upcoming-forecast?month=${targetForecastMonth}`)
        .set('Cookie', userCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const forecast = res.body.data;
      expect(forecast.month).toBe(targetForecastMonth);
      expect(forecast.totalExpectedPayments).toBeGreaterThanOrEqual(1199 + 3500);
      expect(forecast.recurringPaymentsRemaining).toBeGreaterThanOrEqual(1199);
      expect(forecast.emiPaymentsRemaining).toBeGreaterThanOrEqual(3500);

      // Verify Scenario 30: Zero phantom transactions and zero balance changes
      const postAcc1 = await BankAccount.findById(bankAccount1Id);
      const postTxCount = await Transaction.countDocuments();
      expect(postAcc1?.currentBalance).toBe(preAcc1?.currentBalance);
      expect(postTxCount).toBe(preTxCount);
    });

    it('Scenario 24, 25, 26: Paying recurring with discount updates Total Paid, removes from Remaining Needed', async () => {
      // Pay the Airtel broadband with ₹99 discount -> actual amount ₹1,100
      const execRes = await request(app)
        .post(`/api/v1/recurring/${testRecurringRuleId}/execute`)
        .set('Cookie', userCookie)
        .send({
          occurrenceKey: targetForecastMonth,
          actualAmount: 1100,
          discountAmount: 99,
          discountType: 'fixed',
          paymentMethod: PaymentMethod.UPI,
          accountId: bankAccount1Id,
        });
      expect(execRes.status).toBe(200);

      // Fetch forecast
      const res = await request(app)
        .get(`/api/v1/analytics/upcoming-forecast?month=${targetForecastMonth}`)
        .set('Cookie', userCookie);

      const forecast = res.body.data;
      // Total Paid must reflect confirmed actual payment (₹1,100)
      expect(forecast.totalPaid).toBeGreaterThanOrEqual(1100);

      // Paid recurring item must be excluded from recurringRemaining
      const airtelItem = forecast.items.find((i: any) => i.title === 'Airtel Broadband');
      expect(airtelItem.status).toBe('paid');
      expect(airtelItem.actualAmount).toBe(1100);

      // Remaining amount needed strictly equals recurringRemaining + emiRemaining
      expect(forecast.remainingAmountNeeded).toBe(forecast.recurringPaymentsRemaining + forecast.emiPaymentsRemaining);
    });

    it('Scenario 28 & 29: Switching months recalculates correctly; future-month obligations excluded from current month', async () => {
      const resNextMonth = await request(app)
        .get('/api/v1/analytics/upcoming-forecast?month=2026-12')
        .set('Cookie', userCookie);

      expect(resNextMonth.status).toBe(200);
      const nextForecast = resNextMonth.body.data;
      expect(nextForecast.month).toBe('2026-12');

      // 2026-12 EMI is ₹3,500 and unpaid
      const tvsItem = nextForecast.items.find((i: any) => i.title.includes('TVS Credit'));
      expect(tvsItem).toBeDefined();
      expect(tvsItem.status).toBe('unpaid');
      expect(tvsItem.expectedAmount).toBe(3500);

      // Future month December items are NOT in November
      const novRes = await request(app)
        .get('/api/v1/analytics/upcoming-forecast?month=2026-11')
        .set('Cookie', userCookie);
      const novItems = novRes.body.data.items;
      for (const item of novItems) {
        expect(item.occurrenceKey).toBe('2026-11');
      }
    });

    it('Scenario 27: Deleting linked transaction restores the unpaid obligation to forecast', async () => {
      // Find the transaction for Airtel broadband in 2026-11 and delete it
      const tx = await Transaction.findOne({ recurringRuleId: testRecurringRuleId, occurrenceKey: targetForecastMonth });
      expect(tx).not.toBeNull();

      const delRes = await request(app)
        .delete(`/api/v1/transactions/${tx!._id}`)
        .set('Cookie', userCookie);
      expect(delRes.status).toBe(200);

      // Check forecast again
      const res = await request(app)
        .get(`/api/v1/analytics/upcoming-forecast?month=${targetForecastMonth}`)
        .set('Cookie', userCookie);

      const forecast = res.body.data;
      const airtelItem = forecast.items.find((i: any) => i.title === 'Airtel Broadband');
      expect(airtelItem.status).toBe('unpaid');
      expect(airtelItem.expectedAmount).toBe(1199);
      expect(forecast.recurringPaymentsRemaining).toBeGreaterThanOrEqual(1199);
    });
  });
});
