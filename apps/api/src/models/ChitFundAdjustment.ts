import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IChitFundAdjustment extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  chitFundId: mongoose.Types.ObjectId;
  bankAccountId?: mongoose.Types.ObjectId;
  entryType: 'adjustment' | 'separation';
  amount: number;
  reason: string;
  reference?: string;
  notes?: string;
  date: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ChitFundAdjustmentSchema = new Schema<IChitFundAdjustment>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner userId is required'],
      index: true,
    },
    chitFundId: {
      type: Schema.Types.ObjectId,
      ref: 'ChitFund',
      required: [true, 'Chit fund ID is required'],
      index: true,
    },
    bankAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
    },
    entryType: {
      type: String,
      enum: ['adjustment', 'separation'],
      default: 'adjustment',
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    reason: {
      type: String,
      required: [true, 'Reason is required'],
      trim: true,
      maxlength: [200, 'Reason cannot exceed 200 characters'],
    },
    reference: {
      type: String,
      trim: true,
      maxlength: [100, 'Reference cannot exceed 100 characters'],
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, 'Notes cannot exceed 500 characters'],
    },
    date: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : undefined;
        ret.userId = ret.userId ? ret.userId.toString() : undefined;
        ret.chitFundId = ret.chitFundId ? ret.chitFundId.toString() : undefined;
        if (ret.bankAccountId) ret.bankAccountId = ret.bankAccountId.toString();
        ret.entryType = ret.entryType || 'adjustment';
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

ChitFundAdjustmentSchema.index({ userId: 1, chitFundId: 1, date: -1 });

export const ChitFundAdjustment: Model<IChitFundAdjustment> =
  mongoose.models.ChitFundAdjustment ||
  mongoose.model<IChitFundAdjustment>('ChitFundAdjustment', ChitFundAdjustmentSchema);
