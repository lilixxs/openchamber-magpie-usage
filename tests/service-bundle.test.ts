// Regression against the built bundle on disk. Every other test loads the
// service from `src/` under Bun; this file starts `service/main.js` the way
// the host does: a real Node child process (never Bun's `process.execPath`),
// a port grabbed while free, a temp `XDG_CONFIG_HOME`, and a clean working
// directory. The bundle is copied into a service-bundle-XXXX directory without
// node_modules, so a bundle that still resolves `./impl/*` at runtime fails
// here instead of only in CI.
//
// One boot test and one round-trip test cover: bearer auth, the shared health
// contract, the missing-file fallback, the six-item template created with its
// bilingual comments, config.jsonc values reaching /config, usage and quotas
// forwarded to a fake gateway over real HTTP (fixture-shaped, not guessed),
// and an order save that keeps comments and unknown keys without ever
// echoing the API key.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { usagePayload, quotaPayload } from './fixtures.ts';

const root = join(import.meta.dir, '..');
const BUNDLE = join(root, 'service', 'main.js');

// Fake credentials for this test only. They must never appear whole in test
// output, so assertions compare booleans and `includes`, never diff texts.
const TOKEN = 'bundle-smoke-token';
const GATEWAY_KEY = 'sk-bundle-smoke-CANARY';
const ORDER = [
  'r-magpie%2Fworkbuddy|subscription|Lilixxs',
  'r-magpie%2Fdeepseek|balance|',
] as const;

/** Approved disposable area for this run; falls back to the OS temp dir. */
const approvedBase = (): string => {
  const preferred = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Temp', 'opencode')
    : null;
  return preferred && existsSync(preferred) ? preferred : tmpdir();
};

/* ------------------------------ real Node ------------------------------ */

let nodePath: string | null = null;

/** Resolves a real Node from PATH; `process.execPath` under bun test is Bun. */
const realNode = (): string => {
  if (nodePath) return nodePath;
  const probe = spawnSync('node', ['--version'], { encoding: 'utf8', windowsHide: true });
  const version = probe.stdout?.trim() ?? '';
  if (probe.error || probe.status !== 0 || !/^v\d+\./.test(version)) {
    throw new Error(
      'A real Node runtime is required for service-bundle tests (the host runs the ' +
        'service with Node, not Bun). Install Node.js or let CI provide it; the test ' +
        'fails instead of skipping.');
  }
  nodePath = 'node';
  return nodePath;
};

/* -------------------------------- spawn -------------------------------- */

const children: ChildProcess[] = [];
const areas: string[] = [];

const makeArea = (): string => {
  const area = mkdtempSync(join(approvedBase(), 'service-bundle-'));
  areas.push(area);
  return area;
};

/** A port nothing listens on: bind, read, release, use in a child. */
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      const port = address.port;
      server.close(() => resolve(port));
    });
  });

type Spawned = { child: ChildProcess; url: string };

