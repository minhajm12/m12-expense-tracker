import mongoose from 'mongoose';
import { BankAccount } from '../models/BankAccount';
import { Transaction } from '../models/Transaction';
import { CreditCard } from '../models/CreditCard';
import { LendingBorrowing } from '../models/LendingBorrowing';
import { CashAccount } from '../models/CashAccount';
import {
  TransactionType,
  TransactionStatus,
  PaymentMethod,
  PaymentChannel,
  AccountType,
  LendingBorrowingType,
  LendingBorrowingStatus,
  TotalCashSummary,
  safeAdd,
  safeSubtract,
  fromCents,
  toCents,
} from '@finora/shared';
import { AppError } from '../utils/api-response';

import { ChitFundCollection } from '../models/ChitFundCollection';
import { ChitFundPayout } from '../models/ChitFundPayout';
import { ChitFundAdjustment } from '../models/ChitFundAdjustment';
import { ChitFund } from '../models/ChitFund';
import { RecurringOccurrence } from '../models/RecurringOccurrence';
import { RecurringTransaction } from '../models/RecurringTransaction';

/**
 * Recomputes and updates the exact balance of a bank account from its
 * opening balance, full transaction history, and chit fund inflows/outflows using decimal-safe math.
 */
export const recalculateAccountBalance = async (
  accountId: string | mongoose.Types.ObjectId,
  userId: string | mongoose.Types.ObjectId
): Promise<number> => {
  const account = await BankAccount.findOne({ _id: accountId, userId });
  if (!account) {
    throw new AppError('Bank account not found', 404, 'ACCOUNT_NOT_FOUND');
  }

  // Find all completed transactions affecting this account
  const transactions = await Transaction.find({
    userId,
    status: TransactionStatus.COMPLETED,
    $or: [{ accountId }, { destinationAccountId: accountId }],
  });

  // Find all chit fund collections received into this bank account (excluding pure Cash in Hand)
  const collectionFilter: any = {
    userId,
    paymentMethod: { $ne: 'cash_in_hand' },
  };
  if (account.isChitFundAccount) {
    collectionFilter.$or = [
      { receivingBankAccountId: accountId },
      { receivingBankAccountId: null, paymentMethod: { $ne: 'cash' } },
      { receivingBankAccountId: { $exists: false }, paymentMethod: { $ne: 'cash' } },
    ];
  } else {
    collectionFilter.receivingBankAccountId = accountId;
  }

  const collections = await ChitFundCollection.find(collectionFilter);

  // Find all chit fund payouts paid from this account
  const payoutFilter = account.isChitFundAccount
    ? {
        userId,
        $or: [
          { sourceBankAccountId: accountId },
          { sourceBankAccountId: null },
          { sourceBankAccountId: { $exists: false } },
        ],
      }
    : { userId, sourceBankAccountId: accountId };

  const payouts = await ChitFundPayout.find(payoutFilter);

  let balanceCents = toCents(account.openingBalance);

  for (const tx of transactions) {
    const txAmountCents = toCents(tx.amount);

    if (tx.type === TransactionType.INCOME) {
      if (tx.accountId?.toString() === accountId.toString()) {
        balanceCents += txAmountCents;
      }
    } else if (tx.type === TransactionType.EXPENSE) {
      if (tx.accountId?.toString() === accountId.toString()) {
        balanceCents -= txAmountCents;
      }
    } else if (tx.type === TransactionType.INVESTMENT) {
      if (tx.accountId?.toString() === accountId.toString()) {
        balanceCents -= txAmountCents;
      }
    } else if (tx.type === TransactionType.TRANSFER) {
      if (tx.destinationAccountId?.toString() === accountId.toString()) {
        // Inflow transfer
        balanceCents += txAmountCents;
      } else if (tx.accountId?.toString() === accountId.toString()) {
        // Outflow transfer
        balanceCents -= txAmountCents;
      }
    } else if (tx.type === TransactionType.CREDIT_CARD_PAYMENT) {
      // Repayment paid from this bank account
      if (tx.accountId?.toString() === accountId.toString()) {
        balanceCents -= txAmountCents;
      }
    } else if (tx.type === TransactionType.CHIT_SEPARATION) {
      // CHIT_SEPARATION is an internal reserve reclassification, NOT a physical bank debit.
      // Do not debit balanceCents.
    }
  }

  // Collections received into this bank account increase Total Bank Balance
  // Note: Collections marked as separation (isSeparation: true) or self_pay or already_paid reclassify existing bank funds
  // and must NOT increase the total bank balance again!
  // Note: Cash in Hand collections are held physically and MUST NOT increase bank balance!
  for (const col of collections) {
    const isCash = col.paymentMethod === 'cash_in_hand' || (col.paymentMethod === 'cash' && !col.receivingBankAccountId);
    const isSelfPay = col.paymentMethod === 'self_pay';
    const isAlreadyPaid = (col as any).isAlreadyPaid === true;
    if (col.actualAmountReceived > 0 && !col.isSeparation && !isCash && !isSelfPay && !isAlreadyPaid) {
      balanceCents += toCents(col.actualAmountReceived);
    }
  }

  // Payouts paid out from this bank account decrease Total Bank Balance only when completed (disbursed)
  // 1. Historical payouts (isHistorical: true) represent prize disbursements before app tracking and must NEVER debit the bank balance.
  // 2. Pure cash payouts (sourceBankAccountId is empty and upiAmount === 0) must NEVER debit the bank balance.
  // 3. For split payouts (cashAmount + upiAmount), ONLY the upiAmount debited via bank transfer reduces the bank balance.
  for (const p of payouts) {
    if ((p as any).isHistorical) {
      continue;
    }
    if (p.status !== 'completed') {
      continue;
    }

    let bankDebit = 0;
    const splitPayout = p as any;
    if (splitPayout.upiAmount !== undefined || splitPayout.cashAmount !== undefined) {
      bankDebit = splitPayout.upiAmount || 0;
    } else if (p.sourceBankAccountId) {
      bankDebit = p.amount;
    }

    if (bankDebit > 0) {
      if (!p.sourceBankAccountId || p.sourceBankAccountId.toString() === accountId.toString()) {
        balanceCents -= toCents(bankDebit);
      }
    }
  }

  // Lending and Borrowing records via UPI affecting this bank account
  const lendingBorrowingRecords = await LendingBorrowing.find({
    userId,
    $or: [
      { bankAccountId: accountId },
      { 'repayments.bankAccountId': accountId },
    ],
  });

  for (const lb of lendingBorrowingRecords) {
    if (lb.paymentMethod === 'upi' && lb.bankAccountId?.toString() === accountId.toString()) {
      // Historical loans never move bank balance!
      if (!lb.isHistorical && lb.accountingMode !== 'historical') {
        if (lb.type === LendingBorrowingType.LENDING) {
          // Lent money out via UPI from this account: bank balance decreases
          balanceCents -= toCents(lb.amount);
        } else if (lb.type === LendingBorrowingType.BORROWING) {
          // Borrowed money in via UPI to this account: bank balance increases
          balanceCents += toCents(lb.amount);
        }
      }
    }

    if (Array.isArray(lb.repayments)) {
      for (const rep of lb.repayments) {
        if (rep.paymentMethod === 'upi' && rep.bankAccountId?.toString() === accountId.toString()) {
          // Historical repayments never move bank balance!
          if (!rep.isHistorical) {
            if (lb.type === LendingBorrowingType.LENDING) {
              // Repayment received back via UPI into this account: bank balance increases
              balanceCents += toCents(rep.amount);
            } else if (lb.type === LendingBorrowingType.BORROWING) {
              // Repaying borrowed money via UPI from this account: bank balance decreases
              balanceCents -= toCents(rep.amount);
            }
          }
        }
      }
    }
  }

  const finalBalance = fromCents(balanceCents);
  account.currentBalance = finalBalance;
  await account.save();

  return finalBalance;
};

