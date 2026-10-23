export enum UserRole {
  USER = "user",
  ADMIN = "admin",
}

export enum AccountType {
  SAVINGS = "savings",
  CURRENT = "current",
  SALARY = "salary",
  CASH = "cash",
  WALLET = "wallet",
  OTHER = "other",
}

export enum TransactionType {
  INCOME = "income",
  EXPENSE = "expense",
  TRANSFER = "transfer",
  CREDIT_CARD_PAYMENT = "credit_card_payment",
  CREDIT_CARD_REFUND = "credit_card_refund",
  ADJUSTMENT = "adjustment",
  CHIT_SEPARATION = "chit_separation",
  INVESTMENT = "investment",
}

export enum TransactionStatus {
  PENDING = "pending",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
}

export enum PaymentMethod {
  UPI = "upi",
  DEBIT_CARD = "debit_card",
  CREDIT_CARD = "credit_card",
  CASH = "cash",
  NET_BANKING = "net_banking",
  BANK_TRANSFER = "bank_transfer",
  WALLET = "wallet",
  CHEQUE = "cheque",
  OTHER = "other",
}

export enum PaymentChannel {
  ONLINE = "online",
  OFFLINE = "offline",
  OTHER = "other",
}

export enum CreditCardNetwork {
  VISA = "visa",
  MASTERCARD = "mastercard",
  RUPAY = "rupay",
  AMEX = "amex",
  DINERS = "diners",
  DISCOVER = "discover",
  OTHER = "other",
}

export enum StatementStatus {
  GENERATED = "generated",
  DUE = "due",
  PAID = "paid",
  PARTIALLY_PAID = "partially_paid",
  OVERDUE = "overdue",
}

export enum RecurringFrequency {
  WEEKLY = "weekly",
  MONTHLY = "monthly",
  QUARTERLY = "quarterly",
  YEARLY = "yearly",
}

export const DEFAULT_CURRENCY = "INR";

export const SUPPORTED_CURRENCIES = [
  { code: "INR", symbol: "₹", name: "Indian Rupee" },
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "GBP", symbol: "£", name: "British Pound" },
  { code: "AED", symbol: "د.إ", name: "UAE Dirham" },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar" },
] as const;

export const DEFAULT_INCOME_CATEGORIES = [
  { name: "Salary", icon: "Briefcase", color: "#10b981" },
  { name: "Freelance income", icon: "Laptop", color: "#06b6d4" },
  { name: "Business income", icon: "Building2", color: "#3b82f6" },
  { name: "Client payments", icon: "UserCheck", color: "#6366f1" },
  { name: "Investments", icon: "TrendingUp", color: "#8b5cf6" },
  { name: "Interest", icon: "Percent", color: "#ec4899" },
  { name: "Refunds received", icon: "RotateCcw", color: "#14b8a6" },
  { name: "Other income", icon: "PlusCircle", color: "#64748b" },
] as const;

export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: "Food", icon: "Utensils", color: "#f97316" },
  { name: "Groceries", icon: "ShoppingBag", color: "#ea580c" },
  { name: "Fuel", icon: "Fuel", color: "#eab308" },
  { name: "Transportation", icon: "Car", color: "#84cc16" },
  { name: "Rent", icon: "Home", color: "#0284c7" },
  { name: "Utilities", icon: "Zap", color: "#0ea5e9" },
  { name: "Electricity", icon: "Zap", color: "#f59e0b" },
  { name: "Mobile recharge", icon: "Smartphone", color: "#06b6d4" },
  { name: "Broadband", icon: "Wifi", color: "#3b82f6" },
  { name: "Shopping", icon: "ShoppingCart", color: "#a855f7" },
  { name: "Entertainment", icon: "Film", color: "#d946ef" },
  { name: "Subscriptions", icon: "CalendarDays", color: "#ec4899" },
  { name: "Healthcare", icon: "HeartPulse", color: "#ef4444" },
  { name: "Travel", icon: "Plane", color: "#f43f5e" },
  { name: "Insurance", icon: "Shield", color: "#6366f1" },
  { name: "Education", icon: "GraduationCap", color: "#8b5cf6" },
  { name: "EMI", icon: "Landmark", color: "#d97706" },
  { name: "Chits", icon: "Coins", color: "#14b8a6" },
  { name: "Fees", icon: "Receipt", color: "#64748b" },
  { name: "Other expenses", icon: "MoreHorizontal", color: "#94a3b8" },
] as const;

export const DEFAULT_INVESTMENT_CATEGORIES = [
  { name: "CHIT", icon: "Coins", color: "#14b8a6" },
  { name: "Mutual Funds", icon: "TrendingUp", color: "#10b981" },
  { name: "Stocks", icon: "LineChart", color: "#06b6d4" },
  { name: "Fixed Deposit", icon: "Landmark", color: "#6366f1" },
  { name: "Recurring Deposit", icon: "Repeat", color: "#8b5cf6" },
  { name: "Gold", icon: "Coins", color: "#eab308" },
  { name: "Real Estate", icon: "Home", color: "#f97316" },
  { name: "Crypto", icon: "Bitcoin", color: "#ec4899" },
  { name: "PPF", icon: "Shield", color: "#14b8a6" },
  { name: "NPS", icon: "Briefcase", color: "#3b82f6" },
  { name: "Other Investments", icon: "PlusCircle", color: "#64748b" },
] as const;

export enum InvestmentType {
  RECURRING = "recurring",
  ONE_TIME = "one_time",
  CHIT = "chit",
}

export enum InvestmentStatus {
  ACTIVE = "active",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
  WON = "won",
}

export enum InvestmentContributionStatus {
  DUE = "due",
  PAID = "paid",
  PAID_HISTORICAL = "paid_historical",
  SKIPPED = "skipped",
}

export enum RecurringRuleStatus {
  ACTIVE = "active",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
}

export enum LendingBorrowingType {
  LENDING = "lending",
  BORROWING = "borrowing",
}

export enum LendingBorrowingStatus {
  OUTSTANDING = "outstanding",
  PARTIALLY_SETTLED = "partially_settled",
  SETTLED = "settled",
}

export enum EmiStatus {
  ACTIVE = "active",
  COMPLETED = "completed",
  ARCHIVED = "archived",
}

export enum EmiOccurrenceStatus {
  DUE = "due",
  PAID = "paid",
  OVERDUE = "overdue",
  PAID_HISTORICAL = "paid_historical",
}

