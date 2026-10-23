import mongoose, { Schema, Document, Model } from 'mongoose';

export type RecurringOccurrenceStatus = 'DUE' | 'LOGGED' | 'SKIPPED';

export interface IRecurringOccurrence extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  recurringRuleId: mongoose.Types.ObjectId;
  occurrenceKey: string; // "YYYY-MM" in Asia/Kolkata
  scheduledDate: Date;
  status: RecurringOccurrenceStatus;
  transactionId?: mongoose.Types.ObjectId;
  loggedAt?: Date;
  originalAmount?: number;
  actualAmount?: number;
  discountAmount?: number;
  discountType?: string;
  discountNotes?: string;
  paymentMethod?: string;
  paymentChannel?: string;
  accountId?: mongoose.Types.ObjectId;
  creditCardId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const RecurringOccurrenceSchema = new Schema<IRecurringOccurrence>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    recurringRuleId: {
      type: Schema.Types.ObjectId,
      ref: 'RecurringTransaction',
      required: true,
      index: true,
    },
    occurrenceKey: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    scheduledDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ['DUE', 'LOGGED', 'SKIPPED'],
      required: true,
      default: 'DUE',
      index: true,
    },
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
      index: true,
    },
    loggedAt: {
      type: Date,
    },
    originalAmount: {
      type: Number,
      min: 0,
    },
    actualAmount: {
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
    paymentMethod: {
      type: String,
      trim: true,
    },
    paymentChannel: {
      type: String,
      trim: true,
    },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
    },
    creditCardId: {
      type: Schema.Types.ObjectId,
      ref: 'CreditCard',
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : undefined;
        ret.userId = ret.userId ? ret.userId.toString() : undefined;
        ret.recurringRuleId = ret.recurringRuleId ? ret.recurringRuleId.toString() : undefined;
        ret.transactionId = ret.transactionId ? ret.transactionId.toString() : undefined;
        ret.accountId = ret.accountId ? ret.accountId.toString() : undefined;
        ret.creditCardId = ret.creditCardId ? ret.creditCardId.toString() : undefined;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Compound unique index ensuring only 1 occurrence record per recurring rule per monthly cycle key
RecurringOccurrenceSchema.index(
  { recurringRuleId: 1, occurrenceKey: 1 },
  { unique: true }
);

RecurringOccurrenceSchema.index({ userId: 1, occurrenceKey: 1 });
RecurringOccurrenceSchema.index({ recurringRuleId: 1, status: 1 });

export const RecurringOccurrence: Model<IRecurringOccurrence> =
  mongoose.models.RecurringOccurrence ||
  mongoose.model<IRecurringOccurrence>('RecurringOccurrence', RecurringOccurrenceSchema);