/**
 * Recomputes and updates credit card outstanding and available credit using the exact formula:
 * Outstanding = Opening Outstanding + Posted Purchases/Fees/Interest - Posted Repayments - Posted Refunds
 * Available Credit = Credit Limit - Current Outstanding
 */
export const recalculateCreditCardOutstanding = async (
  creditCardId: string | mongoose.Types.ObjectId,
  userId: string | mongoose.Types.ObjectId
): Promise<{ currentOutstanding: number; availableCredit: number }> => {
  const card = await CreditCard.findOne({ _id: creditCardId, userId });
  if (!card) {
    throw new AppError('Credit card not found', 404, 'CARD_NOT_FOUND');
  }

  const transactions = await Transaction.find({
    userId,
    creditCardId,
    status: TransactionStatus.COMPLETED,
  });

  let outstandingCents = toCents(card.openingOutstanding);

  for (const tx of transactions) {
    const txCents = toCents(tx.amount);

    if (tx.type === TransactionType.EXPENSE || tx.type === TransactionType.INVESTMENT) {
      // Purchases, fees, interest charges, or card-funded investments increase outstanding
      outstandingCents += txCents;
    } else if (tx.type === TransactionType.CREDIT_CARD_PAYMENT) {
      // Repayments decrease outstanding by the full liability settled (including redemption credits)
      const settledAmount = tx.liabilitySettled !== undefined && tx.liabilitySettled !== null ? tx.liabilitySettled : tx.amount;
      outstandingCents -= toCents(settledAmount);
    } else if (tx.type === TransactionType.CREDIT_CARD_REFUND) {
      // Merchant refunds decrease outstanding
      outstandingCents -= txCents;
    }
  }

  // Outstanding cannot drop below 0 (negative outstanding would represent credit balance, cap at 0 for outstanding)
  const finalOutstanding = Math.max(0, fromCents(outstandingCents));
  const finalAvailable = Math.max(0, safeSubtract(card.creditLimit, finalOutstanding));

  card.currentOutstanding = finalOutstanding;
  card.availableCredit = finalAvailable;
  await card.save();

  return { currentOutstanding: finalOutstanding, availableCredit: finalAvailable };
};

