import mongoose, { Schema, Document, Model } from 'mongoose';
import { StatementStatus } from '@finora/shared';

export interface ICreditCardStatement extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  creditCardId: mongoose.Types.ObjectId;
  periodStart: Date;
  periodEnd: Date;
  closingDate: Date;
  dueDate: Date;
  openingBalance: number;
  newPurchases: number;
  feesAndCharges: number;
  paymentsReceived: number;
  refundsAndCredits: number;
  statementBalance: number;
  minimumAmountDue: number;
  amountPaid: number;
  remainingBalance: number;
  status: StatementStatus;
  createdAt: Date;
  updatedAt: Date;
}

const CreditCardStatementSchema = new Schema<ICreditCardStatement>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    creditCardId: {
      type: Schema.Types.ObjectId,
      ref: 'CreditCard',
      required: true,
      index: true,
    },
    periodStart: {
      type: Date,
      required: true,
    },
    periodEnd: {
      type: Date,
      required: true,
    },
    closingDate: {
      type: Date,
      required: true,
    },
    dueDate: {
      type: Date,
      required: true,
    },
    openingBalance: {
      type: Number,
      default: 0,
    },
    newPurchases: {
      type: Number,
      default: 0,
    },
    feesAndCharges: {
      type: Number,
      default: 0,
    },
    paymentsReceived: {
      type: Number,
      default: 0,
    },
    refundsAndCredits: {
      type: Number,
      default: 0,
    },
    statementBalance: {
      type: Number,
      default: 0,
    },
    minimumAmountDue: {
      type: Number,
      default: 0,
    },
    amountPaid: {
      type: Number,
      default: 0,
    },
    remainingBalance: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: Object.values(StatementStatus),
      default: StatementStatus.GENERATED,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : undefined;
        ret.userId = ret.userId ? ret.userId.toString() : undefined;
        ret.creditCardId = ret.creditCardId ? ret.creditCardId.toString() : undefined;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

CreditCardStatementSchema.index({ userId: 1, creditCardId: 1, closingDate: -1 });

export const CreditCardStatement: Model<ICreditCardStatement> =
  mongoose.models.CreditCardStatement ||
  mongoose.model<ICreditCardStatement>('CreditCardStatement', CreditCardStatementSchema);
