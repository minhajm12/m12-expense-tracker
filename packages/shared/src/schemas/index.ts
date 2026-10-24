import { z } from 'zod';
import {
  UserRole,
  AccountType,
  TransactionType,
  TransactionStatus,
  PaymentMethod,
  PaymentChannel,
  CreditCardNetwork,
  RecurringFrequency,
  LendingBorrowingType,
  LendingBorrowingStatus,
  EmiStatus,
  EmiOccurrenceStatus,
} from '../constants/financial';
import { parseDateInput } from '../utils/date';

export const flexibleDateSchema = z.union([
  z.date(),
  z.string().refine(
    (val) => {
      try {
        const d = parseDateInput(val);
        return !isNaN(d.getTime());
      } catch {
        return false;
      }
    },
    { message: 'Invalid date format. Expected YYYY-MM-DD, DD/MM/YYYY, or ISO timestamp' }
  ),
]);

// ==========================================
// Generic & Pagination
// ==========================================

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ==========================================
// Authentication & User
// ==========================================

export const registerSchema = z.object({
  email: z.string().email('Please enter a valid email address').toLowerCase().trim(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .max(128, 'Password must not exceed 128 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  fullName: z.string().min(2, 'Name must be at least 2 characters').max(100).trim(),
  currency: z.string().length(3).default('INR'),
});

export const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address').toLowerCase().trim(),
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .max(128)
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Must contain at least one number'),
});

export const updateProfileSchema = z.object({
  fullName: z.string().min(2).max(100).optional(),
  currency: z.string().length(3).optional(),
  preferences: z
    .object({
      theme: z.enum(['light', 'dark', 'system']).optional(),
      dateFormat: z.string().optional(),
      notifyDueDates: z.boolean().optional(),
      notifyBudgetAlerts: z.boolean().optional(),
    })
    .optional(),
});

// ==========================================
// Bank Accounts
// ==========================================

export const createBankAccountSchema = z.object({
  accountName: z.string().min(1, 'Account name is required').max(100).trim(),
  bankName: z.string().min(1, 'Bank name is required').max(100).trim(),
  accountType: z.nativeEnum(AccountType),
  accountNumberMasked: z.string().max(30).optional(),
  openingBalance: z.number().default(0),
  openingBalanceDate: flexibleDateSchema,
  currency: z.string().length(3).default('INR'),
  color: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/).optional(),
  icon: z.string().max(50).optional(),
  isChitFundAccount: z.boolean().optional(),
  confirmReassign: z.boolean().optional(),
  notes: z.string().max(500).optional(),
});

export const updateBankAccountSchema = createBankAccountSchema.partial().extend({
  isArchived: z.boolean().optional(),
});

// ==========================================
// Credit Cards
// ==========================================

export const createCreditCardSchema = z.object({
  cardNickname: z.string().min(1, 'Card nickname is required').max(100).trim(),
  issuingBank: z.string().min(1, 'Issuing bank is required').max(100).trim(),
  network: z.nativeEnum(CreditCardNetwork),
  lastFourDigits: z
    .string()
    .length(4, 'Last four digits must be exactly 4 digits')
    .regex(/^\d{4}$/, 'Must be numeric')
    .optional(),
  creditLimit: z.number().positive('Credit limit must be greater than 0'),
  billingCycleClosingDay: z
    .number()
    .int()
    .min(1, 'Closing day must be between 1 and 31')
    .max(31, 'Closing day must be between 1 and 31'),
  paymentDueDay: z
    .number()
    .int()
    .min(1, 'Due day must be between 1 and 31')
    .max(31, 'Due day must be between 1 and 31'),
  openingOutstanding: z.number().min(0, 'Outstanding cannot be negative').default(0),
  openingOutstandingDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)),
  annualFee: z.number().min(0).default(0),
  rewardsNotes: z.string().max(1000).optional(),
  notes: z.string().max(500).optional(),
});

export const updateCreditCardSchema = createCreditCardSchema.partial().extend({
  isArchived: z.boolean().optional(),
});

