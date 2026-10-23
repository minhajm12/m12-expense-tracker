import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IChitFund extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  name: string;
  totalChits: number;
  defaultContributionPerChit: number;
  currency: string;
  collectionFrequency: string;
  startDate: Date;
  currentPeriod: string;
  designatedBankAccountId?: mongoose.Types.ObjectId;
  notes?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ChitFundSchema = new Schema<IChitFund>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner userId is required'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Chit fund name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    totalChits: {
      type: Number,
      required: true,
      default: 20,
      min: [1, 'Total chits must be at least 1'],
    },
    defaultContributionPerChit: {
      type: Number,
      required: true,
      default: 5000,
      min: [1, 'Contribution must be positive'],
    },
    currency: {
      type: String,
      required: true,
      default: 'INR',
      uppercase: true,
    },
    collectionFrequency: {
      type: String,
      default: 'monthly',
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    currentPeriod: {
      type: String,
      default: () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      },
    },
    designatedBankAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, 'Notes cannot exceed 500 characters'],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : undefined;
        ret.userId = ret.userId ? ret.userId.toString() : undefined;
        if (ret.designatedBankAccountId) {
          ret.designatedBankAccountId = ret.designatedBankAccountId.toString();
        }
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

ChitFundSchema.index({ userId: 1, isActive: 1 });

export const ChitFund: Model<IChitFund> =
  mongoose.models.ChitFund || mongoose.model<IChitFund>('ChitFund', ChitFundSchema);
