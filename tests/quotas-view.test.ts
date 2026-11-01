// The quota card's view model: pools, tiers, window order, remaining-first
// figures, balance parts, and logo ids. Pure, so these are exact.
import { describe, expect, test } from 'bun:test';

import { decodeQuotas, type QuotaCard, type QuotaWindow } from '../src/shared/magpie.ts';
import {
  balanceParts,
  groupWindows,
  isTierWindow,
  logoFor,
  remainingAmountLine,
  tightestLeftPercent,
  windowRank,
  windowTail,
} from '../src/shared/quotas-view.ts';
import { antigravityCard, commandCodeCards, quotaPayload } from './fixtures.ts';

const cardOf = (value: unknown): QuotaCard => {
  const decoded = decodeQuotas({ data: [value] });
  if (!decoded.ok || !decoded.value[0]) throw new Error('fixture did not decode');
  return decoded.value[0];
};

const windowOf = (value: Record<string, unknown>): QuotaWindow => {
  const card = cardOf({ provider: 'r-magpie/x', windows: [value] });
  const window = card.windows[0];
  if (!window) throw new Error('window did not decode');
  return window;
};

describe('pool grouping', () => {
  test('Antigravity collapses into three pool rows and five windows', () => {
    const rows = groupWindows(cardOf(antigravityCard));

    expect(rows.map((row) => row.pool)).toEqual(['Claude & GPT', 'Gemini', 'Gemini 4 Argon']);
    // The nine `(High)`/`(Low)`/`(Medium)` tiers are gone; the durations stay.
    expect(rows.map((row) => row.windows.length)).toEqual([2, 2, 1]);
    expect(rows.flatMap((row) => row.windows).map((window) => windowTail(window.name))).toEqual([
      '5 hours',
      '7 days',
      '5 hours',
      '7 days',
      '7 days',
    ]);
  });

  test('windows inside a pool are ordered by length, not payload order', () => {
    const rows = groupWindows(cardOf(antigravityCard));
    const gemini = rows.find((row) => row.pool === 'Gemini');
    expect(gemini?.windows.map((window) => windowTail(window.name))).toEqual(['5 hours', '7 days']);
  });

  test('a card with no pools keeps every window in one row, ordered by length', () => {
    const card = cardOf({
      provider: 'r-magpie/opencode-go',
      kind: 'plan',
      windows: [
        { name: '5 hours', used: 2, remaining: 98 },
        { name: '7 days', used: 6, remaining: 94 },
        { name: 'Month', used: 3, remaining: 97 },
      ],
    });
    const rows = groupWindows(card);
    expect(rows.length).toBe(1);
    expect(rows[0]?.windows.map((window) => windowTail(window.name))).toEqual(['5 hours', '7 days', 'Month']);
  });

  test('windows with no pool share one unlabelled row', () => {
    const rows = groupWindows(
      cardOf({ provider: 'r-magpie/x', windows: [{ name: 'Limit', used: 0, remaining: 100 }] }),
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.pool).toBe('');
    expect(rows[0]?.windows[0]?.name).toBe('Limit');
  });

  test('a pool-less window is not a tier, whatever its name', () => {
    const card = cardOf({
      provider: 'r-magpie/x',
      windows: [
        { name: 'Flash (High)', used: 10, remaining: 90 },
        { name: 'Flash (Low)', used: 42, remaining: 58 },
      ],
    });
    expect(groupWindows(card)[0]?.windows.length).toBe(2);
  });

  test('a pool of tiers only keeps its most-used tier', () => {
    const card = cardOf({
      provider: 'r-magpie/x',
      windows: [
        { name: 'Gemini · Flash (High)', used: 10, remaining: 90, pool: 'Gemini' },
        { name: 'Gemini · Flash (Low)', used: 42, remaining: 58, pool: 'Gemini' },
        { name: 'Gemini · Flash (Medium)', used: 1, remaining: 99, pool: 'Gemini' },
      ],
    });
    const rows = groupWindows(card);
    expect(rows.length).toBe(1);
    expect(rows[0]?.windows.map((window) => windowTail(window.name))).toEqual(['Flash (Low)']);
  });

  test('only (High)/(Low)/(Medium) after the last separator count as tiers', () => {
    expect(isTierWindow(windowOf({ name: 'Gemini · Flash (High)', used: 0 }))).toBe(true);
    expect(isTierWindow(windowOf({ name: 'Flash (High)', used: 0 }))).toBe(true);
    expect(isTierWindow(windowOf({ name: 'Gemini · 5 hours', used: 0 }))).toBe(false);
    expect(isTierWindow(windowOf({ name: 'Credits (Monthly)', used: 0 }))).toBe(false);
    expect(isTierWindow(windowOf({ name: 'Gemini · Flash (highest)', used: 0 }))).toBe(false);
    expect(isTierWindow(windowOf({ used: 0 }))).toBe(false);
  });
});