/**
 * Executes an atomic transfer between two accounts belonging to the authenticated user.
 */
export const executeAccountTransfer = async (params: {
  userId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amount: number;
  date: Date;
  notes?: string;
  idempotencyKey?: string;
}) => {
  const { userId, sourceAccountId, destinationAccountId, amount, date, notes, idempotencyKey } = params;

  if (sourceAccountId === destinationAccountId) {
    throw new AppError('Source and destination accounts must be different', 400, 'SAME_ACCOUNT_TRANSFER');
  }

  // Idempotency check
  if (idempotencyKey) {
    const existing = await Transaction.findOne({ userId, idempotencyKey });
    if (existing) {
      return {
        transaction: existing,
        alreadyProcessed: true,
      };
    }
  }

  // Verify ownership of both accounts
  const [sourceAccount, destAccount] = await Promise.all([
    BankAccount.findOne({ _id: sourceAccountId, userId, isArchived: false }),
    BankAccount.findOne({ _id: destinationAccountId, userId, isArchived: false }),
  ]);

  if (!sourceAccount) {
    throw new AppError('Source bank account not found or archived', 404, 'SOURCE_ACCOUNT_NOT_FOUND');
  }
  if (!destAccount) {
    throw new AppError('Destination bank account not found or archived', 404, 'DEST_ACCOUNT_NOT_FOUND');
  }

  // If transferring from designated Chit Fund account, ensure personal funds suffice
  if (sourceAccount.isChitFundAccount) {
    const [collections, payouts, adjustments] = await Promise.all([
      ChitFundCollection.find({ userId, receivingBankAccountId: sourceAccount._id }),
      ChitFundPayout.find({ userId, sourceBankAccountId: sourceAccount._id }),
      ChitFundAdjustment.find({ userId, bankAccountId: sourceAccount._id }),
    ]);
    const totalColl = collections.reduce((s: number, c) => s + c.actualAmountReceived, 0);
    const totalPay = payouts.reduce((s: number, p) => s + p.amount, 0);
    const totalAdj = adjustments.reduce((s: number, a) => s + a.amount, 0);
    const chitHeld = Math.max(0, safeAdd(safeSubtract(totalColl, totalPay), totalAdj));
    const personalAvailable = safeSubtract(sourceAccount.currentBalance, chitHeld);

    if (amount > personalAvailable) {
      throw new AppError(
        `Transfer amount (₹${amount.toLocaleString()}) exceeds personal available balance (₹${personalAvailable.toLocaleString()}). Chit fund pool money cannot be transferred.`,
        400,
        'INSUFFICIENT_PERSONAL_FUNDS'
      );
    }
  }

  // Create Unified Transfer Transaction
  const transferTx = await Transaction.create({
    userId,
    type: TransactionType.TRANSFER,
    title: `Transfer: ${sourceAccount.accountName} -> ${destAccount.accountName}`,
    amount,
    currency: sourceAccount.currency,
    date,
    category: 'Transfer',
    paymentMethod: 'bank_transfer',
    paymentChannel: 'online',
    accountId: sourceAccount._id,
    destinationAccountId: destAccount._id,
    notes,
    idempotencyKey,
    status: TransactionStatus.COMPLETED,
    isExcludedFromBudget: true,
  });

  // Recompute both account balances authoritatively using safe math
  await Promise.all([
    recalculateAccountBalance(sourceAccount._id, userId),
    recalculateAccountBalance(destAccount._id, userId),
  ]);

  return {
    transaction: transferTx,
    alreadyProcessed: false,
  };
};

/**
 * Executes an atomic credit card repayment from a bank account:
 * - Decreases bank account balance
 * - Decreases card outstanding
 * - Increases card available credit
 * - Excluded from regular expenses (liability settlement)
 * - Protected by idempotency key
 */
