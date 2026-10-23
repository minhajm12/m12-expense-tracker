'use client';

import * as React from 'react';
import { Calendar as CalendarIcon, Clock, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@finora/shared';

const MONTHS = [
  { value: '01', label: 'Jan' },
  { value: '02', label: 'Feb' },
  { value: '03', label: 'Mar' },
  { value: '04', label: 'Apr' },
  { value: '05', label: 'May' },
  { value: '06', label: 'Jun' },
  { value: '07', label: 'Jul' },
  { value: '08', label: 'Aug' },
  { value: '09', label: 'Sep' },
  { value: '10', label: 'Oct' },
  { value: '11', label: 'Nov' },
  { value: '12', label: 'Dec' },
];

export interface MonthYearRange {
  startMonth?: string; // YYYY-MM
  endMonth?: string;   // YYYY-MM
}

interface MonthYearRangePickerProps {
  value?: MonthYearRange;
  onChange: (range: MonthYearRange) => void;
  monthlyAmount?: number;
  chitStartDate?: string; // Optional chit start date to enforce bounds
  className?: string;
}

export function MonthYearRangePicker({
  value,
  onChange,
  monthlyAmount = 0,
  chitStartDate,
  className,
}: MonthYearRangePickerProps) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 7 }, (_, i) => String(currentYear - 3 + i));

  const [startYear, setStartYear] = React.useState<string>(() => {
    if (value?.startMonth) return value.startMonth.split('-')[0];
    if (chitStartDate) return chitStartDate.slice(0, 4);
    return String(currentYear);
  });
  const [startMonthNum, setStartMonthNum] = React.useState<string>(() => {
    if (value?.startMonth) return value.startMonth.split('-')[1];
    if (chitStartDate) return chitStartDate.slice(5, 7);
    return '01';
  });

  const [endYear, setEndYear] = React.useState<string>(() => {
    if (value?.endMonth) return value.endMonth.split('-')[0];
    return String(currentYear);
  });
  const [endMonthNum, setEndMonthNum] = React.useState<string>(() => {
    if (value?.endMonth) return value.endMonth.split('-')[1];
    const prevMonth = new Date().getMonth(); // 0-indexed: previous month number
    const m = prevMonth === 0 ? 12 : prevMonth;
    return String(m).padStart(2, '0');
  });

  // Calculate total months in range
  const count = React.useMemo(() => {
    const s = `${startYear}-${startMonthNum}`;
    const e = `${endYear}-${endMonthNum}`;
    if (s > e) return 0;
    const [sy, sm] = [parseInt(startYear, 10), parseInt(startMonthNum, 10)];
    const [ey, em] = [parseInt(endYear, 10), parseInt(endMonthNum, 10)];
    return (ey - sy) * 12 + (em - sm) + 1;
  }, [startYear, startMonthNum, endYear, endMonthNum]);

  const totalCalculated = count * monthlyAmount;

  const handleUpdate = (sY: string, sM: string, eY: string, eM: string) => {
    const s = `${sY}-${sM}`;
    const e = `${eY}-${eM}`;
    if (s <= e) {
      onChange({ startMonth: s, endMonth: e });
    }
  };

  React.useEffect(() => {
    const s = `${startYear}-${startMonthNum}`;
    const e = `${endYear}-${endMonthNum}`;
    if (s <= e && (!value?.startMonth || !value?.endMonth)) {
      onChange({ startMonth: s, endMonth: e });
    }
  }, [startYear, startMonthNum, endYear, endMonthNum, value?.startMonth, value?.endMonth, onChange]);

  return (
    <div className={cn('rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-4', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-emerald-400" />
          <span className="text-xs font-semibold text-emerald-300">
            Midway Historical Range (Already Paid Before Tracking)
          </span>
        </div>
        {count > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
            <CheckCircle2 className="h-3 w-3" />
            {count} {count === 1 ? 'Month' : 'Months'}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* From Month/Year */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            From Month
          </label>
          <div className="flex gap-2">
            <select
              value={startMonthNum}
              onChange={(e) => {
                setStartMonthNum(e.target.value);
                handleUpdate(startYear, e.target.value, endYear, endMonthNum);
              }}
              className="flex-1 h-9 rounded-lg border border-border bg-background px-2.5 text-xs focus:ring-1 focus:ring-emerald-400 focus:outline-none"
            >
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label} ({m.value})
                </option>
              ))}
            </select>
            <select
              value={startYear}
              onChange={(e) => {
                setStartYear(e.target.value);
                handleUpdate(e.target.value, startMonthNum, endYear, endMonthNum);
              }}
              className="w-24 h-9 rounded-lg border border-border bg-background px-2.5 text-xs focus:ring-1 focus:ring-emerald-400 focus:outline-none"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* To Month/Year */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            To Month (Inclusive)
          </label>
          <div className="flex gap-2">
            <select
              value={endMonthNum}
              onChange={(e) => {
                setEndMonthNum(e.target.value);
                handleUpdate(startYear, startMonthNum, endYear, e.target.value);
              }}
              className="flex-1 h-9 rounded-lg border border-border bg-background px-2.5 text-xs focus:ring-1 focus:ring-emerald-400 focus:outline-none"
            >
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label} ({m.value})
                </option>
              ))}
            </select>
            <select
              value={endYear}
              onChange={(e) => {
                setEndYear(e.target.value);
                handleUpdate(startYear, startMonthNum, e.target.value, endMonthNum);
              }}
              className="w-24 h-9 rounded-lg border border-border bg-background px-2.5 text-xs focus:ring-1 focus:ring-emerald-400 focus:outline-none"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Live Calculation Preview Banner */}
      <div className="rounded-lg bg-background/60 border border-emerald-500/20 p-2.5 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Historical Range:</span>
          <span className="font-mono font-bold text-foreground">
            {startYear}-{startMonthNum} <span className="text-muted-foreground font-normal">to</span> {endYear}-{endMonthNum}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Historical Invested:</span>
          <span className="font-mono font-bold text-emerald-400 text-sm">
            {formatCurrency(totalCalculated)}
          </span>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <AlertCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
        <span>
          Historical contributions record prior months into your investment ledger without altering your current bank or cash balances.
        </span>
      </p>
    </div>
  );
}