/** Copies the bundle into an isolated directory and starts it with Node. */
const spawnBundle = async (configHome: string): Promise<Spawned> => {
  const area = makeArea();
  const bundleDir = join(area, 'bundle');
  mkdirSync(bundleDir);
  copyFileSync(BUNDLE, join(bundleDir, 'main.mjs')); // ESM run, no node_modules, no package.json.

  const port = await freePort();
  const child = spawn(realNode(), ['main.mjs'], {
    cwd: bundleDir,
    windowsHide: true,
    env: {
      ...process.env,
      OPENCHAMBER_SERVICE_PORT: String(port),
      OPENCHAMBER_SERVICE_TOKEN: TOKEN,
      XDG_CONFIG_HOME: configHome, // Only this directory is ever read for config.
    },
  });
  children.push(child);

  // Safe diagnostics only: raw output is captured, printed in tails, never
  // echoed whole; neither stream carries the token or the config key.
  let stderr = '';
  let stdout = '';
  let childError: Error | null = null;
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString()}`;
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout = `${stdout}${chunk.toString()}`;
  });
  child.on('error', (error: Error) => {
    childError = error;
  });

  // Short ready wait; a crashed child reports its own exit instead of a
  // timeout, and cleanup happens in afterAll either way. Every request this
  // service serves needs the bearer token, so the probe carries it too.
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 4000;
  for (;;) {
    if (childError) {
      throw new Error(`service/main.js failed to start under real Node: ${String(childError)}`);
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      const tail = (text: string) =>
        text
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(-6)
          .join('\n') || '(empty)';
      throw new Error(
        `service/main.js exited with code ${child.exitCode ?? child.signalCode} on boot ` +
          `under real Node.\nstderr tail:\n${tail(stderr)}\nstdout tail:\n${tail(stdout)}`);
    }
    if (Date.now() > deadline) throw new Error(`service/main.js never answered /health at ${url}`);
    try {
      const probe = await fetch(`${url}/health`, {
        headers: { authorization: `Bearer ${TOKEN}` },
        signal: AbortSignal.timeout(800),
      });
      if (probe.ok) return { child, url };
    } catch {
      // Connection refused or probe timeout: not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50)); // Poll, don't busy spin.
  }
};

/** Terminates even if the process never handled the signal (clean exit path). */
const terminate = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    let hardTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      if (hardTimer) clearTimeout(hardTimer); // Exited cleanly: no 1.8 s wait.
      resolve();
    };
    child.once('exit', finish);
    child.kill('SIGTERM');
    hardTimer = setTimeout(() => {
      if (child.exitCode !== null) {
        finish();
        return;
      }
      try {
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/pid', String(child.pid), '/f', '/t'], { windowsHide: true });
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        // Nothing more to try; the worse-case waiter below still resolves.
      }
      setTimeout(finish, 200);
    }, 1500);
  });
};

const killChildren = async (): Promise<void> => {
  for (const child of children.splice(0)) await terminate(child);
};

const DISPOSE = { recursive: true, force: true, maxRetries: 3, retryDelay: 50 } as const;

afterAll(async () => {
  await killChildren();
  for (const area of areas.splice(0)) rmSync(area, DISPOSE);
});

/* ------------------------------- gateway ------------------------------- */

type GateRecord = {
  method: string;
  path: string;
  query: Record<string, string>;
  hasAuth: boolean;
  // Boolean seam: the recorded header is never echoed into test output.
  authIsConfiguredKey: boolean;
};

type Gate = { url: string; records: GateRecord[]; close(): Promise<void> };

/** A fake magpie gateway spoken to over real HTTP by the Node child. */
const startGateway = async (
  handler: (record: GateRecord) => { status?: number; body: string },
): Promise<Gate> => {
  const records: GateRecord[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const record: GateRecord = {
      method: request.method ?? 'GET',
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      hasAuth: request.headers.authorization !== undefined,
      authIsConfiguredKey: request.headers.authorization === `Bearer ${GATEWAY_KEY}`,
    };
    records.push(record);
    const reply = handler(record);
    response.writeHead(reply.status ?? 200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(reply.body);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    records,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

/* ------------------------------ http calls ----------------------------- */

const getJson = async (url: string, path: string, token: string | null): Promise<{ status: number; text: string }> => {
  const response = await fetch(`${url}${path}`, {
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  });
  return { status: response.status, text: await response.text() };
};

const postJson = async (url: string, path: string, body: unknown): Promise<{ status: number; text: string }> => {
  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
};

/* ------------------------------- the root ------------------------------ */

describe('service bundle on real Node', () => {
  test('boots the shipped service/main.js and creates the commented template', async () => {
    expect(existsSync(BUNDLE)).toBe(true);
    // Guard the original UMD-wrapper failure independently of runtime lookup.
    expect(/\brequire\d*\(["']\.\/impl\//.test(readFileSync(BUNDLE, 'utf8'))).toBe(false);
    realNode(); // Fails explicitly when Node is absent; never silently skips.

    const area = makeArea();
    const spawned = await spawnBundle(join(area, 'xdg'));

    // Shared health contract, reachable only with the bearer token.
    const unauth = await getJson(spawned.url, '/health', null);
    expect(unauth.status).toBe(401);
    const wrong = await getJson(spawned.url, '/health', 'not-the-token');
    expect(wrong.status).toBe(401);
    const health = await getJson(spawned.url, '/health', TOKEN);
    expect(health.status).toBe(200);
    expect(JSON.parse(health.text)).toEqual({ ok: true, name: 'magpie-usage', apiVersion: 1 });

    // No config file yet: documented fallback, present false.
    const missing = await getJson(spawned.url, '/config', TOKEN);
    expect(missing.status).toBe(200);
    const missingReport = JSON.parse(missing.text) as { present: boolean; validity: string; configPath: string };
    expect(missingReport.present).toBe(false);
    expect(missingReport.validity).toBe('missing');
    expect(missingReport.configPath).toBe(join(area, 'xdg', 'openchamber-magpie-usage', 'config.jsonc'));

    // POST /config/create: idempotent, six active settings, comments as comments.
    const created = await postJson(spawned.url, '/config/create', {});
    expect(created.status).toBe(200);
    expect(JSON.parse(created.text)).toEqual({ ok: true, created: true, present: true });
    const configPath = join(area, 'xdg', 'openchamber-magpie-usage', 'config.jsonc');
    const template = readFileSync(configPath, 'utf8');
    expect(template).toContain('// baseUrl');
    expect(template).toContain('// baseUrl：');
    expect(template).toContain('"cardOrder": []');
    expect(template).toContain('"language": "auto"');
    const active = template
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');
    expect(active).toContain('"baseUrl": "http://127.0.0.1:3425"');
    expect(active).toContain('"apiKey": null');
    expect(active).toContain('"refreshSeconds": 60');
    expect(active).toContain('"fontScale": 100');
    // The example key sits in a comment and must never be an active value.
    expect(active).not.toContain('replace-with-your-gateway-key');

    // Again with a file present: untouched, only reported.
    const again = await postJson(spawned.url, '/config/create', {});
    expect(JSON.parse(again.text)).toEqual({ ok: true, created: false, present: true });

    // The service re-reads the file per request without a restart.
    const valid = await getJson(spawned.url, '/config', TOKEN);
    expect((JSON.parse(valid.text) as { validity: string }).validity).toBe('valid');
  }, 20_000);

  test('forwards usage and quotas to the configured gateway and saves order with comments', async () => {
    expect(existsSync(BUNDLE)).toBe(true);
    realNode();

    const gateway = await startGateway((record) => {
      if (record.path === '/v1/magpie/usage') {
        return { body: JSON.stringify(usagePayload) };
      }
      if (record.path === '/v1/magpie/quotas') {
        return { body: JSON.stringify(quotaPayload) };
      }
      return { status: 404, body: '{}' };
    });

    try {
      // Real JSONC on disk: comments, an unknown top-level key, a fake key.
      const area = makeArea();
      const configHome = join(area, 'xdg');
      const configDir = join(configHome, 'openchamber-magpie-usage');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.jsonc'),
        [
          '{',
          '  // gateway: fake used by the bundle smoke test',
          `  "baseUrl": ${JSON.stringify(gateway.url)},`,
          '  /* key material lives here and must never be echoed elsewhere */',
          `  "apiKey": ${JSON.stringify(GATEWAY_KEY)},`,
          '  "unknownKeep": { "note": "kept verbatim" },',
          '  "cardOrder": []',
          '}',
          '',
        ].join('\n'),
        'utf8',
      );

      const spawned = await spawnBundle(configHome);

      // /config reports the file without the key.
      const report = await getJson(spawned.url, '/config', TOKEN);
      expect(report.status).toBe(200);
      expect(report.text.includes(GATEWAY_KEY)).toBe(false);
      const config = JSON.parse(report.text) as {
        baseUrl: string;
        apiKeyConfigured: boolean;
        validity: string;
      };
      expect(config.baseUrl).toBe(gateway.url);
      expect(config.apiKeyConfigured).toBe(true);
      expect(config.validity).toBe('valid');

      // Usage is forwarded with the key and the requested period.
      const usage = await getJson(spawned.url, '/v1/magpie/usage?period=7d', TOKEN);
      expect(usage.status).toBe(200);
      expect(usage.text.includes(GATEWAY_KEY)).toBe(false);
      const usageReport = JSON.parse(usage.text) as {
        endpoint: string;
        period: string;
        totals: { cacheRead: number; calls: number };
        series: unknown[];
      };
      expect(usageReport.endpoint).toBe(gateway.url);
      expect(usageReport.period).toBe('7d');
      expect(usageReport.totals.calls).toBe(usagePayload.calls);
      expect(usageReport.totals.cacheRead).toBe(usagePayload.cache_read);
      expect(usageReport.series.length).toBe(usagePayload.series.length);
      expect(spawned.url.startsWith('http://127.0.0.1')).toBe(true);

      // Quotas answer keeps the gateway's own shape through the decoder.
      const quotas = await getJson(spawned.url, '/v1/magpie/quotas?kept=1', TOKEN);
      expect(quotas.status).toBe(200);
      expect(quotas.text.includes(GATEWAY_KEY)).toBe(false);
      const quotaReport = JSON.parse(quotas.text) as { cards: { provider: string }[] };
      expect(quotaReport.cards.length).toBe(quotaPayload.data.length);

      // The gateway saw exactly one bearer header, and it was the file's key.
      expect(gateway.records.length).toBe(2);
      for (const record of gateway.records) {
        expect(record.hasAuth).toBe(true);
        expect(record.authIsConfiguredKey).toBe(true);
      }
      expect(gateway.records[0]?.path).toBe('/v1/magpie/usage');
      expect(gateway.records[0]?.query.period).toBe('7d');
      expect(gateway.records[1]?.path).toBe('/v1/magpie/quotas');
      expect(gateway.records[1]?.query.kept).toBe('1');

      // An order save replaces only cardOrder; comments and unknown keys stay.
      const configPath = join(configDir, 'config.jsonc');
      const ordered = await postJson(spawned.url, '/config/order', { order: ORDER });
      expect(ordered.status).toBe(200);
      expect(ordered.text.includes(GATEWAY_KEY)).toBe(false);
      expect(JSON.parse(ordered.text)).toEqual({ ok: true, order: ORDER, recovery: null });
      const saved = readFileSync(configPath, 'utf8');
      expect(saved).toContain('// gateway');
      expect(saved).toContain('/* key material');
      expect(saved).toContain('"unknownKeep"');
      expect(saved).toContain('"baseUrl"');
      // The saved cardOrder is exactly the submitted one, in order.
      const active = saved.split('\n').filter((line) => !line.trimStart().startsWith('//'));
      expect(active.join('\n').includes(JSON.stringify(ORDER[0]))).toBe(true);
      expect(saved.indexOf(ORDER[0])).toBeLessThan(saved.indexOf(ORDER[1]));
    } finally {
      await gateway.close();
    }
  }, 20_000);
});
