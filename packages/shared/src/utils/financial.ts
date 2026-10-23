/**
 * Financial Calculation & Formatting Utilities
 *
 * Implements decimal-safe math by converting amounts to integer cents (paise)
 * during operations to prevent IEEE-754 floating-point errors.
 */

export const toCents = (amount: number): number => {
  return Math.round((Number(amount) || 0) * 100);
};

export const fromCents = (cents: number): number => {
  return Math.round(cents) / 100;
};

export const safeAdd = (a: number, b: number): number => {
  return fromCents(toCents(a) + toCents(b));
};

export const safeSubtract = (a: number, b: number): number => {
  return fromCents(toCents(a) - toCents(b));
};

export const safeMultiply = (a: number, multiplier: number): number => {
  return fromCents(Math.round(toCents(a) * multiplier));
};

export const formatCurrency = (
  amount: number,
  currencyCode: string = 'INR',
  locale: string = 'en-IN'
): string => {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Fallback if locale or currency code is unsupported
    const symbol = currencyCode === 'INR' ? '₹' : '$';
    return `${symbol}${amount.toFixed(2)}`;
  }
};

export const maskIdentifier = (value: string, visibleEndChars: number = 4): string => {
  if (!value) return '';
  const clean = value.replace(/\s+/g, '');
  if (clean.length <= visibleEndChars) return clean;
  const maskedLength = clean.length - visibleEndChars;
  const maskedPrefix = '•'.repeat(Math.min(maskedLength, 8));
  return `${maskedPrefix}${clean.slice(-visibleEndChars)}`;
};
