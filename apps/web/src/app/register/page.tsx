'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Logo } from '@/components/ui/logo';
import { toast } from '@/components/ui/toast';
import {
  Coins,
  Eye,
  EyeOff,
  Lock,
  Mail,
  User,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Check,
  X,
  Wallet,
  CreditCard as CreditCardIcon,
  Layers,
  Landmark,
  Plus,
  Trash2,
  RefreshCw,
  AlertCircle,
  PiggyBank,
  Receipt,
  Repeat,
  Percent,
  TrendingUp,
  Info,
} from 'lucide-react';
import {
  SUPPORTED_CURRENCIES,
  AccountType,
  CreditCardNetwork,
  ModulePreferences,
  DEFAULT_MODULE_PREFERENCES,
} from '@finora/shared';

interface OnboardingBankAccount {
  accountName: string;
  bankName: string;
  accountType: AccountType;
  openingBalance: number;
  accountNumberMasked?: string;
}

interface OnboardingCreditCard {
  cardNickname: string;
  issuingBank: string;
  network: CreditCardNetwork;
  creditLimit: number;
  currentOutstanding: number;
  billingCycleClosingDay: number;
  paymentDueDay: number;
}

const MODULE_DEFINITIONS: {
  key: keyof ModulePreferences;
  title: string;
  description: string;
  icon: React.ElementType;
}[] = [
  {
    key: 'expenseTracker',
    title: 'Expense Tracker',
    description: 'Record daily income, expenses, view monthly cash flow and balance summaries.',
    icon: Receipt,
  },
  {
    key: 'emi',
    title: 'EMI Management',
    description: 'Track loan EMIs, installment schedules, advance closures and upcoming due dates.',
    icon: Percent,
  },
  {
    key: 'lendingBorrowing',
    title: 'Lending & Borrowing',
    description: 'Manage debts, receivables, contacts and settlement logs with repayment status.',
    icon: PiggyBank,
  },
  {
    key: 'budget',
    title: 'Budget Management',
    description: 'Set monthly budget limits for spending categories and receive pace warnings.',
    icon: Layers,
  },
  {
    key: 'recurringTransactions',
    title: 'Recurring Transactions',
    description: 'Automate subscriptions, recurring bill forecasts, and scheduled auto-debits.',
    icon: Repeat,
  },
  {
    key: 'creditCards',
    title: 'Credit Card Management',
    description: 'Track credit limits, card outstandings, billing cycles and bill repayments.',
    icon: CreditCardIcon,
  },
  {
    key: 'chitFund',
    title: 'Chit Fund Management',
    description: 'Maintain chit funds, monthly auction bidding, member dividends, and collections.',
    icon: Landmark,
  },
  {
    key: 'investment',
    title: 'Investments',
    description: 'Track mutual funds, stocks, gold, and external chit funds.',
    icon: TrendingUp,
  },
];

function RegisterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { register, verifyOtp, resendOtp, finishOnboarding, isAuthenticated } = useAuth();

  // Multi-step state: 1 (Register) -> 2 (OTP) -> 3 (Modules) -> 4 (Bank) -> 5 (Credit Card) -> 6 (Review)
  const [step, setStep] = useState<number>(1);

  // Step 1: Account info
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [showPassword, setShowPassword] = useState(false);

  // Step 2: OTP info
  const [otp, setOtp] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resending, setResending] = useState(false);

  // Step 3: Module Preferences
  const [modulePreferences, setModulePreferences] = useState<ModulePreferences>({
    ...DEFAULT_MODULE_PREFERENCES,
  });

  // Step 4: Bank Accounts
  const [bankAccounts, setBankAccounts] = useState<OnboardingBankAccount[]>([]);
  const [newBankName, setNewBankName] = useState('');
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountType, setNewAccountType] = useState<AccountType>(AccountType.SAVINGS);
  const [newOpeningBalance, setNewOpeningBalance] = useState<string>('0');
  const [newMaskedNumber, setNewMaskedNumber] = useState('');

  // Step 5: Credit Cards
  const [creditCards, setCreditCards] = useState<OnboardingCreditCard[]>([]);
  const [newCardNickname, setNewCardNickname] = useState('');
  const [newIssuingBank, setNewIssuingBank] = useState('');
  const [newNetwork, setNewNetwork] = useState<CreditCardNetwork>(CreditCardNetwork.VISA);
  const [newCreditLimit, setNewCreditLimit] = useState<string>('50000');
  const [newOutstanding, setNewOutstanding] = useState<string>('0');
  const [newClosingDay, setNewClosingDay] = useState<number>(1);
  const [newDueDay, setNewDueDay] = useState<number>(20);

  // Global UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Handle query params on mount (e.g. ?step=2&email=user@example.com from Login redirect)
  useEffect(() => {
    const stepParam = searchParams.get('step');
    const emailParam = searchParams.get('email');
    if (emailParam) {
      setEmail(emailParam);
    }
    if (stepParam === '2' || stepParam === 'otp') {
      setStep(2);
      // When arriving via redirect from login, allow requesting a code immediately
      setResendCooldown(0);
    }
  }, [searchParams]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Password validation
  const hasMinLength = password.length >= 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const isStep1Valid =
    fullName.trim().length >= 2 &&
    email.includes('@') &&
    hasMinLength &&
    hasUppercase &&
    hasLowercase &&
    hasNumber &&
    passwordsMatch;

  // Step 1: Submit Registration
  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isStep1Valid) {
      setError('Please resolve all registration and password requirements.');
      return;
    }

    setLoading(true);
    const result = await register({
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      password,
      currency,
      requireVerification: true,
      onboarding: true,
    });
    setLoading(false);

    if (result.success) {
      setStep(2);
      setResendCooldown(60);
      toast.success('Account created! A 6-digit verification code has been dispatched to your email.');
    } else {
      setError(result.error || 'Failed to initiate registration.');
    }
  };

  // Step 2: Verify OTP
  const handleVerifyOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!otp || otp.trim().length < 6) {
      setError('Please enter the full 6-digit numeric verification code.');
      return;
    }

    setLoading(true);
    const result = await verifyOtp(email.trim().toLowerCase(), otp.trim());
    setLoading(false);

    if (result.success) {
      toast.success('Email successfully verified!');
      setStep(3);
    } else {
      setError(result.error || 'Verification code failed. Please try again.');
    }
  };

  // Resend OTP
  const handleResendOtp = async () => {
    if (resendCooldown > 0 || resending) return;
    setResending(true);
    setError(null);
    const result = await resendOtp(email.trim().toLowerCase());
    setResending(false);
    if (result.success) {
      setResendCooldown(60);
      toast.success('Fresh verification code sent!');
    } else {
      if (result.retryAfterSeconds) {
        setResendCooldown(result.retryAfterSeconds);
      }
      setError(result.error || 'Failed to resend code.');
    }
  };

  // Step 4: Add Bank Account
  const handleAddBankAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBankName.trim() || !newAccountName.trim()) {
      toast.error('Bank Name and Account Name are required');
      return;
    }
    const balanceNum = parseFloat(newOpeningBalance) || 0;
    if (balanceNum < 0) {
      toast.error('Opening balance cannot be negative');
      return;
    }

    const newAcc: OnboardingBankAccount = {
      bankName: newBankName.trim(),
      accountName: newAccountName.trim(),
      accountType: newAccountType,
      openingBalance: balanceNum,
      accountNumberMasked: newMaskedNumber.trim() || undefined,
    };

    setBankAccounts([...bankAccounts, newAcc]);
    setNewAccountName('');
    setNewBankName('');
    setNewOpeningBalance('0');
    setNewMaskedNumber('');
    toast.success(`Added ${newAcc.accountName}`);
  };

  const handleRemoveBankAccount = (index: number) => {
    setBankAccounts(bankAccounts.filter((_, i) => i !== index));
  };

  // Step 5: Add Credit Card
  const handleAddCreditCard = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCardNickname.trim() || !newIssuingBank.trim()) {
      toast.error('Card Nickname and Issuing Bank are required');
      return;
    }
    const limitNum = parseFloat(newCreditLimit) || 0;
    if (limitNum <= 0) {
      toast.error('Credit limit must be greater than 0');
      return;
    }
    const outstandingNum = parseFloat(newOutstanding) || 0;

    const newCard: OnboardingCreditCard = {
      cardNickname: newCardNickname.trim(),
      issuingBank: newIssuingBank.trim(),
      network: newNetwork,
      creditLimit: limitNum,
      currentOutstanding: outstandingNum,
      billingCycleClosingDay: newClosingDay,
      paymentDueDay: newDueDay,
    };

    setCreditCards([...creditCards, newCard]);
    setNewCardNickname('');
    setNewIssuingBank('');
    setNewCreditLimit('50000');
    setNewOutstanding('0');
    toast.success(`Added ${newCard.cardNickname}`);
  };

  const handleRemoveCreditCard = (index: number) => {
    setCreditCards(creditCards.filter((_, i) => i !== index));
  };

  // Step 6: Final Submission
  const handleFinishOnboarding = async () => {
    setLoading(true);
    setError(null);

    const payload = {
      modulePreferences,
      bankAccounts,
      creditCards,
    };

    const result = await finishOnboarding(payload);
    setLoading(false);

    if (result.success) {
      toast.success('Workspace setup complete! Please sign in with your email and password.');
      router.push('/login');
    } else {
      setError(result.error || 'Failed to complete setup. Please retry.');
    }
  };

  return (
    <div className="flex min-h-[90vh] items-center justify-center p-4 py-8">
      <Card className="w-full max-w-2xl shadow-2xl border-border/60 bg-card">
        {/* Step Progress Bar */}
        <div className="px-6 pt-6 pb-2">
          <div className="flex items-center justify-between mb-3 text-xs font-medium text-muted-foreground">
            <span className="flex items-center gap-1.5 font-semibold text-foreground">
              Step {step} of 6
            </span>
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground/80">
              {step === 1 && '1. Account Creation'}
              {step === 2 && '2. Email OTP Verification'}
              {step === 3 && '3. Feature Modules'}
              {step === 4 && '4. Bank Accounts'}
              {step === 5 && '5. Credit Cards'}
              {step === 6 && '6. Review & Launch'}
            </span>
          </div>
          <div className="grid grid-cols-6 gap-1.5 h-1.5 w-full bg-muted/40 rounded-full overflow-hidden">
            {[1, 2, 3, 4, 5, 6].map((s) => (
              <div
                key={s}
                className={`h-full transition-all duration-300 ${
                  s <= step ? 'bg-primary' : 'bg-muted/20'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="mx-6 mt-4 rounded-lg bg-destructive/15 border border-destructive/20 p-3 text-xs text-destructive font-medium flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ---------------- STEP 1: CREATE ACCOUNT ---------------- */}
        {step === 1 && (
          <form onSubmit={handleRegisterSubmit}>
            <CardHeader className="text-center pb-4 pt-2">
              <div className="flex justify-center mb-3">
                <Logo height={48} className="h-12 w-auto" />
              </div>
              <CardTitle className="text-xl font-bold tracking-tight">Create M12 Expense Tracker Account</CardTitle>
              <CardDescription className="text-xs">
                Set up your personal financial workspace with isolated cryptographic tokens
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-3.5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground">Full Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="e.g. Rahul Sharma"
                      className="flex h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input
                      type="email"
                      placeholder="name@example.com"
                      className="flex h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground">Default Currency</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} ({c.symbol}) — {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      className="flex h-9 w-full rounded-lg border border-input bg-background pl-9 pr-8 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground">Confirm Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      className="flex h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Password checks */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px]">
                <div className={`flex items-center gap-1 ${hasMinLength ? 'text-emerald-500 font-medium' : 'text-muted-foreground'}`}>
                  {hasMinLength ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                  8+ chars
                </div>
                <div className={`flex items-center gap-1 ${hasUppercase ? 'text-emerald-500 font-medium' : 'text-muted-foreground'}`}>
                  {hasUppercase ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                  1 uppercase
                </div>
                <div className={`flex items-center gap-1 ${hasNumber ? 'text-emerald-500 font-medium' : 'text-muted-foreground'}`}>
                  {hasNumber ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                  1 number
                </div>
                <div className={`flex items-center gap-1 ${passwordsMatch ? 'text-emerald-500 font-medium' : 'text-muted-foreground'}`}>
                  {passwordsMatch ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                  Passwords match
                </div>
              </div>
            </CardContent>

            <CardFooter className="flex flex-col space-y-3 pt-2">
              <Button type="submit" className="w-full gap-2" isLoading={loading} disabled={!isStep1Valid}>
                Continue to Email Verification
                <ArrowRight className="h-4 w-4" />
              </Button>
              <div className="text-center text-xs text-muted-foreground">
                Already have an account?{' '}
                <Link href="/login" className="text-primary font-semibold hover:underline">
                  Sign In
                </Link>
              </div>
            </CardFooter>
          </form>
        )}

        {/* ---------------- STEP 2: EMAIL OTP VERIFICATION ---------------- */}
        {step === 2 && (
          <form onSubmit={handleVerifyOtpSubmit}>
            <CardHeader className="text-center pb-4 pt-2">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-2">
                <Mail className="h-6 w-6" />
              </div>
              <CardTitle className="text-xl font-bold tracking-tight">Verify Your Email Address</CardTitle>
              <CardDescription className="text-xs max-w-sm mx-auto">
                We sent a 6-digit confirmation code to{' '}
                <span className="font-semibold text-foreground">{email}</span>. Please enter it below.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-center">
                  <input
                    type="text"
                    maxLength={6}
                    placeholder="123456"
                    className="h-12 w-48 text-center text-2xl font-mono tracking-[0.35em] rounded-lg border-2 border-input bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary font-bold"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    autoFocus
                    required
                  />
                </div>
                <p className="text-[11px] text-center text-muted-foreground">
                  The code expires in 10 minutes. Check your inbox and spam folder.
                </p>
              </div>

              <div className="flex items-center justify-center gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={resendCooldown > 0 || resending}
                  onClick={handleResendOtp}
                  className="text-xs gap-1.5"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${resending ? 'animate-spin' : ''}`} />
                  {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend Code'}
                </Button>
              </div>
            </CardContent>

            <CardFooter className="flex flex-col space-y-3 pt-2">
              <Button type="submit" className="w-full gap-2" isLoading={loading} disabled={otp.length !== 6}>
                Verify Code & Continue
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStep(1)}
                className="text-xs text-muted-foreground hover:text-foreground gap-1"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to Account Details
              </Button>
            </CardFooter>
          </form>
        )}

        {/* ---------------- STEP 3: MODULE SELECTION ---------------- */}
        {step === 3 && (
          <div>
            <CardHeader className="text-center pb-4 pt-2">
              <CardTitle className="text-xl font-bold tracking-tight">Welcome to M12 Expense Tracker</CardTitle>
              <CardDescription className="text-xs max-w-md mx-auto">
                Your money, organized in one place. Set up your accounts, choose the tools you need, and start
                tracking your financial life with clarity.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground mb-0.5">Select modules for your workspace</p>
                <p className="text-[11px]">
                  All modules are enabled by default. You can enable or disable any module anytime later in Settings.
                </p>
              </div>

              <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                {MODULE_DEFINITIONS.map((mod) => {
                  const Icon = mod.icon;
                  const isEnabled = modulePreferences[mod.key] !== false;
                  return (
                    <div
                      key={mod.key}
                      onClick={() =>
                        setModulePreferences({
                          ...modulePreferences,
                          [mod.key]: !isEnabled,
                        })
                      }
                      className={`flex items-start justify-between p-3 rounded-lg border transition-all cursor-pointer ${
                        isEnabled
                          ? 'border-primary/40 bg-primary/5 shadow-xs'
                          : 'border-border/60 bg-muted/20 opacity-70 hover:opacity-100'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`p-2 rounded-md shrink-0 mt-0.5 ${
                            isEnabled ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-foreground">{mod.title}</span>
                            {isEnabled && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-primary/30 text-primary">
                                Active
                              </Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{mod.description}</p>
                          {mod.key === 'chitFund' && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="mt-2.5 p-2.5 rounded-md bg-muted/60 border border-border/70 text-[11px] text-muted-foreground leading-relaxed flex items-start gap-2 cursor-default select-text"
                            >
                              <Info className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                              <span>
                                <strong className="text-foreground font-medium">For internal chit fund management:</strong>{' '}
                                Enable this feature only if you manage a group-based chit fund and track its collections, payouts, and related money in your own bank account. If you only want to track your personal income and expenses, you generally do not need to enable it.
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 ml-3 mt-1">
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={() => {}}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>

            <CardFooter className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStep(2)}
                className="text-xs text-muted-foreground gap-1"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setStep(4)}
                  className="text-xs"
                >
                  Skip for Now
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setStep(4)}
                  className="text-xs gap-1.5"
                >
                  Continue <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardFooter>
          </div>
        )}

        {/* ---------------- STEP 4: BANK ACCOUNTS ---------------- */}
        {step === 4 && (
          <div>
            <CardHeader className="text-center pb-3 pt-2">
              <CardTitle className="text-xl font-bold tracking-tight">Set Up Bank Accounts</CardTitle>
              <CardDescription className="text-xs max-w-md mx-auto">
                Add your primary savings, salary, or current accounts with their current balances. You can add more later.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* Form to add an account */}
              <div className="rounded-lg border border-border/80 bg-muted/20 p-3.5 space-y-3">
                <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Plus className="h-3.5 w-3.5 text-primary" /> Add a Bank Account
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">Account Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Salary Account"
                      value={newAccountName}
                      onChange={(e) => setNewAccountName(e.target.value)}
                      className="flex h-8 w-full rounded border border-input bg-background px-2.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">Bank Name</label>
                    <input
                      type="text"
                      placeholder="e.g. HDFC Bank"
                      value={newBankName}
                      onChange={(e) => setNewBankName(e.target.value)}
                      className="flex h-8 w-full rounded border border-input bg-background px-2.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">Account Type</label>
                    <select
                      value={newAccountType}
                      onChange={(e) => setNewAccountType(e.target.value as AccountType)}
                      className="flex h-8 w-full rounded border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value={AccountType.SAVINGS}>Savings</option>
                      <option value={AccountType.CURRENT}>Current</option>
                      <option value={AccountType.SALARY}>Salary</option>
                      <option value={AccountType.CASH}>Cash in Hand</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">Opening Balance (₹)</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      placeholder="0.00"
                      value={newOpeningBalance}
                      onChange={(e) => setNewOpeningBalance(e.target.value)}
                      className="flex h-8 w-full rounded border border-input bg-background px-2.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div className="w-1/2 pr-2">
                    <input
                      type="text"
                      placeholder="Masked No. (e.g. •••• 4589)"
                      value={newMaskedNumber}
                      onChange={(e) => setNewMaskedNumber(e.target.value)}
                      className="flex h-8 w-full rounded border border-input bg-background px-2.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleAddBankAccount}
                    className="text-xs h-8 gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Account
                  </Button>
                </div>
              </div>

              {/* Summary List of Added Accounts */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-medium text-muted-foreground px-0.5">
                  <span>Configured Accounts ({bankAccounts.length})</span>
                  {bankAccounts.length > 0 && (
                    <span className="font-mono text-foreground font-semibold">
                      Total: ₹
                      {bankAccounts
                        .reduce((sum, a) => sum + a.openingBalance, 0)
                        .toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </div>

                {bankAccounts.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    No bank accounts added yet. You can add accounts above or skip this step.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                    {bankAccounts.map((acc, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-card text-xs"
                      >
                        <div className="flex items-center gap-2.5">
                          <Wallet className="h-4 w-4 text-primary shrink-0" />
                          <div>
                            <span className="font-semibold text-foreground">{acc.accountName}</span>
                            <span className="text-muted-foreground ml-1.5">
                              ({acc.bankName} • {acc.accountType})
                            </span>
                            {acc.accountNumberMasked && (
                              <span className="text-muted-foreground/70 ml-1 font-mono">
                                {acc.accountNumberMasked}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono font-semibold text-foreground">
                            ₹{acc.openingBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRemoveBankAccount(idx)}
                            className="text-muted-foreground hover:text-destructive transition-colors p-1"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>

            <CardFooter className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStep(3)}
                className="text-xs text-muted-foreground gap-1"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setStep(5)}
                  className="text-xs"
                >
                  Skip for Now
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setStep(5)}
                  className="text-xs gap-1.5"
                >
                  Continue <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardFooter>
          </div>
        )}

        {/* ---------------- STEP 5: CREDIT CARDS ---------------- */}
        {step === 5 && (
          <div>
            <CardHeader className="text-center pb-3 pt-2">
              <CardTitle className="text-xl font-bold tracking-tight">Set Up Credit Cards</CardTitle>
              <CardDescription className="text-xs max-w-md mx-auto">
                Add your active credit cards to manage limits, billing cycles, and payment due dates.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {modulePreferences.creditCards === false && (
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-500">
                  <p className="font-medium">Credit Card module is currently disabled.</p>
                  <p className="text-[11px] text-amber-500/80 mt-0.5">
                    You can skip this step, or add cards and enable the module later from Settings.
                  </p>
                </div>
              )}

              {/* Form to add a card */}
              <div className="rounded-lg border border-border/80 bg-muted/20 p-3.5 space-y-3">
                <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Plus className="h-3.5 w-3.5 text-primary" /> Add a Credit Card
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">Card Nickname</label>
                    <input
                      type="text"
                      placeholder="e.g. Regalia Gold"
                      value={newCardNickname}
                      onChange={(e) => setNewCardNickname(e.target.value)}
                      className="flex h-8 w-full rounded border border-input bg-background px-2.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">Issuing Bank</label>
                    <input
                      type="text"
                      placeholder="e.g. HDFC"
                      value={newIssuingBank}
                      onChange={(e) => setNewIssuingBank(e.target.value)}
                      className="flex h-8 w-full rounded border border-input bg-background px-2.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">Network</label>
                    <select
                      value={newNetwork}
                      onChange={(e) => setNewNetwork(e.target.value as CreditCardNetwork)}
                      className="flex h-8 w-full rounded border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value={CreditCardNetwork.VISA}>Visa</option>
                      <option value={CreditCardNetwork.MASTERCARD}>Mastercard</option>
                      <option value={CreditCardNetwork.RUPAY}>RuPay</option>
                      <option value={CreditCardNetwork.AMEX}>Amex</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">Credit Limit (₹)</label>
                    <input
                      type="number"
                      step="any"
                      min="1"
                      placeholder="50000"
                      value={newCreditLimit}
                      onChange={(e) => setNewCreditLimit(e.target.value)}
                      className="flex h-8 w-full rounded border border-input bg-background px-2.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">Current Due (₹)</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      placeholder="0.00"
                      value={newOutstanding}
                      onChange={(e) => setNewOutstanding(e.target.value)}
                      className="flex h-8 w-full rounded border border-input bg-background px-2.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">Closing Day (1-31)</label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={newClosingDay}
                      onChange={(e) => setNewClosingDay(parseInt(e.target.value) || 1)}
                      className="flex h-8 w-full rounded border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">Due Day (1-31)</label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={newDueDay}
                      onChange={(e) => setNewDueDay(parseInt(e.target.value) || 20)}
                      className="flex h-8 w-full rounded border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleAddCreditCard}
                    className="text-xs h-8 gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Credit Card
                  </Button>
                </div>
              </div>

              {/* Summary of Cards Added */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-medium text-muted-foreground px-0.5">
                  <span>Configured Credit Cards ({creditCards.length})</span>
                  {creditCards.length > 0 && (
                    <span className="font-mono text-foreground font-semibold">
                      Total Limit: ₹
                      {creditCards
                        .reduce((sum, c) => sum + c.creditLimit, 0)
                        .toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </div>

                {creditCards.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    No credit cards added yet. You can add cards above or skip this step.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                    {creditCards.map((card, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-card text-xs"
                      >
                        <div className="flex items-center gap-2.5">
                          <CreditCardIcon className="h-4 w-4 text-primary shrink-0" />
                          <div>
                            <span className="font-semibold text-foreground">{card.cardNickname}</span>
                            <span className="text-muted-foreground ml-1.5">
                              ({card.issuingBank} • {card.network})
                            </span>
                            <span className="text-muted-foreground/70 ml-1 text-[11px]">
                              Cycle: Day {card.billingCycleClosingDay} / Due Day {card.paymentDueDay}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2.5">
                          <div className="text-right">
                            <span className="font-mono font-semibold text-foreground block">
                              Limit: ₹{card.creditLimit.toLocaleString('en-IN')}
                            </span>
                            {card.currentOutstanding > 0 && (
                              <span className="text-[10px] text-destructive block">
                                Due: ₹{card.currentOutstanding.toLocaleString('en-IN')}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveCreditCard(idx)}
                            className="text-muted-foreground hover:text-destructive transition-colors p-1"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>

            <CardFooter className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStep(4)}
                className="text-xs text-muted-foreground gap-1"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setStep(6)}
                  className="text-xs"
                >
                  Skip for Now
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setStep(6)}
                  className="text-xs gap-1.5"
                >
                  Continue <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardFooter>
          </div>
        )}

        {/* ---------------- STEP 6: REVIEW & FINISH ---------------- */}
        {step === 6 && (
          <div>
            <CardHeader className="text-center pb-3 pt-2">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500 mb-2">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <CardTitle className="text-xl font-bold tracking-tight">Review & Finish Setup</CardTitle>
              <CardDescription className="text-xs max-w-md mx-auto">
                Everything is ready! Please review your configured workspace preferences before completing registration.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-3.5">
              {/* Account & Email Status */}
              <div className="rounded-lg border border-border p-3 bg-muted/20 flex items-center justify-between text-xs">
                <div>
                  <span className="font-semibold text-foreground block">{fullName}</span>
                  <span className="text-muted-foreground">{email}</span>
                </div>
                <div className="flex items-center gap-1.5 text-emerald-500 font-medium">
                  <Check className="h-4 w-4" /> Email Verified
                </div>
              </div>

              {/* Modules Summary */}
              <div className="rounded-lg border border-border p-3 bg-muted/20 text-xs space-y-1.5">
                <div className="flex items-center justify-between font-semibold">
                  <span className="text-foreground">Active Modules</span>
                  <Badge variant="outline" className="text-[10px]">
                    {Object.values(modulePreferences).filter((v) => v !== false).length} of {MODULE_DEFINITIONS.length} Enabled
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {MODULE_DEFINITIONS.map((m) => {
                    const active = modulePreferences[m.key] !== false;
                    return (
                      <span
                        key={m.key}
                        className={`text-[10px] px-2 py-0.5 rounded-md font-medium ${
                          active
                            ? 'bg-primary/10 text-primary border border-primary/20'
                            : 'bg-muted/50 text-muted-foreground line-through'
                        }`}
                      >
                        {m.title}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Bank Accounts Summary */}
              <div className="rounded-lg border border-border p-3 bg-muted/20 text-xs space-y-1">
                <div className="flex items-center justify-between font-semibold">
                  <span className="text-foreground">Bank Accounts</span>
                  <span className="text-muted-foreground font-normal">
                    {bankAccounts.length === 0 ? 'None (Skipped)' : `${bankAccounts.length} Account(s)`}
                  </span>
                </div>
                {bankAccounts.length > 0 && (
                  <p className="text-[11px] text-muted-foreground font-mono">
                    Total Initial Balance: ₹
                    {bankAccounts
                      .reduce((s, a) => s + a.openingBalance, 0)
                      .toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                )}
              </div>

              {/* Credit Cards Summary */}
              <div className="rounded-lg border border-border p-3 bg-muted/20 text-xs space-y-1">
                <div className="flex items-center justify-between font-semibold">
                  <span className="text-foreground">Credit Cards</span>
                  <span className="text-muted-foreground font-normal">
                    {creditCards.length === 0 ? 'None (Skipped)' : `${creditCards.length} Card(s)`}
                  </span>
                </div>
                {creditCards.length > 0 && (
                  <p className="text-[11px] text-muted-foreground font-mono">
                    Total Credit Limit: ₹
                    {creditCards
                      .reduce((s, c) => s + c.creditLimit, 0)
                      .toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                )}
              </div>
            </CardContent>

            <CardFooter className="flex items-center justify-between pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setStep(5)}
                className="text-xs text-muted-foreground gap-1"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleFinishOnboarding}
                isLoading={loading}
                className="text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                <Check className="h-3.5 w-3.5" /> Finish Setup & Proceed to Login
              </Button>
            </CardFooter>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[85vh] items-center justify-center p-4">Loading onboarding...</div>}>
      <RegisterContent />
    </Suspense>
  );
}
