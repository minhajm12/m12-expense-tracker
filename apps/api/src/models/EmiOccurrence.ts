import mongoose, { Schema, Document, Model } from 'mongoose';
import {
  PaymentMethod,
  PaymentChannel,
  EmiOccurrenceStatus,
} from '@finora/shared';

export interface IEmiOccurrence extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  emiRuleId: mongoose.Types.ObjectId;
  occurrenceKey: string; // "YYYY-MM" in Asia/Kolkata
  installmentNumber: number;
  dueDate: Date;
  expectedAmount: number;
  actualAmountPaid?: number;
  paymentMethod?: PaymentMethod;
  paymentChannel?: PaymentChannel;
  accountId?: mongoose.Types.ObjectId;
  creditCardId?: mongoose.Types.ObjectId;
  status: EmiOccurrenceStatus;
  isHistorical?: boolean;
  transactionId?: mongoose.Types.ObjectId;
  paidAt?: Date;
  discountAmount?: number;
  discountType?: string;
  discountNotes?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const EmiOccurrenceSchema = new Schema<IEmiOccurrence>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    emiRuleId: {
      type: Schema.Types.ObjectId,
      ref: 'EmiRule',
      required: true,
      index: true,
    },
    occurrenceKey: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    installmentNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    dueDate: {
      type: Date,
      required: true,
      index: true,
    },
    expectedAmount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    actualAmountPaid: {
      type: Number,
      min: 0,
    },
    paymentMethod: {
      type: String,
      enum: Object.values(PaymentMethod),
    },
    paymentChannel: {
      type: String,
      enum: Object.values(PaymentChannel),
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
      enum: Object.values(EmiOccurrenceStatus),
      required: true,
      default: EmiOccurrenceStatus.DUE,
      index: true,
    },
    isHistorical: {
      type: Boolean,
      default: false,
      index: true,
    },
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
      index: true,
    },
    paidAt: {
      type: Date,
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
    notes: {
      type: String,
      maxlength: 500,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : undefined;
        ret.userId = ret.userId ? ret.userId.toString() : undefined;
        ret.emiRuleId = ret.emiRuleId ? ret.emiRuleId.toString() : undefined;
        if (ret.transactionId) {
          ret.transactionId =
            typeof ret.transactionId === 'object'
              ? (ret.transactionId._id || ret.transactionId.id || ret.transactionId).toString()
              : ret.transactionId.toString();
        }
        if (ret.accountId) {
          ret.accountId =
            typeof ret.accountId === 'object'
              ? (ret.accountId._id || ret.accountId.id || ret.accountId).toString()
              : ret.accountId.toString();
        }
        if (ret.creditCardId) {
          ret.creditCardId =
            typeof ret.creditCardId === 'object'
              ? (ret.creditCardId._id || ret.creditCardId.id || ret.creditCardId).toString()
              : ret.creditCardId.toString();
        }
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Compound unique index ensuring only 1 occurrence record per EMI rule per monthly cycle key
EmiOccurrenceSchema.index(
  { emiRuleId: 1, occurrenceKey: 1 },
  { unique: true }
);

EmiOccurrenceSchema.index({ userId: 1, occurrenceKey: 1 });
EmiOccurrenceSchema.index({ emiRuleId: 1, status: 1 });

export const EmiOccurrence: Model<IEmiOccurrence> =
  mongoose.models.EmiOccurrence ||
  mongoose.model<IEmiOccurrence>('EmiOccurrence', EmiOccurrenceSchema);
