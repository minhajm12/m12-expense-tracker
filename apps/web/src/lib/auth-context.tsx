'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { UserProfile } from '@finora/shared';
import { toast } from '@/components/ui/toast';
import {
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  getApiUrl,
  installAuthFetchInterceptor,
} from './api-client';

// Ensure fetch interceptor is active for all client-side requests
if (typeof window !== 'undefined') {
  installAuthFetchInterceptor();
}

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string; code?: string; data?: any }>;
  register: (data: {
    email: string;
    password: string;
    fullName: string;
    currency?: string;
    requireVerification?: boolean;
    onboarding?: boolean;
  }) => Promise<{ success: boolean; error?: string; code?: string; requiresVerification?: boolean; data?: any }>;
  verifyOtp: (email: string, otp: string) => Promise<{ success: boolean; error?: string; code?: string; data?: any }>;
  resendOtp: (email: string) => Promise<{ success: boolean; error?: string; code?: string; retryAfterSeconds?: number }>;
  finishOnboarding: (data: {
    modulePreferences?: any;
    bankAccounts?: any[];
    creditCards?: any[];
  }) => Promise<{ success: boolean; error?: string }>;
  forgotPassword: (email: string) => Promise<{ success: boolean; error?: string; retryAfterSeconds?: number; message?: string }>;
  verifyResetOtp: (email: string, otp: string) => Promise<{ success: boolean; error?: string; resetToken?: string }>;
  resetPassword: (data: {
    token?: string;
    resetToken?: string;
    email?: string;
    otp?: string;
    newPassword: string;
  }) => Promise<{ success: boolean; error?: string; message?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const inFlightRef = React.useRef(false);
  const lastRefreshTimeRef = React.useRef(0);

  const getApiUrl = () => {
    return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
  };

  const refreshUser = useCallback(async (force = false) => {
    const now = Date.now();
    // Throttle non-forced calls to at most once per 2 seconds to prevent rapid render loops
    if (!force && now - lastRefreshTimeRef.current < 2000) {
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    lastRefreshTimeRef.current = now;

    try {
      const token = getAuthToken();
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`${getApiUrl()}/api/v1/auth/me`, {
        method: 'GET',
        headers,
        credentials: 'include',
        cache: 'no-store',
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data?.user) {
          setUser(json.data.user);
          return;
        }
      } else if (res.status === 401 || res.status === 403) {
        // Explicitly unauthenticated or revoked credentials verified by server
        clearAuthToken();
        setUser(null);
      } else if (res.status === 429) {
        // Rate limited — do NOT log out! The user's token/session remains valid.
        console.warn('[Auth] Rate limited checking session status. Preserving active session.');
      }
      // On 5xx or transient errors, do not log user out if already authenticated
    } catch (err) {
      // Network drop or offline — preserve user session
      console.warn('[Auth] Network error checking auth status:', err);
    } finally {
      inFlightRef.current = false;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser(true);
  }, [refreshUser]);

  const login = async (email: string, password: string) => {
    if (inFlightRef.current) return { success: false, error: 'Request already in progress' };
    inFlightRef.current = true;
    setIsLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        // Extract token from real API response structure (top-level or inside data property)
        const token = json.token || json.data?.token;
        if (token && typeof token === 'string') {
          setAuthToken(token);
        }
        setUser(json.data?.user || json.data);
        toast.success(`Welcome back, ${json.data?.user?.fullName || 'User'}!`);
        return { success: true };
      } else {
        const msg = json.error?.message || 'Login failed';
        const code = json.error?.code;
        toast.error(msg);
        return { success: false, error: msg, code, data: json.data || json.error?.details };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error during login';
      toast.error(msg);
      return { success: false, error: msg, code: 'NETWORK_ERROR' };
    } finally {
      inFlightRef.current = false;
      setIsLoading(false);
    }
  };

  const register = async (data: {
    email: string;
    password: string;
    fullName: string;
    currency?: string;
    requireVerification?: boolean;
    onboarding?: boolean;
  }) => {
    if (inFlightRef.current) return { success: false, error: 'Request already in progress' };
    inFlightRef.current = true;
    setIsLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        const token = json.token || json.data?.token;
        if (token && typeof token === 'string') {
          setAuthToken(token);
        }
        if (json.data?.requiresVerification) {
          return { success: true, requiresVerification: true, data: json.data };
        }
        if (json.data?.user) {
          setUser(json.data.user);
          toast.success(`Account created! Welcome to M12 Expense Tracker, ${json.data.user.fullName}.`);
        }
        return { success: true, data: json.data };
      } else {
        const msg = json.error?.message || 'Registration failed';
        const code = json.error?.code;
        toast.error(msg);
        return { success: false, error: msg, code };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error during registration';
      toast.error(msg);
      return { success: false, error: msg, code: 'NETWORK_ERROR' };
    } finally {
      inFlightRef.current = false;
      setIsLoading(false);
    }
  };

  const verifyOtp = async (email: string, otp: string) => {
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, otp }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        const token = json.token || json.data?.token;
        if (token && typeof token === 'string') {
          setAuthToken(token);
        }
        if (json.data?.user) {
          setUser(json.data.user);
        }
        return { success: true, data: json.data };
      } else {
        const msg = json.error?.message || 'Verification failed';
        const code = json.error?.code;
        toast.error(msg);
        return { success: false, error: msg, code };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error during OTP verification';
      toast.error(msg);
      return { success: false, error: msg, code: 'NETWORK_ERROR' };
    }
  };

  const resendOtp = async (email: string) => {
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/auth/resend-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Verification code resent successfully.');
        return { success: true };
      } else {
        const msg = json.error?.message || 'Failed to resend verification code';
        const code = json.error?.code;
        const retryAfterSeconds = json.error?.details?.retryAfterSeconds || json.data?.retryAfterSeconds;
        toast.error(msg);
        return { success: false, error: msg, code, retryAfterSeconds };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error during code resend';
      toast.error(msg);
      return { success: false, error: msg, code: 'NETWORK_ERROR' };
    }
  };

  const finishOnboarding = async (data: {
    modulePreferences?: any;
    bankAccounts?: any[];
    creditCards?: any[];
  }) => {
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/auth/onboarding-finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        clearAuthToken();
        setUser(null); // Session cleared by backend requirement
        return { success: true };
      } else {
        const msg = json.error?.message || 'Failed to finish onboarding';
        return { success: false, error: msg };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error finishing onboarding';
      return { success: false, error: msg };
    }
  };

  const forgotPassword = async (email: string) => {
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        return { success: true, message: json.message };
      } else {
        const msg = json.error?.message || 'Failed to request password reset code';
        const retryAfterSeconds = json.error?.details?.retryAfterSeconds || json.data?.retryAfterSeconds;
        return { success: false, error: msg, retryAfterSeconds };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error during password reset request';
      return { success: false, error: msg };
    }
  };

  const verifyResetOtp = async (email: string, otp: string) => {
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/auth/verify-reset-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        return { success: true, resetToken: json.data?.resetToken };
      } else {
        const msg = json.error?.message || 'Failed to verify reset code';
        return { success: false, error: msg };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error during code verification';
      return { success: false, error: msg };
    }
  };

  const resetPassword = async (data: {
    token?: string;
    resetToken?: string;
    email?: string;
    otp?: string;
    newPassword: string;
  }) => {
    try {
      const res = await fetch(`${getApiUrl()}/api/v1/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        return { success: true, message: json.message };
      } else {
        const msg = json.error?.message || 'Failed to reset password';
        return { success: false, error: msg };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error during password reset';
      return { success: false, error: msg };
    }
  };

  const logout = async () => {
    try {
      await fetch(`${getApiUrl()}/api/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Ignore network failure on logout
    } finally {
      clearAuthToken();
      setUser(null);
      toast.info('You have been logged out.');
    }
  };

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
    login,
    register,
    verifyOtp,
    resendOtp,
    finishOnboarding,
    forgotPassword,
    verifyResetOtp,
    resetPassword,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
