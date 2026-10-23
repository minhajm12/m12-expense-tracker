import mongoose, { Schema, Document, Model } from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { UserRole } from '@finora/shared';

export interface IUserPreferences {
  theme: 'light' | 'dark' | 'system';
  dateFormat: string;
  notifyDueDates: boolean;
  notifyBudgetAlerts: boolean;
  incomeCategories?: string[];
}

export interface IModulePreferences {
  expenseTracker: boolean;
  emi: boolean;
  lendingBorrowing: boolean;
  budget: boolean;
  recurringTransactions: boolean;
  creditCards: boolean;
  chitFund: boolean;
  investment: boolean;
}

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  email: string;
  password?: string;
  fullName: string;
  role: UserRole;
  currency: string;
  isActive: boolean;
  tokenVersion: number;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  passwordResetOtpHash?: string;
  passwordResetOtpExpires?: Date;
  passwordResetAttempts?: number;
  passwordResetLastSentAt?: Date;
  isEmailVerified: boolean;
  isOnboardingCompleted: boolean;
  emailVerificationOtpHash?: string;
  emailVerificationOtpExpires?: Date;
  emailVerificationAttempts?: number;
  emailVerificationLastSentAt?: Date;
  preferences: IUserPreferences;
  modulePreferences: IModulePreferences;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
  createPasswordResetToken(): string;
}

const UserPreferencesSchema = new Schema<IUserPreferences>(
  {
    theme: {
      type: String,
      enum: ['light', 'dark', 'system'],
      default: 'light',
    },
    dateFormat: {
      type: String,
      default: 'YYYY-MM-DD',
    },
    notifyDueDates: {
      type: Boolean,
      default: true,
    },
    notifyBudgetAlerts: {
      type: Boolean,
      default: true,
    },
    incomeCategories: {
      type: [String],
      default: ['Salary', 'Freelance income'],
    },
  },
  { _id: false }
);

const ModulePreferencesSchema = new Schema<IModulePreferences>(
  {
    expenseTracker: {
      type: Boolean,
      default: true,
    },
    emi: {
      type: Boolean,
      default: true,
    },
    lendingBorrowing: {
      type: Boolean,
      default: true,
    },
    budget: {
      type: Boolean,
      default: true,
    },
    recurringTransactions: {
      type: Boolean,
      default: true,
    },
    creditCards: {
      type: Boolean,
      default: true,
    },
    chitFund: {
      type: Boolean,
      default: true,
    },
    investment: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: [true, 'Email address is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters long'],
      select: false,
    },
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      maxlength: [100, 'Full name cannot exceed 100 characters'],
    },
    role: {
      type: String,
      enum: Object.values(UserRole),
      default: UserRole.USER,
      index: true,
    },
    currency: {
      type: String,
      default: 'INR',
      uppercase: true,
      minlength: 3,
      maxlength: 3,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    tokenVersion: {
      type: Number,
      default: 0,
    },
    passwordResetToken: {
      type: String,
      select: false,
    },
    passwordResetExpires: {
      type: Date,
      select: false,
    },
    passwordResetOtpHash: {
      type: String,
      select: false,
    },
    passwordResetOtpExpires: {
      type: Date,
      select: false,
    },
    passwordResetAttempts: {
      type: Number,
      default: 0,
      select: false,
    },
    passwordResetLastSentAt: {
      type: Date,
      select: false,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
      index: true,
    },
    isOnboardingCompleted: {
      type: Boolean,
      default: false,
    },
    emailVerificationOtpHash: {
      type: String,
      select: false,
    },
    emailVerificationOtpExpires: {
      type: Date,
      select: false,
    },
    emailVerificationAttempts: {
      type: Number,
      default: 0,
      select: false,
    },
    emailVerificationLastSentAt: {
      type: Date,
      select: false,
    },
    preferences: {
      type: UserPreferencesSchema,
      default: () => ({}),
    },
    modulePreferences: {
      type: ModulePreferencesSchema,
      default: () => ({
        expenseTracker: true,
        emi: true,
        lendingBorrowing: true,
        budget: true,
        recurringTransactions: true,
        creditCards: true,
        chitFund: true,
        investment: true,
      }),
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret: Record<string, any>) => {
        ret.id = ret._id ? ret._id.toString() : undefined;
        delete ret._id;
        delete ret.__v;
        delete ret.password;
        delete ret.passwordResetToken;
        delete ret.passwordResetExpires;
        delete ret.passwordResetOtpHash;
        delete ret.passwordResetOtpExpires;
        delete ret.passwordResetAttempts;
        delete ret.passwordResetLastSentAt;
        delete ret.emailVerificationOtpHash;
        delete ret.emailVerificationOtpExpires;
        delete ret.emailVerificationAttempts;
        delete ret.emailVerificationLastSentAt;
        delete ret.tokenVersion;
        if (ret.isEmailVerified === undefined) ret.isEmailVerified = true;
        if (ret.isOnboardingCompleted === undefined) ret.isOnboardingCompleted = true;
        const mp = ret.modulePreferences || {};
        ret.modulePreferences = {
          expenseTracker: mp.expenseTracker !== false,
          emi: mp.emi !== false,
          lendingBorrowing: mp.lendingBorrowing !== false,
          budget: mp.budget !== false,
          recurringTransactions: mp.recurringTransactions !== false,
          creditCards: mp.creditCards !== false,
          chitFund: mp.chitFund !== false,
          investment: mp.investment !== false,
        };
        return ret;
      },
    },
  }
);

// Pre-save password hashing hook with 12 bcrypt salt rounds
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err: unknown) {
    next(err as Error);
  }
});

// Compare candidated password with stored bcrypt hash
UserSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

// Generate cryptographically random reset token and store hash
UserSchema.methods.createPasswordResetToken = function (): string {
  const resetToken = crypto.randomBytes(32).toString('hex');

  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  // Token valid for 1 hour
  this.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);

  return resetToken;
};

export const User: Model<IUser> = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