export const creditCardRepaymentSchema = z
  .object({
    creditCardId: z.string().min(1, 'Credit card is required'),
    sourceAccountId: z.string().min(1, 'Source bank account is required'),
    amount: z.number().nonnegative().optional(),
    liabilitySettled: z.number().nonnegative().optional(),
    redemptionCredit: z.number().nonnegative().default(0).optional(),
    redemptionNotes: z.string().max(200).optional(),
    isFullRepayment: z.boolean().optional(),
    date: flexibleDateSchema,
    statementId: z.string().optional(),
    notes: z.string().max(500).optional(),
    idempotencyKey: z.string().min(1, 'Idempotency key is required'),
  })
  .refine(
    (data) =>
      data.isFullRepayment ||
      (data.liabilitySettled !== undefined && data.liabilitySettled > 0) ||
      (data.amount !== undefined && data.amount > 0),
    {
      message: 'Repayment amount or liability settled must be positive when not paying in full',
      path: ['amount'],
    }
  )
  .refine(
    (data) => {
      const settled = data.liabilitySettled ?? data.amount ?? 0;
      const credit = data.redemptionCredit ?? 0;
      return credit >= 0 && (settled === 0 || credit <= settled);
    },
    {
      message: 'Redemption credit cannot exceed liability settled amount',
      path: ['redemptionCredit'],
    }
  );

// ==========================================
// Transactions (Income & Expenses)
// ==========================================

export const baseTransactionSchema = z.object({
  type: z.nativeEnum(TransactionType),
  title: z.string().min(1, 'Title is required').max(200).trim(),
  amount: z.number().positive('Amount must be positive'),
  currency: z.string().length(3).default('INR'),
  date: flexibleDateSchema,
  category: z.string().min(1, 'Category is required'),
  subcategory: z.string().max(100).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod),
  paymentChannel: z.nativeEnum(PaymentChannel),
  accountId: z
    .string()
    .optional()
    .transform((val) => (!val ? undefined : val)),
  creditCardId: z
    .string()
    .optional()
    .transform((val) => (!val ? undefined : val)),
  merchantOrRecipient: z.string().max(200).optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().max(1000).optional(),
  receiptUrl: z.string().url().optional(),
  status: z.nativeEnum(TransactionStatus).default(TransactionStatus.COMPLETED),
  idempotencyKey: z.string().optional(),
  recurringRuleId: z.string().optional(),
  occurrenceKey: z.string().optional(),
  liabilitySettled: z.number().nonnegative().optional(),
  redemptionCredit: z.number().nonnegative().optional(),
  redemptionNotes: z.string().max(200).optional(),
  originalAmount: z.number().nonnegative().optional(),
  discountAmount: z.number().nonnegative().optional(),
  discountType: z.string().max(50).optional(),
  discountNotes: z.string().max(500).optional(),
  isExcludedFromBudget: z.boolean().optional(),
  isPastRecorded: z.boolean().optional().default(false),
});

export const createTransactionSchema = baseTransactionSchema.refine(
  (data) => {
    // If credit card payment method is selected, creditCardId must be provided
    if (data.paymentMethod === PaymentMethod.CREDIT_CARD) {
      return !!data.creditCardId;
    }
    // Otherwise if it's not cash/other, accountId should be provided
    if ([PaymentMethod.UPI, PaymentMethod.DEBIT_CARD, PaymentMethod.NET_BANKING, PaymentMethod.BANK_TRANSFER].includes(data.paymentMethod)) {
      return !!data.accountId;
    }
    return true;
  },
  {
    message: 'Valid bank account or credit card must be selected for the chosen payment method',
    path: ['accountId'],
  }
);

export const updateTransactionSchema = baseTransactionSchema.partial();

// ==========================================
// Account Transfers
// ==========================================

export const createTransferSchema = z.object({
  sourceAccountId: z.string().min(1, 'Source account is required'),
  destinationAccountId: z.string().min(1, 'Destination account is required'),
  amount: z.number().positive('Transfer amount must be positive'),
  date: flexibleDateSchema,
  notes: z.string().max(500).optional(),
  idempotencyKey: z.string().min(1, 'Idempotency key is required'),
}).refine((data) => data.sourceAccountId !== data.destinationAccountId, {
  message: 'Source and destination accounts must be different',
  path: ['destinationAccountId'],
});

// ==========================================
// Budgets
// ==========================================

