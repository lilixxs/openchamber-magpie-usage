import { describe, expect, test } from 'bun:test';

import {
  inspectConfigDocument,
  parseConfigText,
  recoverConfigValues,
  setCardOrderText,
} from '../src/shared/config-document.ts';
import {
  DEFAULT_BASE_URL,
  DEFAULT_FONT_SCALE,
  DEFAULT_LANGUAGE,
  DEFAULT_REFRESH_SECONDS,
} from '../src/shared/magpie.ts';
import { renderConfigTemplate } from '../src/service/config-template.ts';

const fields = (text: string): string[] => parseConfigText(text).config.issues.map((issue) => issue.field);

describe('strict JSONC inspection', () => {
  test('accepts line and block comments', () => {
    const text = `{
      // a line comment
      "baseUrl": "https://magpie.example.com", /* a block comment */
      "refreshSeconds": 90
    }`;
    expect(inspectConfigDocument(text).state).toBe('ok');
    expect(parseConfigText(text).config.validity).toBe('valid');
  });

  test('does not treat // or /* inside strings as comments', () => {
    const text = `{
      "path": "https://example.com/a//b",
      "block": "/* not a comment */",
      "quote": "a\\"//b"
    }`;
    expect(inspectConfigDocument(text).state).toBe('ok');
  });

  test('rejects a trailing comma', () => {
    expect(inspectConfigDocument('{"baseUrl":"http://127.0.0.1:3425",}').state).toBe('syntax');
    expect(parseConfigText('{"baseUrl":"http://127.0.0.1:3425",}').config.issue?.kind).toBe('invalid-json');
  });

  test('rejects a truncated string, an empty file, and a non-object root', () => {
    expect(inspectConfigDocument('{"baseUrl": "https://magpie.example.com').state).toBe('syntax');
    expect(inspectConfigDocument('').state).toBe('syntax');
    expect(inspectConfigDocument('[1,2,3]').state).toBe('non-object');
    expect(inspectConfigDocument('null').state).toBe('non-object');
  });

  test('rejects duplicate top-level keys and allows a nested duplicate', () => {
    const duplicate = inspectConfigDocument('{"baseUrl":"https://a.example","baseUrl":"https://b.example"}');
    expect(duplicate.state).toBe('duplicate');
    if (duplicate.state === 'duplicate') expect(duplicate.keys).toEqual(['baseUrl']);

    const nested = '{"outer":{"x":1,"x":2}}';
    expect(inspectConfigDocument(nested).state).toBe('ok');
  });

  test('checks the whole document instead of trusting the tolerant value', () => {
    const inspection = inspectConfigDocument('{"a": 1 "b": 2}');
    expect(inspection.state).toBe('syntax');
    if (inspection.state === 'syntax') expect(inspection.errors.length).toBeGreaterThan(0);
  });

  test('validity includes lenient fields but keeps the endpoint', () => {
    const { config } = parseConfigText(
      '{"baseUrl":"https://magpie.example.com","fontScale":999,"cardOrder":["ok",2],"language":42}',
    );
    expect(config.validity).toBe('invalid');
    expect(config.issue).toBeNull();
    expect(config.baseUrl).toBe('https://magpie.example.com');
    expect(config.fontScale).toBe(DEFAULT_FONT_SCALE);
    expect(config.fontScaleInvalid).toBe(true);
    expect(config.cardOrder).toEqual(['ok']);
    expect(config.cardOrderInvalid).toBe(true);
    expect(config.language).toBe(DEFAULT_LANGUAGE);
    expect(config.languageInvalid).toBe(true);
    expect(config.issues.map((issue) => issue.field).sort()).toEqual(['cardOrder', 'fontScale', 'language']);
  });

  test('a fatal endpoint error still falls back to the whole default config', () => {
    const { config } = parseConfigText('{"baseUrl":"http://magpie.example.com","fontScale":150}');
    expect(config.validity).toBe('invalid');
    expect(config.issue?.kind).toBe('invalid');
    expect(config.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(config.fontScale).toBe(DEFAULT_FONT_SCALE);
    expect(fields('{"baseUrl":"http://magpie.example.com"}')).toEqual(['baseUrl']);
  });
});

describe('UTF-8 BOM', () => {
  const bom = '\uFEFF';

  test('accepts exactly one leading BOM and keeps endpoint and key', () => {
    const text = `${bom}{"baseUrl":"https://magpie.example.com","apiKey":"secret-key"}`;
    expect(inspectConfigDocument(text).state).toBe('ok');
    const { config } = parseConfigText(text);
    expect(config.validity).toBe('valid');
    expect(config.issue).toBeNull();
    expect(config.baseUrl).toBe('https://magpie.example.com');
    expect(config.apiKey).toBe('secret-key');
  });

  test('still rejects a second BOM, a mid-document BOM, a trailing comma, and duplicates', () => {
    expect(inspectConfigDocument(`${bom}${bom}{"baseUrl":"http://127.0.0.1:3425"}`).state).toBe(
      'syntax',
    );
    expect(
      inspectConfigDocument('{\uFEFF"baseUrl":"http://127.0.0.1:3425"}').state,
    ).toBe('syntax');
    expect(inspectConfigDocument(`${bom}{"baseUrl":"http://127.0.0.1:3425",}`).state).toBe(
      'syntax',
    );
    const duplicate = inspectConfigDocument(
      `${bom}{"baseUrl":"https://a.example","baseUrl":"https://b.example"}`,
    );
    expect(duplicate.state).toBe('duplicate');
  });

  test('the local cardOrder edit preserves the BOM, CRLF, and outside comments', () => {
    const text = `${bom}{\r\n  // keep\r\n  "cardOrder": [\r\n    "old"\r\n  ],\r\n  "baseUrl": "https://magpie.example.com"\r\n}\r\n`;
    const next = setCardOrderText(text, ['new']);
    expect(next).not.toBeNull();
    expect(next?.startsWith(bom)).toBe(true);
    const body = (next ?? '').slice(1);
    expect(body).toContain('// keep');
    expect(body).toContain('\r\n');
    expect(body).not.toContain('"old"');
    const parsed = inspectConfigDocument(next ?? '');
    expect(parsed.state).toBe('ok');
    if (parsed.state === 'ok') expect(parsed.value.cardOrder).toEqual(['new']);
  });

  test('inserting cardOrder after a BOM does not shift the property offsets', () => {
    const text = `${bom}{\n  "baseUrl": "http://127.0.0.1:3425",\n  "custom": { "x": 1 }\n}\n`;
    const next = setCardOrderText(text, ['k']);
    expect(next?.startsWith(bom)).toBe(true);
    const parsed = inspectConfigDocument(next ?? '');
    expect(parsed.state).toBe('ok');
    if (parsed.state === 'ok') {
      expect(parsed.value.cardOrder).toEqual(['k']);
      expect(parsed.value.custom).toEqual({ x: 1 });
      expect(parsed.value.baseUrl).toBe('http://127.0.0.1:3425');
    }
  });

  test('recovery strips the BOM before slicing values', () => {
    const recovered = recoverConfigValues(
      `${bom}{\n  "baseUrl": "https://magpie.example.com",\n  "apiKey": "secret",\n  "refreshSeconds": 90\n`,
    );
    expect(recovered.values.baseUrl).toBe('https://magpie.example.com');
    expect(recovered.values.apiKey).toBe('secret');
    expect(recovered.values.refreshSeconds).toBe(90);
    expect(recovered.restored).toEqual(['baseUrl', 'apiKey', 'refreshSeconds']);
  });
});

describe('conservative recovery', () => {
  test('restores complete root properties and the endpoint/key pair', () => {
    const text = `{
      // leading comment
      "baseUrl": "https://magpie.example.com",
      "apiKey": "secret-key",
      "refreshSeconds": 90,
      "fontScale": 150,
      "language": "zh-CN",
      "providerIcons": {"openai-mm": "claude"},
      "cardOrder": ["old"]
    `;
    const recovered = recoverConfigValues(text);
    expect(recovered.values).toEqual({
      baseUrl: 'https://magpie.example.com',
      apiKey: 'secret-key',
      refreshSeconds: 90,
      fontScale: 150,
      language: 'zh-CN',
      providerIcons: { 'openai-mm': 'claude' },
    });
    expect(recovered.restored).toEqual([
      'baseUrl',
      'apiKey',
      'refreshSeconds',
      'fontScale',
      'language',
      'providerIcons',
    ]);
    expect(recovered.defaulted).toEqual([]);
  });

  test('a duplicated endpoint or key defaults the whole pair', () => {
    const endpoint = recoverConfigValues(
      '{"baseUrl":"https://a.example","baseUrl":"https://b.example","apiKey":"k"}',
    );
    expect(endpoint.values.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(endpoint.values.apiKey).toBeNull();
    expect(endpoint.defaulted).toContain('baseUrl');
    expect(endpoint.defaulted).toContain('apiKey');

    const key = recoverConfigValues('{"baseUrl":"https://a.example","apiKey":"k","apiKey":"k2"}');
    expect(key.values.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(key.values.apiKey).toBeNull();
    expect(key.defaulted).toContain('baseUrl');
    expect(key.defaulted).toContain('apiKey');
  });

  test('never attaches a surviving key to the default or an invalid endpoint', () => {
    const onlyKey = recoverConfigValues('{"apiKey":"secret"}');
    expect(onlyKey.values.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(onlyKey.values.apiKey).toBeNull();
    expect(onlyKey.defaulted).toContain('apiKey');

    const badEndpoint = recoverConfigValues('{"baseUrl":"http://remote.example.com","apiKey":"secret"}');
    expect(badEndpoint.values.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(badEndpoint.values.apiKey).toBeNull();
  });

  test('a proven endpoint with an invalid key keeps the endpoint and drops the key', () => {
    const recovered = recoverConfigValues('{"baseUrl":"https://a.example","apiKey":"bad key"}');
    expect(recovered.values.baseUrl).toBe('https://a.example');
    expect(recovered.values.apiKey).toBeNull();
    expect(recovered.restored).toContain('baseUrl');
    expect(recovered.defaulted).toContain('apiKey');
  });

  test('ignores nested values and values only mentioned in comments', () => {
    const nested = recoverConfigValues(
      '{"wrapper":{"baseUrl":"https://real.example","apiKey":"secret"}}',
    );
    expect(nested.values.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(nested.values.apiKey).toBeNull();

    const commented = recoverConfigValues(
      '{"x":1 /* "baseUrl": "https://real.example", "apiKey": "secret" */}',
    );
    expect(commented.values.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(commented.values.apiKey).toBeNull();
  });

  test('an incomplete value is not recovered; a complete neighbour still may be', () => {
    const recovered = recoverConfigValues('{"baseUrl":"https://magpie.example.com","apiKey":"secret');
    // The endpoint's own value is complete and valid, so it is safe to keep;
    // the truncated key is not, and no partial key is guessed.
    expect(recovered.values.baseUrl).toBe('https://magpie.example.com');
    expect(recovered.values.apiKey).toBeNull();
    expect(recovered.defaulted).toContain('apiKey');
  });

  test('a non-object root recovers nothing', () => {
    const recovered = recoverConfigValues('[{"baseUrl":"https://a.example"}]');
    expect(recovered.values.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(recovered.values.apiKey).toBeNull();
    expect(recovered.defaulted).toEqual([
      'baseUrl',
      'apiKey',
      'refreshSeconds',
      'fontScale',
      'language',
      'providerIcons',
    ]);
  });

  test('a unique, independently provable providerIcons object is restored with its valid entries', () => {
    const recovered = recoverConfigValues(
      '{"baseUrl":"https://a.example","providerIcons":{"~keys":"magpie","extra":"claude"}}',
    );
    expect(recovered.values.providerIcons).toEqual({ '~keys': 'magpie', extra: 'claude' });
    expect(recovered.restored).toContain('providerIcons');
    expect(recovered.defaulted).not.toContain('providerIcons');
  });

  test('a restored providerIcons object keeps prototype keys as safe own properties', () => {
    // The slice carries comments: it must re-parse strictly on its own, and
    // the keys named after the object model must survive the AST path as
    // own properties instead of vanishing through the property setter.
    const recovered = recoverConfigValues(
      `{
        "providerIcons": {
          // provider literally named __proto__
          "__proto__": "claude",
          "constructor": "magpie" /* own, too */,
          "plain": "generic"
        }
      }`,
    );
    for (const key of ['__proto__', 'constructor', 'plain']) {
      expect({ key, own: Object.hasOwn(recovered.values.providerIcons, key) }).toEqual({ key, own: true });
    }
    expect((recovered.values.providerIcons as Record<string, unknown>)['__proto__']).toBe('claude');
    expect(Object.getPrototypeOf(recovered.values.providerIcons)).toBe(Object.prototype);
    expect(recovered.restored).toContain('providerIcons');
  });

  test('a duplicated or unprovable providerIcons falls back to the template default', () => {
    const duplicated = recoverConfigValues(
      '{"providerIcons":{"a":"claude"},"providerIcons":{"b":"codex"}}',
    );
    expect(duplicated.values.providerIcons).toEqual({ '~keys': 'magpie' });
    expect(duplicated.defaulted).toContain('providerIcons');
    expect(duplicated.restored).not.toContain('providerIcons');

    const unprovable = recoverConfigValues('{"providerIcons":{"a":"cla');
    expect(unprovable.values.providerIcons).toEqual({ '~keys': 'magpie' });
    expect(unprovable.defaulted).toContain('providerIcons');
  });

  test('an old file without providerIcons recovers the template mapping, not an empty one', () => {
    const recovered = recoverConfigValues('{"baseUrl":"https://a.example","apiKey":"k"');
    expect(recovered.values.providerIcons).toEqual({ '~keys': 'magpie' });
    expect(recovered.defaulted).toContain('providerIcons');
  });

  test('only auto, en, and zh-CN are valid recovered languages; ranges still apply', () => {
    expect(recoverConfigValues('{"language":"ar"}').values.language).toBe(DEFAULT_LANGUAGE);
    expect(recoverConfigValues('{"language":"en"}').values.language).toBe('en');
    expect(recoverConfigValues('{"refreshSeconds":4}').values.refreshSeconds).toBe(DEFAULT_REFRESH_SECONDS);
    expect(recoverConfigValues('{"fontScale":999}').values.fontScale).toBe(DEFAULT_FONT_SCALE);
    expect(recoverConfigValues('{"refreshSeconds":/*c*/ 90}').values.refreshSeconds).toBe(90);
  });

  test('a duplicated scalar defaults only that field', () => {
    const recovered = recoverConfigValues('{"refreshSeconds":5,"refreshSeconds":10}');
    expect(recovered.values.refreshSeconds).toBe(DEFAULT_REFRESH_SECONDS);
    expect(recovered.defaulted).toContain('refreshSeconds');
  });
});

describe('local cardOrder edit', () => {
  test('preserves comments, unknown keys, indentation, and CRLF', () => {
    const text =
      '{\r\n\t// top comment\r\n\t"baseUrl": "https://magpie.example.com",\r\n\t"custom": { "x": 1 },\r\n\t// bottom comment\r\n\t"refreshSeconds": 90\r\n}\r\n';
    const next = setCardOrderText(text, ['a|b|']);
    expect(next).not.toBeNull();
    expect(next?.includes('\r\n')).toBe(true);
    expect(next).toContain('// top comment');
    expect(next).toContain('// bottom comment');
    expect(next).toContain('"custom": { "x": 1 }');
    expect(next).toContain('"refreshSeconds": 90');
    expect(next).toContain('"cardOrder"');
    expect(next).toContain('"a|b|"');
  });

  test('inserts cardOrder when the valid file has none', () => {
    const next = setCardOrderText('{\n  "baseUrl": "http://127.0.0.1:3425"\n}\n', ['k']);
    expect(next).toContain('"cardOrder"');
    expect(next).toContain('"k"');
    expect(next).toContain('"baseUrl"');
  });

  test('returns null instead of editing a damaged document', () => {
    expect(setCardOrderText('{ not json', ['k'])).toBeNull();
  });

  test('drops comments inside the managed array but keeps Chinese comments outside it', () => {
    const text = `{
  // 顶部中文注释
  "baseUrl": "http://127.0.0.1:3425",
  "cardOrder": [
    // 旧数组内注释
    "old"
  ],
  // 底部中文注释
  "language": "auto"
}
`;
    const next = setCardOrderText(text, ['new']);
    expect(next).not.toBeNull();
    expect(next).not.toContain('旧数组内注释');
    expect(next).toContain('顶部中文注释');
    expect(next).toContain('底部中文注释');
    const parsed = inspectConfigDocument(next ?? '');
    expect(parsed.state).toBe('ok');
    if (parsed.state === 'ok') expect(parsed.value.cardOrder).toEqual(['new']);
  });

  test('a providerIcons mapping survives a cardOrder edit untouched', () => {
    const text = `{
  "baseUrl": "https://magpie.example.com",
  "providerIcons": { "~keys": "magpie" },
  "cardOrder": ["a|b|"]
}
`;
    const next = setCardOrderText(text, ['b|c|']);
    expect(next).not.toBeNull();
    expect(next?.includes('"providerIcons": { "~keys": "magpie" },')).toBe(true);
    const parsed = inspectConfigDocument(next ?? '');
    expect(parsed.state).toBe('ok');
    if (parsed.state === 'ok') {
      expect(parsed.value.cardOrder).toEqual(['b|c|']);
      expect(parsed.value.providerIcons).toEqual({ '~keys': 'magpie' });
    }
  });

  test('the template is itself valid JSONC with the seven active keys', () => {
    const text = renderConfigTemplate(['a|b|']);
    const inspection = inspectConfigDocument(text);
    expect(inspection.state).toBe('ok');
    if (inspection.state !== 'ok') return;
    expect(Object.keys(inspection.value).sort()).toEqual(
      ['apiKey', 'baseUrl', 'cardOrder', 'fontScale', 'language', 'providerIcons', 'refreshSeconds'].sort(),
    );
    expect(inspection.value.cardOrder).toEqual(['a|b|']);
    // The template's own default: every provider collapses into the keys icon.
    expect(inspection.value.providerIcons).toEqual({ '~keys': 'magpie' });
    expect(text).toContain('// providerIcons：');
  });
});
