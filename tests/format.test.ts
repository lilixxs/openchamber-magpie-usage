import { describe, expect, test } from 'bun:test';

import {
  cacheHitRate,
  formatAmount,
  formatCompact,
  formatCost,
  formatCredits,
  formatDuration,
  formatInt,
  formatPercent,
  formatRelative,
  formatWhen,
  quotaAmountLine,
  quotaLeftPercent,
  quotaUsedPercent,
} from '../src/shared/format.ts';
import type { QuotaWindow } from '../src/shared/magpie.ts';

const window = (value: Partial<QuotaWindow>): QuotaWindow => ({
  name: null,
  used: null,
  remaining: null,
  amount: null,
  limit: null,
  unit: null,
  display: null,
  resetsAt: null,
  runsOutAt: null,
  runsOut: null,
  pool: null,
  unlimited: false,
  ...value,
});

describe('formatting', () => {
  test('integers are grouped', () => {
    expect(formatInt(0)).toBe('0');
    expect(formatInt(999)).toBe('999');
    expect(formatInt(6274)).toBe('6,274');
    expect(formatInt(16_184_969)).toBe('16,184,969');
    expect(formatInt(-1234)).toBe('-1,234');
    expect(formatInt(null)).toBe('—');
  });

  test('compact token counts', () => {
    expect(formatCompact(999)).toBe('999');
    expect(formatCompact(1500)).toBe('1.5k');
    expect(formatCompact(2_500_000)).toBe('2.5M');
    expect(formatCompact(1_200_000_000)).toBe('1.2B');
    expect(formatCompact(Number.NaN)).toBe('—');
  });

  test('costs follow the gateway precision steps', () => {
    expect(formatCost(0)).toBe('≈$0.000');
    expect(formatCost(0.000777)).toBe('≈$0.001');
    expect(formatCost(1.3668395)).toBe('≈$1.37');
    expect(formatCost(53.2038)).toBe('≈$53.20');
    expect(formatCost(123.4)).toBe('≈$123');
    expect(formatCost(null)).toBe('—');
  });

  test('credits trim trailing zeros and mark a tiny positive value', () => {
    expect(formatCredits(109.75000000000001)).toBe('109.75');
    expect(formatCredits(517.04)).toBe('517.04');
    expect(formatCredits(0.004)).toBe('<0.01');
    expect(formatCredits(0)).toBe('0');
    expect(formatCredits(null)).toBe('—');
  });

  test('quota amounts group integers and keep two decimals otherwise', () => {
    expect(formatAmount(5165)).toBe('5,165');
    expect(formatAmount(998.04)).toBe('998.04');
    expect(formatAmount(null)).toBe('—');
  });

  test('hit rate is cache_read over input + cache_read + cache_write', () => {
    expect(cacheHitRate(100, 300, 0)).toBe(0.75);
    expect(cacheHitRate(0, 0, 0)).toBeNull();
    expect(cacheHitRate(0, 0, 0.0001)).toBe(0);
    expect(cacheHitRate(-1, 0, 0)).toBeNull();
    expect(cacheHitRate(Number.NaN, 10, 0)).toBeNull();
  });

  test('hit rate never prints NaN or 0% for an empty denominator', () => {
    const rate = cacheHitRate(0, 0, 0);
    expect(rate).toBeNull();
    expect(formatPercent(rate)).toBe('—');
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(0.5)).toBe('50%');
    expect(formatPercent(0.943)).toBe('94.3%');
  });

  test('window percentage falls back through used, remaining, then amount/limit', () => {
    expect(quotaUsedPercent(window({ used: 19.32, remaining: 80.68 }))).toBeCloseTo(19.32);
    expect(quotaUsedPercent(window({ remaining: 95 }))).toBe(5);
    expect(quotaUsedPercent(window({ amount: 18.64, limit: 70 }))).toBeCloseTo(26.6286, 3);
    expect(quotaUsedPercent(window({ used: 140 }))).toBe(100);
    expect(quotaUsedPercent(window({ used: -5 }))).toBe(0);
    expect(quotaUsedPercent(window({ unlimited: true, used: 10 }))).toBeNull();
    expect(quotaUsedPercent(window({}))).toBeNull();
    expect(quotaLeftPercent(window({ used: 19.32 }))).toBeCloseTo(80.68);
  });

  test('the amount line prefers the gateway display string', () => {
    expect(quotaAmountLine(window({ display: '998.04 / 5165', amount: 998.04, limit: 5165, unit: 'credits' }))).toBe(
      '998.04 / 5165',
    );
    expect(quotaAmountLine(window({ amount: 998.04, limit: 5165, unit: 'credits' }))).toBe('998.04 / 5,165 credits');
    expect(quotaAmountLine(window({ remaining: 12.5, unit: 'USD' }))).toBe('12.5 USD left');
    expect(quotaAmountLine(window({}))).toBeNull();
  });

  test('stamps are fixed-shape and zone-explicit', () => {
    expect(formatWhen('2026-11-01T00:00:00+08:00', { timeZone: 'UTC' })).toBe('2026-10-31 16:00');
    expect(formatWhen('2026-11-16T04:00:14Z', { timeZone: 'UTC' })).toBe('2026-11-16 04:00');
    expect(formatWhen('2026-11-16T04:00:14Z', { timeZone: 'UTC', seconds: true })).toBe('2026-11-16 04:00:14');
    expect(formatWhen(null)).toBe('—');
    expect(formatWhen('not a date')).toBe('—');
  });

  test('durations and relative stamps', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(90 * 60_000)).toBe('1h 30m');
    expect(formatDuration(26 * 3_600_000)).toBe('1d 2h');
    const now = Date.parse('2026-11-01T12:00:00Z');
    expect(formatRelative('2026-11-01T11:00:00Z', now)).toBe('1h ago');
    expect(formatRelative('2026-11-01T12:00:30Z', now)).toBe('just now');
    expect(formatRelative('2026-11-16T15:30:00Z', now)).toBe('in 15d 3h');
    expect(formatRelative(null, now)).toBe('—');
    expect(formatRelative('nope', now)).toBe('—');
  });
});
