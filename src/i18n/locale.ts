/**
 * Locale registry and bundle loading. `panel/locales/index.json` is the list;
 * `panel/locales/<code>.json` holds flat dot-separated keys.
 */
import en from '../../panel/locales/en.json';
import type { Messages } from './messages.ts';

export type LocaleDirection = 'ltr' | 'rtl';

export type LocaleEntry = {
  code: string;
  /** Endonym shown to translators; the panel itself never renders a picker. */
  name: string;
  dir: LocaleDirection;
  /** Fixture locale kept for layout coverage, not a language users are offered. */
  test?: boolean;
};

export type ResolvedLocale = {
  locale: string;
  /** True when an explicit setting names a language that is not in the registry. */
  unsupported: boolean;
};

export type Fetcher = (path: string) => Promise<string>;

export const FALLBACK_LOCALE = 'en';

/** English fallback for the pure translator helpers; the panel imports every bundle directly. */
export const FALLBACK_MESSAGES: Messages = en;

const isDirection = (value: unknown): value is LocaleDirection => value === 'ltr' || value === 'rtl';

/** Parses `index.json`; null when the document is not a non-empty list of valid entries. */
export const readRegistry = (body: string): LocaleEntry[] | null => {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length === 0) return null;

  const entries: LocaleEntry[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null;
    const record = item as Record<string, unknown>;
    const { code, name, dir, test } = record;
    if (typeof code !== 'string' || code === '') return null;
    if (typeof name !== 'string' || name === '') return null;
    if (!isDirection(dir)) return null;
    if (test !== undefined && typeof test !== 'boolean') return null;
    entries.push(test === undefined ? { code, name, dir } : { code, name, dir, test });
  }
  return entries;
};

/** `auto` follows the host locale when the registry has an exact match. */
export const resolveLocale = (
  setting: string,
  hostLocale: string,
  codes: readonly string[],
): ResolvedLocale => {
  const auto = codes.includes(hostLocale) ? hostLocale : FALLBACK_LOCALE;
  if (setting === 'auto') return { locale: auto, unsupported: false };
  if (codes.includes(setting)) return { locale: setting, unsupported: false };
  return { locale: auto, unsupported: true };
};

export const loadRegistry = async (fetchText: Fetcher): Promise<LocaleEntry[] | null> => {
  try {
    return readRegistry(await fetchText('./locales/index.json'));
  } catch {
    return null;
  }
};

/** Loads one bundle; null on a failed request or a malformed document. */
export const loadMessages = async (fetchText: Fetcher, code: string): Promise<Messages | null> => {
  try {
    const value: unknown = JSON.parse(await fetchText(`./locales/${code}.json`));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const messages: Messages = {};
    for (const [key, text] of Object.entries(value)) {
      if (typeof text !== 'string' || text === '') return null;
      messages[key] = text;
    }
    return messages;
  } catch {
    return null;
  }
};
