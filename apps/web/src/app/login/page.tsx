'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Coins, Eye, EyeOff, Lock, Mail, ArrowRight, ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/ui/logo';

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);

  // If already logged in, redirect
  React.useEffect(() => {
    if (isAuthenticated) {
      router.push('/');
    }
  }, [isAuthenticated, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setUnverifiedEmail(null);

    if (!email || !password) {
      setError('Please provide both email and password');
      return;
    }

    setLoading(true);
    const result = await login(email, password);
    setLoading(false);

    if (result.success) {
      router.push('/');
    } else {
      if (result.code === 'EMAIL_NOT_VERIFIED' || result.data?.requiresVerification) {
        setUnverifiedEmail(email);
        setError(result.error || 'Your email has not been verified yet.');
      } else {
        setError(result.error || 'Invalid credentials');
      }
    }
  };

  return (
    <div className="flex items-center justify-center w-full">
      <Card className="w-full max-w-md shadow-2xl border-border/60">
        <CardHeader className="space-y-2 text-center pb-6">
          <div className="flex justify-center mb-2">
            <Logo height={48} className="h-12 w-auto" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Sign in to M12 Expense Tracker</CardTitle>
          <CardDescription className="text-sm">
            Enter your credentials to access your financial dashboard
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <div className="rounded-lg bg-destructive/15 border border-destructive/20 p-3 text-xs text-destructive font-medium">
                {error}
              </div>
            )}

            {unverifiedEmail && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-500 flex flex-col gap-2">
                <p className="font-medium">Verification required before sign-in.</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="text-xs border-amber-500/40 text-amber-400 hover:bg-amber-500/20 w-fit"
                  onClick={() => router.push(`/register?step=2&email=${encodeURIComponent(unverifiedEmail)}`)}
                >
                  Verify Email Now
                </Button>
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

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-primary font-semibold hover:underline"
                >
                  Forgot Password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  className="flex h-10 w-full rounded-lg border border-input bg-background pl-9 pr-10 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
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

            <Button type="submit" className="w-full mt-2 gap-2" isLoading={loading}>
              Sign In
              <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>

          <CardFooter className="flex flex-col space-y-4 text-center border-t border-border pt-4 text-xs text-muted-foreground">
            <div>
              Don&apos;t have an account yet?{' '}
              <Link href="/register" className="text-primary font-semibold hover:underline">
                Create one now
              </Link>
            </div>
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground/80">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
              Secured with bcrypt password cryptography & HTTP-only cookies
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
