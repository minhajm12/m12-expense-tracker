'use client';

import React from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
  variant?: 'auto' | 'light' | 'dark';
  height?: number;
  width?: number;
}

export function Logo({
  className,
  variant = 'auto',
  height = 36,
  width = 160,
}: LogoProps) {
  if (variant === 'light') {
    // White text logo for dark backgrounds
    return (
      <img
        src="/img/logo/m12_expense_tracker_logo_light.png"
        alt="M12 Expense Tracker"
        width={width}
        height={height}
        className={cn('h-9 w-auto object-contain', className)}
      />
    );
  }

  if (variant === 'dark') {
    // Black text logo for light backgrounds
    return (
      <img
        src="/img/logo/m12_expense_tracker_logo_dark.png"
        alt="M12 Expense Tracker"
        width={width}
        height={height}
        className={cn('h-9 w-auto object-contain', className)}
      />
    );
  }

  // Auto theme-aware: dark logo in light mode, light logo in dark mode
  return (
    <div className={cn('inline-flex items-center', className)}>
      <img
        src="/img/logo/m12_expense_tracker_logo_dark.png"
        alt="M12 Expense Tracker"
        width={width}
        height={height}
        className="block dark:hidden h-9 w-auto object-contain"
      />
      <img
        src="/img/logo/m12_expense_tracker_logo_light.png"
        alt="M12 Expense Tracker"
        width={width}
        height={height}
        className="hidden dark:block h-9 w-auto object-contain"
      />
    </div>
  );
}
