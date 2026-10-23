import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IPersonalCashAdjustment {
  _id: mongoose.Types.ObjectId;
  type: 'set_balance' | 'add_cash' | 'remove_cash';
  amount: number;
  date: Date;
  description?: string;
  source?: 'bank_account' | 'person' | 'manual';
  bankAccountId?: mongoose.Types.ObjectId;
  personName?: string;
  transactionId?: mongoose.Types.ObjectId;
  createdAt: Date;
}

export interface ICashAccount extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  openingBalance: number;
  openingBalanceDate: Date;
  currentBalance: number;
  currency: string;
  notes?: string;
  adjustments: IPersonalCashAdjustment[];
  createdAt: Date;
  updatedAt: Date;
}

const PersonalCashAdjustmentSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['set_balance', 'add_cash', 'remove_cash'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [0.01, 'Adjustment amount must be positive'],
    },
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },
    source: {
      type: String,
      enum: ['bank_account', 'person', 'manual'],
      default: 'manual',
    },
    bankAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
      default: null,
    },
    personName: {
      type: String,
      trim: true,
      maxlength: [200, 'Person name cannot exceed 200 characters'],
    },
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
      default: null,
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
        delete ret._id;
        return ret;
      },
    },
  }
);

const CashAccountSchema = new Schema<ICashAccount>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User id is required'],
      unique: true,
      index: true,
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
    notes: {
      type: String,
      trim: true,
      maxlength: [500, 'Notes cannot exceed 500 characters'],
    },
    adjustments: [PersonalCashAdjustmentSchema],
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : undefined;
        ret.userId = ret.userId ? ret.userId.toString() : undefined;
        if (Array.isArray(ret.adjustments)) {
          ret.adjustments = ret.adjustments.map((adj: any) => ({
            id: adj._id ? adj._id.toString() : (adj.id || undefined),
            type: adj.type,
            amount: adj.amount,
            date: adj.date,
            description: adj.description,
            createdAt: adj.createdAt,
          }));
        }
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

export const CashAccount: Model<ICashAccount> =
  mongoose.models.CashAccount || mongoose.model<ICashAccount>('CashAccount', CashAccountSchema);
