/**
 * The quota card's view model: pools, tiers, window order, remaining-first
 * figures, balance parts, and which logo a provider gets.
 *
 * Pure functions over the decoded gateway payload: no DOM, no Node, nothing
 * from `service/` or `panel/`, so the panel bundle and the tests share them.
 */
import type { QuotaCard, QuotaWindow } from './magpie.ts';
import { formatAmount, quotaUsedPercent } from './format.ts';

/* -------------------------------------------------------------------------- */
/* Pools and tiers                                                            */
/* -------------------------------------------------------------------------- */

export type PoolRow = {
  /** The pool's name, or the window's own name for a window that has no pool. */
  pool: string;
  /** Windows kept for this pool, tightest-to-loosest irrelevant; ordered by length. */
  windows: QuotaWindow[];
};

const SEPARATOR = ' · ';

/** The part of a name after its last ` · `: the model or the duration. */
export const windowTail = (name: string | null): string => {
  if (!name) return '';
  const cut = name.lastIndexOf(SEPARATOR);
  return cut === -1 ? name : name.slice(cut + SEPARATOR.length);
};

/**
 * A per-model tier, the way Antigravity reports them: `Gemini · Gemini 3.8
 * Flash (High)`. Scoped to the three words magpie uses, and only meaningful
 * inside a pool, so another version's naming cannot quietly eat windows.
 */
const TIER = /\((high|low|medium)\)$/i;

export const isTierWindow = (window: QuotaWindow): boolean => TIER.test(windowTail(window.name).trim());

const DURATION = /^(\d+)\s*(hour|day|week)s?$/i;
const HOURS_PER_UNIT: Record<string, number> = { hour: 1, day: 24, week: 168 };

/**
 * Fixed names magpie uses for windows that carry no `N days` figure. They sit
 * after every parsed length and before anything unknown.
 */
const NAMED_RANK: Record<string, number> = { weekly: 1e6, month: 1e6 + 1, credits: 1e6 + 2 };
const UNKNOWN_RANK = 1e9;

/**
 * A window's length in hours, for ordering: `5 hours` < `7 days` < `Weekly` <
 * `Month` < `Credits` < anything else, which keeps payload order (sort is
 * stable). A pool window's name is `<pool> · <length>`, so the tail is used.
 */
export const windowRank = (window: QuotaWindow): number => {
  const name = windowTail(window.name).trim();
  const match = DURATION.exec(name);
  if (match) {
    const amount = Number(match[1]);
    const unit = (match[2] ?? '').toLowerCase();
    const hours = HOURS_PER_UNIT[unit];
    if (Number.isFinite(amount) && hours !== undefined) return amount * hours;
  }
  return NAMED_RANK[name.toLowerCase()] ?? UNKNOWN_RANK;
};

const usedShare = (window: QuotaWindow): number => quotaUsedPercent(window) ?? 0;

/**
 * Groups a card's windows into one row per pool, in payload order of first
 * appearance, plus one trailing row for every window that names no pool.
 *
 * Per-model tiers are dropped inside a pool; a pool that only ever reported
 * tiers keeps its most-used one, so a card never loses its last window. A
 * window with no pool is never treated as a tier: the `(High)/(Low)/(Medium)`
 * names are Antigravity's pool wording, and dropping a window outside a pool
 * would hide a provider's real limit.
 */
export const groupWindows = (card: QuotaCard): PoolRow[] => {
  const byPool = new Map<string, QuotaWindow[]>();
  const loose: QuotaWindow[] = [];
  for (const window of card.windows) {
    if (window.pool === null) {
      loose.push(window);
      continue;
    }
    const existing = byPool.get(window.pool);
    if (existing) existing.push(window);
    else byPool.set(window.pool, [window]);
  }

  const byRank = (left: QuotaWindow, right: QuotaWindow): number => windowRank(left) - windowRank(right);

  const rows: PoolRow[] = [];
  for (const [pool, windows] of byPool) {
    const durations = windows.filter((window) => !isTierWindow(window));
    let kept = durations;
    if (kept.length === 0) {
      kept = [windows.reduce((best, window) => (usedShare(window) > usedShare(best) ? window : best))];
    }
    rows.push({ pool, windows: [...kept].sort(byRank) });
  }
  if (loose.length > 0) rows.push({ pool: '', windows: [...loose].sort(byRank) });
  return rows;
};

