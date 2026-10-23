'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';
import { toast } from '@/components/ui/toast';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
  KeyRound,
  ShieldCheck,
  Check,
  X,
  AlertCircle,
} from 'lucide-react';

function ForgotPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { forgotPassword, verifyResetOtp, resetPassword, isAuthenticated } = useAuth();

  // If already logged in, redirect home
  useEffect(() => {
    if (isAuthenticated) {
      router.push('/');
    }
  }, [isAuthenticated, router]);

  // Steps: 1 = Request, 2 = Verify OTP, 3 = New Password, 4 = Success
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Form states
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // UI status
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Cooldown countdown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Read initial query params if user visited with preset email or step
  useEffect(() => {
    const emailParam = searchParams.get('email');
    const tokenParam = searchParams.get('token') || searchParams.get('resetToken');
    const stepParam = searchParams.get('step');

    if (emailParam) {
      setEmail(emailParam);
    }

    if (tokenParam) {
      setResetToken(tokenParam);
      setStep(3);
    } else if (stepParam === '2' && emailParam) {
      setStep(2);
    }
  }, [searchParams]);

  // Password rules validation
  const hasMinLength = newPassword.length >= 8;
  const hasUppercase = /[A-Z]/.test(newPassword);
  const hasLowercase = /[a-z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const isPasswordValid = hasMinLength && hasUppercase && hasLowercase && hasNumber && passwordsMatch;

  // Step 1: Send OTP
  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatusMessage(null);

    const cleanEmail = email.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setError('Please provide a valid email address');
      return;
    }

    setLoading(true);
    const result = await forgotPassword(cleanEmail);
    setLoading(false);

    if (result.success) {
      setStatusMessage(
        result.message ||
          'If an account exists with that email, password reset instructions and a verification code have been sent.'
      );
      setResendCooldown(60);
      setStep(2);
      toast.success('Verification code dispatched to your email.');
    } else {
      if (result.retryAfterSeconds) {
        setResendCooldown(result.retryAfterSeconds);
      }
      setError(result.error || 'Failed to request reset code');
    }
  };

  // Step 2: Resend OTP
  const handleResendOtp = async () => {
    if (resendCooldown > 0 || loading) return;
    setError(null);
    setLoading(true);

    const result = await forgotPassword(email.trim());
    setLoading(false);

    if (result.success) {
      setResendCooldown(60);
      toast.success('New verification code sent to your email.');
    } else {
      if (result.retryAfterSeconds) {
        setResendCooldown(result.retryAfterSeconds);
      }
      setError(result.error || 'Failed to resend verification code');
    }
  };

  // Step 2: Verify OTP
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanOtp = otp.trim();
    if (!/^\d{6}$/.test(cleanOtp)) {
      setError('Please enter a 6-digit verification code');
      return;
    }

    setLoading(true);
    const result = await verifyResetOtp(email.trim(), cleanOtp);
    setLoading(false);

    if (result.success) {
      if (result.resetToken) {
        setResetToken(result.resetToken);
      }
      toast.success('Code confirmed. You can now set your new password.');
      setStep(3);
    } else {
      setError(result.error || 'Invalid or expired verification code');
    }
  };

  // Step 3: Save New Password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isPasswordValid) {
      setError('Please satisfy all password complexity criteria before proceeding');
      return;
    }

    setLoading(true);
    const result = await resetPassword({
      token: resetToken || undefined,
      resetToken: resetToken || undefined,
      email: email.trim(),
      otp: otp.trim() || undefined,
      newPassword,
    });
    setLoading(false);

    if (result.success) {
      toast.success('Password updated successfully!');
      setStep(4);
    } else {
      setError(result.error || 'Failed to reset password');
    }
  };

  return (
    <div className="flex items-center justify-center w-full">
      <Card className="w-full max-w-md shadow-2xl border-border/60">
        {/* ================= STEP 1: REQUEST CODE ================= */}
        {step === 1 && (
          <form onSubmit={handleRequestOtp}>
            <CardHeader className="space-y-2 text-center pb-6">
              <div className="flex justify-center mb-2">
                <Logo height={48} className="h-12 w-auto" />
              </div>
              <CardTitle className="text-2xl font-bold tracking-tight">Forgot Password?</CardTitle>
              <CardDescription className="text-sm">
                Enter your registered email address to receive a 6-digit verification code.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {error && (
                <div className="rounded-lg bg-destructive/15 border border-destructive/20 p-3 text-xs text-destructive font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <input
                    type="email"
                    placeholder="name@example.com"
                    className="flex h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </div>
              </div>

              <div className="rounded-lg bg-muted/40 border border-border/40 p-3 text-xs text-muted-foreground">
                <p className="flex items-start gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <span>
                    A single-use 6-digit verification code expiring in 10 minutes will be generated and dispatched securely.
                  </span>
                </p>
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-3 pt-2">
              <Button type="submit" className="w-full gap-2" disabled={loading}>
                {loading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Sending Code...</span>
                  </>
                ) : (
                  <>
                    <span>Send Verification Code</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>

              <Link
                href="/login"
                className="text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 py-1"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back to Sign In</span>
              </Link>
            </CardFooter>
          </form>
        )}

        {/* ================= STEP 2: ENTER OTP ================= */}
        {step === 2 && (
          <form onSubmit={handleVerifyOtp}>
            <CardHeader className="space-y-2 text-center pb-6">
              <div className="flex justify-center mb-2">
                <Logo height={48} className="h-12 w-auto" />
              </div>
              <CardTitle className="text-2xl font-bold tracking-tight">Enter Verification Code</CardTitle>
              <CardDescription className="text-sm">
                We sent a 6-digit code to <strong className="text-foreground">{email}</strong>.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {error && (
                <div className="rounded-lg bg-destructive/15 border border-destructive/20 p-3 text-xs text-destructive font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {statusMessage && (
                <div className="rounded-lg bg-primary/10 border border-primary/20 p-3 text-xs text-primary font-medium">
                  {statusMessage}
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    6-Digit Code
                  </label>
                  <span className="text-xs text-amber-500 font-medium">Expires in 10 minutes</span>
                </div>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder="123456"
                    className="flex h-11 w-full rounded-lg border border-input bg-background pl-9 pr-3 py-2 text-center text-lg tracking-[0.35em] font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    autoComplete="one-time-code"
                    autoFocus
                    required
                  />
                </div>
              </div>

              <div className="flex items-center justify-between text-xs pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStep(1);
                  }}
                  className="text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <ArrowLeft className="h-3 w-3" />
                  <span>Change email</span>
                </button>

                <button
                  type="button"
                  disabled={resendCooldown > 0 || loading}
                  onClick={handleResendOtp}
                  className={`font-medium ${
                    resendCooldown > 0
                      ? 'text-muted-foreground cursor-not-allowed'
                      : 'text-primary hover:underline'
                  }`}
                >
                  {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend Code'}
                </button>
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-3 pt-2">
              <Button type="submit" className="w-full gap-2" disabled={loading || otp.trim().length !== 6}>
                {loading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Verifying Code...</span>
                  </>
                ) : (
                  <>
                    <span>Verify Code</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>

              <Link
                href="/login"
                className="text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 py-1"
              >
                <span>Cancel and return to Sign In</span>
              </Link>
            </CardFooter>
          </form>
        )}

        {/* ================= STEP 3: NEW PASSWORD ================= */}
        {step === 3 && (
          <form onSubmit={handleResetPassword}>
            <CardHeader className="space-y-2 text-center pb-6">
              <div className="flex justify-center mb-2">
                <Logo height={48} className="h-12 w-auto" />
              </div>
              <CardTitle className="text-2xl font-bold tracking-tight">Set New Password</CardTitle>
              <CardDescription className="text-sm">
                Create a strong, unique password for your financial workspace.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              {error && (
                <div className="rounded-lg bg-destructive/15 border border-destructive/20 p-3 text-xs text-destructive font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* New Password */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  New Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter new password"
                    className="flex h-10 w-full rounded-lg border border-input bg-background pl-9 pr-10 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="Re-enter new password"
                    className="flex h-10 w-full rounded-lg border border-input bg-background pl-9 pr-10 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Password Requirements Checklist */}
              <div className="rounded-lg bg-muted/40 border border-border/50 p-3 space-y-1.5 text-xs">
                <p className="font-semibold text-foreground/80 mb-1">Password Requirements:</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                  <div className={`flex items-center gap-1.5 ${hasMinLength ? 'text-emerald-500 font-medium' : 'text-muted-foreground'}`}>
                    {hasMinLength ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                    <span>At least 8 characters</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${hasUppercase ? 'text-emerald-500 font-medium' : 'text-muted-foreground'}`}>
                    {hasUppercase ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                    <span>One uppercase letter</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${hasLowercase ? 'text-emerald-500 font-medium' : 'text-muted-foreground'}`}>
                    {hasLowercase ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                    <span>One lowercase letter</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${hasNumber ? 'text-emerald-500 font-medium' : 'text-muted-foreground'}`}>
                    {hasNumber ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                    <span>One number</span>
                  </div>
                  <div className={`flex items-center gap-1.5 col-span-full ${passwordsMatch ? 'text-emerald-500 font-medium' : 'text-muted-foreground'}`}>
                    {passwordsMatch ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                    <span>Passwords match</span>
                  </div>
                </div>
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-3 pt-2">
              <Button type="submit" className="w-full gap-2" disabled={loading || !isPasswordValid}>
                {loading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Updating Password...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4" />
                    <span>Reset Password</span>
                  </>
                )}
              </Button>

              <Link
                href="/login"
                className="text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 py-1"
              >
                <span>Cancel and return to Sign In</span>
              </Link>
            </CardFooter>
          </form>
        )}

        {/* ================= STEP 4: SUCCESS ================= */}
        {step === 4 && (
          <div>
            <CardHeader className="space-y-3 text-center pb-6">
              <div className="flex justify-center mb-2">
                <Logo height={48} className="h-12 w-auto" />
              </div>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <CardTitle className="text-2xl font-bold tracking-tight">Password Reset Complete</CardTitle>
              <CardDescription className="text-sm max-w-sm mx-auto">
                Your password has been successfully updated. All prior active sessions have been invalidated for security.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="rounded-lg bg-muted/40 border border-border/40 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-semibold text-foreground/80">Security Notice:</p>
                <p>You can now sign in to your account with your new password across all devices.</p>
              </div>
            </CardContent>

            <CardFooter className="pt-2">
              <Button className="w-full gap-2" onClick={() => router.push('/login')}>
                <span>Sign In with New Password</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </CardFooter>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[50vh]">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <ForgotPasswordContent />
    </Suspense>
  );
}
