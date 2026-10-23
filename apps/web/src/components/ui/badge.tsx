import * as React from 'react';
import { cn } from '@/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variants = {
    default: 'border-transparent bg-primary text-primary-foreground shadow',
    secondary: 'border-transparent bg-secondary text-secondary-foreground',
    destructive: 'border-[#CC0000]/20 bg-[#CC0000]/10 text-[#CC0000] font-medium border',
    outline: 'text-foreground',
    success: 'border-[#05A100]/20 bg-[#05A100]/10 text-[#05A100] font-medium border',
    warning: 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium',
    info: 'border-[#F94C10]/20 bg-[#F94C10]/10 text-[#F94C10] font-medium border',
  };

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
