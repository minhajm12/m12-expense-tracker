import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IBudget extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  category: string;
  limitAmount: number;
  period: 'monthly' | 'custom';
  startDate: Date;
  endDate: Date;
  alertThresholdPercent: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BudgetSchema = new Schema<IBudget>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    limitAmount: {
      type: Number,
      required: true,
      min: [1, 'Budget limit must be greater than 0'],
    },
    period: {
      type: String,
      enum: ['monthly', 'custom'],
      default: 'monthly',
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    alertThresholdPercent: {
      type: Number,
      default: 80,
      min: 1,
      max: 100,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : undefined;
        ret.userId = ret.userId ? ret.userId.toString() : undefined;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

BudgetSchema.index({ userId: 1, category: 1, startDate: 1 });

export const Budget: Model<IBudget> =
  mongoose.models.Budget || mongoose.model<IBudget>('Budget', BudgetSchema);