export const createBudgetSchema = z.object({
  category: z.string().min(1, 'Category is required'),
  limitAmount: z.number().positive('Budget limit must be positive'),
  period: z.enum(['monthly', 'custom']).default('monthly'),
  startDate: flexibleDateSchema,
  endDate: flexibleDateSchema,
  alertThresholdPercent: z.number().min(1).max(100).default(80),
});

export const updateBudgetSchema = createBudgetSchema.partial();

// ==========================================
// Recurring Schedules
// ==========================================

export const createRecurringSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200).trim(),
  amount: z.number().positive('Amount must be positive'),
  type: z.nativeEnum(TransactionType),
  category: z.string().min(1, 'Category is required'),
  frequency: z.nativeEnum(RecurringFrequency),
  paymentMethod: z.nativeEnum(PaymentMethod),
  paymentChannel: z.nativeEnum(PaymentChannel),
  accountId: z.string().optional(),
  creditCardId: z.string().optional(),
  nextExecutionDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)),
  notes: z.string().max(500).optional(),
  isActive: z.boolean().default(true),
  isFlexibleDate: z.boolean().optional(),
  status: z.enum(['active', 'completed', 'cancelled']).optional(),
});

export const updateRecurringSchema = createRecurringSchema.partial();

export const executeRecurringSchema = z.object({
  occurrenceKey: z.string().optional(),
  actualAmount: z.number().positive().optional(),
  discountType: z.string().optional(),
  discountAmount: z.number().min(0).optional(),
  discountNotes: z.string().max(500).optional(),
  updateFutureAmount: z.boolean().optional(),
  futureAmount: z.number().positive().optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  paymentChannel: z.nativeEnum(PaymentChannel).optional(),
  accountId: z.string().optional(),
  creditCardId: z.string().optional(),
  updateFuturePaymentSettings: z.boolean().optional(),
});

// ==========================================
// Module Preferences (Per-User)
// ==========================================

export const updateModulePreferencesSchema = z.object({
  expenseTracker: z.boolean().optional(),
  emi: z.boolean().optional(),
  lendingBorrowing: z.boolean().optional(),
  budget: z.boolean().optional(),
  recurringTransactions: z.boolean().optional(),
  creditCards: z.boolean().optional(),
  chitFund: z.boolean().optional(),
  investment: z.boolean().optional(),
});

// ==========================================
// Chit Fund Schemas
// ==========================================

export const createChitFundSchema = z.object({
  name: z.string().min(1, 'Chit fund name is required').max(100).trim(),
  totalChits: z.number().int().min(1).default(20),
  defaultContributionPerChit: z.number().positive().default(5000),
  currency: z.string().length(3).default('INR'),
  collectionFrequency: z.string().default('monthly'),
  startDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  currentPeriod: z.string().optional(),
  notes: z.string().max(500).optional(),
});

export const updateChitFundSchema = createChitFundSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const createChitFundMemberSchema = z.object({
  chitFundId: z.string().optional(),
  name: z.string().min(1, 'Member name is required').max(100).trim(),
  numberOfChits: z.number().int().min(1, 'Number of chits must be at least 1').default(1),
  contributionPerChit: z.number().positive('Contribution per chit must be positive').default(5000),
  monthlyContribution: z.number().positive('Monthly contribution must be positive').optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal('')),
  startDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  hasPreviouslyWon: z.boolean().optional().default(false),
  previousWinDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional().or(z.literal('')),
  previousWinCycle: z.string().max(20).optional().or(z.literal('')),
  previousWinNotes: z.string().max(500).optional(),
  notes: z.string().max(500).optional(),
});

export const updateChitFundMemberSchema = createChitFundMemberSchema.partial().extend({
  status: z.enum(['active', 'inactive', 'archived']).optional(),
  monthlyContribution: z.number().positive('Monthly contribution must be positive').optional(),
});

export const createChitFundCollectionSchema = z.object({
  chitFundId: z.string().optional(),
  memberId: z.string().min(1, 'Member is required'),
  collectionPeriod: z.string().min(1, 'Collection period is required'),
  chitsCovered: z.number().int().min(1).default(1),
  expectedAmount: z.number().positive('Expected amount must be positive').optional(),
  actualAmountReceived: z.number().nonnegative('Received amount cannot be negative'),
  isSeparation: z.boolean().optional().default(false),
  isAlreadyPaid: z.boolean().optional().default(false),
  sourceAccountId: z.string().optional().transform((v) => (!v ? undefined : v)),
  collectionDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)),
  receivingBankAccountId: z.string().optional().transform((v) => (!v ? undefined : v)),
  paymentMethod: z.string().default('upi'),
  reference: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
});

