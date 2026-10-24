'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  ArrowUpDown,
  TrendingDown,
  TrendingUp,
  ArrowDownLeft,
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
  ChevronDown,
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
  const shouldReduceMotion = useReducedMotion();

  const expenseTrackerEnabled = user?.modulePreferences?.expenseTracker !== false;
  const emiEnabled = user?.modulePreferences?.emi !== false;
  const lendingEnabled = user?.modulePreferences?.lendingBorrowing !== false;
  const budgetEnabled = user?.modulePreferences?.budget !== false;
  const recurringEnabled = user?.modulePreferences?.recurringTransactions !== false;
  const creditCardsEnabled = user?.modulePreferences?.creditCards !== false;
  const chitFundEnabled = user?.modulePreferences?.chitFund !== false;
  const investmentEnabled = user?.modulePreferences?.investment !== false;

  const isIncomeExpenseActive =
    pathname === '/transactions' ||
    pathname.startsWith('/transactions/') ||
    pathname === '/expenses' ||
    pathname.startsWith('/expenses/') ||
    pathname === '/income' ||
    pathname.startsWith('/income/') ||
    pathname === '/pass-through' ||
    pathname.startsWith('/pass-through/');

  const [incomeExpenseOpen, setIncomeExpenseOpen] = useState(isIncomeExpenseActive);

  // Automatically expand parent if user navigates to any of the nested child routes
  useEffect(() => {
    if (isIncomeExpenseActive) {
      setIncomeExpenseOpen(true);
    }
  }, [isIncomeExpenseActive]);

  const incomeExpenseChildren = [
    { name: 'Transactions', href: '/transactions', icon: ArrowLeftRight },
    { name: 'Expenses', href: '/expenses', icon: TrendingDown },
    { name: 'Income', href: '/income', icon: TrendingUp },
    { name: 'Pass-Through Money', href: '/pass-through', icon: ArrowDownLeft },
  ];

  const primaryNavigation = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'Accounts', href: '/accounts', icon: Wallet },
  ];

  const secondaryNavigation = [
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

        {/* Top links: Dashboard, Accounts */}
        {primaryNavigation.map((item) => {
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
              <ChevronRight
                className={cn(
                  'h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100',
                  isActive && 'opacity-100 text-primary-foreground'
                )}
              />
            </Link>
          );
        })}

        {/* Income & Expense Parent Item with Smooth Dropdown */}
        {expenseTrackerEnabled && (
          <div className="space-y-0.5">
            <button
              type="button"
              aria-expanded={incomeExpenseOpen}
              aria-controls="income-expense-submenu"
              onClick={() => setIncomeExpenseOpen((prev) => !prev)}
              className={cn(
                'w-full group flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 text-left',
                isIncomeExpenseActive
                  ? 'bg-muted/70 text-foreground font-semibold'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <div className="flex items-center gap-3">
                <ArrowUpDown
                  className={cn(
                    'h-4 w-4 transition-colors',
                    isIncomeExpenseActive ? 'text-primary font-bold' : 'text-muted-foreground group-hover:text-foreground'
                  )}
                />
                <span>Income & Expense</span>
              </div>
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200',
                  incomeExpenseOpen && 'rotate-180',
                  isIncomeExpenseActive && 'text-foreground'
                )}
              />
            </button>

            {/* Nested Submenu: Transactions, Expenses, Income, Pass-Through Money */}
            <AnimatePresence initial={false}>
              {incomeExpenseOpen && (
                <motion.div
                  id="income-expense-submenu"
                  role="region"
                  aria-label="Income & Expense submenu"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{
                    height: 'auto',
                    opacity: 1,
                    transition: shouldReduceMotion
                      ? { duration: 0 }
                      : {
                          height: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
                          opacity: { duration: 0.16, delay: 0.04 },
                        },
                  }}
                  exit={{
                    height: 0,
                    opacity: 0,
                    transition: shouldReduceMotion
                      ? { duration: 0 }
                      : {
                          height: { duration: 0.18, ease: [0.16, 1, 0.3, 1] },
                          opacity: { duration: 0.1 },
                        },
                  }}
                  className="overflow-hidden"
                >
                  <div className="pl-3 py-1 space-y-1 ml-4 border-l border-border/70 my-1">
                    {incomeExpenseChildren.map((child) => {
                      const isChildActive = pathname === child.href;
                      const ChildIcon = child.icon;

                      return (
                        <Link
                          key={child.name}
                          href={child.href}
                          onClick={onNavigate}
                          className={cn(
                            'group flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-150',
                            isChildActive
                              ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          )}
                        >
                          <div className="flex items-center gap-2.5">
                            <ChildIcon
                              className={cn(
                                'h-3.5 w-3.5 transition-colors shrink-0',
                                isChildActive
                                  ? 'text-primary-foreground'
                                  : 'text-muted-foreground group-hover:text-foreground'
                              )}
                            />
                            <span>{child.name}</span>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Secondary Links: Lending, EMI, Chit Fund, Investments, Credit Cards, etc. */}
        {secondaryNavigation.map((item) => {
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
