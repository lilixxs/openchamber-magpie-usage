/**
 * Contract shared by the panel and the local service: the configuration file,
 * the upstream payloads as they are normalised for the panel, and the error
 * vocabulary the panel renders.
 *
 * No Node or DOM imports. The panel bundle and the service both load this file.
 */

export const DEFAULT_BASE_URL = 'http://127.0.0.1:3425';
export const DEFAULT_REFRESH_SECONDS = 60;
export const MIN_REFRESH_SECONDS = 5;
export const MAX_REFRESH_SECONDS = 3600;

export const CONFIG_DIR_NAME = 'openchamber-magpie-usage';
export const CONFIG_FILE_NAME = 'config.json';
/** Shown in the README and in error text; the service reports the absolute path. */
export const CONFIG_RELATIVE_PATH = `~/.config/${CONFIG_DIR_NAME}/${CONFIG_FILE_NAME}`;

/** Periods the panel offers. The gateway also accepts `all` and date ranges; we do not. */
export const PERIODS = ['today', '7d', '30d'] as const;
export type Period = (typeof PERIODS)[number];

export const isPeriod = (value: unknown): value is Period =>
  typeof value === 'string' && (PERIODS as readonly string[]).includes(value);

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

export type ConfigSource = 'file' | 'default';

export type ConfigIssueKind = 'invalid-json' | 'invalid' | 'unreadable';

/** Ceilings for `cardOrder`, so a runaway list cannot bloat the config file. */
export const MAX_CARD_ORDER = 500;
export const MAX_CARD_ORDER_KEY = 200;

/**
 * A config file the service had to replace. The panel shows it rather than
 * letting the parse error disappear with the rewrite.
 */
export type ResetNotice = {
  /** When the reset happened, ISO 8601. */
  at: string;
  /** Where the unusable file was copied. */
  backupPath: string;
};

export type ConfigIssue = {
  kind: ConfigIssueKind;
  /** Safe to show: never contains the API key. */
  message: string;
};

/** `auto` follows the host locale; any other value is matched against the locale registry. */
export const DEFAULT_LANGUAGE = 'auto';

export type ServiceConfig = {
  /** Normalised endpoint, no trailing slash. Always an absolute http(s) URL. */
  baseUrl: string;
  /** `URL.host`, i.e. host plus port when it is not the scheme default. */
  host: string;
  loopback: boolean;
  apiKey: string | null;
  refreshSeconds: number;
  /** Quota card order, oldest first. Lenient: a bad value never breaks the rest. */
  cardOrder: string[];
  /** Language setting; `auto` when missing or unusable. */
  language: string;
  /** True when `language` was present but not a non-empty string. */
  languageInvalid: boolean;
  source: ConfigSource;
  /** Whether a config file was found at the configured path. */
  present: boolean;
  issue: ConfigIssue | null;
};

/** What `/config` answers. Deliberately has no field that can carry the key. */
export type ConfigReport = {
  configPath: string;
  baseUrl: string;
  host: string;
  loopback: boolean;
  apiKeyConfigured: boolean;
  refreshSeconds: number;
  cardOrder: string[];
  /** Language setting; `auto` when missing or unusable. */
  language: string;
  /** True when `language` was present but not a non-empty string. */
  languageInvalid: boolean;
  /** Present after the service replaced an unusable file; `null` otherwise. */
  reset: ResetNotice | null;
  source: ConfigSource;
  present: boolean;
  issue: ConfigIssue | null;
};

export const fallbackConfig = (): ServiceConfig => ({
  baseUrl: DEFAULT_BASE_URL,
  host: '127.0.0.1:3425',
  loopback: true,
  apiKey: null,
  refreshSeconds: DEFAULT_REFRESH_SECONDS,
  cardOrder: [],
  language: DEFAULT_LANGUAGE,
  languageInvalid: false,
  source: 'default',
  present: false,
  issue: null,
});

const LOOPBACK_V4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export const isLoopbackHostname = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '::1' || hostname === '[::1]' || LOOPBACK_V4.test(hostname);

type BaseUrlResult = { ok: true; baseUrl: string; host: string; loopback: boolean } | { ok: false; message: string };

/**
 * Normalises a configured endpoint.
 *
 * Rules: absolute http(s) URL, no credentials, no query, no hash; plain http
 * only for a loopback host. A path prefix is kept, so a gateway behind a
 * reverse-proxy prefix still works.
 */
