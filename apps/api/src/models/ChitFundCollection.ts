import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IChitFundCollection extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  chitFundId: mongoose.Types.ObjectId;
  memberId: mongoose.Types.ObjectId;
  collectionPeriod: string;
  chitsCovered: number;
  expectedAmount: number;
  actualAmountReceived: number;
  isSeparation?: boolean;
  isAlreadyPaid?: boolean;
  collectionDate: Date;
  receivingBankAccountId?: mongoose.Types.ObjectId;
  sourceAccountId?: mongoose.Types.ObjectId;
  transactionId?: mongoose.Types.ObjectId;
  paymentMethod: string;
  reference?: string;
  notes?: string;
  status: 'completed' | 'partial' | 'pending';
  createdAt: Date;
  updatedAt: Date;
}

const ChitFundCollectionSchema = new Schema<IChitFundCollection>(
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
    memberId: {
      type: Schema.Types.ObjectId,
      ref: 'ChitFundMember',
      required: [true, 'Member ID is required'],
      index: true,
    },
    collectionPeriod: {
      type: String,
      required: [true, 'Collection period is required'],
      index: true,
    },
    chitsCovered: {
      type: Number,
      required: true,
      default: 1,
      min: [1, 'Chits covered must be at least 1'],
    },
    expectedAmount: {
      type: Number,
      required: true,
      min: [0, 'Expected amount cannot be negative'],
    },
    actualAmountReceived: {
      type: Number,
      required: true,
      min: [0, 'Received amount cannot be negative'],
    },
    isSeparation: {
      type: Boolean,
      default: false,
      index: true,
    },
    isAlreadyPaid: {
      type: Boolean,
      default: false,
      index: true,
    },
    collectionDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    receivingBankAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
    },
    sourceAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
    },
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
    },
    paymentMethod: {
      type: String,
      default: 'upi',
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
      enum: ['completed', 'partial', 'pending'],
      default: 'completed',
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : undefined;
        ret.userId = ret.userId ? ret.userId.toString() : undefined;
        if (ret.memberId) {
          if (typeof ret.memberId === 'object' && ret.memberId._id) {
            ret.memberId = ret.memberId._id.toString();
          } else if (typeof ret.memberId === 'object' && ret.memberId.id) {
            ret.memberId = ret.memberId.id.toString();
          } else {
            ret.memberId = ret.memberId.toString();
          }
        }
        if (ret.receivingBankAccountId) {
          if (typeof ret.receivingBankAccountId === 'object' && ret.receivingBankAccountId._id) {
            ret.receivingBankAccountId = ret.receivingBankAccountId._id.toString();
          } else if (typeof ret.receivingBankAccountId === 'object' && ret.receivingBankAccountId.id) {
            ret.receivingBankAccountId = ret.receivingBankAccountId.id.toString();
          } else {
            ret.receivingBankAccountId = ret.receivingBankAccountId.toString();
          }
        }
        if (ret.sourceAccountId) {
          if (typeof ret.sourceAccountId === 'object' && ret.sourceAccountId._id) {
            ret.sourceAccountId = ret.sourceAccountId._id.toString();
          } else if (typeof ret.sourceAccountId === 'object' && ret.sourceAccountId.id) {
            ret.sourceAccountId = ret.sourceAccountId.id.toString();
          } else {
            ret.sourceAccountId = ret.sourceAccountId.toString();
          }
        }
        if (ret.transactionId) {
          if (typeof ret.transactionId === 'object' && ret.transactionId._id) {
            ret.transactionId = ret.transactionId._id.toString();
          } else if (typeof ret.transactionId === 'object' && ret.transactionId.id) {
            ret.transactionId = ret.transactionId.id.toString();
          } else {
            ret.transactionId = ret.transactionId.toString();
          }
        }
        ret.outstandingAmount = Math.max(0, (ret.expectedAmount || 0) - (ret.actualAmountReceived || 0));
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

ChitFundCollectionSchema.index({ userId: 1, chitFundId: 1, collectionPeriod: 1 });
ChitFundCollectionSchema.index({ userId: 1, memberId: 1, collectionPeriod: 1 });

export const ChitFundCollection: Model<IChitFundCollection> =
  mongoose.models.ChitFundCollection || mongoose.model<IChitFundCollection>('ChitFundCollection', ChitFundCollectionSchema);
