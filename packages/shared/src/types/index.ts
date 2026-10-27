import {
  UserRole,
  AccountType,
  TransactionType,
  TransactionStatus,
  RefundClassification,
  PaymentMethod,
  PaymentChannel,
  CreditCardNetwork,
  StatementStatus,
  RecurringFrequency,
  LendingBorrowingType,
  LendingBorrowingStatus,
  EmiStatus,
  EmiOccurrenceStatus,
  InvestmentType,
  InvestmentStatus,
  InvestmentContributionStatus,
  RecurringRuleStatus,
} from '../constants/financial';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    timestamp: string;
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
    hasMore?: boolean;
    [key: string]: unknown;
  };
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
  transactions?: T;
}

export interface ModulePreferences {
  expenseTracker: boolean;
  emi: boolean;
  lendingBorrowing: boolean;
  budget: boolean;
  recurringTransactions: boolean;
  creditCards: boolean;
  chitFund: boolean;
  investment: boolean;
}

export const DEFAULT_MODULE_PREFERENCES: ModulePreferences = {
  expenseTracker: true,
  emi: true,
  lendingBorrowing: true,
  budget: true,
  recurringTransactions: true,
  creditCards: true,
  chitFund: true,
  investment: true,
};

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  currency: string;
  isActive: boolean;
  isEmailVerified?: boolean;
  isOnboardingCompleted?: boolean;
  createdAt: string;
  updatedAt: string;
  preferences?: {
    theme?: 'light' | 'dark' | 'system';
    dateFormat?: string;
    notifyDueDates?: boolean;
    notifyBudgetAlerts?: boolean;
  };
  modulePreferences?: ModulePreferences;
}