export const confirmWinnerSchema = z.object({
  memberId: z.string().min(1, 'Member is required'),
  alreadyPaidOut: z.boolean().optional().default(false),
  notes: z.string().max(500).optional(),
});

export const correctWinnerSchema = z.object({
  newMemberId: z.string().min(1, 'New member is required'),
  reason: z.string().min(1, 'Reason is required').max(500),
});

export const resetChitWinnerMonthSchema = z.object({
  chitFundId: z.string().optional(),
  cyclePeriod: z.string().min(1, 'Cycle period is required'),
  reason: z.string().max(500).optional(),
});

export const resetAllChitWinnersSchema = z.object({
  chitFundId: z.string().optional(),
  confirmationPhrase: z.literal('RESET WINNERS', {
    errorMap: () => ({ message: 'Confirmation phrase must be exactly "RESET WINNERS"' }),
  }),
  reason: z.string().max(500).optional(),
});

export const createChitFundPayoutSchema = z.object({
  chitFundId: z.string().optional(),
  recipientName: z.string().min(1, 'Recipient name is required').max(100).trim(),
  memberId: z.string().optional().transform((v) => (!v ? undefined : v)),
  payoutPeriod: z.string().min(1, 'Payout period is required'),
  amount: z.number().positive('Payout amount must be positive'),
  cashAmount: z.number().min(0, 'Cash amount cannot be negative').optional(),
  upiAmount: z.number().min(0, 'UPI amount cannot be negative').optional(),
  isHistorical: z.boolean().optional(),
  payoutDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)),
  sourceBankAccountId: z.string().optional().transform((v) => (!v ? undefined : v)),
  status: z.enum(['completed', 'pending']).default('completed').optional(),
  reference: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
});

export const updateChitFundPayoutSchema = createChitFundPayoutSchema.partial();

export const createChitFundAdjustmentSchema = z.object({
  chitFundId: z.string().optional(),
  amount: z.number(),
  reason: z.string().min(1, 'Reason is required').max(200).trim(),
  notes: z.string().max(500).optional(),
  date: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
});

export const createChitFundSeparationSchema = z.object({
  chitFundId: z.string().optional(),
  sourceBankAccountId: z.string().optional(),
  amount: z.number().positive('Amount to separate must be positive'),
  date: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)).optional(),
  description: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
});

// ==========================================
// Data Management & Reset Schemas
// ==========================================

export const resetTransactionsSchema = z.object({
  confirmationPhrase: z.literal('RESET MY DATA', {
    errorMap: () => ({ message: 'Confirmation phrase must be exactly "RESET MY DATA"' }),
  }),
  selectedTypes: z.array(
    z.enum([
      'income',
      'expense',
      'transfers',
      'credit_card_purchases',
      'credit_card_repayments',
      'chit_collections',
      'chit_payouts',
      'chit_reclassifications',
      'budgets',
      'recurring',
    ])
  ).min(1, 'Please select at least one transaction type to reset'),
});

export const resetAllFinancialDataSchema = z.object({
  confirmationPhrase: z.literal('RESET MY DATA', {
    errorMap: () => ({ message: 'Confirmation phrase must be exactly "RESET MY DATA"' }),
  }),
  password: z.string().optional(),
});

export const resetChitFundFinancialsSchema = z.object({
  chitFundId: z.string().optional(),
  confirmationPhrase: z.literal('RESET CHIT FINANCIALS', {
    errorMap: () => ({ message: 'Confirmation phrase must be exactly "RESET CHIT FINANCIALS"' }),
  }),
  preserveCurrentBankBalance: z.boolean().default(true).optional(),
});

export const deleteAccountPermanentlySchema = z.object({
  confirmationPhrase: z.literal('DELETE', {
    errorMap: () => ({ message: 'Confirmation phrase must be exactly "DELETE"' }),
  }),
  password: z.string().optional(),
});

export const resetLendingBorrowingSchema = z.object({
  confirmationPhrase: z.literal('RESET LENDING DATA', {
    errorMap: () => ({ message: 'Confirmation phrase must be exactly "RESET LENDING DATA"' }),
  }),
});

