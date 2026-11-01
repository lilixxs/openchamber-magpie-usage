import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { usagePayload, sparseUsagePayload } from './fixtures.ts';
import {
  call,
  deadPortUrl,
  makeTempDir,
  startGateway,
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

const gatewayFor = async (body: unknown, status = 200) =>
  startGateway(() => ({ status, body: typeof body === 'string' ? body : JSON.stringify(body) }));

const serviceFor = async (baseUrl: string, extra: Record<string, unknown> = {}) => {
  const dir = tempDir();
  const configPath = writeConfig(dir, { baseUrl });
  return startService({ configPath, ...extra });
};

describe('GET /v1/magpie/usage', () => {
  test('forwards the period and the key, then normalises the summary', async () => {
    const gateway = await gatewayFor(usagePayload);
    const dir = tempDir();
    const configPath = writeConfig(dir, { baseUrl: gateway.url, apiKey: 'gateway-key' });
    const keyed = await startService({ configPath });

    const answer = await call(keyed.url, '/v1/magpie/usage?period=7d');
    expect(answer.status).toBe(200);

    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0]?.path).toBe('/v1/magpie/usage');
    expect(gateway.requests[0]?.query).toEqual({ period: '7d' });
    expect(gateway.requests[0]?.authorization).toBe('Bearer gateway-key');

    const body = JSON.parse(answer.body);
    expect(body.period).toBe('7d');
    expect(body.since).toBe('2026-10-26T00:00:00+08:00');
    expect(body.endpoint).toBe(gateway.url);
    expect(body.host).toBe(gateway.url.replace('http://', ''));
    expect(body.loopback).toBe(true);
    expect(body.totals).toEqual({
      calls: 6274,
      errors: 50,
      retried: 12,
      loops: 0,
      input: 16_184_969,
      output: 2_622_360,
      cacheRead: 607_959_073,
      cacheWrite: 0,
      reasoning: 12_345,
      cost: 53.2038,
      unpriced: 7,
      credits: 1326.22,
      credited: 410,
    });
    expect(body.series).toHaveLength(3);
    expect(body.series[1]).toEqual({
      label: '10-31',
      time: '2026-10-31T00:00:00+08:00',
      calls: 20,
      input: 2000,
      output: 300,
      cacheRead: 9000,
      cacheWrite: 0,
      cost: 1.5,
    });
    await gateway.close();
  });

  test('sends no authorization header when no key is configured', async () => {
    const gateway = await gatewayFor(usagePayload);
    const service = await serviceFor(gateway.url);
    await call(service.url, '/v1/magpie/usage?period=today');
    expect(gateway.requests[0]?.authorization).toBeNull();
    expect(gateway.requests[0]?.query).toEqual({ period: 'today' });
    await gateway.close();
  });

  test('defaults to today when no period is given', async () => {
    const gateway = await gatewayFor(usagePayload);
    const service = await serviceFor(gateway.url);
    await call(service.url, '/v1/magpie/usage');
    expect(gateway.requests[0]?.query).toEqual({ period: 'today' });
    await gateway.close();
  });

  test('rejects an unknown period before touching the gateway', async () => {
    const gateway = await gatewayFor(usagePayload);
    const service = await serviceFor(gateway.url);
    const answer = await call(service.url, '/v1/magpie/usage?period=all');
    expect(answer.status).toBe(400);
    expect(JSON.parse(answer.body).error.kind).toBe('bad-request');
    expect(gateway.requests).toHaveLength(0);
    await gateway.close();
  });

  test('missing optional fields become zeros and nulls, never NaN', async () => {
    const gateway = await gatewayFor(sparseUsagePayload);
    const service = await serviceFor(gateway.url);
    const answer = await call(service.url, '/v1/magpie/usage?period=today');
    expect(answer.status).toBe(200);
    expect(answer.body.includes('NaN')).toBe(false);
    const body = JSON.parse(answer.body);
    expect(body.totals.input).toBe(0);
    expect(body.totals.cost).toBeNull();
    expect(body.totals.credits).toBeNull();
    expect(body.since).toBeNull();
    expect(body.series).toEqual([]);
    await gateway.close();
  });

  test('a malformed optional number is dropped instead of leaking NaN', async () => {
    const gateway = await gatewayFor({ calls: 2, cost: 'free', series: [{ label: 'a', input: 'many' }] });
    const service = await serviceFor(gateway.url);
    const body = JSON.parse((await call(service.url, '/v1/magpie/usage?period=today')).body);
    expect(body.totals.cost).toBeNull();
    expect(body.totals.input).toBe(0);
    expect(body.series[0].input).toBe(0);
    await gateway.close();
  });
});