export const executeCreditCardRepayment = async (params: {
  userId: string;
  creditCardId: string;
  sourceAccountId: string;
  amount?: number;
  liabilitySettled?: number;
  redemptionCredit?: number;
  redemptionNotes?: string;
  isFullRepayment?: boolean;
  date: Date;
  notes?: string;
  statementId?: string;
  idempotencyKey?: string;
}) => {
  const {
    userId,
    creditCardId,
    sourceAccountId,
    isFullRepayment,
    date,
    notes,
    statementId,
    idempotencyKey,
  } = params;

  // Idempotency check
  if (idempotencyKey) {
    const existing = await Transaction.findOne({ userId, idempotencyKey });
    if (existing) {
      return {
        transaction: existing,
        alreadyProcessed: true,
      };
    }
  }

  const [card, sourceAccount] = await Promise.all([
    CreditCard.findOne({ _id: creditCardId, userId, isArchived: false }),
    BankAccount.findOne({ _id: sourceAccountId, userId, isArchived: false }),
  ]);

  if (!card) {
    throw new AppError('Credit card not found or archived', 404, 'CARD_NOT_FOUND');
  }
  if (!sourceAccount) {
    throw new AppError('Source bank account not found or archived', 404, 'SOURCE_ACCOUNT_NOT_FOUND');
  }

  // Determine total liability settled
  let liabilitySettled = params.liabilitySettled !== undefined ? params.liabilitySettled : (params.amount ?? 0);
  if (isFullRepayment) {
    if (card.currentOutstanding <= 0) {
      throw new AppError('Credit card has zero outstanding balance. No repayment is needed.', 400, 'NO_OUTSTANDING_BALANCE');
    }
    liabilitySettled = card.currentOutstanding;
  } else {
    if (liabilitySettled <= 0) {
      throw new AppError('Repayment amount must be positive', 400, 'INVALID_AMOUNT');
    }
    if (liabilitySettled > card.currentOutstanding) {
      throw new AppError(
        `Repayment amount (₹${liabilitySettled}) cannot exceed current outstanding (₹${card.currentOutstanding})`,
        400,
        'AMOUNT_EXCEEDS_OUTSTANDING'
      );
    }
  }

  const redemptionCredit = params.redemptionCredit ?? 0;
  if (redemptionCredit < 0) {
    throw new AppError('Redemption credit cannot be negative', 400, 'INVALID_REDEMPTION_CREDIT');
  }
  if (redemptionCredit > liabilitySettled) {
    throw new AppError('Redemption credit cannot exceed liability settled amount', 400, 'REDEMPTION_EXCEEDS_LIABILITY');
  }

  // Net actual amount debited from the bank account
  const actualBankPayment = Math.max(0, safeSubtract(liabilitySettled, redemptionCredit));

  const combinedNotes = [
    notes,
    redemptionCredit > 0
      ? `Redemption credit: ₹${redemptionCredit}${params.redemptionNotes ? ` (${params.redemptionNotes})` : ''}`
      : null,
  ]
    .filter(Boolean)
    .join(' | ');

  // Create Repayment Transaction
  const repaymentTx = await Transaction.create({
    userId,
    type: TransactionType.CREDIT_CARD_PAYMENT,
    title: isFullRepayment ? `Full Repayment: ${card.cardNickname}` : `Repayment: ${card.cardNickname}`,
    amount: actualBankPayment, // The actual bank deduction!
    liabilitySettled,
    redemptionCredit,
    redemptionNotes: params.redemptionNotes,
    currency: card.issuingBank ? 'INR' : sourceAccount.currency,
    date,
    category: 'Debt Repayment',
    paymentMethod: PaymentMethod.NET_BANKING,
    paymentChannel: PaymentChannel.ONLINE,
    accountId: sourceAccount._id,
    creditCardId: card._id,
    statementId,
    notes: combinedNotes || undefined,
    idempotencyKey,
    status: TransactionStatus.COMPLETED,
    isExcludedFromBudget: true, // Liability settlement, NOT an expense!
  });

  // Authoritatively update bank account balance and credit card outstanding
  await recalculateAccountBalance(sourceAccount._id, userId);
  await recalculateCreditCardOutstanding(card._id, userId);

  return {
    transaction: repaymentTx,
    card,
    sourceAccount,
    alreadyProcessed: false,
  };
};

/**
 * Records a merchant refund against a credit card:
 * - Decreases card outstanding
 * - Increases available credit
 * - Excluded from regular income; reduces net expenses
 */
