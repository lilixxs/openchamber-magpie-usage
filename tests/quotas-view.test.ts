// The quota card's view model: pools, tiers, window order, remaining-first
// figures, balance parts, and logo ids. Pure, so these are exact.
import { describe, expect, test } from 'bun:test';

import { decodeQuotas, type QuotaCard, type QuotaWindow } from '../src/shared/magpie.ts';
import { ICON_NAMES, PROVIDER_ICONS } from '../src/shared/provider-icons.generated.ts';
import {
  GENERIC_LOGO,
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

/** Icon names the generator must ship, checked without hard-coding the table. */
const STABLE_IDS = ['claude', 'codex', 'copilot', 'antigravity', 'workbuddy', 'openrouter'] as const;

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
  test('the stable acknowledged provider ids have a generated mapping', () => {
    for (const id of STABLE_IDS) {
      expect({ id, mapped: Object.hasOwn(PROVIDER_ICONS, id) }).toEqual({ id, mapped: true });
      expect((ICON_NAMES as readonly string[]).includes(PROVIDER_ICONS[id] ?? '')).toBe(true);
    }
  });

  test('a provider with a shipped mark resolves through the chain to a packaged name', () => {
    for (const id of STABLE_IDS) {
      const logo = logoFor(`r-magpie/${id}`);
      expect(logo).not.toBe(GENERIC_LOGO);
      expect((ICON_NAMES as readonly string[]).includes(logo)).toBe(true);
    }
  });

  test('a config override wins over the generated mapping and the file names', () => {
    // `kimi` is a bundled mark, so the override can take over.
    expect(logoFor('r-magpie/openrouter', { openrouter: 'kimi' })).toBe('kimi');
    expect(logoFor('r-magpie/unknown-provider', { 'unknown-provider': 'kimi' })).toBe('kimi');
    // The template's way of collapsing every provider into the keys icon.
    expect(logoFor('r-magpie/~keys', { '~keys': 'magpie' })).toBe('magpie');
    expect(logoFor(null, { something: 'kimi' })).toBe(GENERIC_LOGO);
    expect(logoFor('', { something: 'kimi' })).toBe(GENERIC_LOGO);
  });

  test('a non-bundled override value falls through the chain instead of taking over', () => {
    // `__missing-icon__` ships under no name, so it cannot take over.
    expect(logoFor('r-magpie/openrouter', { openrouter: '__missing-icon__' })).toBe(
      logoFor('r-magpie/openrouter'),
    );
    // A provider with its own mark keeps that mark as an override of its own,
    // and a value the bundle does not carry falls back to the chain.
    expect(logoFor('r-magpie/claude', { claude: '__missing-icon__' })).not.toBe(GENERIC_LOGO);
    expect((ICON_NAMES as readonly string[]).includes(logoFor('r-magpie/claude'))).toBe(true);
    for (const overrides of [
      { openrouter: '__missing-icon__' },
      { openrouter: '' },
      { openrouter: 7 } as unknown as Record<string, string>,
    ]) {
      expect(logoFor('r-magpie/openrouter', overrides)).toBe(logoFor('r-magpie/openrouter'));
    }
  });

  test('override lookups are own-property checks; prototype keys stay as plain names', () => {
    const overrides = JSON.parse('{"__proto__":"kimi","constructor":"commandcode"}') as Record<string, string>;
    // A provider literally named `__proto__` resolves like any other name.
    expect(logoFor('r-magpie/__proto__', overrides)).toBe('kimi');
    expect(logoFor('r-magpie/constructor', overrides)).toBe('commandcode');
    // Everyone else keeps their own resolution; nothing was polluted.
    expect(logoFor('r-magpie/workbuddy', overrides)).toBe(logoFor('r-magpie/workbuddy'));
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect('kimi' in ({} as Record<string, unknown>)).toBe(false);
    expect(logoFor('r-magpie/x', overrides)).toBe(GENERIC_LOGO);
  });

  test('the old hand-written aliases are gone and stay generic without overrides', () => {
    expect(logoFor('r-magpie/openai-mm')).toBe(GENERIC_LOGO);
    expect(logoFor('r-magpie/~keys')).toBe(GENERIC_LOGO);
  });

  test('anything without a mark still gets the generic glyph', () => {
    expect(logoFor('r-magpie/our-free-model')).toBe(GENERIC_LOGO);
    expect(logoFor(null)).toBe(GENERIC_LOGO);
    expect(logoFor('')).toBe(GENERIC_LOGO);
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
