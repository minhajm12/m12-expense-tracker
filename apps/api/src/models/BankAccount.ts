import mongoose, { Schema, Document, Model } from 'mongoose';
import { AccountType } from '@finora/shared';

export interface IBankAccount extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  accountName: string;
  bankName: string;
  accountType: AccountType;
  accountNumberMasked?: string;
  openingBalance: number;
  openingBalanceDate: Date;
  currentBalance: number;
  currency: string;
  color?: string;
  icon?: string;
  isChitFundAccount: boolean;
  isActive: boolean;
  isArchived: boolean;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BankAccountSchema = new Schema<IBankAccount>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Account owner userId is required'],
      index: true,
    },
    accountName: {
      type: String,
      required: [true, 'Account name is required'],
      trim: true,
      maxlength: [100, 'Account name cannot exceed 100 characters'],
    },
    bankName: {
      type: String,
      required: [true, 'Bank name is required'],
      trim: true,
      maxlength: [100, 'Bank name cannot exceed 100 characters'],
    },
    accountType: {
      type: String,
      enum: Object.values(AccountType),
      default: AccountType.SAVINGS,
    },
    accountNumberMasked: {
      type: String,
      trim: true,
      maxlength: [30, 'Masked identifier cannot exceed 30 characters'],
    },
    openingBalance: {
      type: Number,
      required: [true, 'Opening balance is required'],
      default: 0,
    },
    openingBalanceDate: {
      type: Date,
      required: [true, 'Opening balance date is required'],
      default: Date.now,
    },
    currentBalance: {
      type: Number,
      required: true,
      default: 0,
    },
    currency: {
      type: String,
      required: true,
      default: 'INR',
      uppercase: true,
    },
    color: {
      type: String,
      default: '#10b981',
    },
    icon: {
      type: String,
      default: 'Wallet',
    },
    isChitFundAccount: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isArchived: {
      type: Boolean,
      default: false,
      index: true,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, 'Notes cannot exceed 500 characters'],
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : undefined;
        ret.userId = ret.userId ? ret.userId.toString() : undefined;
        ret.isChitFundAccount = Boolean(ret.isChitFundAccount);
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

BankAccountSchema.index({ userId: 1, isArchived: 1 });
BankAccountSchema.index({ userId: 1, accountName: 1 });
BankAccountSchema.index(
  { userId: 1, isChitFundAccount: 1 },
  { unique: true, partialFilterExpression: { isChitFundAccount: true } }
);

export const BankAccount: Model<IBankAccount> =
  mongoose.models.BankAccount || mongoose.model<IBankAccount>('BankAccount', BankAccountSchema);
