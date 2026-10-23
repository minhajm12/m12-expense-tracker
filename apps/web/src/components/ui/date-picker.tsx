'use client';

import * as React from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

export interface DatePickerProps {
  value?: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  className,
  disabled = false,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);

  // Parse current value
  const parsedDate = React.useMemo(() => {
    if (!value) return null;
    const [y, m, d] = value.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }, [value]);

  const [currentViewMonth, setCurrentViewMonth] = React.useState<Date>(
    () => parsedDate || new Date()
  );

  React.useEffect(() => {
    if (parsedDate) {
      setCurrentViewMonth(parsedDate);
    }
  }, [value]);

  const year = currentViewMonth.getFullYear();
  const month = currentViewMonth.getMonth(); // 0-indexed

  const monthName = currentViewMonth.toLocaleString('en-IN', { month: 'long', year: 'numeric' });

  // Compute days in month
  const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0=Sun
  const totalDays = new Date(year, month + 1, 0).getDate();

  const handlePrevMonth = () => {
    setCurrentViewMonth(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentViewMonth(new Date(year, month + 1, 1));
  };

  const handleSelectDay = (day: number) => {
    const formattedMonth = String(month + 1).padStart(2, '0');
    const formattedDay = String(day).padStart(2, '0');
    onChange(`${year}-${formattedMonth}-${formattedDay}`);
    setOpen(false);
  };

  const formattedDisplay = parsedDate
    ? parsedDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

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
          {formattedDisplay || <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">{monthName}</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={handlePrevMonth}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={handleNextMonth}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-muted-foreground">
            <span>Su</span>
            <span>Mo</span>
            <span>Tu</span>
            <span>We</span>
            <span>Th</span>
            <span>Fr</span>
            <span>Sa</span>
          </div>

          {/* Days */}
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div key={`empty-${i}`} className="h-7 w-7" />
            ))}
            {Array.from({ length: totalDays }).map((_, i) => {
              const day = i + 1;
              const isSelected =
                parsedDate &&
                parsedDate.getFullYear() === year &&
                parsedDate.getMonth() === month &&
                parsedDate.getDate() === day;

              const isToday =
                new Date().getFullYear() === year &&
                new Date().getMonth() === month &&
                new Date().getDate() === day;

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => handleSelectDay(day)}
                  className={cn(
                    'h-7 w-7 rounded-md text-xs transition-colors flex items-center justify-center font-medium',
                    isSelected
                      ? 'bg-primary text-primary-foreground font-bold shadow'
                      : isToday
                      ? 'bg-muted text-foreground border border-border'
                      : 'hover:bg-accent hover:text-accent-foreground text-foreground'
                  )}
                >
                  {day}
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
                const today = new Date();
                const y = today.getFullYear();
                const m = String(today.getMonth() + 1).padStart(2, '0');
                const d = String(today.getDate()).padStart(2, '0');
                onChange(`${y}-${m}-${d}`);
                setOpen(false);
              }}
            >
              Today
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
