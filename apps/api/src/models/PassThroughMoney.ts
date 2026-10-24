import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IPassThroughSend {
  _id?: mongoose.Types.ObjectId;
  recipientName: string;
  amount: number;
  date: Date;
  bankAccountId: mongoose.Types.ObjectId;
  reference?: string;
  notes?: string;
  createdAt?: Date;
}

export interface IPassThroughMoney extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  senderName: string;
  receivedAmount: number;
  receivedDate: Date;
  receivingBankAccountId: mongoose.Types.ObjectId;
  reference?: string;
  notes?: string;
  totalSentAmount: number;
  outstandingAmount: number;
  status: 'pending' | 'partially_sent' | 'completed';
  sends: IPassThroughSend[];
  createdAt: Date;
  updatedAt: Date;
}

const PassThroughSendSchema = new Schema<IPassThroughSend>(
  {
    recipientName: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    date: {
      type: Date,
      required: true,
    },
    bankAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
      required: true,
    },
    reference: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const PassThroughMoneySchema = new Schema<IPassThroughMoney>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    senderName: {
      type: String,
      required: true,
      trim: true,
    },
    receivedAmount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    receivedDate: {
      type: Date,
      required: true,
      index: true,
    },
    receivingBankAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
      required: true,
      index: true,
    },
    reference: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    totalSentAmount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    outstandingAmount: {
      type: Number,
      required: true,
      default: function (this: IPassThroughMoney) {
        return this.receivedAmount || 0;
      },
      min: 0,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'partially_sent', 'completed'],
      default: 'pending',
      index: true,
    },
    sends: [PassThroughSendSchema],
  },
  {
    timestamps: true,
  }
);

PassThroughMoneySchema.index({ userId: 1, status: 1 });
PassThroughMoneySchema.index({ userId: 1, receivedDate: -1 });

export const PassThroughMoney: Model<IPassThroughMoney> =
  mongoose.models.PassThroughMoney ||
  mongoose.model<IPassThroughMoney>('PassThroughMoney', PassThroughMoneySchema);