export const executeCreditCardRefund = async (params: {
  userId: string;
  creditCardId: string;
  amount: number;
  title: string;
  date: Date;
  category?: string;
  notes?: string;
  idempotencyKey?: string;
}) => {
  const { userId, creditCardId, amount, title, date, category, notes, idempotencyKey } = params;

  if (idempotencyKey) {
    const existing = await Transaction.findOne({ userId, idempotencyKey });
    if (existing) {
      return {
        transaction: existing,
        alreadyProcessed: true,
      };
    }
  }

  const card = await CreditCard.findOne({ _id: creditCardId, userId, isArchived: false });
  if (!card) {
    throw new AppError('Credit card not found or archived', 404, 'CARD_NOT_FOUND');
  }

  const refundTx = await Transaction.create({
    userId,
    type: TransactionType.CREDIT_CARD_REFUND,
    title: `Refund: ${title}`,
    amount,
    currency: 'INR',
    date,
    category: category || 'Refunds received',
    paymentMethod: PaymentMethod.CREDIT_CARD,
    paymentChannel: PaymentChannel.ONLINE,
    creditCardId: card._id,
    notes,
    idempotencyKey,
    status: TransactionStatus.COMPLETED,
  });

  // Authoritatively update credit card outstanding and available credit
  await recalculateCreditCardOutstanding(card._id, userId);

  return {
    transaction: refundTx,
    card,
    alreadyProcessed: false,
  };
};

/**
 * Calculates authoritative Personal Cash in Hand ledger balance.
 * Strictly independent of Chit Cash in Hand.
 */
export const calculatePersonalCashInHand = async (
  userId: string | mongoose.Types.ObjectId
): Promise<number> => {
  let cashDoc = await CashAccount.findOne({ userId });
  if (!cashDoc) {
    const legacyCash = await BankAccount.findOne({
      userId,
      accountType: AccountType.CASH,
      isArchived: false,
    });
    const openingBal = legacyCash ? legacyCash.openingBalance : 0;
    const openingDate = legacyCash ? legacyCash.openingBalanceDate : new Date();
    cashDoc = await CashAccount.create({
      userId,
      openingBalance: openingBal,
      openingBalanceDate: openingDate,
      currentBalance: openingBal,
      currency: 'INR',
      adjustments: [],
    });
  }

  let cashCents = toCents(cashDoc.openingBalance);

  // 1. Personal cash adjustments (add cash or remove cash)
  if (Array.isArray(cashDoc.adjustments)) {
    for (const adj of cashDoc.adjustments) {
      const adjCents = toCents(adj.amount);
      if (adj.type === 'add_cash') {
        cashCents += adjCents;
      } else if (adj.type === 'remove_cash') {
        cashCents -= adjCents;
      }
    }
  }

  // 2. Regular personal cash transactions (income adds, expense subtracts)
  const cashTransactions = await Transaction.find({
    userId,
    status: TransactionStatus.COMPLETED,
    paymentMethod: PaymentMethod.CASH,
  });

  for (const tx of cashTransactions) {
    // Untracked / external cash payments do not modify tracked personal cash in hand
    if ((tx as any).isUntrackedCash || (tx as any).cashSource === 'untracked_cash' || tx.tags?.includes('untracked_cash')) {
      continue;
    }
    const txAmountCents = toCents(tx.amount);
    if (tx.type === TransactionType.INCOME) {
      cashCents += txAmountCents;
    } else if (tx.type === TransactionType.EXPENSE) {
      cashCents -= txAmountCents;
    } else if (tx.type === TransactionType.INVESTMENT) {
      cashCents -= txAmountCents;
    }
  }

  // 3. Personal Lending and Borrowing physical cash movements
  // Note: Historical loans/repayments have ZERO balance impact!
  const lbRecords = await LendingBorrowing.find({ userId });
  for (const lb of lbRecords) {
    // Principal movement: ONLY LIVE loans move cash!
    if (lb.paymentMethod === 'cash' && !lb.isHistorical && lb.accountingMode !== 'historical') {
      const amtCents = toCents(lb.amount);
      if (lb.type === LendingBorrowingType.LENDING) {
        // Live loan in cash given to someone: Personal Cash in Hand decreases
        cashCents -= amtCents;
      } else if (lb.type === LendingBorrowingType.BORROWING) {
        // Live borrowing in cash from someone: Personal Cash in Hand increases
        cashCents += amtCents;
      }
    }

    // Cash repayments: ONLY LIVE repayments move cash!
    if (Array.isArray(lb.repayments)) {
      for (const rep of lb.repayments) {
        if (rep.paymentMethod === 'cash' && !rep.isHistorical) {
          const repCents = toCents(rep.amount);
          if (lb.type === LendingBorrowingType.LENDING) {
            // Live cash repayment received back: Personal Cash in Hand increases
            cashCents += repCents;
          } else if (lb.type === LendingBorrowingType.BORROWING) {
            // Live cash repayment paid out: Personal Cash in Hand decreases
            cashCents -= repCents;
          }
        }
      }
    }
  }

  const finalCash = fromCents(cashCents);
  cashDoc.currentBalance = finalCash;
  await cashDoc.save();

  return finalCash;
};