export const normaliseBaseUrl = (raw: string): BaseUrlResult => {
  const text = raw.trim();
  if (text === '') return { ok: false, message: 'baseUrl is empty.' };

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, message: 'baseUrl is not an absolute URL.' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, message: 'baseUrl must use http or https.' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, message: 'baseUrl must not carry credentials; put the key in apiKey.' };
  }
  if (url.search !== '' || url.hash !== '') {
    return { ok: false, message: 'baseUrl must not carry a query or a fragment.' };
  }
  if (url.hostname === '') return { ok: false, message: 'baseUrl has no host.' };

  const loopback = isLoopbackHostname(url.hostname);
  if (url.protocol === 'http:' && !loopback) {
    return { ok: false, message: 'A non-loopback baseUrl must use https.' };
  }

  const path = url.pathname.replace(/\/+$/, '');
  return { ok: true, baseUrl: `${url.origin}${path}`, host: url.host, loopback };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isControlOrSpace = /[\s\u0000-\u001f\u007f]/;

/**
 * Reads `cardOrder`. Unlike `baseUrl` and `apiKey`, a bad value is dropped
 * entry by entry: the order is cosmetic, so it can never degrade the endpoint.
 */
export const parseCardOrder = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const order: string[] = [];
  for (const entry of value) {
    if (order.length >= MAX_CARD_ORDER) break;
    if (typeof entry !== 'string') continue;
    if (entry.length === 0 || entry.length > MAX_CARD_ORDER_KEY) continue;
    order.push(entry);
  }
  return order;
};

const parseConfigObject = (value: Record<string, unknown>): { ok: true; config: ServiceConfig } | { ok: false; message: string } => {
  let baseUrl = DEFAULT_BASE_URL;
  let host = '127.0.0.1:3425';
  let loopback = true;

  if (value.baseUrl !== undefined) {
    if (typeof value.baseUrl !== 'string') return { ok: false, message: 'baseUrl must be a string.' };
    const parsed = normaliseBaseUrl(value.baseUrl);
    if (!parsed.ok) return { ok: false, message: parsed.message };
    baseUrl = parsed.baseUrl;
    host = parsed.host;
    loopback = parsed.loopback;
  }

  let apiKey: string | null = null;
  if (value.apiKey !== undefined && value.apiKey !== null) {
    if (typeof value.apiKey !== 'string') return { ok: false, message: 'apiKey must be a string.' };
    const key = value.apiKey.trim();
    if (key === '') return { ok: false, message: 'apiKey is empty; remove the field instead.' };
    if (key.length > 4096) return { ok: false, message: 'apiKey is longer than 4096 characters.' };
    if (isControlOrSpace.test(key)) return { ok: false, message: 'apiKey must not contain whitespace or control characters.' };
    apiKey = key;
  }

  let refreshSeconds = DEFAULT_REFRESH_SECONDS;
  if (value.refreshSeconds !== undefined) {
    const raw = value.refreshSeconds;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) {
      return { ok: false, message: 'refreshSeconds must be an integer.' };
    }
    if (raw < MIN_REFRESH_SECONDS || raw > MAX_REFRESH_SECONDS) {
      return {
        ok: false,
        message: `refreshSeconds must be between ${MIN_REFRESH_SECONDS} and ${MAX_REFRESH_SECONDS}.`,
      };
    }
    refreshSeconds = raw;
  }

  // A bad language never resets the endpoint or the key: it falls back to auto
  // and the panel shows a notice. The service does not decide whether the code
  // exists; the panel checks it against the locale registry.
  let language = DEFAULT_LANGUAGE;
  let languageInvalid = false;
  if (value.language !== undefined) {
    if (typeof value.language === 'string' && value.language !== '') language = value.language;
    else languageInvalid = true;
  }

  return {
    ok: true,
    config: {
      baseUrl,
      host,
      loopback,
      apiKey,
      refreshSeconds,
      cardOrder: parseCardOrder(value.cardOrder),
      language,
      languageInvalid,
      source: 'file',
      present: true,
      issue: null,
    },
  };
};

/**
 * Parses the config file text. Anything unusable yields the fallback endpoint
 * plus an issue the panel shows, so a typo never leaves the panel blank.
 */
export const parseConfigText = (text: string): { config: ServiceConfig } => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {
      config: {
        ...fallbackConfig(),
        present: true,
        source: 'file',
        issue: { kind: 'invalid-json', message: 'The config file is not valid JSON.' },
      },
    };
  }

  if (!isRecord(value)) {
    return {
      config: {
        ...fallbackConfig(),
        present: true,
        source: 'file',
        issue: { kind: 'invalid', message: 'The config file must hold a JSON object.' },
      },
    };
  }

  const parsed = parseConfigObject(value);
  if (!parsed.ok) {
    return {
      config: {
        ...fallbackConfig(),
        present: true,
        source: 'file',
        issue: { kind: 'invalid', message: parsed.message },
      },
    };
  }
  return { config: parsed.config };
};

