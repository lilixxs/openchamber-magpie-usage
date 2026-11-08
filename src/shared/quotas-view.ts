/**
 * The quota card's view model: pools, tiers, window order, remaining-first
 * figures, balance parts, and which logo a provider gets.
 *
 * Pure functions over the decoded gateway payload: no DOM, no Node, nothing
 * from `service/` or `panel/`, so the panel bundle and the tests share them.
 */
import type { QuotaCard, QuotaWindow } from './magpie.ts';
import { formatAmount, quotaUsedPercent } from './format.ts';
import { ICON_NAMES, PROVIDER_ICONS } from './provider-icons.generated.ts';

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

export type LogoId = string;

/** The bundled fallback mark: this repo's own glyph, never a provider's. */
export const GENERIC_LOGO: LogoId = 'generic';

/** Names that actually shipped in the bundle, plus this repo's own fallback. */
const PACKAGED_ICONS: ReadonlySet<string> = new Set([...ICON_NAMES, GENERIC_LOGO]);

const owns = (record: Readonly<Record<string, unknown>>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

/** An icon name the bundle really carries; config values are not trusted. */
const bundled = (name: unknown): name is string =>
  typeof name === 'string' && PACKAGED_ICONS.has(name);

/** The part after the provider's last `/`: the id magpie names the card after. */
const providerKey = (provider: string): string => {
  const cut = provider.lastIndexOf('/');
  return cut === -1 ? provider : provider.slice(cut + 1);
};

/**
 * The icon for a card, in four steps:
 *
 * 1. `providerIcons` from `config.jsonc`, keyed by the provider id;
 * 2. the mapping generated from magpie's own provider icons;
 * 3. a bundled file named after the id (`id`, `id-color`, `id.png`);
 * 4. the generic glyph.
 *
 * A step only wins with a bundled icon name, so a typo in the config falls
 * through silently instead of rendering a broken mark. `constructor` and
 * `__proto__` are plain strings here: every lookup is an own-property check,
 * so a provider name can never reach object internals.
 */
export const logoFor = (
  provider: string | null,
  overrides?: Readonly<Record<string, string>> | null,
): LogoId => {
  if (!provider) return GENERIC_LOGO;
  const key = providerKey(provider);
  if (key === '') return GENERIC_LOGO;

  if (overrides) {
    const configured = owns(overrides, key) ? overrides[key] : undefined;
    if (bundled(configured)) return configured;
  }

  const mapped = owns(PROVIDER_ICONS, key) ? PROVIDER_ICONS[key] : undefined;
  if (bundled(mapped)) return mapped;

  for (const candidate of [key, `${key}-color`, `${key}.png`]) {
    if (PACKAGED_ICONS.has(candidate)) return candidate;
  }
  return GENERIC_LOGO;
};
