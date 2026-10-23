'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { Sun, Moon, Menu, Activity, LogOut, UserCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth-context';

interface HeaderProps {
  onMobileMenuToggle?: () => void;
}

export function Header({ onMobileMenuToggle }: HeaderProps) {
  const { theme, setTheme } = useTheme();
  const { user, isAuthenticated, logout } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);

  useEffect(() => {
    setMounted(true);

    const checkApiHealth = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
        const res = await fetch(`${apiUrl}/health`, { method: 'GET', cache: 'no-store' });
        if (res.ok) {
          setApiOnline(true);
        } else {
          setApiOnline(false);
        }
      } catch {
        setApiOnline(false);
      }
    };

    checkApiHealth();
    const interval = setInterval(checkApiHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-border bg-background/80 px-4 md:px-8 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onMobileMenuToggle}
          aria-label="Toggle navigation"
        >
          <Menu className="h-5 w-5" />
        </Button>

        <div className="flex items-center gap-2">
          <span className="font-bold text-sm tracking-tight text-foreground">M12 Expense Tracker</span>
          <span className="text-muted-foreground/60 text-xs hidden sm:inline">/</span>
          <span className="text-xs text-muted-foreground hidden sm:inline">Personal Finance Operating System</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Live API Health Pill */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/60 text-xs font-medium">
          <Activity
            className={`h-3.5 w-3.5 ${
              apiOnline === true
                ? 'text-emerald-500 animate-pulse'
                : apiOnline === false
                ? 'text-red-500'
                : 'text-amber-500'
            }`}
          />
          <span className="text-muted-foreground">API:</span>
          <span className={apiOnline ? 'text-emerald-600 font-semibold dark:text-emerald-400' : 'text-red-500'}>
            {apiOnline === true ? 'Connected' : apiOnline === false ? 'Offline' : 'Checking...'}
          </span>
        </div>

        {/* Theme Switcher */}
        {mounted && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title="Toggle color theme"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        )}

        {/* User / Auth State */}
        {isAuthenticated && user ? (
          <div className="flex items-center gap-3 pl-2 border-l border-border">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-xs border border-primary/20">
                {getInitials(user.fullName)}
              </div>
              <div className="hidden lg:block text-left text-xs">
                <div className="flex items-center gap-1.5">
                  <p className="font-medium text-foreground leading-none">{user.fullName}</p>
                  {user.role === 'admin' && (
                    <Badge variant="warning" className="text-[9px] px-1 py-0 uppercase">
                      Admin
                    </Badge>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{user.email}</p>
              </div>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              title="Sign Out"
              className="text-muted-foreground hover:text-destructive"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 pl-2 border-l border-border">
            <Link href="/login">
              <Button variant="ghost" size="sm">
                Sign In
              </Button>
            </Link>
            <Link href="/register">
              <Button size="sm">Get Started</Button>
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
