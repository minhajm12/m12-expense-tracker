import mongoose, { Schema, Document, Model } from 'mongoose';
import { CreditCardNetwork } from '@finora/shared';

export interface ICreditCard extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  cardNickname: string;
  issuingBank: string;
  network: CreditCardNetwork;
  lastFourDigits?: string;
  creditLimit: number;
  billingCycleClosingDay: number;
  paymentDueDay?: number;
  openingOutstanding: number;
  openingOutstandingDate: Date;
  currentOutstanding: number;
  availableCredit: number;
  annualFee: number;
  rewardsNotes?: string;
  isActive: boolean;
  isArchived: boolean;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CreditCardSchema = new Schema<ICreditCard>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Credit card owner userId is required'],
      index: true,
    },
    cardNickname: {
      type: String,
      required: [true, 'Card nickname is required'],
      trim: true,
      maxlength: [100, 'Card nickname cannot exceed 100 characters'],
    },
    issuingBank: {
      type: String,
      required: [true, 'Issuing bank is required'],
      trim: true,
      maxlength: [100, 'Issuing bank cannot exceed 100 characters'],
    },
    network: {
      type: String,
      enum: Object.values(CreditCardNetwork),
      default: CreditCardNetwork.VISA,
    },
    lastFourDigits: {
      type: String,
      match: [/^\d{4}$/, 'Last four digits must be exactly 4 digits'],
      trim: true,
    },
    creditLimit: {
      type: Number,
      required: [true, 'Credit limit is required'],
      min: [1, 'Credit limit must be greater than 0'],
    },
    billingCycleClosingDay: {
      type: Number,
      required: true,
      min: 1,
      max: 31,
    },
    paymentDueDay: {
      type: Number,
      required: false,
      min: 1,
      max: 31,
    },
    openingOutstanding: {
      type: Number,
      default: 0,
      min: [0, 'Opening outstanding cannot be negative'],
    },
    openingOutstandingDate: {
      type: Date,
      default: Date.now,
    },
    currentOutstanding: {
      type: Number,
      default: 0,
      min: 0,
    },
    availableCredit: {
      type: Number,
      required: true,
    },
    annualFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    rewardsNotes: {
      type: String,
      maxlength: [1000, 'Rewards notes cannot exceed 1000 characters'],
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
      maxlength: [500, 'Notes cannot exceed 500 characters'],
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : undefined;
        ret.userId = ret.userId ? ret.userId.toString() : undefined;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

CreditCardSchema.index({ userId: 1, isArchived: 1 });

export const CreditCard: Model<ICreditCard> =
  mongoose.models.CreditCard || mongoose.model<ICreditCard>('CreditCard', CreditCardSchema);
