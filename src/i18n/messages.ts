/** Pure translation helpers. No DOM and no fetch, so tests can run them directly. */
export type Messages = Record<string, string>;

export type MessageVars = Record<string, string | number>;

export type Translator = (key: string, vars?: MessageVars) => string;

export type CreateTranslatorOptions = {
  messages: Messages;
  /** English messages; consulted when the active language lacks a key. */
  fallback: Messages;
  /** BCP 47 tag the plural rules use. */
  locale: string;
};

/** Replaces `{name}`; a placeholder without a value is left as written. */
export const interpolate = (template: string, vars?: MessageVars): string => {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
};

const pluralCategory = (locale: string, count: number): string => {
  try {
    return new Intl.PluralRules(locale).select(count);
  } catch {
    // An unsupported tag must not break rendering; `other` is the CLDR catch-all.
    return 'other';
  }
};

/**
 * Looks up `key`, then `key.<pluralCategory>` when `count` is a number, then
 * `key.other`, then the same chain in `fallback`, and finally returns the key.
 */
export const createTranslator = ({ messages, fallback, locale }: CreateTranslatorOptions): Translator => {
  return (key, vars) => {
    const count = vars?.count;
    const category = typeof count === 'number' ? pluralCategory(locale, count) : null;
    const candidates = category === null ? [key] : [key, `${key}.${category}`, `${key}.other`];
    for (const source of [messages, fallback]) {
      for (const candidate of candidates) {
        const template = source[candidate];
        if (template !== undefined) return interpolate(template, vars);
      }
    }
    return key;
  };
};