/* -------------------------------------------------------------------------- */
/* Usage summary                                                              */
/* -------------------------------------------------------------------------- */

export type UsageTotals = {
  calls: number;
  errors: number;
  retried: number;
  loops: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  /** `null` when the gateway sent no usable number, so the panel can print a dash. */
  cost: number | null;
  unpriced: number;
  credits: number | null;
  credited: number;
};

export type UsageBucket = {
  label: string;
  time: string | null;
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number | null;
};

export type UsageReport = {
  endpoint: string;
  host: string;
  loopback: boolean;
  fetchedAt: string;
  period: string;
  since: string | null;
  totals: UsageTotals;
  series: UsageBucket[];
};

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const count = (value: unknown): number => finite(value) ?? 0;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const readBucket = (value: unknown): UsageBucket | null => {
  if (!isRecord(value)) return null;
  const label = text(value.label) ?? text(value.time);
  if (label === null) return null;
  return {
    label,
    time: text(value.time),
    calls: count(value.calls),
    input: count(value.input),
    output: count(value.output),
    cacheRead: count(value.cache_read),
    cacheWrite: count(value.cache_write),
    cost: finite(value.cost),
  };
};

export type Decoded<T> = { ok: true; value: T } | { ok: false; message: string };

/** Reads `GET /v1/magpie/usage` from the gateway. */
export const decodeUsage = (value: unknown): Decoded<{ period: string; since: string | null; totals: UsageTotals; series: UsageBucket[] }> => {
  if (!isRecord(value)) return { ok: false, message: 'The gateway answer is not a JSON object.' };
  if (finite(value.calls) === null) {
    return { ok: false, message: 'The gateway answer has no numeric `calls` field.' };
  }
  if (!Array.isArray(value.series)) {
    return { ok: false, message: 'The gateway answer has no `series` array.' };
  }

  const series: UsageBucket[] = [];
  for (const entry of value.series) {
    const bucket = readBucket(entry);
    if (bucket) series.push(bucket);
  }

  return {
    ok: true,
    value: {
      period: text(value.period) ?? 'unknown',
      since: text(value.since),
      totals: {
        calls: count(value.calls),
        errors: count(value.errors),
        retried: count(value.retried),
        loops: count(value.loops),
        input: count(value.input),
        output: count(value.output),
        cacheRead: count(value.cache_read),
        cacheWrite: count(value.cache_write),
        reasoning: count(value.reasoning),
        cost: finite(value.cost),
        unpriced: count(value.unpriced),
        credits: finite(value.credits),
        credited: count(value.credited),
      },
      series,
    },
  };
};

/* -------------------------------------------------------------------------- */
/* Quota cards                                                                */
/* -------------------------------------------------------------------------- */

export type QuotaWindow = {
  name: string | null;
  used: number | null;
  remaining: number | null;
  amount: number | null;
  limit: number | null;
  unit: string | null;
  display: string | null;
  resetsAt: string | null;
  runsOutAt: string | null;
  runsOut: number | null;
  pool: string | null;
  unlimited: boolean;
};

export type QuotaCard = {
  provider: string | null;
  name: string;
  kind: string | null;
  plan: string | null;
  user: string | null;
  balance: string | null;
  error: string | null;
  readAt: string | null;
  from: string | null;
  windows: QuotaWindow[];
};

export type QuotaReport = {
  endpoint: string;
  host: string;
  loopback: boolean;
  fetchedAt: string;
  /** Whether these cards are the gateway's own cached answer (`kept=1`). */
  kept: boolean;
  /** True when a manual refresh was served from the throttle window. */
  throttled: boolean;
  /**
   * True when the cards are an earlier snapshot: the gateway's `kept=1` cache
   * was empty, or the manual refresh was throttled.
   */
  stale: boolean;
  /** When the returned cards were read from the gateway. */
  asOf: string | null;
  cards: QuotaCard[];
};

const readWindow = (value: unknown): QuotaWindow | null => {
  if (!isRecord(value)) return null;
  return {
    name: text(value.name),
    used: finite(value.used),
    remaining: finite(value.remaining),
    amount: finite(value.amount),
    limit: finite(value.limit),
    unit: text(value.unit),
    display: text(value.display),
    resetsAt: text(value.resetsAt),
    runsOutAt: text(value.runsOutAt),
    runsOut: finite(value.runsOut),
    pool: text(value.pool),
    unlimited: value.unlimited === true,
  };
};

const readCard = (value: unknown): QuotaCard | null => {
  if (!isRecord(value)) return null;
  const windows: QuotaWindow[] = [];
  if (Array.isArray(value.windows)) {
    for (const entry of value.windows) {
      const window = readWindow(entry);
      if (window) windows.push(window);
    }
  }
  const provider = text(value.provider);
  const name = text(value.name) ?? provider;
  return {
    provider,
    name: name ?? 'Unnamed card',
    kind: text(value.kind),
    plan: text(value.plan),
    user: text(value.user),
    balance: text(value.balance),
    error: text(value.error),
    readAt: text(value.readAt),
    from: text(value.from),
    windows,
  };
};

