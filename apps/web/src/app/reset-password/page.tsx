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
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  Check,
  X,
  AlertCircle,
} from 'lucide-react';

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { resetPassword, isAuthenticated } = useAuth();

  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // If already logged in, redirect
  useEffect(() => {
    if (isAuthenticated) {
      router.push('/');
    }
  }, [isAuthenticated, router]);

  useEffect(() => {
    const tokenParam = searchParams.get('token') || searchParams.get('resetToken');
    const emailParam = searchParams.get('email');

    if (tokenParam) {
      setToken(tokenParam);
    }
    if (emailParam) {
      setEmail(emailParam);
    }

    // If neither token nor email is provided, redirect to /forgot-password
    if (!tokenParam && !emailParam) {
      router.replace('/forgot-password');
    }
  }, [searchParams, router]);

  // Password rules validation
  const hasMinLength = newPassword.length >= 8;
  const hasUppercase = /[A-Z]/.test(newPassword);
  const hasLowercase = /[a-z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const isPasswordValid = hasMinLength && hasUppercase && hasLowercase && hasNumber && passwordsMatch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isPasswordValid) {
      setError('Please satisfy all password complexity criteria before proceeding');
      return;
    }

    setLoading(true);
    const result = await resetPassword({
      token: token || undefined,
      resetToken: token || undefined,
      email: email ? email.trim() : undefined,
      newPassword,
    });
    setLoading(false);

    if (result.success) {
      toast.success('Password updated successfully!');
      setSuccess(true);
    } else {
      setError(result.error || 'Failed to reset password. The link may be invalid or expired.');
    }
  };

  if (success) {
    return (
      <div className="flex items-center justify-center w-full">
        <Card className="w-full max-w-md shadow-2xl border-border/60">
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
              <p>You can now sign in to your account with your new password.</p>
            </div>
          </CardContent>

          <CardFooter className="pt-2">
            <Button className="w-full gap-2" onClick={() => router.push('/login')}>
              <span>Sign In with New Password</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center w-full">
      <Card className="w-full max-w-md shadow-2xl border-border/60">
        <form onSubmit={handleSubmit}>
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
              href="/forgot-password"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 py-1"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Request Reset Code</span>
            </Link>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[50vh]">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