/** The least remaining figure across a card's windows, as a 0..100 share. */
export const tightestLeftPercent = (card: QuotaCard): number | null => {
  const lefts: number[] = [];
  for (const window of card.windows) {
    if (window.unlimited) continue;
    const used = quotaUsedPercent(window);
    if (used !== null) lefts.push(100 - used);
  }
  return lefts.length === 0 ? null : Math.min(...lefts);
};

/* -------------------------------------------------------------------------- */
/* Figures                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The line under a window's bar, remaining first: `left / limit unit`.
 *
 * `limit − amount` is the remaining figure, so a card whose gateway reported
 * both shows the number the bar is drawn from rather than the spent one. The
 * gateway's own `display` is kept verbatim when there is nothing to subtract,
 * and a window that only reports `remaining` reads `N unit left`.
 */
export type LeftTemplate = (amount: string, unit: string) => string;

const defaultLeft: LeftTemplate = (amount, unit) => `${amount}${unit} left`;

export const remainingAmountLine = (
  window: QuotaWindow,
  left: LeftTemplate = defaultLeft,
): string | null => {
  const unit = window.unit ? ` ${window.unit}` : '';
  if (window.limit !== null && window.limit > 0 && window.amount !== null) {
    return `${formatAmount(window.limit - window.amount)} / ${formatAmount(window.limit)}${unit}`;
  }
  if (window.display) return window.display;
  if (window.remaining !== null) return left(formatAmount(window.remaining), unit);
  return null;
};

export type BalancePart = {
  /** `null` for a one-segment balance or a segment with no label part. */
  label: string | null;
  value: string;
};

/**
 * Splits a gateway balance string into label/value rows: `balance` is one
 * ` · `-joined line on the `openai-mm` card, around fourteen segments long, so
 * it becomes a table instead of a paragraph.
 */
export const balanceParts = (balance: string | null): BalancePart[] => {
  const text = balance?.trim() ?? '';
  if (text === '') return [];
  const segments = text
    .split(SEPARATOR)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');
  if (segments.length === 0) return [];
  if (segments.length === 1) return [{ label: null, value: segments[0] ?? '' }];

  return segments.map((segment) => {
    const cut = segment.lastIndexOf(' ');
    if (cut <= 0) return { label: null, value: segment };
    return { label: segment.slice(0, cut).trim(), value: segment.slice(cut + 1) };
  });
};

/* -------------------------------------------------------------------------- */
/* Logos                                                                      */
/* -------------------------------------------------------------------------- */

export type LogoId =
  | 'workbuddy'
  | 'antigravity'
  | 'deepseek'
  | 'kimi'
  | 'commandcode'
  | 'opencode'
  | 'openrouter'
  | 'openai'
  | 'magpie'
  | 'generic';

/** Provider id suffix (after the last `/`) to logo, for the providers magpie knows. */
const LOGO_BY_SUFFIX: Record<string, LogoId> = {
  workbuddy: 'workbuddy',
  antigravity: 'antigravity',
  deepseek: 'deepseek',
  kimi: 'kimi',
  'kimi-code': 'kimi',
  'kimi-code-cn': 'kimi',
  commandcode: 'commandcode',
  opencode: 'opencode',
  'opencode-go': 'opencode',
  openrouter: 'openrouter',
  openai: 'openai',
  'openai-mm': 'openai',
  '~keys': 'magpie',
  magpie: 'magpie',
};

/**
 * The logo for a card. Remote cards all carry `provider: "r-magpie/<id>"` and
 * no `icon` field, so the identity is the id suffix; anything unrecognised
 * gets the generic glyph rather than a broken image.
 */
export const logoFor = (provider: string | null): LogoId => {
  if (!provider) return 'generic';
  const cut = provider.lastIndexOf('/');
  const suffix = cut === -1 ? provider : provider.slice(cut + 1);
  return LOGO_BY_SUFFIX[suffix] ?? 'generic';
};