export interface BankAccount {
  id: string;
  userId: string;
  accountName: string;
  bankName: string;
  accountType: AccountType;
  accountNumberMasked?: string;
  openingBalance: number;
  openingBalanceDate: string;
  currentBalance: number;
  currency: string;
  color?: string;
  icon?: string;
  isChitFundAccount?: boolean;
  isActive: boolean;
  isArchived: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreditCard {
  id: string;
  userId: string;
  cardNickname: string;
  issuingBank: string;
  network: CreditCardNetwork;
  lastFourDigits?: string;
  creditLimit: number;
  billingCycleClosingDay: number;
  paymentDueDay: number;
  openingOutstanding: number;
  openingOutstandingDate: string;
  currentOutstanding: number;
  availableCredit: number;
  annualFee: number;
  rewardsNotes?: string;
  isActive: boolean;
  isArchived: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionCategory {
  id: string;
  userId?: string; // null if system default
  name: string;
  type: 'income' | 'expense' | 'investment';
  icon?: string;
  color?: string;
  subcategories?: string[];
  isCustom: boolean;
}

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  title: string;
  amount: number; // Stored in major units (e.g. 100.50) but calculated server-side with decimal safety
  currency: string;
  date: string;
  category: string;
  subcategory?: string;
  paymentMethod: PaymentMethod;
  paymentChannel: PaymentChannel;
  accountId?: string;
  creditCardId?: string;
  destinationAccountId?: string; // For transfers
  merchantOrRecipient?: string;
  tags?: string[];
  notes?: string;
  receiptUrl?: string;
  status: TransactionStatus;
  idempotencyKey?: string;
  statementId?: string;
  transferTransactionId?: string;
  recurringRuleId?: string;
  occurrenceKey?: string;
  emiRuleId?: string;
  emiOccurrenceId?: string;
  liabilitySettled?: number;
  redemptionCredit?: number;
  redemptionNotes?: string;
  originalAmount?: number;
  discountAmount?: number;
  discountType?: string;
  discountNotes?: string;
  isExcludedFromBudget?: boolean;
  isPastRecorded?: boolean;
  originalExpenseId?: string;
  refundClassification?: RefundClassification;
  netExpense?: number;
  totalRefunded?: number;
  remainingRefundable?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreditCardStatement {
  id: string;
  userId: string;
  creditCardId: string;
  periodStart: string;
  periodEnd: string;
  closingDate: string;
  dueDate: string;
  openingBalance: number;
  newPurchases: number;
  feesAndCharges: number;
  paymentsReceived: number;
  refundsAndCredits: number;
  statementBalance: number;
  minimumAmountDue: number;
  status: StatementStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreditCardRepayment {
  id: string;
  userId: string;
  creditCardId: string;
  sourceAccountId: string;
  amount: number;
  date: string;
  statementId?: string;
  notes?: string;
  idempotencyKey?: string;
  status: TransactionStatus;
  createdAt: string;
}

export interface Budget {
  id: string;
  userId: string;
  category: string; // "ALL" for overall or category name
  limitAmount: number;
  period: 'monthly' | 'custom';
  startDate: string;
  endDate: string;
  spentAmount: number;
  remainingAmount: number;
  alertThresholdPercent: number; // default 80
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringRule {
  id: string;
  userId: string;
  title: string;
  amount: number;
  type: TransactionType;
  category: string;
  frequency: RecurringFrequency;
  paymentMethod: PaymentMethod;
  paymentChannel: PaymentChannel;
  accountId?: string;
  creditCardId?: string;
  nextExecutionDate: string;
  lastExecutedAt?: string;
  autoCreate?: boolean;
  isActive: boolean;
  notes?: string;
  isLoggedForCurrentMonth?: boolean;
  currentMonthCycleKey?: string;
  currentMonthOccurrenceStatus?: 'DUE' | 'LOGGED' | 'SKIPPED';
  currentMonthTransactionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardSummary {
  monthlyIncome: number;
  monthlyExpenses: number;
  netCashFlow: number;
  totalBankBalances: number;
  totalCreditCardOutstanding: number;
  totalAvailableCredit: number;
  savings: number;
  savingsRate: number;
  upcomingDueDatesCount: number;
  currency: string;
  period: string;
}

// ==========================================
// Chit Fund Management
// ==========================================

export interface ChitFund {
  id: string;
  userId: string;
  name: string;
  totalChits: number;
  defaultContributionPerChit: number;
  currency: string;
  collectionFrequency: string;
  startDate: string;
  currentPeriod: string;
  designatedBankAccountId?: string;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChitFundMember {
  id: string;
  userId: string;
  chitFundId: string;
  name: string;
  numberOfChits: number;
  contributionPerChit: number;
  totalExpectedPerPeriod: number;
  phone?: string;
  email?: string;
  startDate: string;
  status: 'active' | 'inactive' | 'archived';
  hasPreviouslyWon?: boolean;
  previousWinDate?: string;
  previousWinCycle?: string;
  previousWinNotes?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChitFundCollection {
  id: string;
  userId: string;
  chitFundId: string;
  memberId: string;
  memberName?: string;
  collectionPeriod: string;
  chitsCovered: number;
  expectedAmount: number;
  actualAmountReceived: number;
  outstandingAmount?: number;
  isSeparation?: boolean;
  isAlreadyPaid?: boolean;
  sourceAccountId?: string;
  transactionId?: string;
  collectionDate: string;
  receivingBankAccountId?: string;
  receivingAccountName?: string;
  paymentMethod: string;
  reference?: string;
  notes?: string;
  status: 'completed' | 'partial' | 'pending';
  createdAt: string;
  updatedAt: string;
}

export type ChitFundCycleStatus = 'upcoming' | 'collecting' | 'winner_selected' | 'payout_pending' | 'completed';

export interface ChitFundCycle {
  id: string;
  userId: string;
  chitFundId: string;
  cyclePeriod: string; // e.g. "2026-10"
  year: number;
  month: number;
  prizeTakingDate: string;
  rolloverDate: string;
  status: ChitFundCycleStatus;
  winnerMemberId?: string;
  winnerMemberName?: string;
  winnerConfirmedAt?: string;
  winnerNotes?: string;
  payoutId?: string;
  payoutStatus?: 'none' | 'pending' | 'completed';
  payoutAmount?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChitFundSpinnerResult {
  cyclePeriod: string;
  selectedMember: {
    id: string;
    name: string;
    numberOfChits: number;
    contributionPerChit: number;
    totalExpectedPerPeriod: number;
  };
  eligibleMembers: Array<{
    id: string;
    name: string;
    numberOfChits: number;
    contributionPerChit: number;
    totalExpectedPerPeriod: number;
  }>;
  eligibleCount: number;
  generatedAt: string;
}

export interface ChitFundCycleDetails extends ChitFundCycle {
  totalExpectedCollection: number;
  totalCollected: number;
  totalSeparated: number;
  outstandingCollection: number;
  totalCashCollected?: number;
  totalUpiCollected?: number;
  fullyPaidMembersCount?: number;
  partialMembersCount?: number;
  unpaidMembersCount?: number;
  membersCount: number;
  collectionsCount: number;
  isRolloverDone: boolean;
}

export interface ChitFundPayout {
  id: string;
  userId: string;
  chitFundId: string;
  recipientName: string;
  memberId?: string;
  payoutPeriod: string;
  amount: number;
  cashAmount?: number;
  upiAmount?: number;
  isHistorical?: boolean;
  payoutDate: string;
  sourceBankAccountId?: string;
  sourceAccountName?: string;
  reference?: string;
  notes?: string;
  status: 'completed' | 'pending';
  createdAt: string;
  updatedAt: string;
}

export interface ChitFundAdjustment {
  id: string;
  userId: string;
  chitFundId: string;
  entryType?: 'adjustment' | 'separation';
  bankAccountId?: string;
  amount: number;
  reason: string;
  notes?: string;
  date: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChitFundSeparation {
  id: string;
  userId: string;
  chitFundId: string;
  bankAccountId?: string;
  amount: number;
  reason: string;
  notes?: string;
  date: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChitFundSummary {
  totalActiveMembers: number;
  totalActiveChits: number;
  expectedCollectionPerPeriod: number;
  actualCollectionForPeriod: number;
  outstandingForPeriod: number;
  totalChitFundMoneyHeld: number;
  chitFundsHeldInBank?: number;
  cashInHandChitFunds?: number;
  totalPayouts: number;
  totalPendingPayouts?: number;
  designatedAccountId?: string;
  designatedAccountName?: string;
  designatedAccountBalance?: number;
  personalAvailableBalance?: number;
  discrepancy?: number;
  currentPeriod?: string;
  activeCycleInfo?: any;
  winnerInfo?: any;
  cyclePaymentBreakdown?: {
    totalExpected: number;
    totalCollected: number;
    remainingDue: number;
    totalCash: number;
    totalUpi: number;
    fullyPaidCount: number;
    partialCount: number;
    unpaidCount: number;
  };
}

export type ResetTransactionType =
  | 'income'
  | 'expense'
  | 'transfers'
  | 'credit_card_purchases'
  | 'credit_card_repayments'
  | 'chit_collections'
  | 'chit_payouts'
  | 'chit_reclassifications'
  | 'budgets'
  | 'recurring';

export interface ResetTransactionsRequest {
  confirmationPhrase: 'RESET MY DATA';
  selectedTypes: ResetTransactionType[];
}

export interface ResetAllFinancialDataRequest {
  confirmationPhrase: 'RESET MY DATA';
  password?: string;
}

export interface LendingRepayment {
  id?: string;
  _id?: string;
  amount: number;
  date: string;
  paymentMethod: 'upi' | 'cash';
  paymentChannel?: PaymentChannel;
  bankAccountId?: string;
  bankAccountName?: string;
  notes?: string;
  isHistorical?: boolean;
  createdAt?: string;
}

export interface LendingBorrowing {
  id: string;
  _id?: string;
  userId: string;
  type: LendingBorrowingType;
  personName: string;
  phoneNumber?: string;
  amount: number;
  date: string;
  dueDate?: string;
  paymentMethod: 'upi' | 'cash';
  paymentChannel?: PaymentChannel;
  bankAccountId?: string;
  bankAccountName?: string;
  description?: string;
  notes?: string;
  status: LendingBorrowingStatus;
  settledAmount: number;
  outstandingAmount: number;
  isHistorical?: boolean;
  accountingMode?: 'historical' | 'live';
  repayments: LendingRepayment[];
  createdAt: string;
  updatedAt: string;
}

export interface LendingBorrowingSummary {
  totalLent: number;
  lentReceivedBack: number;
  outstandingLending: number;
  totalBorrowed: number;
  borrowedRepaid: number;
  outstandingBorrowing: number;
  activeRecordsCount: number;
  settledRecordsCount: number;
}

export interface PersonalCashAdjustment {
  id?: string;
  _id?: string;
  type: 'set_balance' | 'add_cash' | 'remove_cash';
  amount: number;
  date: string;
  description?: string;
  createdAt?: string;
}

export interface CashAccount {
  id: string;
  userId: string;
  openingBalance: number;
  openingBalanceDate: string;
  currentBalance: number;
  currency: string;
  notes?: string;
  adjustments?: PersonalCashAdjustment[];
  createdAt: string;
  updatedAt: string;
}

export interface TotalCashSummary {
  totalBankBalance: number;
  designatedBankAccountId?: string;
  designatedBankAccountName?: string;
  isChitAccountConfigured: boolean;
  designatedBankBalance: number;
  chitReserveHeldInBank: number;
  personalAvailableBalanceChitBank: number;
  otherBankBalances: number;
  totalPersonalAvailableBalance: number;
  cashInHand: number;
  personalCashInHand: number;
  openingCashBalance: number;
  latestAdjustmentDate?: string;
  outstandingLending: number;
  totalAvailableMoney: number;
  totalFinancialAssetsTracked: number;
  personalBorrowingOutstanding: number;
  creditCardOutstanding: number;
  totalOutstandingDebt: number;
  outstandingBorrowing: number;
  netTrackedPosition: number;
  heldPassThroughFunds?: number;
  accounts: BankAccount[];
  adjustments?: PersonalCashAdjustment[];
}

export interface RecurringOccurrence {
  id?: string;
  _id?: string;
  userId: string;
  recurringRuleId: string;
  occurrenceKey: string;
  scheduledDate: string;
  status: 'DUE' | 'LOGGED' | 'SKIPPED';
  transactionId?: string;
  loggedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface EmiRule {
  id: string;
  userId: string;
  name: string;
  lender: string;
  monthlyAmount: number;
  startDate: string;
  firstDueDate: string;
  dueDay: number;
  endDate: string;
  nextEmiDate?: string;
  totalInstallments: number;
  originalLoanAmount?: number;
  outstandingPrincipal?: number;
  loanReference?: string;
  paymentMethod: PaymentMethod;
  paymentChannel: PaymentChannel;
  accountId?: string;
  creditCardId?: string;
  status: EmiStatus;
  notes?: string;
  downPaymentAmount?: number;
  downPaymentAlreadyPaid?: boolean;
  downPaymentPaymentMethod?: PaymentMethod;
  downPaymentAccountId?: string;
  downPaymentCreditCardId?: string;
  downPaymentDate?: string;
  downPaymentTransactionId?: string;
  downPaymentStatus?: 'paid' | 'paid_historical' | 'not_paid';
  downPaymentNotes?: string;
  paidInstallmentsCount?: number;
  historicalPaidInstallmentsCount?: number;
  normalPaidInstallmentsCount?: number;
  remainingInstallmentsCount?: number;
  overdueInstallmentsCount?: number;
  totalScheduledAmount?: number;
  totalPaidAmount?: number;
  remainingAmount?: number;
  nextDueDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmiOccurrence {
  id: string;
  userId: string;
  emiRuleId: string;
  occurrenceKey: string; // "YYYY-MM"
  installmentNumber: number;
  dueDate: string;
  expectedAmount: number;
  actualAmountPaid?: number;
  paymentMethod?: PaymentMethod;
  paymentChannel?: PaymentChannel;
  cashSource?: 'tracked_personal_cash' | 'untracked_cash';
  accountId?: string;
  creditCardId?: string;
  status: EmiOccurrenceStatus;
  isHistorical?: boolean;
  transactionId?: string;
  paidAt?: string;
  discountAmount?: number;
  discountType?: string;
  discountNotes?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmiSummary {
  activeEmisCount: number;
  completedEmisCount: number;
  estimatedMonthlyOutflow: number;
  nextEmiDue?: {
    emiRuleId: string;
    emiName: string;
    lender: string;
    dueDate: string;
    amount: number;
    occurrenceKey: string;
  } | null;
  totalRemainingAmount: number;
}

export interface UpcomingPaymentItem {
  id: string;
  title: string;
  type: 'recurring' | 'emi' | 'investment';
  category?: string;
  dueDate: string;
  expectedAmount: number;
  actualAmount?: number;
  status: 'paid' | 'unpaid' | 'skipped';
  ruleId: string;
  occurrenceKey: string;
  occurrenceId?: string;
  paymentMethod?: PaymentMethod;
  accountId?: string;
  creditCardId?: string;
  isOverdue?: boolean;
  isFlexibleDate?: boolean;
  isExternalChit?: boolean;
  isWon?: boolean;
}

export interface UpcomingPaymentForecast {
  month: string; // YYYY-MM
  totalExpectedPayments: number;
  recurringPaymentsRemaining: number;
  emiPaymentsRemaining: number;
  investmentPaymentsRemaining: number;
  totalPaid: number;
  remainingAmountNeeded: number;
  items: UpcomingPaymentItem[];
}

export interface InvestmentItem {
  id: string;
  userId: string;
  name: string;
  category: string;
  investmentType: InvestmentType;
  initialAmount: number;
  startDate: string;
  endDate?: string;
  durationMonths?: number;
  monthlyContribution: number;
  isMonthlyPaymentEnabled: boolean;
  paymentMethod?: PaymentMethod;
  accountId?: string;
  creditCardId?: string;
  status: InvestmentStatus;
  notes?: string;
  // External Chit fields
  isExternalChit: boolean;
  chitName?: string;
  isWon: boolean;
  winningDate?: string;
  payoutAmount?: number;
  isHistoricalPayout?: boolean;
  payoutDestinationType?: 'bank' | 'cash';
  payoutAccountId?: string;
  payoutTransactionId?: string;
  payoutNotes?: string;
  // Computed summary fields
  totalInvested?: number;
  totalHistoricalContributed?: number;
  totalActualContributed?: number;
  totalContributionsInvested?: number;
  remainingContributionCommitment?: number;
  outstandingContributions?: number;
  netChitCashFlow?: number;
  totalPaidThisMonth?: number;
  totalScheduledMonths?: number;
  paidMonthsCount?: number;
  unpaidMonthsCount?: number;
  remainingScheduledAmount?: number;
  nextDueCycle?: string;
  nextDueDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvestmentContributionItem {
  id: string;
  userId: string;
  investmentId: string;
  cycleKey: string; // YYYY-MM
  installmentNumber?: number;
  scheduledDate: string;
  expectedAmount: number;
  actualAmount?: number;
  paidAt?: string;
  status: InvestmentContributionStatus;
  isHistorical: boolean;
  paymentMethod?: PaymentMethod;
  paymentChannel?: PaymentChannel;
  cashSource?: 'tracked_personal_cash' | 'untracked_cash';
  accountId?: string;
  creditCardId?: string;
  transactionId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvestmentDashboardData {
  totalHistoricalInvested: number;
  totalInvestedThisMonth: number;
  activeInvestmentsCount: number;
  completedInvestmentsCount: number;
  wonChitsCount: number;
  categoryBreakdown: Array<{
    category: string;
    totalAmount: number;
    count: number;
    percentage: number;
  }>;
  monthlyContributions: Array<{
    month: string;
    amount: number;
    count: number;
  }>;
  investments: InvestmentItem[];
  upcomingPayments: UpcomingPaymentItem[];
}

export interface InvestmentReportData {
  totalInvested: number;
  monthlyContributions: Array<{
    month: string;
    amount: number;
    count: number;
  }>;
  categoryBreakdown: Array<{
    category: string;
    totalAmount: number;
    count: number;
    percentage: number;
  }>;
  fundingSourceBreakdown: Array<{
    source: string;
    amount: number;
    count: number;
    percentage: number;
  }>;
  transactions: Array<{
    id: string;
    title: string;
    amount: number;
    date: string;
    category: string;
    subcategory?: string;
    paymentMethod: string;
    fundingSource: string;
    notes?: string;
  }>;
}

export interface FinancialReportData {
  period: {
    startDate: string;
    endDate: string;
  };
  summary: {
    totalIncome: number;
    totalExpenses: number;
    totalInvestments?: number;
    netCashFlow: number;
    savingsRate: number;
    transactionCount: number;
    creditCardSpend: number;
    recurringExpenses: number;
    emiExpenses: number;
    nonRecurringExpenses: number;
    creditCardRepayments?: number;
    recurringInvestments?: number;
  };
  investments?: InvestmentReportData;
  forecast?: {
    upcomingRecurring: number;
    upcomingEmi: number;
    totalProjectedExpenses: number;
    projectedNetCashFlow: number;
  };
  categoryBreakdown: Array<{
    category: string;
    totalAmount: number;
    transactionCount: number;
    percentage: number;
  }>;
  monthlyTrends: Array<{
    month: string;
    income: number;
    expenses: number;
    investments?: number;
    net: number;
  }>;
  paymentMethodBreakdown: Array<{
    method: string;
    amount: number;
    count: number;
  }>;
  channelBreakdown: Array<{
    channel: string;
    amount: number;
    count: number;
  }>;
}

// Monthly Expenses Reporting Types
export interface MonthlyExpenseTransaction {
  id: string;
  title: string;
  amount: number;
  date: string;
  category: string;
  paymentMethod: string;
  paymentChannel?: string;
  accountName?: string;
  merchantOrRecipient?: string;
  notes?: string;
  isPastRecorded?: boolean;
  grossAmount?: number;
  refundAmount?: number;
  netAmount?: number;
  originalExpenseId?: string;
  refundClassification?: string;
  refunds?: Array<{
    id: string;
    title: string;
    amount: number;
    date: string;
    paymentMethod?: string;
    refundClassification?: string;
  }>;
}

export interface MonthlyExpenseCategoryBreakdown {
  category: string;
  amount: number;
  grossAmount?: number;
  refundAmount?: number;
  netAmount?: number;
  transactionCount: number;
  percentage: number;
  transactions?: MonthlyExpenseTransaction[];
}

export interface MonthlyExpensesReportData {
  month: string;
  monthLabel: string;
  totalExpenses: number;
  grossExpenses?: number;
  linkedRefunds?: number;
  unlinkedRefunds?: number;
  netExpenses?: number;
  transactionCount: number;
  highestCategory: {
    name: string;
    amount: number;
  } | null;
  averageDailySpend: number;
  daysInMonth: number;
  categoryBreakdown: MonthlyExpenseCategoryBreakdown[];
  dailySpendingTrend: Array<{
    day: number;
    date: string;
    amount: number;
  }>;
  largestExpenses: MonthlyExpenseTransaction[];
  allTransactions?: MonthlyExpenseTransaction[];
  previousMonthComparison?: {
    previousMonth: string;
    previousTotal: number;
    changeAmount: number;
    changePercentage: number | null;
  };
}

// Monthly Income Reporting Types
export interface MonthlyIncomeCategoryBreakdown {
  category: string;
  amount: number;
  transactionCount: number;
  percentage: number;
  isConfigured: boolean;
  transactions?: Array<{
    id: string;
    title: string;
    amount: number;
    date: string;
    category?: string;
    paymentMethod: string;
    accountName?: string;
    merchantOrRecipient?: string;
    isPastRecorded?: boolean;
  }>;
}

export interface MonthlyIncomeReportData {
  month: string;
  monthLabel: string;
  totalMonthlyIncome: number;
  allIncomeTotal: number;
  salaryIncome: number;
  freelanceIncome: number;
  otherSelectedIncome: number;
  qualifyingTransactionCount: number;
  configuredCategories: string[];
  categoryBreakdown: MonthlyIncomeCategoryBreakdown[];
  previousMonthComparison?: {
    previousMonth: string;
    previousTotal: number;
    changeAmount: number;
    changePercentage: number | null;
  };
  trend: Array<{
    month: string;
    income: number;
  }>;
  totalRefundsReceived?: number;
  transactionCount?: number;
  highestCategory?: { name: string; amount: number } | null;
  averageDailyIncome?: number;
  daysInMonth?: number;
  dailyIncomeTrend?: Array<{ day: number; date: string; amount: number }>;
  largestIncomeEntries?: Array<{
    id: string;
    title: string;
    amount: number;
    date: string;
    category: string;
    paymentMethod: string;
    accountName?: string;
    merchantOrRecipient?: string;
    isPastRecorded?: boolean;
  }>;
  allTransactions?: Array<{
    id: string;
    title: string;
    amount: number;
    date: string;
    category: string;
    paymentMethod: string;
    accountName?: string;
    merchantOrRecipient?: string;
    isPastRecorded?: boolean;
  }>;
}

// Refund & Cashback Types
export interface LinkedRefundItem {
  id: string;
  title: string;
  amount: number;
  date: string;
  paymentMethod: PaymentMethod | string;
  refundClassification: RefundClassification;
  notes?: string;
  isPastRecorded?: boolean;
}

export interface ExpenseRefundContext {
  originalExpenseId: string;
  originalTitle: string;
  originalCategory: string;
  originalDate: string;
  originalAmount: number;
  totalRefunded: number;
  remainingRefundable: number;
  netAmount: number;
  expense: {
    id: string;
    title: string;
    category: string;
    date: string;
    amount: number;
    paymentMethod: string;
    totalRefunded: number;
    remainingRefundable: number;
    netExpense: number;
    merchantOrRecipient?: string;
  };
  refunds: LinkedRefundItem[];
}

export interface RefundableExpenseItem {
  id: string;
  title: string;
  amount: number;
  date: string;
  category: string;
  paymentMethod: string;
  totalRefunded: number;
  remainingRefundable: number;
  merchant?: string;
  merchantOrRecipient?: string;
}

// Pass-Through Money Types
export type PassThroughStatus = 'pending' | 'partially_sent' | 'completed';

export interface PassThroughSendItem {
  id: string;
  recipientName: string;
  amount: number;
  date: string;
  bankAccountId: string;
  bankAccountName?: string;
  reference?: string;
  notes?: string;
  createdAt: string;
}

export interface PassThroughRecordItem {
  id: string;
  userId: string;
  senderName: string;
  receivedAmount: number;
  receivedDate: string;
  receivingBankAccountId: string;
  receivingBankAccountName?: string;
  reference?: string;
  notes?: string;
  totalSentAmount: number;
  outstandingAmount: number;
  status: PassThroughStatus;
  sends: PassThroughSendItem[];
  createdAt: string;
  updatedAt: string;
}

export interface PassThroughOverview {
  totalReceived: number;
  totalSent: number;
  totalOutstanding: number;
  openCount: number;
  completedCount: number;
}