export const resetEmiSchema = z.object({
  confirmationPhrase: z.literal('RESET EMI DATA', {
    errorMap: () => ({ message: 'Confirmation phrase must be exactly "RESET EMI DATA"' }),
  }),
});

// ==========================================
// Lending & Borrowing Schemas
// ==========================================

export const createLendingBorrowingSchema = z.object({
  type: z.nativeEnum(LendingBorrowingType),
  personName: z.string().min(1, 'Person name is required').max(100).trim(),
  phoneNumber: z.string().max(20).optional(),
  amount: z.number().positive('Amount must be positive'),
  date: flexibleDateSchema,
  dueDate: flexibleDateSchema.optional(),
  paymentMethod: z.enum(['upi', 'cash']),
  bankAccountId: z.string().optional(),
  description: z.string().max(300).optional(),
  notes: z.string().max(1000).optional(),
  isHistorical: z.boolean().optional().default(false),
  accountingMode: z.enum(['historical', 'live']).optional(),
  initialSettledAmount: z.number().min(0).optional(),
}).refine(
  (data) => {
    // Only live UPI loans require a bank account. Historical loans do not move funds now.
    if (data.paymentMethod === 'upi' && !data.isHistorical && data.accountingMode !== 'historical') {
      return !!data.bankAccountId;
    }
    return true;
  },
  {
    message: 'Bank account is required when payment method is UPI for live loans',
    path: ['bankAccountId'],
  }
);

export const updateLendingBorrowingSchema = z.object({
  type: z.nativeEnum(LendingBorrowingType).optional(),
  personName: z.string().min(1).max(100).trim().optional(),
  phoneNumber: z.string().max(20).optional(),
  amount: z.number().positive('Amount must be positive').optional(),
  date: flexibleDateSchema.optional(),
  dueDate: flexibleDateSchema.optional(),
  paymentMethod: z.enum(['upi', 'cash']).optional(),
  bankAccountId: z.string().optional(),
  description: z.string().max(300).optional(),
  notes: z.string().max(1000).optional(),
  status: z.nativeEnum(LendingBorrowingStatus).optional(),
  isHistorical: z.boolean().optional(),
  accountingMode: z.enum(['historical', 'live']).optional(),
});

export const createLendingRepaymentSchema = z.object({
  amount: z.number().positive('Repayment amount must be positive'),
  date: flexibleDateSchema,
  paymentMethod: z.enum(['upi', 'cash']),
  bankAccountId: z.string().optional(),
  notes: z.string().max(500).optional(),
  isHistorical: z.boolean().optional().default(false),
}).refine(
  (data) => {
    if (data.paymentMethod === 'upi' && !data.isHistorical) {
      return !!data.bankAccountId;
    }
    return true;
  },
  {
    message: 'Bank account is required when repayment method is UPI',
    path: ['bankAccountId'],
  }
);

export const updateCashAccountSchema = z.object({
  openingBalance: z.number().min(0, 'Opening balance cannot be negative'),
  openingBalanceDate: flexibleDateSchema.optional(),
  notes: z.string().max(500).optional(),
});

export const cashAdjustmentSchema = z.object({
  type: z.enum(['set_balance', 'add_cash', 'remove_cash']),
  amount: z.number().positive('Adjustment amount must be positive'),
  date: flexibleDateSchema,
  description: z.string().max(500).optional(),
  source: z.enum(['bank_account', 'person', 'manual']).optional(),
  bankAccountId: z.string().optional(),
  personName: z.string().max(200).optional(),
});

// ==========================================
// EMI Management Schemas
// ==========================================

