'use client';

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Sun, Moon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { ModuleGuard } from './module-guard';

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const pathname = usePathname();
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
