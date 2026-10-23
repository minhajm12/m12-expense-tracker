'use client';

import * as React from 'react';
import { Calendar as CalendarIcon, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DatePicker } from '@/components/ui/date-picker';
import { Button } from '@/components/ui/button';

export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onChange: (range: { startDate: string; endDate: string }) => void;
  className?: string;
  disabled?: boolean;
}

export function DateRangePicker({
  startDate,
  endDate,
  onChange,
  className,
  disabled = false,
}: DateRangePickerProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="flex-1">
        <DatePicker
          value={startDate}
          onChange={(d) => onChange({ startDate: d, endDate })}
          placeholder="Start date"
          disabled={disabled}
        />
      </div>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <div className="flex-1">
        <DatePicker
          value={endDate}
          onChange={(d) => onChange({ startDate, endDate: d })}
          placeholder="End date"
          disabled={disabled}
        />
      </div>
    </div>
  );
}
