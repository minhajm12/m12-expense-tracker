import mongoose, { Schema, Document, Model } from 'mongoose';
import {
  InvestmentContributionStatus,
  PaymentMethod,
  PaymentChannel,
} from '@finora/shared';

export interface IInvestmentContribution extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  investmentId: mongoose.Types.ObjectId;
  cycleKey: string; // "YYYY-MM" in Asia/Kolkata
  installmentNumber?: number;
  scheduledDate: Date;
  expectedAmount: number;
  actualAmount?: number;
  paidAt?: Date;
  status: InvestmentContributionStatus;
  isHistorical: boolean;
  paymentMethod?: PaymentMethod;
  paymentChannel?: PaymentChannel;
  cashSource?: 'tracked_personal_cash' | 'untracked_cash';
  accountId?: mongoose.Types.ObjectId;
  creditCardId?: mongoose.Types.ObjectId;
  transactionId?: mongoose.Types.ObjectId;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const InvestmentContributionSchema = new Schema<IInvestmentContribution>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    investmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Investment',
      required: true,
      index: true,
    },
    cycleKey: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    installmentNumber: {
      type: Number,
      min: 1,
    },
    scheduledDate: {
      type: Date,
      required: true,
    },
    expectedAmount: {
      type: Number,
      required: true,
      min: [0, 'Expected amount cannot be negative'],
    },
    actualAmount: {
      type: Number,
      min: [0, 'Actual amount cannot be negative'],
    },
    paidAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: Object.values(InvestmentContributionStatus),
      default: InvestmentContributionStatus.DUE,
      required: true,
      index: true,
    },
    isHistorical: {
      type: Boolean,
      default: false,
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: Object.values(PaymentMethod),
    },
    paymentChannel: {
      type: String,
      enum: Object.values(PaymentChannel),
      default: PaymentChannel.ONLINE,
    },
    cashSource: {
      type: String,
      enum: ['tracked_personal_cash', 'untracked_cash'],
    },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
    },
    creditCardId: {
      type: Schema.Types.ObjectId,
      ref: 'CreditCard',
    },
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
      index: true,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : undefined;
        ret.userId = ret.userId ? ret.userId.toString() : undefined;
        ret.investmentId = ret.investmentId ? ret.investmentId.toString() : undefined;
        if (ret.accountId) ret.accountId = ret.accountId.toString();
        if (ret.creditCardId) ret.creditCardId = ret.creditCardId.toString();
        if (ret.transactionId) ret.transactionId = ret.transactionId.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Compound unique index ensuring only 1 contribution occurrence per investment per monthly cycle
InvestmentContributionSchema.index(
  { investmentId: 1, cycleKey: 1 },
  { unique: true }
);

InvestmentContributionSchema.index({ userId: 1, cycleKey: 1, status: 1 });
InvestmentContributionSchema.index({ investmentId: 1, status: 1 });

export const InvestmentContribution: Model<IInvestmentContribution> =
  mongoose.models.InvestmentContribution ||
  mongoose.model<IInvestmentContribution>('InvestmentContribution', InvestmentContributionSchema);
