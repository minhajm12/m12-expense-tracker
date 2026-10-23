'use client';

import React, { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { Sun, Moon, X, ArrowRight, ShieldCheck, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/ui/logo';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { ModuleGuard } from './module-guard';
import { useAuth } from '@/lib/auth-context';

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAuthenticated, isLoading } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isAuthPage =
    pathname === '/login' ||
    pathname === '/register' ||
    pathname === '/forgot-password' ||
    pathname === '/reset-password';

  // Handle protected route redirection for unauthenticated visitors
  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isAuthPage && pathname !== '/') {
      const redirectUrl = `/login?redirect=${encodeURIComponent(pathname)}`;
      router.replace(redirectUrl);
    }
  }, [isLoading, isAuthenticated, isAuthPage, pathname, router]);

  // Auth pages (login, register, forgot-password, reset-password)
  if (isAuthPage) {
    return (
      <div className="min-h-screen bg-background flex flex-col justify-between">
        {/* Top-Right Theme Toggle Header */}
        <header className="w-full flex items-center justify-end p-4 md:p-6">
          {mounted && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="gap-2 text-xs rounded-full border-border bg-card/80 backdrop-blur-sm"
              title="Toggle color theme"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="h-4 w-4 text-amber-400" />
                  <span>Light Mode</span>
                </>
              ) : (
                <>
                  <Moon className="h-4 w-4 text-foreground" />
                  <span>Dark Mode</span>
                </>
              )}
            </Button>
          )}
        </header>

        {/* Centered Authentication Form */}
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-xl">{children}</div>
        </main>

        {/* Minimal Unauthenticated Footer */}
        <footer className="py-4 text-center text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} M12 Expense Tracker. Personal Finance Operating System.
        </footer>
      </div>
    );
  }

  // Loading state: avoid flashing authenticated sidebar/header
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <div className="flex flex-col items-center gap-4 animate-in fade-in-50 duration-300">
          <Logo height={44} />
          <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span>Loading M12 Expense Tracker...</span>
          </div>
        </div>
      </div>
    );
  }

  // Unauthenticated Public Landing Page (pathname === '/')
  if (!isAuthenticated && pathname === '/') {
    return (
      <div className="min-h-screen bg-background flex flex-col justify-between">
        {/* Public Navigation Header */}
        <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 hover:opacity-90 transition-opacity">
              <Logo height={32} />
            </Link>

            <div className="flex items-center gap-2 sm:gap-3">
              {mounted && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="rounded-full text-muted-foreground hover:text-foreground"
                  title="Toggle color theme"
                >
                  {theme === 'dark' ? (
                    <Sun className="h-4 w-4 text-amber-400" />
                  ) : (
                    <Moon className="h-4 w-4" />
                  )}
                </Button>
              )}

              <Link href="/login">
                <Button variant="ghost" size="sm" className="font-medium text-xs sm:text-sm">
                  Sign In
                </Button>
              </Link>

              <Link href="/register">
                <Button size="sm" className="font-medium text-xs sm:text-sm rounded-lg shadow-sm">
                  Get Started
                </Button>
              </Link>
            </div>
          </div>
        </header>

        {/* Public Content */}
        <main className="flex-1 w-full">{children}</main>

        {/* Public Footer */}
        <footer className="border-t border-border bg-card/40 py-8 px-4 text-center text-xs text-muted-foreground">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Logo height={24} />
              <span className="font-semibold text-foreground">M12 Expense Tracker</span>
            </div>
            <p className="text-muted-foreground text-center sm:text-right">
              &copy; {new Date().getFullYear()} M12 Expense Tracker. Personal Finance Operating System. All rights reserved.
            </p>
          </div>
        </footer>
      </div>
    );
  }

  // Unauthenticated visitor attempting to access protected route (while redirecting)
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            <Lock className="h-5 w-5" />
          </div>
          <p className="text-sm font-medium text-foreground">Redirecting to sign in...</p>
        </div>
      </div>
    );
  }

  // Authenticated App Shell
  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <div className="hidden md:block">
        <Sidebar className="fixed inset-y-0 left-0 z-40" />
      </div>

      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm md:hidden animate-in fade-in-50"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="fixed inset-y-0 left-0 w-72 bg-card p-0 shadow-2xl animate-in slide-in-from-left duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute right-3 top-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <Sidebar onNavigate={() => setMobileMenuOpen(false)} className="w-full border-0" />
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col md:pl-64">
        <Header onMobileMenuToggle={() => setMobileMenuOpen(true)} />
        <main className="flex-1 p-4 md:p-8 max-w-[1600px] w-full mx-auto">
          <ModuleGuard>{children}</ModuleGuard>
        </main>
      </div>
    </div>
  );
}