/**
 * Backward compatibility alias for calculatePersonalCashInHand.
 */
export const calculateCashInHand = calculatePersonalCashInHand;

/**
 * Calculates authoritative Chit Cash in Hand ledger balance.
 * Strictly exclusive to chit fund collections and payouts.
 */
export const calculateChitCashInHand = async (
  userId: string | mongoose.Types.ObjectId,
  chitFundId?: string | mongoose.Types.ObjectId
): Promise<number> => {
  const colFilter: any = {
    userId,
    isSeparation: { $ne: true },
    isAlreadyPaid: { $ne: true },
    $or: [
      { paymentMethod: 'cash_in_hand' },
      { paymentMethod: 'cash', receivingBankAccountId: { $in: [null, undefined] } },
    ],
  };
  if (chitFundId) {
    colFilter.chitFundId = chitFundId;
  }

  const chitCashCollections = await ChitFundCollection.find(colFilter);
  let totalCashCollected = 0;
  for (const col of chitCashCollections) {
    if (col.actualAmountReceived > 0) {
      totalCashCollected = safeAdd(totalCashCollected, col.actualAmountReceived);
    }
  }

  const payoutFilter: any = {
    userId,
    status: 'completed',
    isHistorical: { $ne: true },
  };
  if (chitFundId) {
    payoutFilter.chitFundId = chitFundId;
  }

  const chitCashPayouts = await ChitFundPayout.find(payoutFilter);
  let totalCashPayouts = 0;
  for (const p of chitCashPayouts) {
    const splitPayout = p as any;
    let cashDebit = 0;
    if (splitPayout.cashAmount !== undefined && splitPayout.cashAmount > 0) {
      cashDebit = splitPayout.cashAmount;
    } else if (!p.sourceBankAccountId && splitPayout.upiAmount === 0) {
      cashDebit = p.amount;
    }
    if (cashDebit > 0) {
      totalCashPayouts = safeAdd(totalCashPayouts, cashDebit);
    }
  }

  return Math.max(0, safeSubtract(totalCashCollected, totalCashPayouts));
};

/**
 * Calculates authoritative Chit Funds Held in Bank:
 * Total bank collections - Total live completed bank payouts + Total chit adjustments.
 * Strictly excludes cash in hand collections and cash payouts.
 */
export const calculateChitFundsHeldInBank = async (
  userId: string | mongoose.Types.ObjectId,
  designatedBankAccountId?: string | mongoose.Types.ObjectId
): Promise<number> => {
  const allCollections = await ChitFundCollection.find({
    userId,
  });

  const isCashPayment = (c: any) =>
    c.paymentMethod === 'cash_in_hand' || (c.paymentMethod === 'cash' && !c.receivingBankAccountId);

  let totalBankCollected = 0;
  for (const c of allCollections) {
    if (!isCashPayment(c) && c.actualAmountReceived > 0) {
      if (
        !designatedBankAccountId ||
        !c.receivingBankAccountId ||
        c.receivingBankAccountId.toString() === designatedBankAccountId.toString()
      ) {
        totalBankCollected = safeAdd(totalBankCollected, c.actualAmountReceived);
      }
    }
  }

  const livePayouts = await ChitFundPayout.find({
    userId,
    status: 'completed',
    isHistorical: { $ne: true },
  });

  let totalBankPayouts = 0;
  for (const p of livePayouts) {
    const splitPayout = p as any;
    let bankDebit = 0;
    if (splitPayout.upiAmount !== undefined || splitPayout.cashAmount !== undefined) {
      bankDebit = splitPayout.upiAmount || 0;
    } else if (p.sourceBankAccountId) {
      bankDebit = p.amount;
    }

    if (bankDebit > 0) {
      if (
        !designatedBankAccountId ||
        !p.sourceBankAccountId ||
        p.sourceBankAccountId.toString() === designatedBankAccountId.toString()
      ) {
        totalBankPayouts = safeAdd(totalBankPayouts, bankDebit);
      }
    }
  }

  const allAdjustments = await ChitFundAdjustment.find({ userId });
  let totalAdjustments = 0;
  for (const a of allAdjustments) {
    if (
      !designatedBankAccountId ||
      !a.bankAccountId ||
      a.bankAccountId.toString() === designatedBankAccountId.toString()
    ) {
      totalAdjustments = safeAdd(totalAdjustments, a.amount || 0);
    }
  }

  return Math.max(0, safeAdd(safeSubtract(totalBankCollected, totalBankPayouts), totalAdjustments));
};

