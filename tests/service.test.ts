import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  call,
  makeTempDir,
  post,
  request,
  startService,
  stopAll,
  writeConfig,
  type TempDir,
} from './harness.ts';

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
    const service = await startService({ configPath: join(tempDir().path, 'config.json') });
    const answer = await call(service.url, '/health', null);
    expect(answer.status).toBe(401);
  });

  test('rejects a request with the wrong bearer token', async () => {
    const service = await startService({ configPath: join(tempDir().path, 'config.json') });
    const answer = await call(service.url, '/health', 'wrong');
    expect(answer.status).toBe(401);
  });

  test('answers /health with the shared contract', async () => {
    const service = await startService({ configPath: join(tempDir().path, 'config.json') });
    const answer = await call(service.url, '/health');
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({ ok: true, name: 'magpie-usage', apiVersion: 1 });
  });

  test('answers unknown routes with 404', async () => {
    const service = await startService({ configPath: join(tempDir().path, 'config.json') });
    const answer = await call(service.url, '/usage');
    expect(answer.status).toBe(404);
  });

  test('binds an OS-assigned port when asked for port 0', async () => {
    const service = await startService({ configPath: join(tempDir().path, 'config.json') });
    expect(service.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  test('refuses a method and path pair it does not serve', async () => {
    const service = await startService({ configPath: join(tempDir().path, 'config.json') });
    expect((await request(service.url, 'POST', '/health')).status).toBe(405);
    expect((await request(service.url, 'POST', '/v1/magpie/usage')).status).toBe(405);
    expect((await request(service.url, 'PUT', '/config/order')).status).toBe(405);
    expect((await request(service.url, 'DELETE', '/config/order')).status).toBe(405);
    expect((await call(service.url, '/config/order')).status).toBe(404);
  });
});

describe('POST /config/order', () => {
  const order = ['r-magpie%2Fworkbuddy|subscription|Lilixxs', 'r-magpie%2Fdeepseek|balance|'];

  test('writes the order and keeps the rest of the file, byte for byte', async () => {
    const dir = tempDir();
    const key = 'sk-order-must-not-appear-3d1f';
    const configPath = writeConfig(dir, {
      baseUrl: 'https://magpie.example.com',
      apiKey: key,
      refreshSeconds: 90,
      keepMe: { nested: true },
    });
    const service = await startService({ configPath });

    const answer = await post(service.url, '/config/order', { order });
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({ ok: true, order, reset: null });

    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(written).toEqual({
      baseUrl: 'https://magpie.example.com',
      apiKey: key,
      refreshSeconds: 90,
      keepMe: { nested: true },
      cardOrder: order,
    });
    // Two-space indent and a trailing newline, as the service writes it.
    const text = readFileSync(configPath, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "baseUrl"');

    // /config reports the new order, so a reopened panel starts with it.
    const report = JSON.parse((await call(service.url, '/config')).body);
    expect(report.cardOrder).toEqual(order);
    expect(report.reset).toBeNull();
    expect(answer.body.includes(key)).toBe(false);
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

  test('creates the file and its directory when neither exists', async () => {
    const dir = tempDir();
    const configPath = join(dir.path, 'nested', 'config.json');
    const service = await startService({ configPath });

    const answer = await post(service.url, '/config/order', { order });
    expect(answer.status).toBe(200);
    expect(existsSync(configPath)).toBe(true);
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({ cardOrder: order });

    // A file now exists; the panel's "no config file yet" note goes away.
    const report = JSON.parse((await call(service.url, '/config')).body);
    expect(report.present).toBe(true);
    expect(report.cardOrder).toEqual(order);
  });

  test('a broken file is copied aside, replaced, and reported once', async () => {
    const dir = tempDir();
    const configPath = writeConfig(dir, '{ "baseUrl": "http://127.0.0.1:3425", oops');
    const service = await startService({ configPath });

    const answer = await post(service.url, '/config/order', { order });
    expect(answer.status).toBe(200);
    const saved = JSON.parse(answer.body);
    expect(saved.order).toEqual(order);
    expect(saved.reset.backupPath).toBe(`${configPath}.bak`);
    expect(typeof saved.reset.at).toBe('string');

    expect(readFileSync(`${configPath}.bak`, 'utf8')).toContain('oops');
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({ cardOrder: order });

    const report = JSON.parse((await call(service.url, '/config')).body);
    expect(report.issue).toBeNull();
    expect(report.reset).toEqual(saved.reset);
  });

  test('a second reset does not overwrite the first backup', async () => {
    const dir = tempDir();
    const configPath = writeConfig(dir, 'not json at all');
    const service = await startService({ configPath });

    const first = JSON.parse((await post(service.url, '/config/order', { order })).body);
    writeFileSync(configPath, 'broken again', 'utf8');
    const second = JSON.parse((await post(service.url, '/config/order', { order })).body);

    expect(first.reset.backupPath).toBe(`${configPath}.bak`);
    expect(second.reset.backupPath).not.toBe(first.reset.backupPath);
    expect(second.reset.backupPath.startsWith(`${configPath}.bak-`)).toBe(true);
    expect(readFileSync(first.reset.backupPath, 'utf8')).toBe('not json at all');
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
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({ baseUrl: 'http://127.0.0.1:3425' });
  });

  test('rejects an oversized body without buffering it', async () => {
    const dir = tempDir();
    const configPath = writeConfig(dir, { baseUrl: 'http://127.0.0.1:3425' });
    const service = await startService({ configPath });

    const answer = await post(service.url, '/config/order', { order: ['x'.repeat(70 * 1024)] });
    expect(answer.status).toBe(400);
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({ baseUrl: 'http://127.0.0.1:3425' });
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
    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    expect([order, other]).toContainEqual(written.cardOrder);
    expect(written.baseUrl).toBe('http://127.0.0.1:3425');
  });

  test('needs the bearer token like every other route', async () => {
    const dir = tempDir();
    const configPath = writeConfig(dir, { baseUrl: 'http://127.0.0.1:3425' });
    const service = await startService({ configPath });

    const answer = await post(service.url, '/config/order', { order }, null);
    expect(answer.status).toBe(401);
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({ baseUrl: 'http://127.0.0.1:3425' });
  });
});

describe('/config', () => {
  test('falls back to the loopback default when the file is missing', async () => {
    const dir = tempDir();
    const configPath = join(dir.path, 'config.json');
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
      cardOrder: [],
      language: 'auto',
      languageInvalid: false,
      reset: null,
      source: 'default',
      present: false,
      issue: null,
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
    expect(body.issue).toBeNull();
    expect(answer.body.includes(key)).toBe(false);
  });

  test('reports an invalid file and keeps a usable endpoint', async () => {
    const dir = tempDir();
    const configPath = writeConfig(dir, { baseUrl: 'http://magpie.example.com' });
    const service = await startService({ configPath });

    const body = JSON.parse((await call(service.url, '/config')).body);
    expect(body.issue.kind).toBe('invalid');
    expect(body.issue.message).toContain('https');
    expect(body.baseUrl).toBe('http://127.0.0.1:3425');
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
});
