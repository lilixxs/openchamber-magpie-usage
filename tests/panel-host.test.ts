// The panel against a fake OpenChamber host: the bridge's requests, errors,
// period and refresh behaviour, card order and expansion, repeated snapshots,
// and host/config language. No HTTP, no real host, no user config directory.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { HostRequestError } from '@openchamber/sdk';
import type {
  GuestRequest,
  GuestRequestResult,
  HostClient,
  HostReadyContext,
  HostRequestErrorCode,
  HostThemeTokens,
  ServiceStatus,
} from '@openchamber/sdk';

import { mountPanel, type PanelHandle } from '../src/panel/app.ts';
import type {
  ConfigReport,
  QuotaCard,
  QuotaReport,
  QuotaWindow,
  UsageReport,
} from '../src/shared/magpie.ts';

/* -------------------------------------------------------------------------- */
/* DOM                                                                        */
/* -------------------------------------------------------------------------- */

let dom: Window;
let root: HTMLElement;
let handle: PanelHandle | null = null;

const installGlobals = (window: Window): void => {
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.Element = window.Element;
  globals.Node = window.Node;
  globals.HTMLStyleElement = window.HTMLStyleElement;
  globals.HTMLButtonElement = window.HTMLButtonElement;
  globals.HTMLImageElement = window.HTMLImageElement;
};

beforeEach(() => {
  dom = new Window({ url: 'https://openchamber.test/' });
  // Mirrors panel/index.html so a fallback to English is observable.
  dom.document.documentElement.lang = 'en';
  installGlobals(dom);
  root = dom.document.createElement('div') as unknown as HTMLElement;
  root.id = 'root';
  (dom.document.body as unknown as HTMLElement).append(root);
});

afterEach(() => {
  handle?.dispose();
  handle = null;
  dom.close();
});

/** Lets every pending microtask settle; the fake host answers without I/O. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const start = (host: FakeHost, context: Partial<HostReadyContext> = {}): PanelHandle => {
  const mounted = mountPanel({ host: host.client, root });
  handle = mounted;
  host.emitReady(context);
  return mounted;
};

const text = (node: Element | null): string => node?.textContent ?? '';

const banner = (): HTMLElement => root.querySelector('.banner') as HTMLElement;

const badge = (): HTMLElement => root.querySelector('.badge-slot .oc-sdk-badge') as HTMLElement;

const periodButton = (period: string): HTMLButtonElement =>
  root.querySelector(`[data-period="${period}"]`) as HTMLButtonElement;

const cardKeys = (): string[] =>
  [...root.querySelectorAll<HTMLElement>('.quo-card[data-key]')].map((node) => node.dataset.key ?? '');

const pressKey = (index: number, key: string): void => {
  const logo = root.querySelectorAll<HTMLButtonElement>('.quo-logo')[index];
  if (!logo) throw new Error(`no logo at ${index}`);
  const event = new dom.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  logo.dispatchEvent(event as unknown as Event);
};

const summary = (index: number): HTMLButtonElement =>
  root.querySelectorAll<HTMLButtonElement>('.quo-summary')[index] as HTMLButtonElement;

const usageOnly = (answer: Reply): Responder => (request) =>
  request.path === '/v1/magpie/usage' ? answer : respondOk(request);

const withConfig = (config: ConfigReport): Responder => (request) =>
  request.path === '/config' ? json(config) : respondOk(request);

/* -------------------------------------------------------------------------- */
/* Fake host                                                                  */
/* -------------------------------------------------------------------------- */

const THEME_TOKENS: HostThemeTokens = {
  background: '#101010',
  elevated: '#202020',
  foreground: '#f0f0f0',
  muted: '#a0a0a0',
  subtle: '#303030',
  border: '#404040',
  hover: '#505050',
  selection: '#606060',
  focus: '#707070',
  primary: '#808080',
  mutedSurface: '#909090',
  elevatedForeground: '#f0f0f0',
  active: '#a0a0a0',
  selectionForeground: '#ffffff',
  primaryForeground: '#000000',
  primaryText: '#ffffff',
  successText: '#00ff00',
  warningText: '#ffff00',
  errorText: '#ff0000',
  infoText: '#0000ff',
  success: '#00ff00',
  warning: '#ffff00',
  error: '#ff0000',
  info: '#0000ff',
  font: 'system-ui',
  mono: 'monospace',
  radius: '6px',
};

