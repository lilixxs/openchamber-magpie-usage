import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  loadMessages,
  loadRegistry,
  readRegistry,
  resolveLocale,
  type LocaleEntry,
} from '../src/i18n/locale.ts';
import { createTranslator, interpolate, type Messages } from '../src/i18n/messages.ts';

const root = join(import.meta.dir, '..');
const localesDir = join(root, 'panel', 'locales');
const PLURAL_CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

const readText = (path: string): string => readFileSync(path, 'utf8');

const registry = (): LocaleEntry[] => {
  const entries = readRegistry(readText(join(localesDir, 'index.json')));
  if (!entries) throw new Error('panel/locales/index.json is not a valid registry');
  return entries;
};

const messagesFor = (code: string): Messages => {
  const value: unknown = JSON.parse(readText(join(localesDir, `${code}.json`)));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${code}.json is not an object`);
  }
  return value as Messages;
};

const pluralBase = (key: string): string | null => {
  const dot = key.lastIndexOf('.');
  if (dot < 0) return null;
  return PLURAL_CATEGORIES.has(key.slice(dot + 1)) ? key.slice(0, dot) : null;
};

const pluralBases = (messages: Messages): Set<string> => {
  const bases = new Set<string>();
  for (const key of Object.keys(messages)) {
    const base = pluralBase(key);
    if (base !== null) bases.add(base);
  }
  return bases;
};

const pluralForms = (messages: Messages, base: string): string[] =>
  Object.keys(messages)
    .filter((key) => pluralBase(key) === base)
    .map((key) => key.slice(base.length + 1));

const nonPluralKeys = (messages: Messages): string[] =>
  Object.keys(messages).filter((key) => pluralBase(key) === null);

const placeholders = (template: string): string[] =>
  [...template.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .filter((name): name is string => typeof name === 'string')
    .sort();

const categoriesFor = (code: string): string[] =>
  [...new Intl.PluralRules(code).resolvedOptions().pluralCategories].sort();

describe('locale registry', () => {
  test('lists unique codes with existing bundles', () => {
    const entries = registry();
    const codes = entries.map((entry) => entry.code);
    expect(codes.length).toBeGreaterThan(0);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain('en');

    const panelSource = readText(join(root, 'src', 'panel', 'app.ts'));
    for (const entry of entries) {
      expect(entry.name.trim()).not.toBe('');
      expect(['ltr', 'rtl']).toContain(entry.dir);
      expect(existsSync(join(localesDir, `${entry.code}.json`))).toBe(true);
      // Test fixtures stay out of the runtime bundle; every other registry
      // entry must be imported, or it could pass the JSON checks but never render.
      if (!entry.test) {
        expect(panelSource.includes(`panel/locales/${entry.code}.json`)).toBe(true);
      }
    }
  });

  test('rejects malformed registries', () => {
    expect(readRegistry('not json')).toBeNull();
    expect(readRegistry('[]')).toBeNull();
    expect(readRegistry('[{"code":"en","name":"English","dir":"up"}]')).toBeNull();
    expect(readRegistry('[{"code":"","name":"English","dir":"ltr"}]')).toBeNull();
    expect(readRegistry('[{"code":"en","name":"English","dir":"ltr","test":"yes"}]')).toBeNull();
  });

  test('marks the Arabic fixture as right-to-left', () => {
    const entry = registry().find((candidate) => candidate.code === 'ar');
    expect(entry).toBeDefined();
    expect(entry?.dir).toBe('rtl');
    expect(entry?.test).toBe(true);
  });

  test('keeps the Arabic fixture out of the runtime import and bundle', () => {
    const source = readText(join(root, 'src', 'panel', 'app.ts'));
    expect(source).not.toContain('panel/locales/ar.json');
    const marker = messagesFor('ar')['period.today'] ?? '';
    expect(marker).not.toBe('');
    expect(readText(join(root, 'panel', 'main.js')).includes(marker)).toBe(false);
  });

  test('loadRegistry reads index.json through the injected fetcher', async () => {
    const body = readText(join(localesDir, 'index.json'));
    const entries = await loadRegistry(async (path) => {
      expect(path).toBe('./locales/index.json');
      return body;
    });
    expect(entries).toEqual(registry());
  });
});

describe('language bundles', () => {
  test('contain only non-empty string values', () => {
    for (const entry of registry()) {
      const messages = messagesFor(entry.code);
      expect(Object.keys(messages).length).toBeGreaterThan(0);
      for (const [key, text] of Object.entries(messages)) {
        expect(typeof text).toBe('string');
        expect(text.trim()).not.toBe('');
        expect(key).not.toBe('');
      }
    }
  });

  test('have the same keys, plural forms, and placeholders as English', () => {
    const english = messagesFor('en');
    const englishKeys = new Set(nonPluralKeys(english));
    const englishBases = pluralBases(english);

    for (const entry of registry()) {
      const messages = messagesFor(entry.code);

      expect(new Set(nonPluralKeys(messages))).toEqual(englishKeys);
      expect(pluralBases(messages)).toEqual(englishBases);

      for (const base of englishBases) {
        expect(pluralForms(messages, base).sort()).toEqual(categoriesFor(entry.code));
        const englishOther = english[`${base}.other`];
        expect(englishOther).toBeDefined();
        for (const key of Object.keys(messages)) {
          if (pluralBase(key) !== base) continue;
          expect(placeholders(messages[key] ?? '')).toEqual(placeholders(englishOther ?? ''));
        }
      }

      for (const key of nonPluralKeys(english)) {
        expect(placeholders(messages[key] ?? '')).toEqual(placeholders(english[key] ?? ''));
      }
    }
  });

  test('loadMessages accepts a bundle and rejects malformed documents', async () => {
    expect(await loadMessages(async () => '{"a":"b"}', 'en')).toEqual({ a: 'b' });
    expect(await loadMessages(async () => '{"a":1}', 'en')).toBeNull();
    expect(await loadMessages(async () => '[]', 'en')).toBeNull();
    expect(
      await loadMessages(async () => {
        throw new Error('offline');
      }, 'en'),
    ).toBeNull();
  });
});

describe('interpolate', () => {
  test('replaces known placeholders and keeps unknown ones', () => {
    expect(interpolate('HTTP {status} · {name}', { status: 200, name: 'magpie' })).toBe(
      'HTTP 200 · magpie',
    );
    expect(interpolate('Hi {name} {missing}', { name: 'Ada' })).toBe('Hi Ada {missing}');
    expect(interpolate('No placeholders', { unused: 1 })).toBe('No placeholders');
  });
});

describe('createTranslator', () => {
  const fallback: Messages = {
    greeting: 'Hello {name}',
    'items.one': '{count} item',
    'items.other': '{count} items',
    fallbackOnly: 'Fallback only',
  };
  const german: Messages = {
    greeting: 'Hallo {name}',
    'items.one': '{count} Element',
    'items.other': '{count} Elemente',
  };

  test('uses the active bundle and interpolates', () => {
    const t = createTranslator({ messages: german, fallback, locale: 'en' });
    expect(t('greeting', { name: 'Ada' })).toBe('Hallo Ada');
  });

  test('falls back to English and then to the key', () => {
    const t = createTranslator({ messages: german, fallback, locale: 'en' });
    expect(t('fallbackOnly')).toBe('Fallback only');
    expect(t('missing.key')).toBe('missing.key');
  });

  test('selects English plural categories from count', () => {
    const t = createTranslator({ messages: german, fallback, locale: 'en' });
    expect(t('items', { count: 1 })).toBe('1 Element');
    expect(t('items', { count: 2 })).toBe('2 Elemente');
  });

  test('uses only the other form for Chinese', () => {
    const t = createTranslator({
      messages: { 'items.other': '{count} 项' },
      fallback,
      locale: 'zh-CN',
    });
    expect(t('items', { count: 1 })).toBe('1 项');
    expect(t('items', { count: 5 })).toBe('5 项');
  });

  test('treats an invalid locale tag as other', () => {
    const t = createTranslator({
      messages: { 'items.other': 'fallback other' },
      fallback: {},
      locale: 'not a locale',
    });
    expect(t('items', { count: 1 })).toBe('fallback other');
  });
});

describe('resolveLocale', () => {
  const codes = ['en', 'zh-CN'];

  test('auto follows an exact host match', () => {
    expect(resolveLocale('auto', 'zh-CN', codes)).toEqual({ locale: 'zh-CN', unsupported: false });
  });

  test('auto falls back to English without an exact match', () => {
    expect(resolveLocale('auto', 'zh-TW', codes).locale).toBe('en');
    expect(resolveLocale('auto', 'de', codes).locale).toBe('en');
  });

  test('the test-only Arabic fixture is not a runtime match', () => {
    const runtime = ['en', 'zh-CN'];
    expect(resolveLocale('auto', 'ar', runtime)).toEqual({ locale: 'en', unsupported: false });
    expect(resolveLocale('ar', 'en', runtime)).toEqual({ locale: 'en', unsupported: true });
  });

  test('an explicit supported language wins over the host', () => {
    expect(resolveLocale('zh-CN', 'de', codes)).toEqual({ locale: 'zh-CN', unsupported: false });
  });

  test('an explicit unsupported language falls back to auto and is flagged', () => {
    expect(resolveLocale('fr', 'de', codes)).toEqual({ locale: 'en', unsupported: true });
  });
});
