import mongoose, { Schema, Document, Model } from 'mongoose';
import {
  TransactionType,
  TransactionStatus,
  PaymentMethod,
  PaymentChannel,
} from '@finora/shared';

export interface ITransaction extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  type: TransactionType;
  title: string;
  amount: number;
  currency: string;
  date: Date;
  category: string;
  subcategory?: string;
  paymentMethod: PaymentMethod;
  paymentChannel: PaymentChannel;
  accountId?: mongoose.Types.ObjectId;
  destinationAccountId?: mongoose.Types.ObjectId;
  creditCardId?: mongoose.Types.ObjectId;
  merchantOrRecipient?: string;
  tags: string[];
  notes?: string;
  receiptUrl?: string;
  status: TransactionStatus;
  idempotencyKey?: string;
  statementId?: mongoose.Types.ObjectId;
  transferTransactionId?: mongoose.Types.ObjectId;
  recurringRuleId?: mongoose.Types.ObjectId;
  occurrenceKey?: string;
  emiRuleId?: mongoose.Types.ObjectId;
  emiOccurrenceId?: mongoose.Types.ObjectId;
  investmentId?: mongoose.Types.ObjectId;
  investmentContributionId?: mongoose.Types.ObjectId;
  liabilitySettled?: number;
  redemptionCredit?: number;
  redemptionNotes?: string;
  originalAmount?: number;
  discountAmount?: number;
  discountType?: string;
  discountNotes?: string;
  isExcludedFromBudget: boolean;
  isUntrackedCash?: boolean;
  cashSource?: 'tracked_personal_cash' | 'untracked_cash';
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Transaction owner userId is required'],
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(TransactionType),
      required: [true, 'Transaction type is required'],
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [0.01, 'Amount must be at least 0.01'],
    },
    currency: {
      type: String,
      required: true,
      default: 'INR',
      uppercase: true,
    },
    date: {
      type: Date,
      required: [true, 'Transaction date is required'],
      default: Date.now,
      index: true,
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      trim: true,
      index: true,
    },
    subcategory: {
      type: String,
      trim: true,
    },
    paymentMethod: {
      type: String,
      enum: Object.values(PaymentMethod),
      required: [true, 'Payment method is required'],
      index: true,
    },
    paymentChannel: {
      type: String,
      enum: Object.values(PaymentChannel),
      required: [true, 'Payment channel is required'],
    },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
      index: true,
    },
    destinationAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
    },
    creditCardId: {
      type: Schema.Types.ObjectId,
      ref: 'CreditCard',
      index: true,
    },
    merchantOrRecipient: {
      type: String,
      trim: true,
      maxlength: [200, 'Merchant/Recipient cannot exceed 200 characters'],
    },
    tags: {
      type: [String],
      default: [],
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [1000, 'Notes cannot exceed 1000 characters'],
    },
    receiptUrl: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(TransactionStatus),
      default: TransactionStatus.COMPLETED,
      index: true,
    },
    idempotencyKey: {
      type: String,
      trim: true,
    },
    statementId: {
      type: Schema.Types.ObjectId,
      ref: 'CreditCardStatement',
    },
    transferTransactionId: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
    },
    recurringRuleId: {
      type: Schema.Types.ObjectId,
      ref: 'RecurringTransaction',
      index: true,
    },
    emiRuleId: {
      type: Schema.Types.ObjectId,
      ref: 'EmiRule',
      index: true,
    },
    emiOccurrenceId: {
      type: Schema.Types.ObjectId,
      ref: 'EmiOccurrence',
      index: true,
    },
    investmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Investment',
      index: true,
    },
    investmentContributionId: {
      type: Schema.Types.ObjectId,
      ref: 'InvestmentContribution',
      index: true,
    },
    occurrenceKey: {
      type: String,
      trim: true,
      index: true,
    },
    liabilitySettled: {
      type: Number,
      min: 0,
    },
    redemptionCredit: {
      type: Number,
      min: 0,
      default: 0,
    },
    redemptionNotes: {
      type: String,
      trim: true,
    },
    originalAmount: {
      type: Number,
      min: 0,
    },
    discountAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
    discountType: {
      type: String,
      trim: true,
    },
    discountNotes: {
      type: String,
      trim: true,
    },
    isExcludedFromBudget: {
      type: Boolean,
      default: false,
    },
    isUntrackedCash: {
      type: Boolean,
      default: false,
    },
    cashSource: {
      type: String,
      enum: ['tracked_personal_cash', 'untracked_cash'],
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : undefined;
        ret.userId = ret.userId ? ret.userId.toString() : undefined;
        ret.accountId = ret.accountId ? ret.accountId.toString() : undefined;
        ret.destinationAccountId = ret.destinationAccountId
          ? ret.destinationAccountId.toString()
          : undefined;
        ret.creditCardId = ret.creditCardId ? ret.creditCardId.toString() : undefined;
        ret.transferTransactionId = ret.transferTransactionId
          ? ret.transferTransactionId.toString()
          : undefined;
        ret.recurringRuleId = ret.recurringRuleId
          ? ret.recurringRuleId.toString()
          : undefined;
        ret.emiRuleId = ret.emiRuleId ? ret.emiRuleId.toString() : undefined;
        ret.emiOccurrenceId = ret.emiOccurrenceId ? ret.emiOccurrenceId.toString() : undefined;
        ret.investmentId = ret.investmentId ? ret.investmentId.toString() : undefined;
        ret.investmentContributionId = ret.investmentContributionId ? ret.investmentContributionId.toString() : undefined;
        ret.occurrenceKey = ret.occurrenceKey || undefined;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

TransactionSchema.index({ userId: 1, date: -1 });
TransactionSchema.index({ userId: 1, accountId: 1, date: -1 });
TransactionSchema.index({ userId: 1, category: 1, date: -1 });
TransactionSchema.index({ userId: 1, type: 1, date: -1 });
TransactionSchema.index(
  { userId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  }
);
TransactionSchema.index(
  { recurringRuleId: 1, occurrenceKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      recurringRuleId: { $exists: true },
      occurrenceKey: { $type: 'string' },
    },
  }
);
TransactionSchema.index(
  { emiRuleId: 1, occurrenceKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      emiRuleId: { $exists: true },
      occurrenceKey: { $type: 'string' },
    },
  }
);
TransactionSchema.index(
  { investmentId: 1, occurrenceKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      investmentId: { $exists: true },
      occurrenceKey: { $type: 'string' },
    },
  }
);

export const Transaction: Model<ITransaction> =
  mongoose.models.Transaction || mongoose.model<ITransaction>('Transaction', TransactionSchema);
