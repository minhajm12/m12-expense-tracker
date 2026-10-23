import mongoose, { Schema, Document, Model } from 'mongoose';
import {
  InvestmentType,
  InvestmentStatus,
  PaymentMethod,
} from '@finora/shared';

export interface IInvestment extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  name: string;
  category: string;
  investmentType: InvestmentType;
  initialAmount: number;
  startDate: Date;
  endDate?: Date;
  durationMonths?: number;
  monthlyContribution: number;
  isMonthlyPaymentEnabled: boolean;
  paymentMethod?: PaymentMethod;
  accountId?: mongoose.Types.ObjectId;
  creditCardId?: mongoose.Types.ObjectId;
  status: InvestmentStatus;
  notes?: string;
  // External Chit fields
  isExternalChit: boolean;
  chitName?: string;
  isWon: boolean;
  winningDate?: Date;
  payoutAmount?: number;
  isHistoricalPayout: boolean;
  payoutDestinationType?: 'bank' | 'cash';
  payoutAccountId?: mongoose.Types.ObjectId;
  payoutTransactionId?: mongoose.Types.ObjectId;
  payoutNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const InvestmentSchema = new Schema<IInvestment>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Investment name is required'],
      trim: true,
      maxlength: [200, 'Name cannot exceed 200 characters'],
    },
    category: {
      type: String,
      required: [true, 'Investment category is required'],
      trim: true,
      index: true,
    },
    investmentType: {
      type: String,
      enum: Object.values(InvestmentType),
      default: InvestmentType.RECURRING,
      required: true,
    },
    initialAmount: {
      type: Number,
      default: 0,
      min: [0, 'Initial amount must be greater than or equal to 0'],
    },
    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
      default: Date.now,
      index: true,
    },
    endDate: {
      type: Date,
    },
    durationMonths: {
      type: Number,
      min: [1, 'Duration must be at least 1 month'],
    },
    monthlyContribution: {
      type: Number,
      default: 0,
      min: [0, 'Monthly contribution cannot be negative'],
    },
    isMonthlyPaymentEnabled: {
      type: Boolean,
      default: true,
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: Object.values(PaymentMethod),
    },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
    },
    creditCardId: {
      type: Schema.Types.ObjectId,
      ref: 'CreditCard',
    },
    status: {
      type: String,
      enum: Object.values(InvestmentStatus),
      default: InvestmentStatus.ACTIVE,
      index: true,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [1000, 'Notes cannot exceed 1000 characters'],
    },
    // External Chit specific metadata
    isExternalChit: {
      type: Boolean,
      default: false,
      index: true,
    },
    chitName: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    isWon: {
      type: Boolean,
      default: false,
      index: true,
    },
    winningDate: {
      type: Date,
    },
    payoutAmount: {
      type: Number,
      min: [0, 'Payout amount cannot be negative'],
    },
    isHistoricalPayout: {
      type: Boolean,
      default: false,
    },
    payoutDestinationType: {
      type: String,
      enum: ['bank', 'cash'],
    },
    payoutAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
    },
    payoutTransactionId: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
    },
    payoutNotes: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : undefined;
        ret.userId = ret.userId ? ret.userId.toString() : undefined;
        if (ret.accountId) ret.accountId = ret.accountId.toString();
        if (ret.creditCardId) ret.creditCardId = ret.creditCardId.toString();
        if (ret.payoutAccountId) ret.payoutAccountId = ret.payoutAccountId.toString();
        if (ret.payoutTransactionId) ret.payoutTransactionId = ret.payoutTransactionId.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

InvestmentSchema.index({ userId: 1, status: 1, category: 1 });
InvestmentSchema.index({ userId: 1, isExternalChit: 1, isWon: 1 });

export const Investment: Model<IInvestment> =
  mongoose.models.Investment || mongoose.model<IInvestment>('Investment', InvestmentSchema);