describe('upstream failures', () => {
  const kindOf = (body: string): string => JSON.parse(body).error.kind;

  test('401 is reported as an authorization failure', async () => {
    const gateway = await gatewayFor({ error: 'nope' }, 401);
    const service = await serviceFor(gateway.url);
    const answer = await call(service.url, '/v1/magpie/usage?period=today');
    expect(answer.status).toBe(502);
    expect(kindOf(answer.body)).toBe('upstream-unauthorized');
    expect(JSON.parse(answer.body).error.status).toBe(401);
    await gateway.close();
  });

  test('403 is reported as a scope refusal', async () => {
    const gateway = await gatewayFor({ error: 'nope' }, 403);
    const service = await serviceFor(gateway.url);
    const answer = await call(service.url, '/v1/magpie/usage?period=today');
    expect(answer.status).toBe(502);
    expect(kindOf(answer.body)).toBe('upstream-forbidden');
    await gateway.close();
  });

  test('another status is reported as a status failure', async () => {
    const gateway = await gatewayFor({ error: 'boom' }, 500);
    const service = await serviceFor(gateway.url);
    const answer = await call(service.url, '/v1/magpie/usage?period=today');
    expect(answer.status).toBe(502);
    expect(kindOf(answer.body)).toBe('upstream-status');
    expect(JSON.parse(answer.body).error.status).toBe(500);
    await gateway.close();
  });

  test('a slow gateway is a timeout, not a network error', async () => {
    const gateway = await startGateway(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { status: 200, body: JSON.stringify(usagePayload) };
    });
    const service = await serviceFor(gateway.url, { upstreamTimeoutMs: 40 });
    const answer = await call(service.url, '/v1/magpie/usage?period=today');
    expect(answer.status).toBe(504);
    expect(kindOf(answer.body)).toBe('upstream-timeout');
    await gateway.close();
  });

  test('a refused connection is a network error', async () => {
    const service = await serviceFor(await deadPortUrl());
    const answer = await call(service.url, '/v1/magpie/usage?period=today');
    expect(answer.status).toBe(502);
    expect(kindOf(answer.body)).toBe('upstream-network');
  });

  test('a non-JSON answer is kept apart from a schema mismatch', async () => {
    const gateway = await startGateway(() => ({ status: 200, body: '<html>login</html>' }));
    const service = await serviceFor(gateway.url);
    const answer = await call(service.url, '/v1/magpie/usage?period=today');
    expect(kindOf(answer.body)).toBe('upstream-not-json');
    await gateway.close();
  });

  test('JSON that is not a usage summary is a schema mismatch', async () => {
    const gateway = await gatewayFor({ hello: 'world' });
    const service = await serviceFor(gateway.url);
    const answer = await call(service.url, '/v1/magpie/usage?period=today');
    expect(kindOf(answer.body)).toBe('upstream-schema');
    expect(JSON.parse(answer.body).error.message).toContain('calls');
    await gateway.close();
  });

  test('a series that is not an array is a schema mismatch', async () => {
    const gateway = await gatewayFor({ calls: 1, series: 'nope' });
    const service = await serviceFor(gateway.url);
    const answer = await call(service.url, '/v1/magpie/usage?period=today');
    expect(kindOf(answer.body)).toBe('upstream-schema');
    await gateway.close();
  });
});
