import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IChitFundCycle extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  chitFundId: mongoose.Types.ObjectId;
  cyclePeriod: string; // e.g. "2026-10"
  year: number;
  month: number;
  prizeTakingDate: Date;
  rolloverDate: Date;
  status: 'upcoming' | 'collecting' | 'winner_selected' | 'payout_pending' | 'completed';
  winnerMemberId?: mongoose.Types.ObjectId;
  winnerMemberName?: string;
  winnerConfirmedAt?: Date;
  winnerConfirmedBy?: mongoose.Types.ObjectId;
  winnerNotes?: string;
  payoutId?: mongoose.Types.ObjectId;
  payoutStatus: 'none' | 'pending' | 'completed';
  payoutAmount?: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ChitFundCycleSchema = new Schema<IChitFundCycle>(
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
    cyclePeriod: {
      type: String,
      required: [true, 'Cycle period (YYYY-MM) is required'],
      trim: true,
    },
    year: {
      type: Number,
      required: true,
    },
    month: {
      type: Number,
      required: true,
    },
    prizeTakingDate: {
      type: Date,
      required: true,
    },
    rolloverDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ['upcoming', 'collecting', 'winner_selected', 'payout_pending', 'completed'],
      default: 'collecting',
      index: true,
    },
    winnerMemberId: {
      type: Schema.Types.ObjectId,
      ref: 'ChitFundMember',
      index: true,
    },
    winnerMemberName: {
      type: String,
      trim: true,
    },
    winnerConfirmedAt: {
      type: Date,
    },
    winnerConfirmedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    winnerNotes: {
      type: String,
      trim: true,
      maxlength: [500, 'Notes cannot exceed 500 characters'],
    },
    payoutId: {
      type: Schema.Types.ObjectId,
      ref: 'ChitFundPayout',
    },
    payoutStatus: {
      type: String,
      enum: ['none', 'pending', 'completed'],
      default: 'none',
    },
    payoutAmount: {
      type: Number,
      min: [0, 'Payout amount cannot be negative'],
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
        ret.chitFundId = ret.chitFundId ? ret.chitFundId.toString() : undefined;
        if (ret.winnerMemberId) ret.winnerMemberId = ret.winnerMemberId.toString();
        if (ret.winnerConfirmedBy) ret.winnerConfirmedBy = ret.winnerConfirmedBy.toString();
        if (ret.payoutId) ret.payoutId = ret.payoutId.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Enforce exactly one cycle record per user, fund, and period
ChitFundCycleSchema.index({ userId: 1, chitFundId: 1, cyclePeriod: 1 }, { unique: true });

export const ChitFundCycle: Model<IChitFundCycle> =
  mongoose.models.ChitFundCycle || mongoose.model<IChitFundCycle>('ChitFundCycle', ChitFundCycleSchema);
