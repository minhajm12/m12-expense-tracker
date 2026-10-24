import mongoose, { Schema, Document, Model } from 'mongoose';
import { LendingBorrowingType, LendingBorrowingStatus } from '@finora/shared';

export interface ILendingRepayment {
  _id: mongoose.Types.ObjectId;
  amount: number;
  date: Date;
  paymentMethod: 'upi' | 'cash';
  paymentChannel?: 'online' | 'offline';
  bankAccountId?: mongoose.Types.ObjectId;
  notes?: string;
  isHistorical?: boolean;
  createdAt: Date;
}

export interface ILendingBorrowing extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  type: LendingBorrowingType;
  personName: string;
  phoneNumber?: string;
  amount: number;
  date: Date;
  dueDate?: Date;
  paymentMethod: 'upi' | 'cash';
  paymentChannel?: 'online' | 'offline';
  bankAccountId?: mongoose.Types.ObjectId;
  description?: string;
  notes?: string;
  status: LendingBorrowingStatus;
  settledAmount: number;
  outstandingAmount: number;
  isHistorical: boolean;
  accountingMode: 'historical' | 'live';
  repayments: ILendingRepayment[];
  createdAt: Date;
  updatedAt: Date;
}

const LendingRepaymentSchema = new Schema(
  {
    amount: {
      type: Number,
      required: true,
      min: [0.01, 'Repayment amount must be positive'],
    },
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    paymentMethod: {
      type: String,
      enum: ['upi', 'cash'],
      required: true,
    },
    paymentChannel: {
      type: String,
      enum: ['online', 'offline'],
      default: function (this: any) {
        return this.paymentMethod === 'upi' ? 'online' : 'offline';
      },
    },
    bankAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, 'Notes cannot exceed 500 characters'],
    },
    isHistorical: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: true,
    toJSON: {
      transform: (doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : undefined;
        ret.bankAccountId = ret.bankAccountId ? ret.bankAccountId.toString() : undefined;
        ret.isHistorical = Boolean(ret.isHistorical);
        delete ret._id;
        return ret;
      },
    },
  }
);

const LendingBorrowingSchema = new Schema<ILendingBorrowing>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner userId is required'],
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(LendingBorrowingType),
      required: [true, 'Type (lending or borrowing) is required'],
      index: true,
    },
    personName: {
      type: String,
      required: [true, 'Person name is required'],
      trim: true,
      maxlength: [100, 'Person name cannot exceed 100 characters'],
      index: true,
    },
    phoneNumber: {
      type: String,
      trim: true,
      maxlength: [20, 'Phone number cannot exceed 20 characters'],
    },
    amount: {
      type: Number,
      required: [true, 'Principal amount is required'],
      min: [0.01, 'Amount must be positive'],
    },
    date: {
      type: Date,
      required: [true, 'Transaction date is required'],
      default: Date.now,
    },
    dueDate: {
      type: Date,
    },
    paymentMethod: {
      type: String,
      enum: ['upi', 'cash'],
      required: true,
      default: 'cash',
    },
    paymentChannel: {
      type: String,
      enum: ['online', 'offline'],
      default: function (this: any) {
        return this.paymentMethod === 'upi' ? 'online' : 'offline';
      },
    },
    bankAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
    },
    description: {
      type: String,
      trim: true,
      maxlength: [300, 'Description cannot exceed 300 characters'],
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [1000, 'Notes cannot exceed 1000 characters'],
    },
    status: {
      type: String,
      enum: Object.values(LendingBorrowingStatus),
      default: LendingBorrowingStatus.OUTSTANDING,
      index: true,
    },
    settledAmount: {
      type: Number,
      default: 0,
    },
    outstandingAmount: {
      type: Number,
      required: true,
    },
    isHistorical: {
      type: Boolean,
      default: false,
      index: true,
    },
    accountingMode: {
      type: String,
      enum: ['historical', 'live'],
      default: 'live',
    },
    repayments: [LendingRepaymentSchema],
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : undefined;
        ret.userId = ret.userId ? ret.userId.toString() : undefined;
        ret.bankAccountId = ret.bankAccountId ? ret.bankAccountId.toString() : undefined;
        ret.paymentChannel = ret.paymentChannel || (ret.paymentMethod === 'upi' ? 'online' : 'offline');
        ret.isHistorical = Boolean(ret.isHistorical);
        ret.accountingMode = ret.accountingMode || (ret.isHistorical ? 'historical' : 'live');
        if (Array.isArray(ret.repayments)) {
          ret.repayments = ret.repayments.map((r: any) => {
            if (r && typeof r === 'object') {
              return {
                id: r._id ? r._id.toString() : (r.id || undefined),
                amount: r.amount,
                date: r.date,
                paymentMethod: r.paymentMethod,
                paymentChannel: r.paymentChannel || (r.paymentMethod === 'upi' ? 'online' : 'offline'),
                bankAccountId: r.bankAccountId ? r.bankAccountId.toString() : undefined,
                notes: r.notes,
                isHistorical: Boolean(r.isHistorical),
                createdAt: r.createdAt,
              };
            }
            return r;
          });
        }
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

LendingBorrowingSchema.index({ userId: 1, type: 1, status: 1 });
LendingBorrowingSchema.index({ userId: 1, isHistorical: 1 });
LendingBorrowingSchema.index({ userId: 1, date: -1 });
LendingBorrowingSchema.index({ userId: 1, personName: 1 });
LendingBorrowingSchema.index({ userId: 1, bankAccountId: 1 });

export const LendingBorrowing: Model<ILendingBorrowing> =
  mongoose.models.LendingBorrowing ||
  mongoose.model<ILendingBorrowing>('LendingBorrowing', LendingBorrowingSchema);
