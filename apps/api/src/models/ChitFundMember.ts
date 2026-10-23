import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IChitFundMember extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  chitFundId: mongoose.Types.ObjectId;
  name: string;
  numberOfChits: number;
  contributionPerChit: number;
  totalExpectedPerPeriod: number;
  phone?: string;
  email?: string;
  startDate: Date;
  status: 'active' | 'inactive' | 'archived';
  hasPreviouslyWon: boolean;
  previousWinDate?: Date;
  previousWinCycle?: string;
  previousWinNotes?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ChitFundMemberSchema = new Schema<IChitFundMember>(
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
    name: {
      type: String,
      required: [true, 'Member name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    numberOfChits: {
      type: Number,
      required: true,
      default: 1,
      min: [1, 'Number of chits must be at least 1'],
    },
    contributionPerChit: {
      type: Number,
      required: true,
      default: 5000,
      min: [1, 'Contribution per chit must be positive'],
    },
    totalExpectedPerPeriod: {
      type: Number,
      required: true,
      default: 5000,
    },
    phone: {
      type: String,
      trim: true,
      maxlength: [30, 'Phone cannot exceed 30 characters'],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'archived'],
      default: 'active',
      index: true,
    },
    hasPreviouslyWon: {
      type: Boolean,
      default: false,
      index: true,
    },
    previousWinDate: {
      type: Date,
    },
    previousWinCycle: {
      type: String,
      trim: true,
    },
    previousWinNotes: {
      type: String,
      trim: true,
      maxlength: [500, 'Previous win notes cannot exceed 500 characters'],
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
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

ChitFundMemberSchema.index({ userId: 1, chitFundId: 1, status: 1 });
ChitFundMemberSchema.index({ userId: 1, name: 1 });

// Ensure totalExpectedPerPeriod and contributionPerChit are consistently synchronized without doubling
ChitFundMemberSchema.pre('save', function (next) {
  const chits = this.numberOfChits || 1;
  if (this.isModified('totalExpectedPerPeriod') && !this.isModified('contributionPerChit')) {
    this.contributionPerChit = this.totalExpectedPerPeriod / chits;
  } else if (this.isModified('contributionPerChit') && !this.isModified('totalExpectedPerPeriod')) {
    this.totalExpectedPerPeriod = chits * this.contributionPerChit;
  } else if (this.totalExpectedPerPeriod) {
    this.contributionPerChit = this.totalExpectedPerPeriod / chits;
  } else {
    this.totalExpectedPerPeriod = chits * (this.contributionPerChit || 5000);
  }
  next();
});

export const ChitFundMember: Model<IChitFundMember> =
  mongoose.models.ChitFundMember || mongoose.model<IChitFundMember>('ChitFundMember', ChitFundMemberSchema);