const readyContext = (overrides: Partial<HostReadyContext> = {}): HostReadyContext => ({
  theme: { mode: 'dark', tokens: THEME_TOKENS },
  locale: 'en',
  directory: null,
  session: null,
  surface: 'panel',
  connection: { connected: true, account: 'tester' },
  settings: {},
  item: null,
  ...overrides,
});

type Reply = { status?: number; body: string } | Error;
type Responder = (request: GuestRequest) => Reply | Promise<Reply>;

type HostState = {
  reply: Responder;
  status: ServiceStatus | Error;
};

type FakeHost = {
  client: HostClient;
  requests: GuestRequest[];
  state: HostState;
  emitReady(overrides?: Partial<HostReadyContext>): void;
  readyListeners(): number;
};

const makeHost = (reply: Responder = respondOk): FakeHost => {
  const state: HostState = { reply, status: 'ready' };
  const requests: GuestRequest[] = [];
  const listeners = new Set<(context: HostReadyContext) => void>();

  const client = {
    serviceRequest: async (request: GuestRequest): Promise<GuestRequestResult> => {
      requests.push({ ...request, ...(request.query ? { query: { ...request.query } } : {}) });
      const answer = await state.reply(request);
      if (answer instanceof Error) throw answer;
      return { status: answer.status ?? 200, body: answer.body };
    },
    serviceStatus: async (): Promise<{ status: ServiceStatus }> => {
      if (state.status instanceof Error) throw state.status;
      return { status: state.status };
    },
    onReady: (listener: (context: HostReadyContext) => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } as unknown as HostClient;

  return {
    client,
    requests,
    state,
    emitReady: (overrides = {}) => {
      const context = readyContext(overrides);
      for (const listener of [...listeners]) listener(context);
    },
    readyListeners: () => listeners.size,
  };
};

/* -------------------------------------------------------------------------- */
/* Payloads                                                                   */
/* -------------------------------------------------------------------------- */

const json = (value: unknown, status = 200): Reply => ({ status, body: JSON.stringify(value) });

const configReport = (overrides: Partial<ConfigReport> = {}): ConfigReport => ({
  configPath: '/home/tester/.config/openchamber-magpie-usage/config.json',
  baseUrl: 'https://magpie.test',
  host: 'magpie.test',
  loopback: false,
  apiKeyConfigured: true,
  refreshSeconds: 60,
  cardOrder: [],
  language: 'auto',
  languageInvalid: false,
  reset: null,
  source: 'file',
  present: true,
  issue: null,
  ...overrides,
});

const usageReport = (period = 'today', overrides: Partial<UsageReport> = {}): UsageReport => ({
  endpoint: 'https://magpie.test',
  host: 'magpie.test',
  loopback: false,
  fetchedAt: '2026-11-01T00:00:00.000Z',
  period,
  since: '2026-11-01T00:00:00.000Z',
  totals: {
    calls: 10,
    errors: 2,
    retried: 1,
    loops: 0,
    input: 1000,
    output: 500,
    cacheRead: 2000,
    cacheWrite: 0,
    reasoning: 0,
    cost: 1.234,
    unpriced: 0,
    credits: 3.5,
    credited: 0,
  },
  series: [
    {
      label: 'today',
      time: '2026-11-01T00:00:00.000Z',
      calls: 10,
      input: 1000,
      output: 500,
      cacheRead: 2000,
      cacheWrite: 0,
      cost: 1.234,
    },
  ],
  ...overrides,
});

const quotaWindow = (overrides: Partial<QuotaWindow> = {}): QuotaWindow => ({
  name: null,
  used: null,
  remaining: null,
  amount: null,
  limit: null,
  unit: null,
  display: null,
  resetsAt: null,
  runsOutAt: null,
  runsOut: null,
  pool: null,
  unlimited: false,
  ...overrides,
});

const quotaCards = (): QuotaCard[] => [
  {
    provider: 'r-magpie/deepseek',
    name: 'DeepSeek',
    kind: 'balance',
    plan: null,
    user: null,
    balance: '¥21.08',
    error: null,
    readAt: null,
    from: null,
    windows: [],
  },
  {
    provider: 'r-magpie/openrouter',
    name: 'OpenRouter',
    kind: 'balance',
    plan: null,
    user: null,
    balance: '$5.00',
    error: null,
    readAt: null,
    from: null,
    windows: [],
  },
  {
    provider: 'r-magpie/opencode-go',
    name: 'OpenCode Go',
    kind: 'plan',
    plan: 'Go',
    user: null,
    balance: null,
    error: null,
    readAt: null,
    from: null,
    windows: [quotaWindow({ name: '5 hours', used: 0, remaining: 100 })],
  },
];

const quotaReport = (overrides: Partial<QuotaReport> = {}): QuotaReport => ({
  endpoint: 'https://magpie.test',
  host: 'magpie.test',
  loopback: false,
  fetchedAt: '2026-11-01T00:00:00.000Z',
  kept: true,
  throttled: false,
  stale: false,
  asOf: '2026-11-01T00:00:00.000Z',
  cards: quotaCards(),
  ...overrides,
});

const respondOk: Responder = (request) => {
  switch (request.path) {
    case '/config':
      return json(configReport());
    case '/v1/magpie/usage':
      return json(usageReport(request.query?.period ?? 'today'));
    case '/v1/magpie/quotas':
      return json(quotaReport(request.query?.refresh === '1'
        ? { kept: false, throttled: true, stale: true }
        : { kept: true }));
    case '/config/order': {
      const body = request.body ? (JSON.parse(request.body) as { order?: string[] }) : {};
      return json({ ok: true, order: body.order ?? [], reset: null });
    }
    default:
      return json({}, 404);
  }
};

/* -------------------------------------------------------------------------- */
/* Smoke                                                                      */
/* -------------------------------------------------------------------------- */

describe('panel first paint', () => {
  test('asks the host for config, usage and quotas, then renders them', async () => {
    const host = makeHost();
    start(host);
    await tick();

    expect(host.requests.map((request) => [request.method, request.path])).toEqual([
      ['GET', '/config'],
      ['GET', '/v1/magpie/usage'],
      ['GET', '/v1/magpie/quotas'],
    ]);
    expect(host.requests[1]?.query).toEqual({ period: 'today' });
    expect(host.requests[2]?.query).toEqual({ kept: '1' });

    const values = [...root.querySelectorAll('.kpi .kpi-value')].map((node) => node.textContent);
    expect(values).toEqual(['1.5k', '66.7%', '10', '≈$1.23', '3.5']);
    expect([...root.querySelectorAll('.quo-card .quo-name')].map((node) => node.textContent)).toEqual([
      'DeepSeek',
      'OpenRouter',
      'OpenCode Go',
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* Error mapping                                                              */
/* -------------------------------------------------------------------------- */

const NO_SERVICE = 'The local service is not approved. Open Settings → Extensions and allow it, then retry.';
const SERVICE_FAILED = 'The local service stopped. It restarts on the next request.';
const REQUEST_FAILED = 'The local service did not answer in time.';
const RESPONSE_TOO_LARGE = 'The local service answered with too much data.';
const DISABLED = 'The extension is paused in Settings → Extensions.';

const hostErrorCase = (code: HostRequestErrorCode): string => {
  switch (code) {
    case 'NO_SERVICE':
    case 'NOT_GRANTED':
      return NO_SERVICE;
    case 'DISABLED':
      return DISABLED;
    case 'SERVICE_FAILED':
      return SERVICE_FAILED;
    case 'REQUEST_FAILED':
      return REQUEST_FAILED;
    case 'RESPONSE_TOO_LARGE':
      return RESPONSE_TOO_LARGE;
    default:
      return `Service request failed: ${code}.`;
  }
};

const HOST_ERROR_CODES: HostRequestErrorCode[] = [
  'HOST_UNAVAILABLE',
  'HOST_TIMEOUT',
  'HOST_REJECTED',
  'DISCONNECTED',
  'DISABLED',
  'BAD_PATH',
  'NO_INTEGRATION',
  'NO_SERVICE',
  'SERVICE_FAILED',
  'REQUEST_FAILED',
  'RESPONSE_TOO_LARGE',
  'NO_SESSION',
  'SESSION_BUSY',
  'NOT_GRANTED',
  'NO_DIRECTORY',
  'NOT_FOUND',
  'FILE_TOO_LARGE',
  'DENIED',
  'NO_MODEL',
  'MODEL_FAILED',
  'UNSUPPORTED',
];

describe('host request errors', () => {
  for (const code of HOST_ERROR_CODES) {
    test(`maps ${code} without showing the host message`, async () => {
      const host = makeHost(usageOnly(new HostRequestError(code, 'UPSTREAM_TEXT_SECRET')));
      start(host);
      await tick();

      expect(banner().hidden).toBe(false);
      expect(text(banner())).toBe(hostErrorCase(code));
      expect(text(root)).not.toContain('UPSTREAM_TEXT_SECRET');
    });
  }
});

type ServiceErrorCase = {
  kind: string;
  expected: string;
  upstreamStatus?: number;
};

const SERVICE_ERRORS: ServiceErrorCase[] = [
  { kind: 'bad-request', expected: 'The panel asked for something the service does not serve.' },
  { kind: 'internal', expected: 'The local service failed to build an answer.' },
  {
    kind: 'upstream-unauthorized',
    expected: 'The gateway rejected the API key (HTTP 401). Check apiKey in the config file.',
    upstreamStatus: 401,
  },
  {
    kind: 'upstream-forbidden',
    expected: 'The gateway refused this key (HTTP 403). It is limited to other models or accounts.',
    upstreamStatus: 403,
  },
  { kind: 'upstream-status', expected: 'The gateway answered with an unexpected status.' },
  { kind: 'upstream-timeout', expected: 'The gateway did not answer in time.' },
  { kind: 'upstream-network', expected: 'The gateway could not be reached.' },
  { kind: 'upstream-not-json', expected: 'The gateway answered, but not with JSON.' },
  {
    kind: 'upstream-schema',
    expected: 'The gateway answered with JSON, but not with magpie usage data.',
  },
  {
    kind: 'upstream-redirect',
    expected:
      'The gateway redirected to another origin. The redirect was not followed, so the key never leaves its origin.',
  },
  { kind: 'not-a-kind', expected: 'The local service answered with an unknown error.' },
];

describe('service error vocabulary', () => {
  for (const item of SERVICE_ERRORS) {
    test(`maps ${item.kind}`, async () => {
      const host = makeHost(
        usageOnly(
          json(
            {
              error: {
                kind: item.kind,
                message: 'UPSTREAM_TEXT_SECRET',
                ...(item.upstreamStatus === undefined ? {} : { status: item.upstreamStatus }),
              },
            },
            502,
          ),
        ),
      );
      start(host);
      await tick();

      const suffix = item.upstreamStatus === undefined ? '' : ` (HTTP ${item.upstreamStatus})`;
      expect(banner().hidden).toBe(false);
      expect(text(banner())).toBe(`${item.expected}${suffix}`);
      expect(text(root)).not.toContain('UPSTREAM_TEXT_SECRET');
    });
  }
});

describe('malformed answers', () => {
  test('a non-JSON body is reported by status, not echoed', async () => {
    const host = makeHost(usageOnly({ status: 502, body: '<html>UPSTREAM_TEXT_SECRET</html>' }));
    start(host);
    await tick();

    expect(banner().hidden).toBe(false);
    expect(text(banner())).toBe('The local service answered HTTP 502 with something that is not JSON.');
    expect(text(root)).not.toContain('UPSTREAM_TEXT_SECRET');
  });

  test('a non-JSON body on HTTP 200 is reported too', async () => {
    const host = makeHost(usageOnly({ status: 200, body: 'not json' }));
    start(host);
    await tick();

    expect(text(banner())).toBe('The local service answered HTTP 200 with something that is not JSON.');
  });

  test('a usage answer without totals is a shape error', async () => {
    const host = makeHost(usageOnly(json({ calls: 1 })));
    start(host);
    await tick();

    expect(banner().hidden).toBe(false);
    expect(text(banner())).toBe('The local service answered /v1/magpie/usage with an unexpected shape.');
  });

  test('a quota answer without a cards array is a shape error', async () => {
    const host = makeHost((request) =>
      request.path === '/v1/magpie/quotas' ? json({ cards: {} }) : respondOk(request),
    );
    start(host);
    await tick();

    expect(text(root.querySelector('.quo-error .quota-err'))).toBe(
      'The local service answered /v1/magpie/quotas with an unexpected shape.',
    );
  });

  test('a config answer without strings is a shape error', async () => {
    let releaseUsage!: () => void;
    const usageGate = new Promise<void>((resolve) => {
      releaseUsage = resolve;
    });
    const host = makeHost((request) => {
      if (request.path === '/config') return json({ configPath: 42 });
      if (request.path === '/v1/magpie/usage') return usageGate.then(() => json(usageReport()));
      return respondOk(request);
    });
    start(host);
    await tick();

    expect(banner().hidden).toBe(false);
    expect(text(banner())).toBe('The local service answered /config with an unexpected shape.');
    releaseUsage();
    await tick();
  });
});

/* -------------------------------------------------------------------------- */
/* Period, refresh, stamps                                                    */
/* -------------------------------------------------------------------------- */

describe('period and refresh', () => {
  test('a period switch re-reads usage only', async () => {
    const host = makeHost();
    start(host);
    await tick();

    host.requests.length = 0;
    periodButton('7d').click();
    await tick();

    expect(host.requests.map((request) => [request.method, request.path, request.query])).toEqual([
      ['GET', '/v1/magpie/usage', { period: '7d' }],
    ]);
    expect(periodButton('7d').getAttribute('aria-pressed')).toBe('true');
    expect(periodButton('today').getAttribute('aria-pressed')).toBe('false');
  });

  test('a manual refresh re-reads config, usage and quotas with refresh=1', async () => {
    const host = makeHost();
    start(host);
    await tick();

    host.requests.length = 0;
    (root.querySelector('.refresh-slot button') as HTMLButtonElement).click();
    await tick();

    expect(host.requests.map((request) => [request.method, request.path, request.query])).toEqual([
      ['GET', '/config', undefined],
      ['GET', '/v1/magpie/usage', { period: 'today' }],
      ['GET', '/v1/magpie/quotas', { refresh: '1' }],
    ]);
  });

  test('kept, stale and throttled answers carry the right stamp text', async () => {
    const host = makeHost();
    host.state.reply = (request) => {
      if (request.path !== '/v1/magpie/quotas') return respondOk(request);
      return json(
        quotaReport(
          request.query?.refresh === '1'
            ? {
                kept: false,
                throttled: true,
                stale: true,
                asOf: new Date(Date.now() - 5 * 60_000).toISOString(),
              }
            : { kept: true },
        ),
      );
    };
    start(host);
    await tick();

    const stamp = (): string => text(root.querySelector('.stamp-slot .stamp:last-child'));
    expect(stamp()).toContain('cached');
    expect(stamp()).not.toContain('throttled');

    (root.querySelector('.refresh-slot button') as HTMLButtonElement).click();
    await tick();

    expect(stamp()).toContain('last read');
    expect(stamp()).toContain('throttled');
    expect(stamp()).not.toContain('fresh');
  });

  test('a fresh answer is labelled fresh', async () => {
    const host = makeHost((request) =>
      request.path === '/v1/magpie/quotas'
        ? json(quotaReport({ kept: false, throttled: false, stale: false }))
        : respondOk(request),
    );
    start(host);
    await tick();

    expect(text(root.querySelector('.stamp-slot .stamp:last-child'))).toContain('fresh');
  });
});

/* -------------------------------------------------------------------------- */
/* Card order and expansion                                                   */
/* -------------------------------------------------------------------------- */

const DEEPSEEK_KEY = 'r-magpie%2Fdeepseek|balance|';
const OPENROUTER_KEY = 'r-magpie%2Fopenrouter|balance|';
const OPENCODE_KEY = 'r-magpie%2Fopencode-go|plan|';

describe('card order', () => {
  test('a keyboard move posts the new order to /config/order', async () => {
    const host = makeHost();
    start(host);
    await tick();

    host.requests.length = 0;
    pressKey(0, 'ArrowDown');
    await tick();

    expect(cardKeys()).toEqual([OPENROUTER_KEY, DEEPSEEK_KEY, OPENCODE_KEY]);
    expect(text(root.querySelector('.quota-live'))).toBe('DeepSeek moved to position 2 of 3');

    const writes = host.requests.filter((request) => request.path === '/config/order');
    expect(writes.length).toBe(1);
    expect(writes[0]?.method).toBe('POST');
    expect(JSON.parse(writes[0]?.body ?? '{}')).toEqual({
      order: [OPENROUTER_KEY, DEEPSEEK_KEY, OPENCODE_KEY],
    });
    expect((root.querySelector('.stamp-error') as HTMLElement).hidden).toBe(true);
  });

  test('a failed order write says order not saved but keeps the on-screen order', async () => {
    const host = makeHost((request) =>
      request.path === '/config/order'
        ? json({ error: { kind: 'internal', message: 'The config file could not be written.' } }, 500)
        : respondOk(request),
    );
    start(host);
    await tick();

    pressKey(0, 'ArrowDown');
    await tick();

    const note = root.querySelector('.stamp-error') as HTMLElement;
    expect(note.hidden).toBe(false);
    expect(text(note)).toBe('order not saved');
    expect(note.title).toBe('The config file could not be written.');
    expect(cardKeys()).toEqual([OPENROUTER_KEY, DEEPSEEK_KEY, OPENCODE_KEY]);
  });

  test('Home and End move the focused card to the ends', async () => {
    const host = makeHost();
    start(host);
    await tick();

    pressKey(1, 'Home');
    await tick();
    expect(cardKeys()[0]).toBe(OPENROUTER_KEY);

    pressKey(0, 'End');
    await tick();
    expect(cardKeys()[2]).toBe(OPENROUTER_KEY);
  });
});

describe('card expansion', () => {
  test('the first two cards start open and summaries toggle their own body', async () => {
    const host = makeHost();
    start(host);
    await tick();

    const cards = [...root.querySelectorAll<HTMLElement>('.quo-card[data-key]')];
    expect(cards.length).toBe(3);
    const body = (index: number): HTMLElement =>
      cards[index]?.querySelector('.quo-body') as HTMLElement;

    expect(cards[0]?.dataset.open).toBe('true');
    expect(cards[1]?.dataset.open).toBe('true');
    expect(cards[2]?.dataset.open).toBe('false');
    expect(body(0).hidden).toBe(false);
    expect(body(1).hidden).toBe(false);
    expect(body(2).hidden).toBe(true);
    expect(summary(0).getAttribute('aria-expanded')).toBe('true');
    expect(summary(2).getAttribute('aria-expanded')).toBe('false');

    summary(2).click();
    expect(cards[2]?.dataset.open).toBe('true');
    expect(body(2).hidden).toBe(false);
    expect(summary(2).getAttribute('aria-expanded')).toBe('true');

    summary(2).click();
    expect(cards[2]?.dataset.open).toBe('false');
    expect(body(2).hidden).toBe(true);
    expect(summary(2).getAttribute('aria-expanded')).toBe('false');

    summary(0).click();
    expect(cards[0]?.dataset.open).toBe('false');
    expect(body(0).hidden).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Host status and repeated snapshots                                         */
/* -------------------------------------------------------------------------- */

type StatusCase = {
  status: ServiceStatus | 'outside';
  label: string;
  tone: string | null;
};

const STATUS_CASES: StatusCase[] = [
  { status: 'starting', label: 'starting', tone: 'warning' },
  { status: 'failed', label: 'failed', tone: 'error' },
  { status: 'stopped', label: 'stopped', tone: null },
  { status: 'ready', label: 'ready', tone: 'success' },
  { status: 'outside', label: 'outside OpenChamber', tone: null },
];

describe('service status badge', () => {
  for (const item of STATUS_CASES) {
    test(`shows ${item.label}`, async () => {
      let releaseConfig!: () => void;
      const configGate = new Promise<void>((resolve) => {
        releaseConfig = resolve;
      });

      const host = makeHost();
      host.state.status =
        item.status === 'outside'
          ? new HostRequestError('HOST_UNAVAILABLE', 'no host')
          : item.status;
      host.state.reply = (request) =>
        request.path === '/config' ? configGate.then(() => json(configReport())) : respondOk(request);

      start(host);
      await tick();

      if (item.status === 'ready') {
        // `ready` is painted by a successful usage answer, not by serviceStatus.
        releaseConfig();
        await tick();
      }

      expect(text(badge())).toBe(item.label);
      expect(badge().getAttribute('data-tone')).toBe(item.tone);

      releaseConfig();
      await tick();
    });
  }

  test('an unknown status failure shows the unknown badge', async () => {
    let releaseConfig!: () => void;
    const configGate = new Promise<void>((resolve) => {
      releaseConfig = resolve;
    });
    const host = makeHost();
    host.state.status = new HostRequestError('HOST_TIMEOUT', 'no answer');
    host.state.reply = (request) =>
      request.path === '/config' ? configGate.then(() => json(configReport())) : respondOk(request);

    start(host);
    await tick();

    expect(text(badge())).toBe('unknown');
    expect(badge().getAttribute('data-tone')).toBeNull();

    releaseConfig();
    await tick();
  });
});

describe('repeated onReady', () => {
  test('does not mount a second button or badge, and does not start another cycle', async () => {
    const host = makeHost();
    start(host);
    await tick();

    const buttons = (): number => root.querySelectorAll('.refresh-slot button').length;
    const badges = (): number => root.querySelectorAll('.badge-slot .oc-sdk-badge').length;
    expect(buttons()).toBe(1);
    expect(badges()).toBe(1);
    expect(host.requests.length).toBe(3);
    expect(host.readyListeners()).toBe(1);

    host.emitReady({ locale: 'zh-CN' });
    await tick();

    expect(buttons()).toBe(1);
    expect(badges()).toBe(1);
    expect(host.requests.length).toBe(3);
    expect(host.readyListeners()).toBe(1);
    // The snapshot still reached the panel: it switched language in place.
    expect(periodButton('today').textContent).toBe('今天');

    handle?.dispose();
    handle = null;
    expect(host.readyListeners()).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Language                                                                   */
/* -------------------------------------------------------------------------- */

const languageNotice = (): string =>
  [...root.querySelectorAll('.card.config .issue')]
    .map((node) => text(node))
    .find((value) => value !== '') ?? '';

describe('language selection', () => {
  test('auto follows an exact host locale', async () => {
    const host = makeHost();
    start(host, { locale: 'zh-CN' });
    await tick();

    expect(dom.document.documentElement.lang).toBe('zh-CN');
    expect(periodButton('today').textContent).toBe('今天');
    expect(text(root.querySelectorAll('.kpi-label')[1] ?? null)).toBe('缓存命中');
    expect(languageNotice()).toBe('');
  });

  test('an explicit supported language wins over the host locale', async () => {
    const host = makeHost(withConfig(configReport({ language: 'zh-CN' })));
    start(host, { locale: 'en' });
    await tick();

    expect(periodButton('today').textContent).toBe('今天');
    expect(dom.document.documentElement.lang).toBe('zh-CN');
  });

  test('an explicit English setting keeps English under a Chinese host', async () => {
    const host = makeHost(withConfig(configReport({ language: 'en' })));
    start(host, { locale: 'zh-CN' });
    await tick();

    expect(periodButton('today').textContent).toBe('Today');
    expect(dom.document.documentElement.lang).toBe('en');
  });

  test('auto falls back to English when the host locale is not bundled', async () => {
    const host = makeHost();
    start(host, { locale: 'de' });
    await tick();

    expect(periodButton('today').textContent).toBe('Today');
    expect(dom.document.documentElement.lang).toBe('en');
    expect(languageNotice()).toBe('');
  });

  test('an unsupported explicit language falls back and explains itself', async () => {
    const config = configReport({ language: 'fr' });
    const host = makeHost(withConfig(config));
    start(host, { locale: 'en' });
    await tick();

    expect(periodButton('today').textContent).toBe('Today');
    expect(languageNotice()).toBe(
      `Language "fr" from ${config.configPath} is unavailable; using the host language.`,
    );
  });

  test('languageInvalid is reported while the host language still applies', async () => {
    const config = configReport({ language: 'auto', languageInvalid: true });
    const host = makeHost(withConfig(config));
    start(host, { locale: 'zh-CN' });
    await tick();

    expect(periodButton('today').textContent).toBe('今天');
    expect(languageNotice()).toBe(`${config.configPath} 中的 language 值不是字符串；使用宿主语言。`);
  });
});

describe('disposal', () => {
  test('clears the refresh timer and detaches the onReady listener', async () => {
    const cleared: unknown[] = [];
    const original = dom.clearInterval.bind(dom) as (id: unknown) => void;
    (dom as unknown as { clearInterval: (id: unknown) => void }).clearInterval = (id) => {
      cleared.push(id);
      original(id);
    };

    const host = makeHost();
    const mounted = start(host);
    await tick();
    expect(cleared.length).toBe(0);
    expect(host.readyListeners()).toBe(1);

    mounted.dispose();
    handle = null;

    expect(cleared.length).toBe(1);
    expect(host.readyListeners()).toBe(0);
  });
});