/**
 * Returns the comprehensive Total Cash Overview summary:
 * B_chit: Designated Chit Fund Bank Account balance
 * R_chit: Chit fund money reserved and held in bank
 * B_other: Sum of all other personal bank accounts
 * C_personal: Personal Cash in Hand (strictly personal, chit cash excluded!)
 * L: Outstanding Personal Lending principal
 * D_borrowed: Outstanding Personal Borrowing principal (excluding credit cards)
 * D_cc: Outstanding Credit Card debt across active cards
 *
 * Calculations:
 * Personal Available Balance of Chit Bank = B_chit - R_chit
 * Total Personal Available Balance = (B_chit - R_chit) + B_other
 * Total Available Money = Total Personal Available Balance + C_personal
 * Total Financial Assets Tracked = C_personal + L + Total Personal Available Balance
 * Total Outstanding Debt = D_borrowed + D_cc
 * Net Personal Financial Position = Total Assets Tracked - Total Outstanding Debt
 */
export const getTotalCashSummary = async (
  userId: string | mongoose.Types.ObjectId
): Promise<TotalCashSummary> => {
  const accounts = await BankAccount.find({ userId, isArchived: false }).sort({ createdAt: -1 });
  const totalBankBalance = accounts.reduce((sum, acc) => safeAdd(sum, acc.currentBalance), 0);
  const personalCashInHand = await calculatePersonalCashInHand(userId);
  const cashDoc = await CashAccount.findOne({ userId });
  const openingCashBalance = cashDoc ? cashDoc.openingBalance : 0;

  // Identify designated chit fund bank account
  let designatedAccount = accounts.find((acc) => acc.isChitFundAccount);
  if (!designatedAccount) {
    const fund = await ChitFund.findOne({ userId, isActive: true });
    if (fund?.designatedBankAccountId) {
      designatedAccount = accounts.find(
        (acc) => acc._id.toString() === fund.designatedBankAccountId?.toString()
      );
    }
  }

  const isChitAccountConfigured = Boolean(designatedAccount);
  const designatedBankAccountId = designatedAccount?._id ? designatedAccount._id.toString() : undefined;
  const designatedBankAccountName = designatedAccount?.accountName;
  const designatedBankBalance = designatedAccount ? designatedAccount.currentBalance : 0;

  // Calculate R_chit
  let chitReserveHeldInBank = 0;
  if (isChitAccountConfigured) {
    chitReserveHeldInBank = await calculateChitFundsHeldInBank(userId, designatedAccount?._id);
  }

  // Personal Available Balance of Chit Bank: B_chit - R_chit
  const personalAvailableBalanceChitBank = isChitAccountConfigured
    ? safeSubtract(designatedBankBalance, chitReserveHeldInBank)
    : 0;

  // Sum of other bank accounts: B_other
  const otherAccounts = isChitAccountConfigured
    ? accounts.filter((acc) => acc._id.toString() !== designatedAccount?._id.toString())
    : accounts;
  const otherBankBalances = otherAccounts.reduce((sum, acc) => safeAdd(sum, acc.currentBalance), 0);

  // Total Personal Available Balance: (B_chit - R_chit) + B_other
  const totalPersonalAvailableBalance = safeAdd(personalAvailableBalanceChitBank, otherBankBalances);

  // Outstanding Personal Lending: L
  const lendingRecords = await LendingBorrowing.find({
    userId,
    type: LendingBorrowingType.LENDING,
    status: { $in: [LendingBorrowingStatus.OUTSTANDING, LendingBorrowingStatus.PARTIALLY_SETTLED] },
  });
  const outstandingLending = lendingRecords.reduce((sum, r) => safeAdd(sum, r.outstandingAmount), 0);

  // Outstanding Personal Borrowing: D_borrowed (excluding credit cards)
  const borrowingRecords = await LendingBorrowing.find({
    userId,
    type: LendingBorrowingType.BORROWING,
    status: { $in: [LendingBorrowingStatus.OUTSTANDING, LendingBorrowingStatus.PARTIALLY_SETTLED] },
  });
  const personalBorrowingOutstanding = borrowingRecords.reduce(
    (sum, r) => safeAdd(sum, r.outstandingAmount),
    0
  );

  // Outstanding Credit Card Debt: D_cc
  const creditCards = await CreditCard.find({ userId, isArchived: false });
  const creditCardOutstanding = creditCards.reduce(
    (sum, card) => safeAdd(sum, card.currentOutstanding || 0),
    0
  );

  // Total Outstanding Debt: D_borrowed + D_cc
  const totalOutstandingDebt = safeAdd(personalBorrowingOutstanding, creditCardOutstanding);

  // Total Available Money: Total Personal Available Balance + C_personal
  const totalAvailableMoney = safeAdd(totalPersonalAvailableBalance, personalCashInHand);

  // Total Assets Tracked: C_personal + L + Total Personal Available Balance
  const totalFinancialAssetsTracked = safeAdd(
    personalCashInHand,
    safeAdd(outstandingLending, totalPersonalAvailableBalance)
  );

  // Net Personal Financial Position: Total Assets Tracked - Total Outstanding Debt
  const netTrackedPosition = safeSubtract(totalFinancialAssetsTracked, totalOutstandingDebt);

  let latestAdjustmentDate: string | undefined = undefined;
  if (cashDoc?.adjustments && cashDoc.adjustments.length > 0) {
    const lastAdj = cashDoc.adjustments[cashDoc.adjustments.length - 1];
    latestAdjustmentDate = lastAdj.date.toISOString();
  } else if (cashDoc?.openingBalanceDate) {
    latestAdjustmentDate = cashDoc.openingBalanceDate.toISOString();
  }

  return {
    totalBankBalance,
    designatedBankAccountId,
    designatedBankAccountName,
    isChitAccountConfigured,
    designatedBankBalance,
    chitReserveHeldInBank,
    personalAvailableBalanceChitBank,
    otherBankBalances,
    totalPersonalAvailableBalance,
    cashInHand: personalCashInHand,
    personalCashInHand,
    openingCashBalance,
    latestAdjustmentDate,
    outstandingLending,
    totalAvailableMoney,
    totalFinancialAssetsTracked,
    personalBorrowingOutstanding,
    creditCardOutstanding,
    totalOutstandingDebt,
    outstandingBorrowing: personalBorrowingOutstanding,
    netTrackedPosition,
    accounts: accounts.map((a) => a.toJSON() as any),
    adjustments: cashDoc?.adjustments?.map((adj: any) => ({
      id: adj._id ? adj._id.toString() : (adj.id || undefined),
      type: adj.type,
      amount: adj.amount,
      date: adj.date.toISOString(),
      description: adj.description,
      createdAt: adj.createdAt ? adj.createdAt.toISOString() : undefined,
    })) || [],
  };
};