/** Reads `GET /v1/magpie/quotas` from the gateway: `{ data: QuotaCard[] }`. */
export const decodeQuotas = (value: unknown): Decoded<QuotaCard[]> => {
  if (!isRecord(value)) return { ok: false, message: 'The gateway answer is not a JSON object.' };
  if (!Array.isArray(value.data)) {
    return { ok: false, message: 'The gateway answer has no `data` array of quota cards.' };
  }
  const cards: QuotaCard[] = [];
  for (const entry of value.data) {
    const card = readCard(entry);
    if (card) cards.push(card);
  }
  return { ok: true, value: cards };
};

/* -------------------------------------------------------------------------- */
/* Quota card order                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A card's stable identity in `cardOrder`.
 *
 * Percent-encoded so `|` inside a provider, kind, or user cannot collide, and
 * so two cards that differ only by kind (the two `commandcode` cards) stay
 * distinct. Two cards with an identical triple get `#2`, `#3` in gateway
 * order, assigned by {@link cardOrderKeys}.
 */
export const cardOrderKey = (card: QuotaCard): string =>
  `${encodeURIComponent(card.provider ?? '')}|${encodeURIComponent(card.kind ?? '')}|${encodeURIComponent(
    card.user ?? '',
  )}`;

export type OrderedCard = {
  key: string;
  card: QuotaCard;
};

/** One key per card, in gateway order, suffixed when a triple repeats. */
export const cardOrderKeys = (cards: QuotaCard[]): string[] => {
  const seen = new Map<string, number>();
  return cards.map((card) => {
    const base = cardOrderKey(card);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}#${count}`;
  });
};

/**
 * Sorts cards by the stored order. Keys the gateway no longer reports are
 * ignored; cards the order does not mention keep gateway order at the end.
 */
export const applyCardOrder = (cards: QuotaCard[], order: string[]): OrderedCard[] => {
  const keys = cardOrderKeys(cards);
  const rank = new Map<string, number>();
  order.forEach((key, index) => {
    if (!rank.has(key)) rank.set(key, index);
  });

  const known: OrderedCard[] = [];
  const rest: OrderedCard[] = [];
  cards.forEach((card, index) => {
    const entry: OrderedCard = { key: keys[index] ?? cardOrderKey(card), card };
    if (rank.has(entry.key)) known.push(entry);
    else rest.push(entry);
  });
  known.sort((left, right) => (rank.get(left.key) ?? 0) - (rank.get(right.key) ?? 0));
  return [...known, ...rest];
};

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

export type ServiceErrorKind =
  | 'bad-request'
  | 'internal'
  | 'upstream-unauthorized'
  | 'upstream-forbidden'
  | 'upstream-status'
  | 'upstream-timeout'
  | 'upstream-network'
  | 'upstream-not-json'
  | 'upstream-schema'
  | 'upstream-redirect';

export type ServiceErrorBody = {
  error: {
    kind: ServiceErrorKind;
    message: string;
    status?: number;
    endpoint?: string;
  };
};

/** One sentence per kind, so the panel and the tests agree on the wording. */
export const describeServiceError = (kind: ServiceErrorKind | undefined): string => {
  switch (kind) {
    case 'bad-request':
      return 'The panel asked for something the service does not serve.';
    case 'internal':
      return 'The local service failed to build an answer.';
    case 'upstream-unauthorized':
      return 'The gateway rejected the API key (HTTP 401). Check apiKey in the config file.';
    case 'upstream-forbidden':
      return 'The gateway refused this key (HTTP 403). It is limited to other models or accounts.';
    case 'upstream-status':
      return 'The gateway answered with an unexpected status.';
    case 'upstream-timeout':
      return 'The gateway did not answer in time.';
    case 'upstream-network':
      return 'The gateway could not be reached.';
    case 'upstream-not-json':
      return 'The gateway answered, but not with JSON.';
    case 'upstream-schema':
      return 'The gateway answered with JSON, but not with magpie usage data.';
    case 'upstream-redirect':
      return 'The gateway redirected to another origin. The redirect was not followed, so the key never leaves its origin.';
    default:
      return 'The local service answered with an unknown error.';
  }
};

export const isServiceErrorBody = (value: unknown): value is ServiceErrorBody => {
  if (!isRecord(value) || !isRecord(value.error)) return false;
  return typeof value.error.kind === 'string' && typeof value.error.message === 'string';
};
