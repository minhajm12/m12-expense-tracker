import mongoose, { Schema, Document, Model } from 'mongoose';
import {
  TransactionType,
  PaymentMethod,
  PaymentChannel,
  RecurringFrequency,
} from '@finora/shared';

export interface IRecurringTransaction extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  title: string;
  amount: number;
  type: TransactionType;
  category: string;
  frequency: RecurringFrequency;
  paymentMethod: PaymentMethod;
  paymentChannel: PaymentChannel;
  accountId?: mongoose.Types.ObjectId;
  creditCardId?: mongoose.Types.ObjectId;
  destinationAccountId?: mongoose.Types.ObjectId;
  nextExecutionDate: Date;
  lastExecutedAt?: Date;
  notes?: string;
  isActive: boolean;
  status?: 'active' | 'completed' | 'cancelled';
  isFlexibleDate?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const RecurringTransactionSchema = new Schema<IRecurringTransaction>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: 200,
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [0.01, 'Amount must be greater than 0'],
    },
    type: {
      type: String,
      enum: Object.values(TransactionType),
      required: true,
      default: TransactionType.EXPENSE,
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      trim: true,
    },
    frequency: {
      type: String,
      enum: Object.values(RecurringFrequency),
      required: true,
      default: RecurringFrequency.MONTHLY,
    },
    paymentMethod: {
      type: String,
      enum: Object.values(PaymentMethod),
      required: true,
      default: PaymentMethod.UPI,
    },
    paymentChannel: {
      type: String,
      enum: Object.values(PaymentChannel),
      required: true,
      default: PaymentChannel.ONLINE,
    },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
    },
    creditCardId: {
      type: Schema.Types.ObjectId,
      ref: 'CreditCard',
    },
    destinationAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
    },
    nextExecutionDate: {
      type: Date,
      required: true,
      index: true,
    },
    lastExecutedAt: {
      type: Date,
    },
    notes: {
      type: String,
      maxlength: 500,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'completed', 'cancelled'],
      default: 'active',
      index: true,
    },
    isFlexibleDate: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : undefined;
        ret.userId = ret.userId ? ret.userId.toString() : undefined;
        if (ret.accountId) ret.accountId = ret.accountId.toString();
        if (ret.creditCardId) ret.creditCardId = ret.creditCardId.toString();
        if (ret.destinationAccountId) ret.destinationAccountId = ret.destinationAccountId.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

RecurringTransactionSchema.index({ userId: 1, isActive: 1, nextExecutionDate: 1 });

export const RecurringTransaction: Model<IRecurringTransaction> =
  mongoose.models.RecurringTransaction ||
  mongoose.model<IRecurringTransaction>('RecurringTransaction', RecurringTransactionSchema);
