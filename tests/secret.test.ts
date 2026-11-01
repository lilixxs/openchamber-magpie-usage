// The key may live in one place only: the service process, read from the
// config file. These tests try to catch it anywhere else.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { usagePayload } from './fixtures.ts';
import { call, makeTempDir, startGateway, startService, stopAll, writeConfig, type TempDir } from './harness.ts';

const root = join(import.meta.dir, '..');
const SENTINEL = 'sk-LEAK-CANARY-4f7a19c2e5';

const dirs: TempDir[] = [];
const tempDir = (): TempDir => {
  const dir = makeTempDir();
  dirs.push(dir);
  return dir;
};

const captured: string[] = [];
const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
const originals = new Map<string, (...args: unknown[]) => void>();

beforeEach(() => {
  captured.length = 0;
  for (const method of methods) {
    const original = console[method] as (...args: unknown[]) => void;
    originals.set(method, original);
    (console as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
      captured.push(args.map((value) => String(value)).join(' '));
    };
  }
});

afterEach(async () => {
  for (const [method, original] of originals) {
    (console as unknown as Record<string, unknown>)[method] = original;
  }
  originals.clear();
  await stopAll();
  for (const dir of dirs.splice(0)) dir.dispose();
});

const walk = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...walk(path));
    else found.push(path);
  }
  return found;
};

describe('the API key stays inside the service process', () => {
  test('never appears in the /config answer, in logs, or in the built bundles', async () => {
    const gateway = await startGateway(() => ({ status: 200, body: JSON.stringify(usagePayload) }));
    const configPath = writeConfig(tempDir(), { baseUrl: gateway.url, apiKey: SENTINEL });
    const service = await startService({ configPath });

    const config = await call(service.url, '/config');
    expect(config.status).toBe(200);
    expect(config.body.includes(SENTINEL)).toBe(false);
    expect(JSON.parse(config.body).apiKeyConfigured).toBe(true);

    // Prove the capture seam works, so the log assertion below means something.
    console.error('capture-check');
    expect(captured.join('\n')).toContain('capture-check');

    const usage = await call(service.url, '/v1/magpie/usage?period=today');
    expect(usage.status).toBe(200);
    expect(usage.body.includes(SENTINEL)).toBe(false);

    // The gateway is the one place allowed to see it.
    expect(gateway.requests[0]?.authorization).toBe(`Bearer ${SENTINEL}`);

    const quotas = await call(service.url, '/v1/magpie/quotas?kept=1');
    expect(quotas.body.includes(SENTINEL)).toBe(false);

    expect(captured.join('\n').includes(SENTINEL)).toBe(false);

    for (const bundle of ['panel/main.js', 'service/main.js']) {
      const text = readFileSync(join(root, bundle), 'utf8');
      expect(text.includes(SENTINEL)).toBe(false);
    }

    await gateway.close();
  });

  test('an upstream rejection does not echo the key into the answer or the logs', async () => {
    const gateway = await startGateway(() => ({ status: 401, body: JSON.stringify({ error: 'bad key' }) }));
    const configPath = writeConfig(tempDir(), { baseUrl: gateway.url, apiKey: SENTINEL });
    const service = await startService({ configPath });

    const answer = await call(service.url, '/v1/magpie/usage?period=today');
    expect(answer.status).toBe(502);
    expect(answer.body.includes(SENTINEL)).toBe(false);
    expect(captured.join('\n').includes(SENTINEL)).toBe(false);

    await gateway.close();
  });

  test('a rejected config still does not put the key in the answer', async () => {
    const configPath = writeConfig(tempDir(), { baseUrl: 'http://example.com', apiKey: SENTINEL });
    const service = await startService({ configPath });

    const answer = await call(service.url, '/config');
    expect(answer.status).toBe(200);
    expect(answer.body.includes(SENTINEL)).toBe(false);
    expect(captured.join('\n').includes(SENTINEL)).toBe(false);
  });

  test('no source file carries a key-shaped literal', () => {
    const files = [...walk(join(root, 'src')), ...walk(join(root, 'panel'))];
    const pattern = /['"`]sk-[A-Za-z0-9_-]{12,}['"`]/;
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect({ file, match: pattern.test(text) }).toEqual({ file, match: false });
    }
  });

  test('the service bundle has no hard-coded Authorization value', () => {
    const text = readFileSync(join(root, 'service/main.js'), 'utf8');
    // The header is built from the config at request time; a literal key would
    // have to appear here as a quoted string.
    expect(/Bearer\s+sk-/.test(text)).toBe(false);
  });
});