export const createEmiSchema = z.object({
  name: z.string().min(1, 'EMI / Loan Name is required').max(200).trim(),
  lender: z.string().min(1, 'Lender name is required').max(200).trim(),
  monthlyAmount: z.number().positive('Monthly EMI amount must be positive'),
  startDate: flexibleDateSchema,
  firstDueDate: flexibleDateSchema,
  nextEmiDate: flexibleDateSchema.optional(),
  dueDay: z.number().int().min(1).max(31).optional(),
  endDate: flexibleDateSchema,
  totalInstallments: z.number().int().positive().optional(),
  originalLoanAmount: z.number().min(0).optional(),
  outstandingPrincipal: z.number().min(0).optional(),
  loanReference: z.string().max(100).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod),
  paymentChannel: z.nativeEnum(PaymentChannel).default(PaymentChannel.ONLINE),
  accountId: z.string().optional(),
  creditCardId: z.string().optional(),
  notes: z.string().max(500).optional(),
  markHistoricalPaid: z.boolean().optional().default(false),
  downPaymentAmount: z.number().min(0, 'Down payment amount cannot be negative').optional().default(0),
  downPaymentAlreadyPaid: z.boolean().optional().default(false),
  downPaymentPaymentMethod: z.nativeEnum(PaymentMethod).optional(),
  downPaymentAccountId: z.string().optional(),
  downPaymentCreditCardId: z.string().optional(),
  downPaymentDate: flexibleDateSchema.optional(),
  downPaymentNotes: z.string().max(500).optional(),
  historicalInstallments: z
    .array(
      z.object({
        occurrenceKey: z.string(),
        actualAmount: z.number().positive().optional(),
        notes: z.string().max(500).optional(),
      })
    )
    .optional(),
}).refine(
  (data) => {
    try {
      const firstDue = parseDateInput(data.firstDueDate);
      const end = parseDateInput(data.endDate);
      return end.getTime() >= firstDue.getTime();
    } catch {
      return false;
    }
  },
  {
    message: 'End date must be on or after first due date',
    path: ['endDate'],
  }
);

export const updateEmiSchema = z.object({
  name: z.string().min(1).max(200).trim().optional(),
  lender: z.string().min(1).max(200).trim().optional(),
  monthlyAmount: z.number().positive().optional(),
  endDate: flexibleDateSchema.optional(),
  nextEmiDate: flexibleDateSchema.optional(),
  dueDay: z.number().int().min(1).max(31).optional(),
  totalInstallments: z.number().int().positive().optional(),
  originalLoanAmount: z.number().min(0).optional(),
  outstandingPrincipal: z.number().min(0).optional(),
  loanReference: z.string().max(100).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  paymentChannel: z.nativeEnum(PaymentChannel).optional(),
  accountId: z.string().optional(),
  creditCardId: z.string().optional(),
  status: z.nativeEnum(EmiStatus).optional(),
  downPaymentAmount: z.number().min(0).optional(),
  downPaymentAlreadyPaid: z.boolean().optional(),
  downPaymentPaymentMethod: z.nativeEnum(PaymentMethod).optional(),
  downPaymentAccountId: z.string().optional(),
  downPaymentCreditCardId: z.string().optional(),
  downPaymentDate: flexibleDateSchema.optional(),
  downPaymentNotes: z.string().max(500).optional(),
  notes: z.string().max(500).optional(),
});

export const payEmiSchema = z.object({
  occurrenceKey: z.string().optional(),
  actualAmount: z.number().positive('Payment amount must be positive'),
  date: flexibleDateSchema.optional(),
  paymentMethod: z.nativeEnum(PaymentMethod),
  paymentChannel: z.nativeEnum(PaymentChannel).optional(),
  accountId: z.string().optional(),
  creditCardId: z.string().optional(),
  discountAmount: z.number().min(0).optional(),
  discountType: z.string().optional(),
  discountNotes: z.string().max(500).optional(),
  updateFuturePaymentSettings: z.boolean().optional(),
  notes: z.string().max(500).optional(),
});

export const updateHistoricalInstallmentSchema = z.object({
  actualAmount: z.number().positive('Actual amount must be positive'),
  notes: z.string().max(500).optional(),
});

// ==========================================
// Pass-Through Money Schemas
// ==========================================

export const recordPassThroughReceivedSchema = z.object({
  senderName: z.string().min(1, 'Sender name is required').max(100).trim(),
  receivedAmount: z.number().positive('Received amount must be greater than 0'),
  receivedDate: flexibleDateSchema,
  receivingBankAccountId: z.string().min(1, 'Bank account is required'),
  reference: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),
});

export const recordPassThroughSendSchema = z.object({
  recipientName: z.string().min(1, 'Recipient name is required').max(100).trim(),
  amount: z.number().positive('Amount sent must be greater than 0'),
  date: flexibleDateSchema,
  bankAccountId: z.string().min(1, 'Bank account is required'),
  reference: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),
});




