/**
 * Formatting for the panel. Pure functions with no locale-dependent output, so
 * the tests can pin exact strings.
 */
import type { QuotaWindow } from './magpie.ts';

const invalid = (value: number | null | undefined): value is null | undefined =>
  value === null || value === undefined || !Number.isFinite(value);

/** Groups the integer part with `,`; no `Intl`, so no ICU version drift. */
const group = (value: number): string => {
  const negative = value < 0;
  const digits = Math.abs(Math.trunc(value)).toString();
  let out = '';
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) out += ',';
    out += digits.charAt(index);
  }
  return negative ? `-${out}` : out;
};

export const formatInt = (value: number | null): string => (invalid(value) ? '—' : group(value));

/** 1234567 → `1.23M`. */
export const formatCompact = (value: number | null): string => {
  if (invalid(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${trim(value / 1e9, 2)}B`;
  if (abs >= 1e6) return `${trim(value / 1e6, 2)}M`;
  if (abs >= 1e3) return `${trim(value / 1e3, 1)}k`;
  return group(value);
};

const trim = (value: number, digits: number): string => {
  const fixed = value.toFixed(digits);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
};

/** Estimated cost in USD, following magpie's own precision steps. */
export const formatCost = (value: number | null): string => {
  if (invalid(value)) return '—';
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : 3;
  return `≈$${value.toFixed(digits)}`;
};

/** A credit balance: two decimals at most, `<0.01` for a tiny positive value. */
export const formatCredits = (value: number | null): string => {
  if (invalid(value)) return '—';
  if (value > 0 && value < 0.01) return '<0.01';
  return value === 0 ? '0' : trim(value, 2);
};

/** Up to two decimals, grouped; used for quota amounts and limits. */
export const formatAmount = (value: number | null): string => {
  if (invalid(value)) return '—';
  return Number.isInteger(value) ? group(value) : trim(value, 2);
};

/**
 * Cache hit rate over `cache_read / (input + cache_read + cache_write)`.
 * `null` when the denominator is not positive, so the panel can omit the row
 * instead of printing NaN or 0%.
 */
export const cacheHitRate = (input: number, cacheRead: number, cacheWrite: number): number | null => {
  const denom = input + cacheRead + cacheWrite;
  if (!Number.isFinite(denom) || denom <= 0) return null;
  const ratio = cacheRead / denom;
  if (!Number.isFinite(ratio)) return null;
  return Math.min(1, Math.max(0, ratio));
};

export const formatPercent = (ratio: number | null): string => {
  if (invalid(ratio)) return '—';
  return `${trim(ratio * 100, 1)}%`;
};

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

/** Share of the window already used, as 0..100. `null` when the payload has no numbers. */
export const quotaUsedPercent = (window: QuotaWindow): number | null => {
  if (window.unlimited) return null;
  if (!invalid(window.used)) return clampPercent(window.used);
  if (!invalid(window.remaining)) return clampPercent(100 - window.remaining);
  if (!invalid(window.amount) && !invalid(window.limit) && window.limit > 0) {
    return clampPercent((window.amount / window.limit) * 100);
  }
  return null;
};

export const quotaLeftPercent = (window: QuotaWindow): number | null => {
  const used = quotaUsedPercent(window);
  return used === null ? null : 100 - used;
};

/** The `amount / limit unit` line, or the gateway's own `display` string. */
export const quotaAmountLine = (window: QuotaWindow): string | null => {
  if (window.display) return window.display;
  const unit = window.unit ? ` ${window.unit}` : '';
  if (!invalid(window.amount) && !invalid(window.limit)) {
    return `${formatAmount(window.amount)} / ${formatAmount(window.limit)}${unit}`;
  }
  if (!invalid(window.remaining)) return `${formatAmount(window.remaining)}${unit} left`;
  return null;
};

/** `YYYY-MM-DD HH:mm` in the given zone; fixed shape, so it never depends on ICU locale data. */
export const formatWhen = (
  iso: string | null,
  options: { timeZone?: string; seconds?: boolean } = {},
): string => {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: options.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(options.seconds ? { second: '2-digit' as const } : {}),
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const pick = (name: string): string => parts[name] ?? '';
  const date = `${pick('year')}-${pick('month')}-${pick('day')}`;
  const time = `${pick('hour')}:${pick('minute')}${options.seconds ? `:${pick('second')}` : ''}`;
  return `${date} ${time}`;
};

export type DurationParts = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

/** The four units `formatDuration` and the panel's translated durations share. */
export const durationParts = (ms: number): DurationParts => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
};

/** `3d 4h`, `45m`, `12s`. */
export const formatDuration = (ms: number): string => {
  const { days, hours, minutes, seconds } = durationParts(ms);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
};

export type RelativeLabels = {
  justNow: string;
  future: (duration: string) => string;
  past: (duration: string) => string;
  /** Defaults to `formatDuration`; the panel supplies a translated one. */
  duration?: (ms: number) => string;
};

const DEFAULT_RELATIVE_LABELS: RelativeLabels = {
  justNow: 'just now',
  future: (duration) => `in ${duration}`,
  past: (duration) => `${duration} ago`,
};

/** `in 15d 3h` for a future stamp, `3h ago` for a past one, `just now` within a minute. */
export const formatRelative = (
  iso: string | null,
  now: number,
  labels: RelativeLabels = DEFAULT_RELATIVE_LABELS,
): string => {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const delta = ms - now;
  if (Math.abs(delta) < 60_000) return labels.justNow;
  const duration = (labels.duration ?? formatDuration)(Math.abs(delta));
  return delta > 0 ? labels.future(duration) : labels.past(duration);
};
