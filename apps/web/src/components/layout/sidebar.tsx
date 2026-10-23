'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  CreditCard,
  PieChart,
  Repeat,
  FileText,
  Settings,
  ShieldAlert,
  Coins,
  HandCoins,
  Landmark,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

import { Logo } from '@/components/ui/logo';
import { useAuth } from '@/lib/auth-context';

interface SidebarProps {
  className?: string;
  onNavigate?: () => void;
}

export function Sidebar({ className, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const { user, isAdmin } = useAuth();

  const expenseTrackerEnabled = user?.modulePreferences?.expenseTracker !== false;
  const emiEnabled = user?.modulePreferences?.emi !== false;
  const lendingEnabled = user?.modulePreferences?.lendingBorrowing !== false;
  const budgetEnabled = user?.modulePreferences?.budget !== false;
  const recurringEnabled = user?.modulePreferences?.recurringTransactions !== false;
  const creditCardsEnabled = user?.modulePreferences?.creditCards !== false;
  const chitFundEnabled = user?.modulePreferences?.chitFund !== false;
  const investmentEnabled = user?.modulePreferences?.investment !== false;

  const navigation = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'Accounts', href: '/accounts', icon: Wallet },
    ...(expenseTrackerEnabled ? [{ name: 'Transactions', href: '/transactions', icon: ArrowLeftRight }] : []),
    ...(lendingEnabled ? [{ name: 'Lending & Borrowing', href: '/lending-borrowing', icon: HandCoins }] : []),
    ...(emiEnabled ? [{ name: 'EMI Management', href: '/emi', icon: Landmark }] : []),
    ...(chitFundEnabled ? [{ name: 'Chit Fund', href: '/chit-fund', icon: Coins }] : []),
    ...(investmentEnabled ? [{ name: 'Investments', href: '/investments', icon: TrendingUp }] : []),
    ...(creditCardsEnabled ? [{ name: 'Credit Cards', href: '/credit-cards', icon: CreditCard }] : []),
    ...(budgetEnabled ? [{ name: 'Budgets', href: '/budgets', icon: PieChart }] : []),
    ...(recurringEnabled ? [{ name: 'Recurring', href: '/recurring', icon: Repeat }] : []),
    { name: 'Reports', href: '/reports', icon: FileText },
    { name: 'Settings', href: '/settings', icon: Settings },
    ...(isAdmin ? [{ name: 'Admin', href: '/admin', icon: ShieldAlert, badge: 'Admin' }] : []),
  ];

  return (
    <aside
      className={cn(
        'flex h-screen w-64 flex-col border-r border-border bg-card/60 backdrop-blur-md px-4 py-6',
        className
      )}
    >
      {/* Brand Header */}
      <div className="flex flex-col gap-1 px-2 mb-6">
        <Link href="/" className="flex items-center gap-2 py-1">
          <Logo height={32} className="h-8 max-w-[190px]" />
        </Link>
        <p className="text-[11px] text-muted-foreground font-medium pl-1">Personal Finance System</p>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 space-y-1 overflow-y-auto pr-1">
        <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">
          Platform Menu
        </p>
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                'group flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <div className="flex items-center gap-3">
                <Icon
                  className={cn(
                    'h-4 w-4 transition-colors',
                    isActive ? 'text-primary-foreground' : 'text-muted-foreground group-hover:text-foreground'
                  )}
                />
                <span>{item.name}</span>
              </div>
              {item.badge ? (
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-muted text-muted-foreground group-hover:bg-muted/80'
                  )}
                >
                  {item.badge}
                </span>
              ) : (
                <ChevronRight
                  className={cn(
                    'h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100',
                    isActive && 'opacity-100 text-primary-foreground'
                  )}
                />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer Info */}
      <div className="mt-auto border-t border-border pt-4 px-2">
        <div className="rounded-lg bg-muted/40 p-3">
          <p className="text-xs font-semibold text-foreground">M12 Expense Tracker</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Enterprise Financial Ledger
          </p>
        </div>
      </div>
    </aside>
  );
}
