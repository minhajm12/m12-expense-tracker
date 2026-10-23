'use client';

import * as React from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export interface MonthYearPickerProps {
  value?: string; // YYYY-MM
  onChange: (monthYear: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function MonthYearPicker({
  value,
  onChange,
  placeholder = 'Select month',
  className,
  disabled = false,
}: MonthYearPickerProps) {
  const [open, setOpen] = React.useState(false);

  const [currentYear, setCurrentYear] = React.useState<number>(() => {
    if (value) {
      const [y] = value.split('-').map(Number);
      if (y) return y;
    }
    return new Date().getFullYear();
  });

  const selectedMonthNum = React.useMemo(() => {
    if (!value) return null;
    const [, m] = value.split('-').map(Number);
    return m ? m - 1 : null; // 0-indexed
  }, [value]);

  const selectedYear = React.useMemo(() => {
    if (!value) return null;
    const [y] = value.split('-').map(Number);
    return y || null;
  }, [value]);

  const displayString = React.useMemo(() => {
    if (selectedYear !== null && selectedMonthNum !== null) {
      return `${MONTH_NAMES[selectedMonthNum]} ${selectedYear}`;
    }
    return null;
  }, [selectedYear, selectedMonthNum]);

  const handleSelectMonth = (monthIndex: number) => {
    const formattedMonth = String(monthIndex + 1).padStart(2, '0');
    onChange(`${currentYear}-${formattedMonth}`);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            'w-full justify-start text-left font-normal h-9 px-3 text-xs border-border bg-background hover:bg-accent/50',
            !value && 'text-muted-foreground',
            className
          )}
        >
          <CalendarIcon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
          {displayString || <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <div className="space-y-3">
          {/* Year selector header */}
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setCurrentYear((y) => y - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs font-bold font-mono text-foreground">{currentYear}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setCurrentYear((y) => y + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* 12 months grid */}
          <div className="grid grid-cols-3 gap-1.5">
            {MONTH_NAMES.map((name, idx) => {
              const isSelected = selectedYear === currentYear && selectedMonthNum === idx;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => handleSelectMonth(idx)}
                  className={cn(
                    'h-8 rounded-lg text-xs font-medium transition-colors flex items-center justify-center',
                    isSelected
                      ? 'bg-primary text-primary-foreground font-bold shadow'
                      : 'hover:bg-accent hover:text-accent-foreground text-foreground'
                  )}
                >
                  {name}
                </button>
              );
            })}
          </div>

          {/* Quick Shortcuts */}
          <div className="pt-2 border-t border-border flex justify-between items-center text-[11px]">
            <button
              type="button"
              className="text-primary hover:underline font-medium"
              onClick={() => {
                const now = new Date();
                const y = now.getFullYear();
                const m = String(now.getMonth() + 1).padStart(2, '0');
                onChange(`${y}-${m}`);
                setOpen(false);
              }}
            >
              Current Month
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:underline"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              Clear
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
