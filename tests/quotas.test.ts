import { afterEach, describe, expect, test } from 'bun:test';

import { quotaPayload, sparseQuotaPayload } from './fixtures.ts';
import {
  call,
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

const gatewayFor = async (body: unknown) =>
  startGateway(() => ({ status: 200, body: JSON.stringify(body) }));

const serviceFor = async (baseUrl: string, extra: Record<string, unknown> = {}) => {
  const configPath = writeConfig(tempDir(), { baseUrl });
  return startService({ configPath, ...extra });
};

describe('GET /v1/magpie/quotas', () => {
  test('normalises every card variant', async () => {
    const gateway = await gatewayFor(quotaPayload);
    const service = await serviceFor(gateway.url);
    const answer = await call(service.url, '/v1/magpie/quotas?kept=1');
    expect(answer.status).toBe(200);

    const body = JSON.parse(answer.body);
    expect(body.kept).toBe(true);
    expect(body.throttled).toBe(false);
    expect(body.stale).toBe(false);
    expect(typeof body.asOf).toBe('string');
    expect(Array.isArray(body.cards)).toBe(true);
    expect(body.cards).toHaveLength(7);

    const [workbuddy, balance, broken, plan, unlimited, amountOnly, sparse] = body.cards;

    expect(workbuddy).toMatchObject({
      provider: 'r-magpie/workbuddy',
      name: 'WorkBuddy · Remote magpie',
      kind: 'subscription',
      plan: 'Free plan',
      user: 'Lilixxs',
      balance: null,
      error: null,
      readAt: '2026-11-01T05:20:37.352Z',
      from: 'Remote magpie',
    });
    expect(workbuddy.windows[0]).toEqual({
      name: 'Credits',
      used: 19.323136488673764,
      remaining: 80.67686351132623,
      amount: 998.04,
      limit: 5165,
      unit: 'credits',
      display: '998.04 / 5165',
      resetsAt: '2026-11-30T15:59:59Z',
      runsOutAt: '2026-11-16T04:00:14Z',
      runsOut: 66.96,
      pool: 'Claude & GPT',
      unlimited: false,
    });

    expect(balance).toMatchObject({ kind: 'balance', balance: '¥21.08', error: null, windows: [] });
    expect(balance.readAt).toBe('2026-11-01T03:00:23.024Z');

    // A card-level error is kept as data, never dropped.
    expect(broken).toMatchObject({
      name: 'OpenRouter · Remote magpie',
      kind: 'balance',
      error: '401 Unauthorized: user not found',
      readAt: null,
    });

    expect(plan.windows).toHaveLength(2);
    expect(plan.windows[0]).toEqual({
      name: '5 hours',
      used: 0,
      remaining: 100,
      amount: null,
      limit: null,
      unit: null,
      display: null,
      resetsAt: null,
      runsOutAt: null,
      runsOut: null,
      pool: null,
      unlimited: false,
    });
    expect(plan.readAt).toBeNull();
    expect(plan.from).toBeNull();

    expect(unlimited.windows[0].unlimited).toBe(true);
    expect(unlimited.windows[0].used).toBe(0);

    expect(amountOnly.windows[0]).toMatchObject({ amount: 18.64, limit: 70, unit: 'USD', used: null, remaining: null });
    expect(amountOnly.plan).toBe('GOAT');

    expect(sparse.name).toBe('Sparse card');
    expect(sparse.kind).toBe('plan');
    expect(sparse.windows).toHaveLength(1);
    expect(sparse.windows[0].used).toBeNull();
    expect(sparse.windows[0].remaining).toBeNull();
    expect(sparse.windows[0].unlimited).toBe(false);

    expect(answer.body.includes('NaN')).toBe(false);
    await gateway.close();
  });

  test('a card without a name falls back to its provider id', async () => {
    const gateway = await gatewayFor(sparseQuotaPayload);
    const service = await serviceFor(gateway.url);
    const body = JSON.parse((await call(service.url, '/v1/magpie/quotas?kept=1')).body);
    expect(body.cards[0].name).toBe('r-magpie/minimal');
    expect(body.cards[0].windows).toEqual([]);
    await gateway.close();
  });

  test('forwards kept=1 and refresh as upstream query flags', async () => {
    const gateway = await gatewayFor(quotaPayload);
    const service = await serviceFor(gateway.url);

    await call(service.url, '/v1/magpie/quotas?kept=1');
    expect(gateway.requests[0]?.query).toEqual({ kept: '1' });

    await call(service.url, '/v1/magpie/quotas?refresh=1');
    expect(gateway.requests[1]?.query).toEqual({});
    expect(gateway.requests[1]?.path).toBe('/v1/magpie/quotas');
    await gateway.close();
  });

  test('throttles manual refreshes and serves the last fresh cards', async () => {
    let clock = Date.parse('2026-11-01T12:00:00Z');
    const gateway = await gatewayFor(quotaPayload);
    const service = await serviceFor(gateway.url, {
      refreshMinIntervalMs: 30_000,
      now: () => clock,
    });

    // The cached read never starts the throttle window.
    await call(service.url, '/v1/magpie/quotas?kept=1');
    expect(gateway.requests).toHaveLength(1);

    const first = JSON.parse((await call(service.url, '/v1/magpie/quotas?refresh=1')).body);
    expect(first.throttled).toBe(false);
    expect(first.stale).toBe(false);
    expect(first.kept).toBe(false);
    expect(first.asOf).toBe('2026-11-01T12:00:00.000Z');
    expect(gateway.requests).toHaveLength(2);

    clock += 1000;
    const second = JSON.parse((await call(service.url, '/v1/magpie/quotas?refresh=1')).body);
    expect(second.throttled).toBe(true);
    expect(second.stale).toBe(true);
    expect(second.cards).toHaveLength(7);
    expect(second.asOf).toBe('2026-11-01T12:00:00.000Z');
    expect(gateway.requests).toHaveLength(2);

    clock += 30_000;
    const third = JSON.parse((await call(service.url, '/v1/magpie/quotas?refresh=1')).body);
    expect(third.throttled).toBe(false);
    expect(third.asOf).toBe('2026-11-01T12:00:31.000Z');
    expect(gateway.requests).toHaveLength(3);
    await gateway.close();
  });

  test('an empty kept=1 answer falls back to the last read instead of wiping the cards', async () => {
    let clock = Date.parse('2026-11-01T12:00:00Z');
    let serveKept = true;
    const gateway = await startGateway((request) => {
      if (request.query.kept === '1') {
        return { status: 200, body: JSON.stringify({ object: 'list', data: serveKept ? quotaPayload.data : [] }) };
      }
      return { status: 200, body: JSON.stringify(quotaPayload) };
    });
    const service = await serviceFor(gateway.url, { now: () => clock });

    const first = JSON.parse((await call(service.url, '/v1/magpie/quotas?kept=1')).body);
    expect(first.cards).toHaveLength(7);
    expect(first.stale).toBe(false);

    serveKept = false;
    clock += 60_000;
    const second = JSON.parse((await call(service.url, '/v1/magpie/quotas?kept=1')).body);
    expect(second.kept).toBe(false);
    expect(second.stale).toBe(true);
    expect(second.cards).toHaveLength(7);
    expect(second.asOf).toBe('2026-11-01T12:00:00.000Z');
    await gateway.close();
  });

  test('an empty kept=1 answer with no earlier read makes one ordinary read', async () => {
    const gateway = await startGateway((request) => {
      if (request.query.kept === '1') {
        return { status: 200, body: JSON.stringify({ object: 'list', data: [] }) };
      }
      return { status: 200, body: JSON.stringify(quotaPayload) };
    });
    const service = await serviceFor(gateway.url);

    const body = JSON.parse((await call(service.url, '/v1/magpie/quotas?kept=1')).body);
    expect(body.cards).toHaveLength(7);
    expect(body.stale).toBe(false);
    expect(gateway.requests).toHaveLength(2);
    expect(gateway.requests[0]?.query).toEqual({ kept: '1' });
    expect(gateway.requests[1]?.query).toEqual({});
    await gateway.close();
  });

  test('a JSON body without a data array is a schema mismatch', async () => {
    const gateway = await gatewayFor({ cards: [] });
    const service = await serviceFor(gateway.url);
    const answer = await call(service.url, '/v1/magpie/quotas?kept=1');
    expect(answer.status).toBe(502);
    expect(JSON.parse(answer.body).error.kind).toBe('upstream-schema');
    await gateway.close();
  });

  test('a 401 on the quota route is reported like the usage route', async () => {
    const gateway = await startGateway(() => ({ status: 401, body: '{}' }));
    const service = await serviceFor(gateway.url);
    const answer = await call(service.url, '/v1/magpie/quotas?kept=1');
    expect(JSON.parse(answer.body).error.kind).toBe('upstream-unauthorized');
    await gateway.close();
  });
});

describe('redirects', () => {
  test('a cross-origin redirect is refused and the key never reaches the other origin', async () => {
    const other = await gatewayFor(quotaPayload);
    const gateway = await startGateway(() => ({
      status: 302,
      headers: { location: `${other.url}/v1/magpie/quotas` },
      body: '',
    }));

    const configPath = writeConfig(tempDir(), { baseUrl: gateway.url, apiKey: 'gateway-key' });
    const service = await startService({ configPath });

    const answer = await call(service.url, '/v1/magpie/quotas?kept=1');
    expect(answer.status).toBe(502);
    expect(JSON.parse(answer.body).error.kind).toBe('upstream-redirect');
    expect(other.requests).toHaveLength(0);
    await gateway.close();
    await other.close();
  });

  test('a same-origin redirect is followed and keeps the key', async () => {
    let gatewayUrl = '';
    const gateway = await startGateway((request) => {
      if (request.path === '/moved') {
        return { status: 200, body: JSON.stringify(quotaPayload) };
      }
      return { status: 302, headers: { location: `${gatewayUrl}/moved` }, body: '' };
    });
    gatewayUrl = gateway.url;

    const configPath = writeConfig(tempDir(), { baseUrl: gateway.url, apiKey: 'gateway-key' });
    const service = await startService({ configPath });

    const answer = await call(service.url, '/v1/magpie/quotas?kept=1');
    expect(answer.status).toBe(200);
    expect(gateway.requests).toHaveLength(2);
    expect(gateway.requests[1]?.path).toBe('/moved');
    expect(gateway.requests[1]?.authorization).toBe('Bearer gateway-key');
    await gateway.close();
  });
});
