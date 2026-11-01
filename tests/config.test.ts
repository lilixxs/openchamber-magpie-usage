import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_BASE_URL,
  DEFAULT_REFRESH_SECONDS,
  MAX_CARD_ORDER,
  MAX_CARD_ORDER_KEY,
  applyCardOrder,
  cardOrderKey,
  cardOrderKeys,
  isLoopbackHostname,
  normaliseBaseUrl,
  parseCardOrder,
  parseConfigText,
  type QuotaCard,
} from '../src/shared/magpie.ts';
import { commandCodeCards } from './fixtures.ts';

const issueOf = (text: string): string | null => parseConfigText(text).config.issue?.message ?? null;

describe('config parsing', () => {
  test('a full file yields the endpoint, the key, and the interval', () => {
    const { config } = parseConfigText(
      JSON.stringify({ baseUrl: 'https://magpie.example.com/', apiKey: 'key-123', refreshSeconds: 120 }),
    );
    expect(config.issue).toBeNull();
    expect(config.baseUrl).toBe('https://magpie.example.com');
    expect(config.host).toBe('magpie.example.com');
    expect(config.loopback).toBe(false);
    expect(config.apiKey).toBe('key-123');
    expect(config.refreshSeconds).toBe(120);
    expect(config.source).toBe('file');
    expect(config.present).toBe(true);
  });

  test('an empty object keeps the documented defaults', () => {
    const { config } = parseConfigText('{}');
    expect(config.issue).toBeNull();
    expect(config.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(config.apiKey).toBeNull();
    expect(config.refreshSeconds).toBe(DEFAULT_REFRESH_SECONDS);
  });

  test('unknown keys are ignored', () => {
    const { config } = parseConfigText(JSON.stringify({ baseUrl: 'http://127.0.0.1:4000', extra: true }));
    expect(config.issue).toBeNull();
    expect(config.baseUrl).toBe('http://127.0.0.1:4000');
  });

  test('language defaults to auto and keeps an explicit value', () => {
    expect(parseConfigText('{}').config.language).toBe('auto');
    expect(parseConfigText('{}').config.languageInvalid).toBe(false);
    const { config } = parseConfigText(JSON.stringify({ language: 'zh-CN' }));
    expect(config.language).toBe('zh-CN');
    expect(config.languageInvalid).toBe(false);
  });

  test('an unusable language falls back to auto without degrading the endpoint', () => {
    for (const language of ['', 42, null, true]) {
      const { config } = parseConfigText(
        JSON.stringify({ baseUrl: 'https://magpie.example.com', apiKey: 'key-123', language }),
      );
      expect(config.issue).toBeNull();
      expect(config.baseUrl).toBe('https://magpie.example.com');
      expect(config.apiKey).toBe('key-123');
      expect(config.language).toBe('auto');
      expect(config.languageInvalid).toBe(true);
    }
  });

  test('an unknown language is kept for the panel to resolve', () => {
    const { config } = parseConfigText(JSON.stringify({ language: 'ja' }));
    expect(config.language).toBe('ja');
    expect(config.languageInvalid).toBe(false);
  });

  test('a path prefix on the endpoint is kept', () => {
    const { config } = parseConfigText(JSON.stringify({ baseUrl: 'https://example.com/magpie/' }));
    expect(config.baseUrl).toBe('https://example.com/magpie');
  });

  test('broken JSON falls back to the loopback default and reports why', () => {
    const { config } = parseConfigText('{ not json');
    expect(config.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(config.present).toBe(true);
    expect(config.issue?.kind).toBe('invalid-json');
  });

  test('a JSON array is not a config object', () => {
    const { config } = parseConfigText('[1,2,3]');
    expect(config.issue?.kind).toBe('invalid');
    expect(config.baseUrl).toBe(DEFAULT_BASE_URL);
  });

  test('plain http is refused off loopback', () => {
    expect(issueOf(JSON.stringify({ baseUrl: 'http://magpie.example.com' }))).toContain('https');
  });

  test('https off loopback is accepted', () => {
    expect(parseConfigText(JSON.stringify({ baseUrl: 'https://magpie.example.com' })).config.issue).toBeNull();
  });

  test('loopback over http is accepted on every spelling', () => {
    for (const url of ['http://127.0.0.1:3425', 'http://localhost:3425', 'http://127.5.5.5:1', 'http://[::1]:3425']) {
      expect(parseConfigText(JSON.stringify({ baseUrl: url })).config.issue).toBeNull();
    }
  });

  test('a relative endpoint is refused', () => {
    expect(issueOf(JSON.stringify({ baseUrl: '/v1' }))).not.toBeNull();
  });

  test('a non-http scheme is refused', () => {
    expect(issueOf(JSON.stringify({ baseUrl: 'ftp://example.com' }))).toContain('http');
  });

  test('credentials in the endpoint are refused', () => {
    expect(issueOf(JSON.stringify({ baseUrl: 'https://user:pass@example.com' }))).toContain('credentials');
  });

  test('a query or fragment in the endpoint is refused', () => {
    expect(issueOf(JSON.stringify({ baseUrl: 'https://example.com/?a=1' }))).not.toBeNull();
    expect(issueOf(JSON.stringify({ baseUrl: 'https://example.com/#x' }))).not.toBeNull();
  });

  test('a non-string endpoint is refused', () => {
    expect(issueOf(JSON.stringify({ baseUrl: 42 }))).toContain('string');
  });

  test('an empty key is refused rather than treated as present', () => {
    expect(issueOf(JSON.stringify({ apiKey: '   ' }))).toContain('empty');
  });

  test('a key with whitespace or control characters is refused', () => {
    expect(issueOf(JSON.stringify({ apiKey: 'a b' }))).toContain('whitespace');
    expect(issueOf(JSON.stringify({ apiKey: 'a\nb' }))).toContain('whitespace');
  });

  test('a non-string key is refused', () => {
    expect(issueOf(JSON.stringify({ apiKey: 5 }))).toContain('string');
  });

  test('refreshSeconds must be an integer inside 5..3600', () => {
    expect(issueOf(JSON.stringify({ refreshSeconds: 4 }))).toContain('between');
    expect(issueOf(JSON.stringify({ refreshSeconds: 3601 }))).toContain('between');
    expect(issueOf(JSON.stringify({ refreshSeconds: 1.5 }))).toContain('integer');
    expect(issueOf(JSON.stringify({ refreshSeconds: '60' }))).toContain('integer');
    expect(parseConfigText(JSON.stringify({ refreshSeconds: 5 })).config.refreshSeconds).toBe(5);
    expect(parseConfigText(JSON.stringify({ refreshSeconds: 3600 })).config.refreshSeconds).toBe(3600);
  });

  test('an invalid file still leaves a usable endpoint', () => {
    const { config } = parseConfigText(JSON.stringify({ baseUrl: 'http://example.com' }));
    expect(config.issue).not.toBeNull();
    expect(config.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(config.refreshSeconds).toBe(DEFAULT_REFRESH_SECONDS);
  });

  test('the issue never echoes the key', () => {
    const { config } = parseConfigText(JSON.stringify({ apiKey: 'secret-key-value', refreshSeconds: 0 }));
    const serialised = JSON.stringify(config);
    expect(serialised.includes('secret-key-value')).toBe(false);
  });
});

describe('cardOrder in the config file', () => {
  test('a valid order is kept', () => {
    const order = ['r-magpie%2Fworkbuddy|subscription|Lilixxs', 'r-magpie%2Fdeepseek|balance|'];
    const { config } = parseConfigText(JSON.stringify({ cardOrder: order }));
    expect(config.cardOrder).toEqual(order);
    expect(config.issue).toBeNull();
  });

  test('a missing order is an empty list', () => {
    expect(parseConfigText('{}').config.cardOrder).toEqual([]);
    expect(parseConfigText('{ not json').config.cardOrder).toEqual([]);
  });

  test('a bad order never degrades the endpoint', () => {
    for (const cardOrder of ['nope', 42, { a: 1 }, null, [1, null, true], [['x']], ['']]) {
      const { config } = parseConfigText(
        JSON.stringify({ baseUrl: 'https://magpie.example.com', apiKey: 'key-123', cardOrder }),
      );
      expect(config.issue).toBeNull();
      expect(config.baseUrl).toBe('https://magpie.example.com');
      expect(config.apiKey).toBe('key-123');
      expect(config.cardOrder).toEqual([]);
    }
  });

  test('bad entries are dropped, good ones kept', () => {
    expect(parseCardOrder(['a', 7, '', 'b', null, 'c'])).toEqual(['a', 'b', 'c']);
    const atLimit = 'x'.repeat(MAX_CARD_ORDER_KEY);
    expect(parseCardOrder([atLimit, 'y'.repeat(MAX_CARD_ORDER_KEY + 1)])).toEqual([atLimit]);
  });

  test('a runaway list is truncated', () => {
    const long = Array.from({ length: MAX_CARD_ORDER + 20 }, (_, index) => `key-${index}`);
    const order = parseCardOrder(long);
    expect(order.length).toBe(MAX_CARD_ORDER);
    expect(order[MAX_CARD_ORDER - 1]).toBe(`key-${MAX_CARD_ORDER - 1}`);
  });

  test('a bad order does not stop the rest of the file from applying', () => {
    const { config } = parseConfigText(JSON.stringify({ refreshSeconds: 15, cardOrder: 'nope' }));
    expect(config.refreshSeconds).toBe(15);
    expect(config.cardOrder).toEqual([]);
  });
});

describe('card order keys', () => {
  const card = (overrides: Partial<QuotaCard>): QuotaCard => ({
    provider: 'r-magpie/x',
    name: 'X',
    kind: null,
    plan: null,
    user: null,
    balance: null,
    error: null,
    readAt: null,
    from: null,
    windows: [],
    ...overrides,
  });

  test('the key joins the encoded provider, kind, and user', () => {
    expect(cardOrderKey(card({ provider: 'r-magpie/workbuddy', kind: 'subscription', user: 'Lilixxs' }))).toBe(
      'r-magpie%2Fworkbuddy|subscription|Lilixxs',
    );
    expect(cardOrderKey(card({ provider: 'a|b', kind: null, user: null }))).toBe('a%7Cb||');
  });

  test('two cards that differ only by kind stay distinct', () => {
    const [plan, balance] = commandCodeCards.map((entry) => card(entry as Partial<QuotaCard>));
    expect(plan && balance ? cardOrderKey(plan) !== cardOrderKey(balance) : false).toBe(true);
  });

  test('an identical triple gets #2 and #3 in gateway order', () => {
    const cards = [card({ kind: 'plan' }), card({ kind: 'plan' }), card({ kind: 'plan' })];
    expect(cardOrderKeys(cards)).toEqual(['r-magpie%2Fx|plan|', 'r-magpie%2Fx|plan|#2', 'r-magpie%2Fx|plan|#3']);
  });
});

describe('applying a stored order', () => {
  const card = (kind: string): QuotaCard => ({
    provider: 'r-magpie/x',
    name: kind,
    kind,
    plan: null,
    user: null,
    balance: null,
    error: null,
    readAt: null,
    from: null,
    windows: [],
  });

  test('known cards follow the order and unknown ones keep gateway order after', () => {
    const cards = [card('a'), card('b'), card('c')];
    const keys = cardOrderKeys(cards);
    const ordered = applyCardOrder(cards, [keys[2]!, keys[0]!]);
    expect(ordered.map((entry) => entry.card.kind)).toEqual(['c', 'a', 'b']);
    expect(ordered.map((entry) => entry.key)).toEqual([keys[2]!, keys[0]!, keys[1]!]);
  });

  test('stale keys are ignored', () => {
    const cards = [card('a'), card('b')];
    const ordered = applyCardOrder(cards, ['r-magpie%2Fgone|plan|', ...cardOrderKeys(cards)]);
    expect(ordered.map((entry) => entry.card.kind)).toEqual(['a', 'b']);
  });

  test('an empty order leaves gateway order', () => {
    const cards = [card('a'), card('b')];
    expect(applyCardOrder(cards, []).map((entry) => entry.card.kind)).toEqual(['a', 'b']);
  });

  test('a suffixed key round-trips through the same list', () => {
    const cards = [card('plan'), card('plan'), card('balance')];
    const keys = cardOrderKeys(cards);
    const ordered = applyCardOrder(cards, [keys[1]!, keys[0]!, keys[2]!]);
    expect(ordered.map((entry) => entry.card.kind)).toEqual(['plan', 'plan', 'balance']);
    expect(ordered.map((entry) => entry.key)).toEqual([keys[1]!, keys[0]!, keys[2]!]);
  });
});

describe('normaliseBaseUrl', () => {
  test('loopback host detection', () => {
    expect(isLoopbackHostname('127.0.0.1')).toBe(true);
    expect(isLoopbackHostname('localhost')).toBe(true);
    expect(isLoopbackHostname('::1')).toBe(true);
    expect(isLoopbackHostname('[::1]')).toBe(true);
    expect(isLoopbackHostname('127.0.0.1.example.com')).toBe(false);
    expect(isLoopbackHostname('magpie.example.com')).toBe(false);
  });

  test('reports the host with its non-default port', () => {
    const parsed = normaliseBaseUrl('http://127.0.0.1:3425');
    expect(parsed).toEqual({ ok: true, baseUrl: 'http://127.0.0.1:3425', host: '127.0.0.1:3425', loopback: true });
  });
});
