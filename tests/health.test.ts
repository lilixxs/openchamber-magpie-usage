import { describe, expect, test } from 'bun:test';

import { readHealth } from '../src/shared/health.ts';

describe('readHealth', () => {
  test('accepts the service health answer', () => {
    expect(readHealth('{"ok":true,"name":"magpie-usage","apiVersion":1}')).toEqual({
      ok: true,
      name: 'magpie-usage',
      apiVersion: 1,
    });
  });

  test('rejects malformed JSON', () => {
    expect(readHealth('not json')).toBeNull();
  });

  test('rejects an object with the wrong shape', () => {
    expect(readHealth('{"ok":true}')).toBeNull();
    expect(readHealth('{"ok":false,"name":"magpie-usage","apiVersion":1}')).toBeNull();
    expect(readHealth('[]')).toBeNull();
  });
});
