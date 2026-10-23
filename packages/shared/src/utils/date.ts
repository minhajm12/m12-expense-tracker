/**
 * Date and Timezone Utilities for M12 Expense Tracker
 * 
 * Provides robust timezone-aware date parsing, formatting, and query boundary calculation.
 * Standardizes on 'Asia/Kolkata' (IST, UTC+5:30) as the primary financial operating timezone.
 */

export const APP_TIMEZONE = 'Asia/Kolkata';

export interface LocalDateParts {
  year: number;
  month: number; // 1-indexed (1 = January, 12 = December)
  day: number;
}

/**
 * Extracts the calendar year, month, and day for a given date in a specific timezone.
 */
export function getLocalDateParts(
  date: Date = new Date(),
  timeZone: string = APP_TIMEZONE
): LocalDateParts {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.format(date).split('-');
    return {
      year: parseInt(parts[0], 10),
      month: parseInt(parts[1], 10),
      day: parseInt(parts[2], 10),
    };
  } catch {
    // Fallback if timezone is invalid
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    };
  }
}

/**
 * Formats a date into a standard HTML date input value ('YYYY-MM-DD')
 * according to the designated timezone (defaults to Asia/Kolkata).
 */
export function formatDateToInput(
  date: Date | string = new Date(),
  timeZone: string = APP_TIMEZONE
): string {
  const d = date instanceof Date ? date : parseDateInput(date, timeZone);
  const { year, month, day } = getLocalDateParts(d, timeZone);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * Robustly parses date inputs in multiple formats:
 * - DD/MM/YYYY or DD-MM-YYYY (e.g. '17/10/2026', '16-10-2026')
 * - YYYY-MM-DD or YYYY/MM/DD (e.g. '2026-10-17')
 * - Full ISO strings (e.g. '2026-10-17T02:36:14.000Z')
 * - Native Date objects
 * 
 * For date-only entries, places the timestamp at UTC midday (12:00:00Z)
 * to guarantee the calendar day never shifts across any international timezone.
 */
export function parseDateInput(
  input: string | Date | undefined | null,
  timeZone: string = APP_TIMEZONE
): Date {
  if (!input) {
    return new Date();
  }

  if (input instanceof Date) {
    return isNaN(input.getTime()) ? new Date() : new Date(input.getTime());
  }

  const str = String(input).trim();

  // 1. DD/MM/YYYY or DD-MM-YYYY format
  const ddmmyyyy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(str);
  if (ddmmyyyy) {
    const day = parseInt(ddmmyyyy[1], 10);
    const month = parseInt(ddmmyyyy[2], 10);
    const year = parseInt(ddmmyyyy[3], 10);
    const hours = ddmmyyyy[4] !== undefined ? parseInt(ddmmyyyy[4], 10) : 12;
    const minutes = ddmmyyyy[5] !== undefined ? parseInt(ddmmyyyy[5], 10) : 0;
    const seconds = ddmmyyyy[6] !== undefined ? parseInt(ddmmyyyy[6], 10) : 0;
    return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
  }

  // 2. YYYY-MM-DD or YYYY/MM/DD date-only format
  const yyyymmdd = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(str);
  if (yyyymmdd) {
    const year = parseInt(yyyymmdd[1], 10);
    const month = parseInt(yyyymmdd[2], 10);
    const day = parseInt(yyyymmdd[3], 10);
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  }

  // 3. ISO format or standard date string
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return new Date();
}

/**
 * Calculates the inclusive start boundary for a given day in the specified timezone.
 * Takes the earliest timestamp between local timezone midnight and UTC midnight
 * to guarantee transactions near midnight are never excluded.
 */
export function getStartOfDay(
  dateInput: Date | string = new Date(),
  timeZone: string = APP_TIMEZONE
): Date {
  const d = dateInput instanceof Date ? dateInput : parseDateInput(dateInput, timeZone);
  const { year, month, day } = getLocalDateParts(d, timeZone);

  // Local midnight in timeZone (e.g. IST = UTC - 5h 30m)
  const localMidnight = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  if (timeZone === 'Asia/Kolkata') {
    localMidnight.setUTCHours(localMidnight.getUTCHours() - 5, localMidnight.getUTCMinutes() - 30);
  }

  const utcMidnight = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  return new Date(Math.min(localMidnight.getTime(), utcMidnight.getTime()));
}

/**
 * Calculates the inclusive end boundary for a given day in the specified timezone.
 * Takes the latest timestamp between local timezone end-of-day and UTC end-of-day
 * to guarantee transactions throughout the entire day (including late night) are included.
 */
export function getEndOfDay(
  dateInput: Date | string = new Date(),
  timeZone: string = APP_TIMEZONE
): Date {
  const d = dateInput instanceof Date ? dateInput : parseDateInput(dateInput, timeZone);
  const { year, month, day } = getLocalDateParts(d, timeZone);

  // Local 23:59:59.999 in timeZone (e.g. IST = UTC - 5h 30m)
  const localEndOfDay = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  if (timeZone === 'Asia/Kolkata') {
    localEndOfDay.setUTCHours(localEndOfDay.getUTCHours() - 5, localEndOfDay.getUTCMinutes() - 30);
  }

  const utcEndOfDay = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  return new Date(Math.max(localEndOfDay.getTime(), utcEndOfDay.getTime()));
}

export interface DashboardDateRange {
  startDate: Date;
  endDate: Date;
  label: string;
}

/**
 * Resolves standard dashboard query date ranges with server-authoritative boundaries.
 * Fully supports:
 * - 'today'
 * - 'this-month'
 * - 'last-month'
 * - 'last-30-days'
 * - 'last-90-days'
 * - 'this-year'
 * - 'all-time'
 * - 'custom'
 */
export function resolveDashboardDateRange(
  period: string = 'this-month',
  customStart?: string,
  customEnd?: string,
  timeZone: string = APP_TIMEZONE
): DashboardDateRange {
  const now = new Date();
  const { year, month, day } = getLocalDateParts(now, timeZone);

  switch (period) {
    case 'today': {
      const todayDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      return {
        startDate: getStartOfDay(todayDate, timeZone),
        endDate: getEndOfDay(todayDate, timeZone),
        label: 'Today',
      };
    }

    case 'last-month': {
      // Last month calculation
      const lastMonthYear = month === 1 ? year - 1 : year;
      const lastMonth = month === 1 ? 12 : month - 1;
      const firstDay = new Date(Date.UTC(lastMonthYear, lastMonth - 1, 1, 12, 0, 0));
      const lastDay = new Date(Date.UTC(lastMonthYear, lastMonth, 0, 12, 0, 0));
      return {
        startDate: getStartOfDay(firstDay, timeZone),
        endDate: getEndOfDay(lastDay, timeZone),
        label: 'Last Month',
      };
    }

    case 'last-30-days': {
      const start30 = new Date(Date.UTC(year, month - 1, day - 30, 12, 0, 0));
      const endToday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      return {
        startDate: getStartOfDay(start30, timeZone),
        endDate: getEndOfDay(endToday, timeZone),
        label: 'Last 30 Days',
      };
    }

    case 'last-90-days': {
      const start90 = new Date(Date.UTC(year, month - 1, day - 90, 12, 0, 0));
      const endToday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      return {
        startDate: getStartOfDay(start90, timeZone),
        endDate: getEndOfDay(endToday, timeZone),
        label: 'Last 90 Days',
      };
    }

    case 'this-year': {
      const firstDayOfYear = new Date(Date.UTC(year, 0, 1, 12, 0, 0));
      const lastDayOfYear = new Date(Date.UTC(year, 11, 31, 12, 0, 0));
      return {
        startDate: getStartOfDay(firstDayOfYear, timeZone),
        endDate: getEndOfDay(lastDayOfYear, timeZone),
        label: 'This Year',
      };
    }

    case 'all-time': {
      return {
        startDate: new Date(0), // 1970-01-01
        endDate: new Date(Date.UTC(2099, 11, 31, 23, 59, 59, 999)),
        label: 'All Time',
      };
    }

    case 'custom': {
      const start = customStart ? parseDateInput(customStart, timeZone) : new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
      const end = customEnd ? parseDateInput(customEnd, timeZone) : new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      return {
        startDate: getStartOfDay(start, timeZone),
        endDate: getEndOfDay(end, timeZone),
        label: 'Custom Range',
      };
    }

    case 'this-month':
    default: {
      const firstDayOfMonth = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
      const lastDayOfMonth = new Date(Date.UTC(year, month, 0, 12, 0, 0));
      return {
        startDate: getStartOfDay(firstDayOfMonth, timeZone),
        endDate: getEndOfDay(lastDayOfMonth, timeZone),
        label: 'This Month',
      };
    }
  }
}

export interface ChitCycleInfo {
  cyclePeriod: string; // e.g. "2026-10"
  year: number;
  month: number;
  prizeTakingDate: Date; // 15th of the cycle month
  rolloverDate: Date; // 13th of the following month at 00:00:00 IST
  formattedPrizeDate: string; // "15 Oct 2026"
  formattedRolloverDate: string; // "13 Nov 2026, 00:00 IST"
  isBeforePrizeDate: boolean;
  isAfterRollover: boolean;
}

/**
 * Derives the authoritative monthly Chit Fund cycle and schedule according to
 * the 15th prize-taking day and the 13th 00:00 IST rollover rule.
 */
export function getChitCycleInfo(
  dateInput: Date | string = new Date(),
  timeZone: string = APP_TIMEZONE
): ChitCycleInfo {
  const d = dateInput instanceof Date ? dateInput : parseDateInput(dateInput, timeZone);
  const { year, month, day } = getLocalDateParts(d, timeZone);

  // If day of month is 13 or greater, the active cycle is this calendar month.
  // If day is before 13 (1 to 12), the active cycle is still the previous month (rollover hasn't happened yet).
  let cycleYear = year;
  let cycleMonth = month;

  if (day < 13) {
    if (month === 1) {
      cycleYear = year - 1;
      cycleMonth = 12;
    } else {
      cycleMonth = month - 1;
    }
  }

  const cyclePeriod = `${cycleYear}-${String(cycleMonth).padStart(2, '0')}`;

  // Prize-taking date is the 15th of the cycle month
  const prizeTakingDate = new Date(Date.UTC(cycleYear, cycleMonth - 1, 15, 12, 0, 0));

  // Rollover date is the 13th of the following month at 00:00:00 IST (UTC-5h30m = 18:30 on the 12th)
  let nextMonth = cycleMonth === 12 ? 1 : cycleMonth + 1;
  let nextYear = cycleMonth === 12 ? cycleYear + 1 : cycleYear;
  const rolloverDate = new Date(Date.UTC(nextYear, nextMonth - 1, 12, 18, 30, 0, 0));

  const isBeforePrizeDate = d.getTime() < prizeTakingDate.getTime();
  const isAfterRollover = d.getTime() >= rolloverDate.getTime();

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const formattedPrizeDate = `15 ${monthNames[cycleMonth - 1]} ${cycleYear}`;
  const formattedRolloverDate = `13 ${monthNames[nextMonth - 1]} ${nextYear}, 00:00 IST`;

  return {
    cyclePeriod,
    year: cycleYear,
    month: cycleMonth,
    prizeTakingDate,
    rolloverDate,
    formattedPrizeDate,
    formattedRolloverDate,
    isBeforePrizeDate,
    isAfterRollover,
  };
}

/**
 * Returns the prize-taking date (15th) for any explicit cycle string (e.g. "2026-10").
 */
export function getPrizeTakingDateForCycle(cyclePeriod: string): Date {
  const parts = cyclePeriod.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  return new Date(Date.UTC(year, month - 1, 15, 12, 0, 0));
}

/**
 * Returns the rollover date (13th of following month 00:00 IST) for any explicit cycle string.
 */
export function getRolloverDateForCycle(cyclePeriod: string): Date {
  const parts = cyclePeriod.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return new Date(Date.UTC(nextYear, nextMonth - 1, 12, 18, 30, 0, 0));
}

/**
 * Formats a cycle string (e.g. "2026-10") into a compact pill label (e.g. "OCT 26").
 * Returns short month name and 2-digit year without secondary bracket labels.
 */
export function formatCyclePillLabel(cyclePeriod: string): string {
  if (!cyclePeriod || typeof cyclePeriod !== 'string') return '';
  const parts = cyclePeriod.split('-');
  if (parts.length < 2) return cyclePeriod;
  const yearShort = parts[0].length >= 4 ? parts[0].slice(-2) : parts[0];
  const monthNum = parseInt(parts[1], 10);
  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const monthShort = monthNames[monthNum - 1] || parts[1];
  return `${monthShort} ${yearShort}`;
}
