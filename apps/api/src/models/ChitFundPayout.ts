import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IChitFundPayout extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  chitFundId: mongoose.Types.ObjectId;
  recipientName: string;
  memberId?: mongoose.Types.ObjectId;
  payoutPeriod: string;
  amount: number;
  cashAmount?: number;
  upiAmount?: number;
  isHistorical?: boolean;
  payoutDate: Date;
  sourceBankAccountId?: mongoose.Types.ObjectId;
  reference?: string;
  notes?: string;
  status: 'completed' | 'pending';
  createdAt: Date;
  updatedAt: Date;
}

const ChitFundPayoutSchema = new Schema<IChitFundPayout>(
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
    recipientName: {
      type: String,
      required: [true, 'Recipient name is required'],
      trim: true,
      maxlength: [100, 'Recipient name cannot exceed 100 characters'],
    },
    memberId: {
      type: Schema.Types.ObjectId,
      ref: 'ChitFundMember',
    },
    payoutPeriod: {
      type: String,
      required: [true, 'Payout period is required'],
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [1, 'Payout amount must be positive'],
    },
    cashAmount: {
      type: Number,
      default: 0,
      min: [0, 'Cash amount cannot be negative'],
    },
    upiAmount: {
      type: Number,
      default: 0,
      min: [0, 'UPI amount cannot be negative'],
    },
    isHistorical: {
      type: Boolean,
      default: false,
      index: true,
    },
    payoutDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    sourceBankAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
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
    status: {
      type: String,
      enum: ['completed', 'pending'],
      default: 'completed',
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : undefined;
        ret.userId = ret.userId ? ret.userId.toString() : undefined;
        ret.chitFundId = ret.chitFundId ? ret.chitFundId.toString() : undefined;
        if (ret.memberId) ret.memberId = ret.memberId.toString();
        if (ret.sourceBankAccountId) {
          ret.sourceBankAccountId = ret.sourceBankAccountId.toString();
        }
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

ChitFundPayoutSchema.index({ userId: 1, chitFundId: 1, payoutPeriod: 1 });

export const ChitFundPayout: Model<IChitFundPayout> =
  mongoose.models.ChitFundPayout || mongoose.model<IChitFundPayout>('ChitFundPayout', ChitFundPayoutSchema);
