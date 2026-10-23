import mongoose, { Schema, Document, Model } from 'mongoose';
import {
  PaymentMethod,
  PaymentChannel,
  EmiStatus,
} from '@finora/shared';

export interface IEmiRule extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  name: string;
  lender: string;
  monthlyAmount: number;
  startDate: Date;
  firstDueDate: Date;
  nextEmiDate?: Date;
  dueDay: number;
  endDate: Date;
  totalInstallments: number;
  originalLoanAmount?: number;
  outstandingPrincipal?: number;
  loanReference?: string;
  paymentMethod: PaymentMethod;
  paymentChannel: PaymentChannel;
  accountId?: mongoose.Types.ObjectId;
  creditCardId?: mongoose.Types.ObjectId;
  status: EmiStatus;
  notes?: string;
  downPaymentAmount?: number;
  downPaymentAlreadyPaid?: boolean;
  downPaymentPaymentMethod?: PaymentMethod;
  downPaymentAccountId?: mongoose.Types.ObjectId;
  downPaymentCreditCardId?: mongoose.Types.ObjectId;
  downPaymentDate?: Date;
  downPaymentTransactionId?: mongoose.Types.ObjectId;
  downPaymentStatus?: 'paid' | 'paid_historical' | 'not_paid';
  downPaymentNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const EmiRuleSchema = new Schema<IEmiRule>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'EMI name is required'],
      trim: true,
      maxlength: 200,
    },
    lender: {
      type: String,
      required: [true, 'Lender name is required'],
      trim: true,
      maxlength: 200,
    },
    monthlyAmount: {
      type: Number,
      required: [true, 'Monthly EMI amount is required'],
      min: [0.01, 'Monthly amount must be positive'],
    },
    startDate: {
      type: Date,
      required: true,
    },
    firstDueDate: {
      type: Date,
      required: true,
      index: true,
    },
    nextEmiDate: {
      type: Date,
      index: true,
    },
    dueDay: {
      type: Number,
      required: true,
      min: 1,
      max: 31,
    },
    endDate: {
      type: Date,
      required: true,
      index: true,
    },
    totalInstallments: {
      type: Number,
      required: true,
      min: 1,
    },
    originalLoanAmount: {
      type: Number,
      min: 0,
    },
    outstandingPrincipal: {
      type: Number,
      min: 0,
    },
    loanReference: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    paymentMethod: {
      type: String,
      enum: Object.values(PaymentMethod),
      required: true,
      default: PaymentMethod.UPI,
    },
    paymentChannel: {
      type: String,
      enum: Object.values(PaymentChannel),
      required: true,
      default: PaymentChannel.ONLINE,
    },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
    },
    creditCardId: {
      type: Schema.Types.ObjectId,
      ref: 'CreditCard',
    },
    status: {
      type: String,
      enum: Object.values(EmiStatus),
      required: true,
      default: EmiStatus.ACTIVE,
      index: true,
    },
    downPaymentAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
    downPaymentAlreadyPaid: {
      type: Boolean,
      default: false,
    },
    downPaymentPaymentMethod: {
      type: String,
      enum: Object.values(PaymentMethod),
    },
    downPaymentAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
    },
    downPaymentCreditCardId: {
      type: Schema.Types.ObjectId,
      ref: 'CreditCard',
    },
    downPaymentDate: {
      type: Date,
    },
    downPaymentTransactionId: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
    },
    downPaymentStatus: {
      type: String,
      enum: ['paid', 'paid_historical', 'not_paid'],
      default: 'not_paid',
    },
    downPaymentNotes: {
      type: String,
      maxlength: 500,
    },
    notes: {
      type: String,
      maxlength: 500,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : undefined;
        ret.userId = ret.userId ? ret.userId.toString() : undefined;
        if (ret.accountId && !ret.accountId._id) {
          ret.accountId = ret.accountId.toString();
        }
        if (ret.creditCardId && !ret.creditCardId._id) {
          ret.creditCardId = ret.creditCardId.toString();
        }
        if (ret.downPaymentAccountId && !ret.downPaymentAccountId._id) {
          ret.downPaymentAccountId = ret.downPaymentAccountId.toString();
        }
        if (ret.downPaymentCreditCardId && !ret.downPaymentCreditCardId._id) {
          ret.downPaymentCreditCardId = ret.downPaymentCreditCardId.toString();
        }
        if (ret.downPaymentTransactionId && !ret.downPaymentTransactionId._id) {
          ret.downPaymentTransactionId = ret.downPaymentTransactionId.toString();
        }
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

EmiRuleSchema.index({ userId: 1, status: 1 });
EmiRuleSchema.index({ userId: 1, firstDueDate: 1 });

export const EmiRule: Model<IEmiRule> =
  mongoose.models.EmiRule ||
  mongoose.model<IEmiRule>('EmiRule', EmiRuleSchema);