describe('window order', () => {
  test('lengths sort as hours, then the named windows, then the unknown', () => {
    const names = ['Credits', 'Month', '7 days', 'unknown thing', '5 hours', 'Weekly', '1 week'];
    const ranked = names
      .map((name) => windowOf({ name, used: 0 }))
      .sort((left, right) => windowRank(left) - windowRank(right))
      .map((window) => window.name);
    expect(ranked).toEqual(['5 hours', '7 days', '1 week', 'Weekly', 'Month', 'Credits', 'unknown thing']);
  });

  test('rank reads past a pool prefix', () => {
    expect(windowRank(windowOf({ name: 'Gemini · 5 hours', used: 0 }))).toBe(5);
    expect(windowRank(windowOf({ name: 'Gemini · 7 days', used: 0 }))).toBe(168);
  });
});

describe('remaining amounts', () => {
  test('limit minus amount is the figure, with the unit', () => {
    expect(remainingAmountLine(windowOf({ amount: 998.04, limit: 5165, unit: 'credits' }))).toBe(
      '4166.96 / 5,165 credits',
    );
  });

  test('a zero limit falls through to the gateway display', () => {
    expect(remainingAmountLine(windowOf({ amount: 3, limit: 0, display: '3 / 0 tokens' }))).toBe('3 / 0 tokens');
  });

  test('display is kept verbatim when there is nothing to subtract', () => {
    expect(remainingAmountLine(windowOf({ display: '$18.64 / $70.00' }))).toBe('$18.64 / $70.00');
  });

  test('remaining alone reads as N unit left', () => {
    expect(remainingAmountLine(windowOf({ remaining: 89.904684, unit: 'requests' }))).toBe('89.9 requests left');
    expect(remainingAmountLine(windowOf({ remaining: 100 }))).toBe('100 left');
  });

  test('nothing to show yields null, never NaN', () => {
    expect(remainingAmountLine(windowOf({}))).toBeNull();
  });
});

describe('balance parts', () => {
  test('the live openai-mm balance splits into label/value rows', () => {
    const parts = balanceParts(
      '余额 $26.36 · 已用额度 $73.64 · 额度余量 26.4% · 今日花费 $0.00 · 配额模式 unrestricted · 平均响应秒 20.35',
    );
    expect(parts.length).toBe(6);
    expect(parts[0]).toEqual({ label: '余额', value: '$26.36' });
    expect(parts[1]).toEqual({ label: '已用额度', value: '$73.64' });
    expect(parts[4]).toEqual({ label: '配额模式', value: 'unrestricted' });
    expect(parts[5]).toEqual({ label: '平均响应秒', value: '20.35' });
  });

  test('a single segment stays whole', () => {
    expect(balanceParts('¥21.08')).toEqual([{ label: null, value: '¥21.08' }]);
    expect(balanceParts('余额 $26.36')).toEqual([{ label: null, value: '余额 $26.36' }]);
  });

  test('a segment with no label part stays whole', () => {
    expect(balanceParts('a · b')).toEqual([
      { label: null, value: 'a' },
      { label: null, value: 'b' },
    ]);
  });

  test('an absent balance has no rows', () => {
    expect(balanceParts(null)).toEqual([]);
    expect(balanceParts('   ')).toEqual([]);
  });
});

describe('tightest remaining', () => {
  test('reports the least left across a card, ignoring unlimited windows', () => {
    const card = cardOf(commandCodeCards[0]);
    expect(tightestLeftPercent(card)).toBeCloseTo(69.89201201, 6);
  });

  test('null when no window carries a number', () => {
    expect(tightestLeftPercent(cardOf({ provider: 'r-magpie/x', windows: [{ name: 'Limit', unlimited: true }] }))).toBeNull();
  });
});

describe('logo mapping', () => {
  test('maps the providers magpie ships and the two shared ids', () => {
    expect(logoFor('r-magpie/workbuddy')).toBe('workbuddy');
    expect(logoFor('r-magpie/antigravity')).toBe('antigravity');
    expect(logoFor('r-magpie/deepseek')).toBe('deepseek');
    expect(logoFor('r-magpie/kimi')).toBe('kimi');
    expect(logoFor('r-magpie/kimi-code')).toBe('kimi');
    expect(logoFor('r-magpie/kimi-code-cn')).toBe('kimi');
    expect(logoFor('r-magpie/commandcode')).toBe('commandcode');
    expect(logoFor('r-magpie/opencode-go')).toBe('opencode');
    expect(logoFor('r-magpie/openrouter')).toBe('openrouter');
    expect(logoFor('r-magpie/openai-mm')).toBe('openai');
    expect(logoFor('r-magpie/openai')).toBe('openai');
    expect(logoFor('r-magpie/~keys')).toBe('magpie');
  });

  test('anything unrecognised gets the generic glyph', () => {
    expect(logoFor('r-magpie/our-free-model')).toBe('generic');
    expect(logoFor('kimi')).toBe('kimi');
    expect(logoFor(null)).toBe('generic');
    expect(logoFor('')).toBe('generic');
  });
});

describe('the live payload decodes into rows', () => {
  test('every card yields at least one row and no NaN figure', () => {
    const decoded = decodeQuotas(quotaPayload);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    for (const card of decoded.value) {
      if (card.error) continue;
      const rows = groupWindows(card);
      if (card.windows.length > 0) expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        for (const window of row.windows) {
          const line = remainingAmountLine(window);
          if (line !== null) expect(line.includes('NaN')).toBe(false);
        }
      }
    }
  });
});