/**
 * Reverts a recurring occurrence when a linked transaction is deleted:
 * - Resets occurrence status to 'DUE' and unlinks transaction
 * - Recalculates the recurring rule's nextExecutionDate to the earliest unpaid occurrence
 * - Updates lastExecutedAt to the most recent remaining logged occurrence
 */
export const revertRecurringOccurrence = async (params: {
  userId: string | mongoose.Types.ObjectId;
  recurringRuleId: string | mongoose.Types.ObjectId;
  occurrenceKey?: string;
  transactionId?: string | mongoose.Types.ObjectId;
}): Promise<void> => {
  const { userId, recurringRuleId, occurrenceKey, transactionId } = params;

  // 1. Find the occurrence record
  const query: any = { userId, recurringRuleId };
  if (occurrenceKey) {
    query.occurrenceKey = occurrenceKey;
  } else if (transactionId) {
    query.transactionId = transactionId;
  }

  const occurrence = await RecurringOccurrence.findOne(query);
  if (occurrence) {
    occurrence.status = 'DUE';
    occurrence.transactionId = undefined;
    occurrence.loggedAt = undefined;
    await occurrence.save();
  }

  // 2. Find the rule and recalculate nextExecutionDate & lastExecutedAt
  const rule = await RecurringTransaction.findOne({ _id: recurringRuleId, userId });
  if (!rule) {
    return;
  }

  // Find all DUE occurrences for this rule, sorted by scheduledDate ascending
  const dueOccurrences = await RecurringOccurrence.find({
    userId,
    recurringRuleId,
    status: 'DUE',
  }).sort({ scheduledDate: 1 });

  if (dueOccurrences.length > 0) {
    rule.nextExecutionDate = dueOccurrences[0].scheduledDate;
  } else if (occurrence?.scheduledDate) {
    rule.nextExecutionDate = occurrence.scheduledDate;
  }

  // Recalculate lastExecutedAt from the latest remaining LOGGED occurrence
  const latestLogged = await RecurringOccurrence.findOne({
    userId,
    recurringRuleId,
    status: 'LOGGED',
  }).sort({ loggedAt: -1, scheduledDate: -1 });

  if (latestLogged?.loggedAt) {
    rule.lastExecutedAt = latestLogged.loggedAt;
  } else if (latestLogged?.scheduledDate) {
    rule.lastExecutedAt = latestLogged.scheduledDate;
  } else {
    rule.lastExecutedAt = undefined;
  }

  await rule.save();
};


