import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { inspectConfigDocument } from '../src/shared/config-document.ts';
import {
  call,
  makeTempDir,
  post,
  request,
  startService,
  stopAll,
  writeConfig,
  writeConfigText,
  type TempDir,
} from './harness.ts';

const parseDocumentText = (text: string): Record<string, unknown> => {
  const inspection = inspectConfigDocument(text);
  if (inspection.state !== 'ok') throw new Error(`config document is ${inspection.state}`);
  return inspection.value;
};

const readDocument = (path: string): Record<string, unknown> =>
  parseDocumentText(readFileSync(path, 'utf8'));

const dirs: TempDir[] = [];
const tempDir = (): TempDir => {
  const dir = makeTempDir();
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  await stopAll();
  for (const dir of dirs.splice(0)) dir.dispose();
});

describe('local service', () => {
  test('rejects a request without the bearer token', async () => {
    const service = await startService({ configPath: join(tempDir().path, 'config.jsonc') });
    const answer = await call(service.url, '/health', null);
    expect(answer.status).toBe(401);
  });

  test('rejects a request with the wrong bearer token', async () => {
    const service = await startService({ configPath: join(tempDir().path, 'config.jsonc') });
    const answer = await call(service.url, '/health', 'wrong');
    expect(answer.status).toBe(401);
  });

  test('answers /health with the shared contract', async () => {
    const service = await startService({ configPath: join(tempDir().path, 'config.jsonc') });
    const answer = await call(service.url, '/health');
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({ ok: true, name: 'magpie-usage', apiVersion: 1 });
  });

  test('answers unknown routes with 404', async () => {
    const service = await startService({ configPath: join(tempDir().path, 'config.jsonc') });
    const answer = await call(service.url, '/usage');
    expect(answer.status).toBe(404);
  });

  test('binds an OS-assigned port when asked for port 0', async () => {
    const service = await startService({ configPath: join(tempDir().path, 'config.jsonc') });
    expect(service.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  test('refuses a method and path pair it does not serve', async () => {
    const service = await startService({ configPath: join(tempDir().path, 'config.jsonc') });
    expect((await request(service.url, 'POST', '/health')).status).toBe(405);
    expect((await request(service.url, 'POST', '/v1/magpie/usage')).status).toBe(405);
    expect((await request(service.url, 'PUT', '/config/order')).status).toBe(405);
    expect((await request(service.url, 'DELETE', '/config/order')).status).toBe(405);
    expect((await request(service.url, 'PUT', '/config/create')).status).toBe(405);
    expect((await call(service.url, '/config/order')).status).toBe(404);
    expect((await call(service.url, '/config/create')).status).toBe(404);
  });
});

describe('POST /config/create', () => {
  test('creates the six-item template with bilingual comments', async () => {
    const dir = tempDir();
    const configPath = join(dir.path, 'nested', 'config.jsonc');
    const service = await startService({ configPath });

    const answer = await post(service.url, '/config/create', {});
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({ ok: true, created: true, present: true });

    const text = readFileSync(configPath, 'utf8');
    expect(text).toContain('// baseUrl');
    expect(text).toContain('// baseUrl：');
    expect(text).toContain('"baseUrl": "http://127.0.0.1:3425"');
    expect(text).toContain('"apiKey": null');
    expect(text).toContain('"refreshSeconds": 60');
    expect(text).toContain('"fontScale": 100');
    expect(text).toContain('"cardOrder": []');
    expect(text).toContain('"language": "auto"');
    expect(text).toContain('replace-with-your-gateway-key');
    // The example key is a comment and is not an active value.
    const active = text
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');
    expect(active).not.toContain('replace-with-your-gateway-key');

    if (process.platform !== 'win32') expect(statSync(configPath).mode & 0o777).toBe(0o600);
  });

  test('accepts an empty body and an explicit order', async () => {
    const dir = tempDir();
    const configPath = join(dir.path, 'config.jsonc');
    const service = await startService({ configPath });
    const order = ['r-magpie%2Fdeepseek|balance|'];

    const answer = await post(service.url, '/config/create', { order });
    expect(answer.status).toBe(200);
    expect(readDocument(configPath).cardOrder).toEqual(order);
  });

  test('leaves an existing file untouched and reports that it exists', async () => {
    const dir = tempDir();
    const configPath = writeConfig(dir, '{\n  // keep\n  "baseUrl": "https://magpie.example.com"\n}\n');
    const before = readFileSync(configPath, 'utf8');
    const service = await startService({ configPath });

    const answer = await post(service.url, '/config/create', {});
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({ ok: true, created: false, present: true });
    expect(readFileSync(configPath, 'utf8')).toBe(before);
  });

  test('rejects a bad create body', async () => {
    const dir = tempDir();
    const configPath = join(dir.path, 'config.jsonc');
    const service = await startService({ configPath });

    for (const body of ['not json', '[]', { order: 'nope' }, { order: [1] }, { order: [''] }]) {
      const answer = await post(service.url, '/config/create', body);
      expect({ body, status: answer.status }).toEqual({ body, status: 400 });
    }
    expect(existsSync(configPath)).toBe(false);
  });

  test('refuses a non-regular path instead of replacing it', async () => {
    const dir = tempDir();
    const configPath = join(dir.path, 'config.jsonc');
    mkdirSync(configPath);
    const service = await startService({ configPath });

    const answer = await post(service.url, '/config/create', {});
    expect(answer.status).toBe(500);
    expect(statSync(configPath).isDirectory()).toBe(true);
  });
});

describe('POST /config/order', () => {
  const order = ['r-magpie%2Fworkbuddy|subscription|Lilixxs', 'r-magpie%2Fdeepseek|balance|'];

  test('edits only cardOrder and keeps comments, unknown keys, and values', async () => {
    const dir = tempDir();
    const key = 'sk-order-must-not-appear-3d1f';
    const configPath = writeConfigText(
      dir,
      `{
  // keep this comment
  "baseUrl": "https://magpie.example.com",
  "apiKey": "${key}",
  "refreshSeconds": 90,
  "fontScale": 150,
  "custom": { "nested": true }
}
`,
    );
    const service = await startService({ configPath });

    const answer = await post(service.url, '/config/order', { order });
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({ ok: true, order, recovery: null });

    const text = readFileSync(configPath, 'utf8');
    expect(text).toContain('// keep this comment');
    expect(text).toContain('"custom": { "nested": true }');
    expect(text).toContain(`"apiKey": "${key}"`);
    expect(parseDocumentText(text).cardOrder).toEqual(order);

    const report = JSON.parse((await call(service.url, '/config')).body);
    expect(report.cardOrder).toEqual(order);
    expect(report.fontScale).toBe(150);
    expect(report.fontScaleInvalid).toBe(false);
    expect(report.validity).toBe('valid');
    expect(report.recovery).toBeNull();
    expect(answer.body.includes(key)).toBe(false);
  });

  test('a leading UTF-8 BOM is valid and is preserved by an order edit', async () => {
    const dir = tempDir();
    const key = 'sk-bom-order-must-not-appear-7a1';
    const configPath = writeConfigText(
      dir,
      `\uFEFF{\n  // keep this comment\n  "baseUrl": "https://magpie.example.com",\n  "apiKey": "${key}"\n}\n`,
    );
    const service = await startService({ configPath });

    const before = JSON.parse((await call(service.url, '/config')).body);
    expect(before.validity).toBe('valid');
    expect(before.baseUrl).toBe('https://magpie.example.com');
    expect(before.apiKeyConfigured).toBe(true);

    const answer = await post(service.url, '/config/order', { order });
    expect(answer.status).toBe(200);
    expect(answer.body.includes(key)).toBe(false);

    const text = readFileSync(configPath, 'utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1)).toContain('// keep this comment');
    expect(parseDocumentText(text).cardOrder).toEqual(order);
    const after = JSON.parse((await call(service.url, '/config')).body);
    expect(after.baseUrl).toBe('https://magpie.example.com');
    expect(after.apiKeyConfigured).toBe(true);
  });

  test('rebuilding a BOM-prefixed damaged file keeps the BOM and comments the old body', async () => {
    const dir = tempDir();
    const configPath = writeConfigText(
      dir,
      '\uFEFF{\n  "baseUrl": "https://magpie.example.com",\n  "apiKey": "sk-bom-rebuild",\n  "fontScale": 150\n',
    );
    const service = await startService({ configPath });

    const answer = await post(service.url, '/config/order', { order });
    expect(answer.status).toBe(200);
    expect(answer.body.includes('sk-bom-rebuild')).toBe(false);

    const text = readFileSync(configPath, 'utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1)).toContain('// --- Previous config text');
    expect(text.slice(1)).toContain('//   "baseUrl": "https://magpie.example.com"');
    expect(text.slice(1)).not.toContain('\uFEFF');
    expect(readdirSync(dir.path).filter((name) => name.includes('.bak'))).toEqual([]);
  });

  test('keeps the file mode', async () => {
    const dir = tempDir();
    const configPath = writeConfig(dir, { baseUrl: 'http://127.0.0.1:3425' });
    if (process.platform === 'win32') return;
    chmodSync(configPath, 0o640);
    const service = await startService({ configPath });

    await post(service.url, '/config/order', { order });
    expect(statSync(configPath).mode & 0o777).toBe(0o640);
  });

  test('creates the full template and its directory when neither exists', async () => {
    const dir = tempDir();
    const configPath = join(dir.path, 'nested', 'config.jsonc');
    const service = await startService({ configPath });

    const answer = await post(service.url, '/config/order', { order });
    expect(answer.status).toBe(200);
    expect(existsSync(configPath)).toBe(true);
    const written = readDocument(configPath);
    expect(written.cardOrder).toEqual(order);
    expect(written.baseUrl).toBe('http://127.0.0.1:3425');
    expect(written.apiKey).toBeNull();
    expect(written.refreshSeconds).toBe(60);
    expect(written.fontScale).toBe(100);
    expect(written.language).toBe('auto');

    const report = JSON.parse((await call(service.url, '/config')).body);
    expect(report.present).toBe(true);
    expect(report.validity).toBe('valid');
    expect(report.cardOrder).toEqual(order);
  });

  test('rebuilds a broken file in place, without a separate backup', async () => {
    const dir = tempDir();
    const configPath = writeConfig(dir, '{ "baseUrl": "http://127.0.0.1:3425", oops');
    const service = await startService({ configPath });

    const answer = await post(service.url, '/config/order', { order });
    expect(answer.status).toBe(200);
    const saved = JSON.parse(answer.body);
    expect(saved.order).toEqual(order);
    expect(saved.recovery.previousText).toBe('appended-comments');
    expect(saved.recovery.restored).toContain('baseUrl');
    expect(typeof saved.recovery.at).toBe('string');

    const text = readFileSync(configPath, 'utf8');
    expect(text).toContain('// --- Previous config text');
    expect(text).toContain('// { "baseUrl": "http://127.0.0.1:3425", oops');
    expect(existsSync(`${configPath}.bak`)).toBe(false);
    expect(readdirSync(dir.path).filter((name) => name.includes('.bak'))).toEqual([]);

    const report = JSON.parse((await call(service.url, '/config')).body);
    expect(report.issue).toBeNull();
    expect(report.validity).toBe('valid');
    expect(report.recovery).toEqual(saved.recovery);
  });

  test('a second rebuild keeps the first commented text and creates no backup', async () => {
    const dir = tempDir();
    const configPath = writeConfig(dir, 'not json at all');
    const service = await startService({ configPath });

    const first = JSON.parse((await post(service.url, '/config/order', { order })).body);
    // Damage the rebuilt file while keeping its comment block, so a second
    // rebuild must carry the first old text forward too.
    const rebuilt = readFileSync(configPath, 'utf8');
    writeFileSync(configPath, rebuilt.replace('"baseUrl"', '"baseUrl" oops'), 'utf8');
    const second = JSON.parse((await post(service.url, '/config/order', { order })).body);

    expect(typeof first.recovery.at).toBe('string');
    expect(typeof second.recovery.at).toBe('string');
    expect(second.recovery).not.toEqual(first.recovery);
    const text = readFileSync(configPath, 'utf8');
    expect(text).toContain('// not json at all');
    expect(text).toContain('"baseUrl" oops');
    expect(readdirSync(dir.path).filter((name) => name.includes('.bak'))).toEqual([]);
  });

  test('a field error does not rebuild; only cardOrder changes', async () => {
    const dir = tempDir();
    const configPath = writeConfig(
      dir,
      '{\n  // keep\n  "baseUrl": "https://magpie.example.com",\n  "fontScale": 999\n}\n',
    );
    const service = await startService({ configPath });

    const answer = await post(service.url, '/config/order', { order });
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body).recovery).toBeNull();
    const text = readFileSync(configPath, 'utf8');
    expect(text).toContain('// keep');
    expect(text).toContain('"fontScale": 999');
    expect(parseDocumentText(text).cardOrder).toEqual(order);

    const report = JSON.parse((await call(service.url, '/config')).body);
    expect(report.validity).toBe('invalid');
    expect(report.fontScaleInvalid).toBe(true);
    expect(report.baseUrl).toBe('https://magpie.example.com');
  });

  test('rejects every body it cannot use', async () => {
    const dir = tempDir();
    const configPath = writeConfig(dir, { baseUrl: 'http://127.0.0.1:3425' });
    const service = await startService({ configPath });

    const bad: unknown[] = [
      '',
      'not json',
      '[]',
      '{}',
      { order: [] },
      { order: 'nope' },
      { order: [1] },
      { order: [''] },
      { order: ['x'.repeat(201)] },
      { order: Array.from({ length: 501 }, (_, index) => `k${index}`) },
    ];
    for (const body of bad) {
      const answer = await post(service.url, '/config/order', body);
      expect({ body, status: answer.status }).toEqual({ body, status: 400 });
    }
    // Nothing was written by a rejected request.
    expect(readDocument(configPath)).toEqual({ baseUrl: 'http://127.0.0.1:3425' });
  });

  test('rejects an oversized body without buffering it', async () => {
    const dir = tempDir();
    const configPath = writeConfig(dir, { baseUrl: 'http://127.0.0.1:3425' });
    const service = await startService({ configPath });

    const answer = await post(service.url, '/config/order', { order: ['x'.repeat(70 * 1024)] });
    expect(answer.status).toBe(400);
    expect(readDocument(configPath)).toEqual({ baseUrl: 'http://127.0.0.1:3425' });
  });

  test('an external edit before publish is rejected with 409 and not overwritten', async () => {
    const dir = tempDir();
    const configPath = writeConfig(dir, { baseUrl: 'http://127.0.0.1:3425' });
    const external = '{\n  "baseUrl": "https://external.example.com"\n}\n';
    const service = await startService({
      configPath,
      beforeConfigPublish: (path) => {
        writeFileSync(path, external, 'utf8');
      },
    });

    const answer = await post(service.url, '/config/order', { order });
    expect(answer.status).toBe(409);
    expect(JSON.parse(answer.body).error.kind).toBe('config-conflict');
    expect(readFileSync(configPath, 'utf8')).toBe(external);
  });

  test('a non-regular config path is refused without overwriting it', async () => {
    const dir = tempDir();
    const configPath = join(dir.path, 'config.jsonc');
    mkdirSync(configPath);
    const service = await startService({ configPath });

    const answer = await post(service.url, '/config/order', { order });
    expect(answer.status).toBe(500);
    expect(statSync(configPath).isDirectory()).toBe(true);
  });

  test('two writes in flight both land', async () => {
    const dir = tempDir();
    const configPath = writeConfig(dir, { baseUrl: 'http://127.0.0.1:3425' });
    const service = await startService({ configPath });

    const other = ['r-magpie%2Fkimi|plan|'];
    const [first, second] = await Promise.all([
      post(service.url, '/config/order', { order }),
      post(service.url, '/config/order', { order: other }),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    // One of the two won; the file is valid and holds one order, not a mix.
    const written = readDocument(configPath);
    expect([order, other]).toContainEqual(written.cardOrder as string[]);
    expect(written.baseUrl).toBe('http://127.0.0.1:3425');
  });

  test('needs the bearer token like every other route', async () => {
    const dir = tempDir();
    const configPath = writeConfig(dir, { baseUrl: 'http://127.0.0.1:3425' });
    const service = await startService({ configPath });

    const answer = await post(service.url, '/config/order', { order }, null);
    expect(answer.status).toBe(401);
    expect(readDocument(configPath)).toEqual({ baseUrl: 'http://127.0.0.1:3425' });
  });
});

describe('/config', () => {
  test('falls back to the loopback default when the file is missing', async () => {
    const dir = tempDir();
    const configPath = join(dir.path, 'config.jsonc');
    const service = await startService({ configPath });

    const answer = await call(service.url, '/config');
    expect(answer.status).toBe(200);
    const body = JSON.parse(answer.body);
    expect(body).toEqual({
      configPath,
      baseUrl: 'http://127.0.0.1:3425',
      host: '127.0.0.1:3425',
      loopback: true,
      apiKeyConfigured: false,
      refreshSeconds: 60,
      fontScale: 100,
      fontScaleInvalid: false,
      cardOrder: [],
      cardOrderInvalid: false,
      language: 'auto',
      languageInvalid: false,
      recovery: null,
      source: 'default',
      present: false,
      validity: 'missing',
      issue: null,
      issues: [],
    });
  });

  test('reports the configured endpoint and whether a key is present, never the key', async () => {
    const dir = tempDir();
    const key = 'sk-config-must-not-appear-9f2c';
    const configPath = writeConfig(dir, { baseUrl: 'https://magpie.example.com/', apiKey: key, refreshSeconds: 90 });
    const service = await startService({ configPath });

    const answer = await call(service.url, '/config');
    const body = JSON.parse(answer.body);
    expect(body.baseUrl).toBe('https://magpie.example.com');
    expect(body.host).toBe('magpie.example.com');
    expect(body.loopback).toBe(false);
    expect(body.apiKeyConfigured).toBe(true);
    expect(body.refreshSeconds).toBe(90);
    expect(body.source).toBe('file');
    expect(body.present).toBe(true);
    expect(body.validity).toBe('valid');
    expect(body.issue).toBeNull();
    expect(body.issues).toEqual([]);
    expect(answer.body.includes(key)).toBe(false);
  });

  test('reports an invalid file and keeps a usable endpoint', async () => {
    const dir = tempDir();
    const configPath = writeConfig(dir, { baseUrl: 'http://magpie.example.com' });
    const service = await startService({ configPath });

    const body = JSON.parse((await call(service.url, '/config')).body);
    expect(body.issue.kind).toBe('invalid');
    expect(body.issue.message).toContain('https');
    expect(body.validity).toBe('invalid');
    expect(body.issues[0].field).toBe('baseUrl');
    expect(body.baseUrl).toBe('http://127.0.0.1:3425');
  });

  test('reports a lenient field error without degrading the endpoint', async () => {
    const dir = tempDir();
    const configPath = writeConfig(dir, {
      baseUrl: 'https://magpie.example.com',
      apiKey: 'key',
      fontScale: 999,
      cardOrder: ['ok', 2],
    });
    const service = await startService({ configPath });

    const body = JSON.parse((await call(service.url, '/config')).body);
    expect(body.validity).toBe('invalid');
    expect(body.issue).toBeNull();
    expect(body.baseUrl).toBe('https://magpie.example.com');
    expect(body.apiKeyConfigured).toBe(true);
    expect(body.fontScale).toBe(100);
    expect(body.fontScaleInvalid).toBe(true);
    expect(body.cardOrderInvalid).toBe(true);
    expect(body.cardOrder).toEqual(['ok']);
    expect(body.issues.map((issue: { field: string }) => issue.field).sort()).toEqual(['cardOrder', 'fontScale']);
  });

  test('reports duplicate top-level keys as a document error', async () => {
    const dir = tempDir();
    const configPath = writeConfigText(dir, '{"baseUrl":"https://a.example","baseUrl":"https://b.example"}');
    const service = await startService({ configPath });

    const body = JSON.parse((await call(service.url, '/config')).body);
    expect(body.validity).toBe('invalid');
    expect(body.issue.kind).toBe('duplicate-key');
    expect(body.baseUrl).toBe('http://127.0.0.1:3425');
  });

  test('reports a non-regular path as unreadable, not missing', async () => {
    const dir = tempDir();
    const configPath = join(dir.path, 'config.jsonc');
    mkdirSync(configPath);
    const service = await startService({ configPath });

    const body = JSON.parse((await call(service.url, '/config')).body);
    expect(body.present).toBe(false);
    expect(body.validity).toBe('unreadable');
    expect(body.issue.kind).toBe('unreadable');
  });

  test('applies a config edit without restarting the service', async () => {
    const dir = tempDir();
    const configPath = writeConfig(dir, { baseUrl: 'http://127.0.0.1:4000' });
    const service = await startService({ configPath });
    expect(JSON.parse((await call(service.url, '/config')).body).baseUrl).toBe('http://127.0.0.1:4000');

    writeConfig(dir, { baseUrl: 'https://magpie.example.com', refreshSeconds: 15 });
    const updated = JSON.parse((await call(service.url, '/config')).body);
    expect(updated.baseUrl).toBe('https://magpie.example.com');
    expect(updated.refreshSeconds).toBe(15);
  });

  test('ignores an old config.json when config.jsonc is absent or present', async () => {
    const dir = tempDir();
    const old = join(dir.path, 'config.json');
    writeFileSync(old, JSON.stringify({ baseUrl: 'https://old.example.com' }), 'utf8');
    const configPath = join(dir.path, 'config.jsonc');

    const missingService = await startService({ configPath });
    const missing = JSON.parse((await call(missingService.url, '/config')).body);
    expect(missing.present).toBe(false);
    expect(missing.validity).toBe('missing');
    expect(missing.baseUrl).toBe('http://127.0.0.1:3425');
    await missingService.stop();

    const configPath2 = writeConfig(dir, { baseUrl: 'https://new.example.com' });
    const presentService = await startService({ configPath: configPath2 });
    const present = JSON.parse((await call(presentService.url, '/config')).body);
    expect(present.baseUrl).toBe('https://new.example.com');
    expect(readFileSync(old, 'utf8')).toContain('old.example.com');
  });
});
