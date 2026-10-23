'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import { Sliders, ArrowLeft, CheckCircle2, Lock } from 'lucide-react';
import { emitDataChange } from '@/lib/data-sync';

interface ModuleConfig {
  key: string;
  name: string;
  description: string;
}

const ROUTE_MODULE_MAP: Record<string, ModuleConfig> = {
  '/transactions': {
    key: 'expenseTracker',
    name: 'Expense Tracker',
    description: 'Record income, expenses, and financial transactions.',
  },
  '/emi': {
    key: 'emi',
    name: 'EMI Management',
    description: 'Track EMI schedules, payments, and remaining installments.',
  },
  '/lending-borrowing': {
    key: 'lendingBorrowing',
    name: 'Lending & Borrowing',
    description: 'Track money lent to others and money borrowed.',
  },
  '/budgets': {
    key: 'budget',
    name: 'Budget Management',
    description: 'Set category budgets and monitor spending.',
  },
  '/recurring': {
    key: 'recurringTransactions',
    name: 'Recurring Transactions',
    description: 'Manage subscriptions, bills, and recurring payments.',
  },
  '/credit-cards': {
    key: 'creditCards',
    name: 'Credit Card Management',
    description: 'Track card expenses, outstanding balances, and repayments.',
  },
  '/chit-fund': {
    key: 'chitFund',
    name: 'Chit Fund Management',
    description: 'Manage chit members, collections, winners, payouts, and balances.',
  },
  '/investments': {
    key: 'investment',
    name: 'Investment Management',
    description: 'Track capital investments, external chits, and portfolio growth.',
  },
};

export function ModuleGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, refreshUser } = useAuth();
  const [enabling, setEnabling] = useState(false);

  // Find matching module config
  let matchedModule: ModuleConfig | null = null;
  for (const [routePrefix, config] of Object.entries(ROUTE_MODULE_MAP)) {
    if (pathname === routePrefix || pathname.startsWith(`${routePrefix}/`)) {
      matchedModule = config;
      break;
    }
  }

  if (!matchedModule || !user) {
    return <>{children}</>;
  }

  const prefs = user.modulePreferences as any;
  const isEnabled = prefs ? prefs[matchedModule.key] !== false : true;

  if (isEnabled) {
    return <>{children}</>;
  }

  const handleEnableModule = async () => {
    if (!matchedModule) return;
    setEnabling(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
      const res = await fetch(`${apiUrl}/api/v1/settings/module-preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ [matchedModule.key]: true }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success(`${matchedModule.name} re-enabled successfully`);
        await refreshUser();
        emitDataChange('all');
      } else {
        toast.error(json.error?.message || 'Failed to enable module');
      }
    } catch {
      toast.error('Network error enabling module');
    } finally {
      setEnabling(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-4">
      <Card className="max-w-md w-full border-border/80 bg-card/80 backdrop-blur-md shadow-xl text-center">
        <CardHeader className="pb-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground mb-2">
            <Lock className="h-6 w-6" />
          </div>
          <div className="flex items-center justify-center gap-2">
            <CardTitle className="text-xl font-bold">{matchedModule.name}</CardTitle>
            <Badge variant="secondary" className="text-xs">
              Disabled
            </Badge>
          </div>
          <CardDescription className="text-xs text-muted-foreground mt-1">
            This module is currently disabled in your Settings. All your underlying records, accounts, and histories remain securely preserved.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-xs text-muted-foreground">
          <p className="bg-muted/40 p-3 rounded-xl border border-border/60">
            {matchedModule.description}
          </p>
        </CardContent>
        <CardFooter className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-2">
          <Button
            onClick={handleEnableModule}
            disabled={enabling}
            className="w-full sm:w-auto gap-2"
          >
            <CheckCircle2 className="h-4 w-4" />
            {enabling ? 'Enabling...' : `Enable ${matchedModule.name}`}
          </Button>
          <Link href="/settings" className="w-full sm:w-auto">
            <Button variant="outline" className="w-full gap-2">
              <Sliders className="h-4 w-4" />
              Settings
            </Button>
          </Link>
          <Link href="/" className="w-full sm:w-auto">
            <Button variant="ghost" className="w-full gap-2">
              <ArrowLeft className="h-4 w-4" />
              Dashboard
            </Button>
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
