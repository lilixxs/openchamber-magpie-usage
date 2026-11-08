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

type StorageState = {
  values: Map<string, unknown>;
  getCalls: number;
  setCalls: number;
  getError: Error | null;
  setError: Error | null;
  /** When set, a `get` waits for it before answering; lets a test interleave a config read. */
  getGate: Promise<void> | null;
};

type HostState = {
  reply: Responder;
  status: ServiceStatus | Error;
  storage: StorageState;
  clipboard: string[];
  clipboardError: Error | null;
};

type FakeHost = {
  client: HostClient;
  requests: GuestRequest[];
  state: HostState;
  emitReady(overrides?: Partial<HostReadyContext>): void;
  readyListeners(): number;
};

const makeHost = (reply: Responder = respondOk): FakeHost => {
  const state: HostState = {
    reply,
    status: 'ready',
    storage: {
      values: new Map<string, unknown>(),
      getCalls: 0,
      setCalls: 0,
      getError: null,
      setError: null,
      getGate: null,
    },
    clipboard: [],
    clipboardError: null,
  };
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
    storage: {
      get: async (key: string): Promise<unknown> => {
        state.storage.getCalls += 1;
        if (state.storage.getError) throw state.storage.getError;
        if (state.storage.getGate) await state.storage.getGate;
        return state.storage.values.get(key);
      },
      set: async (key: string, value: unknown): Promise<void> => {
        state.storage.setCalls += 1;
        if (state.storage.setError) throw state.storage.setError;
        state.storage.values.set(key, value);
      },
      delete: async (key: string): Promise<void> => {
        state.storage.values.delete(key);
      },
      keys: async (): Promise<string[]> => [...state.storage.values.keys()].sort(),
    },
    writeClipboard: async (text: string): Promise<void> => {
      if (state.clipboardError) throw state.clipboardError;
      state.clipboard.push(text);
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
  configPath: '/home/tester/.config/openchamber-magpie-usage/config.jsonc',
  baseUrl: 'https://magpie.test',
  host: 'magpie.test',
  loopback: false,
  apiKeyConfigured: true,
  refreshSeconds: 60,
  fontScale: 100,
  fontScaleInvalid: false,
  cardOrder: [],
  cardOrderInvalid: false,
  language: 'auto',
  languageInvalid: false,
  recovery: null,
  source: 'file',
  present: true,
  validity: 'valid',
  issue: null,
  issues: [],
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
      return json({ ok: true, order: body.order ?? [], recovery: null });
    }
    case '/config/create':
      return json({ ok: true, created: true, present: true });
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
  {
    kind: 'config-conflict',
    expected: 'The config file changed on disk. Nothing was overwritten; retry.',
  },
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

    // A later config read must not snap the failed order back to the file.
    (root.querySelector('.refresh-slot button') as HTMLButtonElement).click();
    await tick();
    expect(cardKeys()).toEqual([OPENROUTER_KEY, DEEPSEEK_KEY, OPENCODE_KEY]);
  });

  test('a save with a recovery notice reloads /config at once', async () => {
    const host = makeHost((request) => {
      if (request.path === '/config/order') {
        const body = request.body ? (JSON.parse(request.body) as { order?: string[] }) : {};
        return json({
          ok: true,
          order: body.order ?? [],
          recovery: {
            at: '2026-11-07T00:00:00.000Z',
            restored: ['baseUrl'],
            defaulted: ['apiKey'],
            previousText: 'appended-comments',
          },
        });
      }
      return respondOk(request);
    });
    start(host);
    await tick();
    host.requests.length = 0;

    pressKey(0, 'ArrowDown');
    await tick();

    expect(host.requests.map((request) => request.path)).toContain('/config');
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

  test('a test-only locale is not offered; Arabic falls back to English', async () => {
    const host = makeHost(withConfig(configReport({ language: 'ar' })));
    start(host, { locale: 'ar' });
    await tick();

    expect(dom.document.documentElement.lang).toBe('en');
    expect(dom.document.documentElement.dir).toBe('ltr');
    expect(periodButton('today').textContent).toBe('Today');
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

describe('font scale', () => {
  test('applies the configured scale to the root after every ready', async () => {
    const host = makeHost(withConfig(configReport({ fontScale: 150 })));
    start(host);
    await tick();

    expect(dom.document.documentElement.style.fontSize).toBe('21px');
    host.emitReady();
    await tick();
    expect(dom.document.documentElement.style.fontSize).toBe('21px');
    const row = [...root.querySelectorAll('.row')].find((node) => text(node).includes('Font size'));
    expect(text(row ?? null)).toContain('150%');
  });

  test('an invalid scale falls back to 100 and explains why', async () => {
    const host = makeHost(
      withConfig(
        configReport({
          fontScale: 100,
          fontScaleInvalid: true,
          issues: [
            {
              field: 'fontScale',
              kind: 'invalid',
              message: 'fontScale must be an integer from 50 to 200.',
            },
          ],
        }),
      ),
    );
    start(host);
    await tick();

    expect(dom.document.documentElement.style.fontSize).toBe('14px');
    const issues = [...root.querySelectorAll('.issue')].map((node) => text(node));
    expect(issues.some((issue) => issue.includes('50 to 200'))).toBe(true);
    // The localized notice replaces the service's English duplicate.
    expect(issues.some((issue) => issue.includes('fontScale must be'))).toBe(false);
  });

  test('a config without fontScale falls back to 100%', async () => {
    const config = configReport();
    delete (config as Partial<ConfigReport>).fontScale;
    const host = makeHost(withConfig(config));
    start(host);
    await tick();

    expect(dom.document.documentElement.style.fontSize).toBe('14px');
    const row = [...root.querySelectorAll('.row')].find((node) => text(node).includes('Font size'));
    expect(text(row ?? null)).toContain('100%');
  });
});

describe('chart labels', () => {
  // Thirty daily buckets with real dates, in the gateway's +08:00 zone, as the service sends them.
  const thirtyDays = Array.from({ length: 30 }, (_, index) => {
    const day = new Date(Date.UTC(2026, 9, 9 + index));
    const mm = String(day.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(day.getUTCDate()).padStart(2, '0');
    return {
      label: `${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`,
      time: `2026-${mm}-${dd}T00:00:00+08:00`,
      calls: 1,
      input: 1000 + index,
      output: 100 + index,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
    };
  });

  const hours = Array.from({ length: 24 }, (_, index) => ({
    label: String(index).padStart(2, '0'),
    time: `2026-11-07T${String(index).padStart(2, '0')}:00:00+08:00`,
    calls: 1,
    input: 1000 + index,
    output: 100 + index,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
  }));

  const chartHost = (period: string, buckets: typeof thirtyDays, fontScale = 100): FakeHost =>
    makeHost((request) => {
      if (request.path === '/config') return json(configReport({ fontScale }));
      if (request.path === '/v1/magpie/usage') return json(usageReport(period, { series: buckets }));
      return respondOk(request);
    });

  // Each cell is one bar; the text is only in the picked cells.
  const shownLabels = (): string[] =>
    [...root.querySelectorAll('.bar-label')].map((node) => text(node));

  test('30 days shows seven MM-DD labels, first and last pinned to their bars', async () => {
    start(chartHost('30d', thirtyDays));
    await tick();
    expect(shownLabels()).toEqual(['10-09', '10-14', '10-19', '10-24', '10-28', '11-02', '11-07']);
    expect(root.querySelector('.bar-label-start')?.textContent).toBe('10-09');
    expect(root.querySelector('.bar-label-end')?.textContent).toBe('11-07');
  });

  test('24 hours shows six HH labels', async () => {
    start(chartHost('today', hours));
    await tick();
    expect(shownLabels()).toEqual(['00', '05', '09', '14', '18', '23']);
  });

  test('label count does not depend on font scale', async () => {
    start(chartHost('30d', thirtyDays, 150));
    await tick();
    expect(shownLabels()).toEqual(['10-09', '10-14', '10-19', '10-24', '10-28', '11-02', '11-07']);
  });

  test('each label sits in the cell of its own bar', async () => {
    start(chartHost('30d', thirtyDays));
    await tick();
    const cells = [...root.querySelectorAll('.bar-cell')];
    expect(cells).toHaveLength(30);
    const labelled = cells.map((cell, index) => (cell.querySelector('.bar-label') ? index : -1)).filter((index) => index >= 0);
    expect(labelled).toEqual([0, 5, 10, 15, 19, 24, 29]);
  });

  test('a later refresh replaces the labels rather than appending to them', async () => {
    start(chartHost('30d', thirtyDays));
    await tick();
    expect(shownLabels()).toHaveLength(7);
    const refresh = root.querySelector('.refresh-slot button') as HTMLButtonElement;
    refresh.click();
    await tick();
    expect(shownLabels()).toHaveLength(7);
    expect(root.querySelectorAll('.bar-label')).toHaveLength(7);
  });
});

/* -------------------------------------------------------------------------- */
/* Configuration card                                                         */
/* -------------------------------------------------------------------------- */

const INIT_KEY = 'openchamber-magpie-usage:v1:config-initialized';

const configCard = (): HTMLElement => root.querySelector('.card.config') as HTMLElement;
const configHead = (): HTMLButtonElement =>
  root.querySelector('.config-head') as HTMLButtonElement;
const configBodyEl = (): HTMLElement => root.querySelector('.config-body') as HTMLElement;
const configStatusText = (): string => text(root.querySelector('.config-status'));
const configPathButton = (): HTMLButtonElement =>
  root.querySelector('.config-path') as HTMLButtonElement;

const missingReport = (overrides: Partial<ConfigReport> = {}): ConfigReport =>
  configReport({
    present: false,
    source: 'default',
    validity: 'missing',
    baseUrl: 'http://127.0.0.1:3425',
    host: '127.0.0.1:3425',
    loopback: true,
    apiKeyConfigured: false,
    issue: null,
    issues: [],
    ...overrides,
  });

describe('configuration card shell', () => {
  test('is last before the footer, collapsed by default, and toggles with its header', async () => {
    const host = makeHost();
    start(host);
    await tick();

    expect(configCard()).toBeDefined();
    expect(configCard().nextElementSibling?.className).toBe('footer');
    expect(root.querySelectorAll('.quotas .card.config').length).toBe(0);
    expect(configBodyEl().hidden).toBe(true);
    expect(configHead().getAttribute('aria-expanded')).toBe('false');
    expect(configHead().getAttribute('aria-controls')).toBe('config-body');
    expect(configBodyEl().id).toBe('config-body');
    expect(configHead().getAttribute('draggable')).toBeNull();
    expect(configHead().querySelector('.quo-logo')).toBeNull();

    configHead().click();
    expect(configBodyEl().hidden).toBe(false);
    expect(configHead().getAttribute('aria-expanded')).toBe('true');

    // Refresh and a repeated snapshot do not reset the fold.
    (root.querySelector('.refresh-slot button') as HTMLButtonElement).click();
    await tick();
    expect(configBodyEl().hidden).toBe(false);

    host.emitReady({ locale: 'zh-CN' });
    await tick();
    expect(configBodyEl().hidden).toBe(false);
  });

  test('a remounted panel starts collapsed again', async () => {
    const host = makeHost();
    start(host);
    await tick();
    configHead().click();
    expect(configBodyEl().hidden).toBe(false);
    handle?.dispose();
    handle = null;

    const secondRoot = dom.document.createElement('div') as unknown as HTMLElement;
    (dom.document.body as unknown as HTMLElement).append(secondRoot);
    const secondHost = makeHost();
    const second = mountPanel({ host: secondHost.client, root: secondRoot });
    handle = second;
    secondHost.emitReady();
    await tick();
    expect((secondRoot.querySelector('.config-body') as HTMLElement).hidden).toBe(true);
  });

  test('the header reports only file validity and unsupported language', async () => {
    const gate = makeHost((request) =>
      request.path === '/config'
        ? new Promise((resolve) => {
            setTimeout(() => resolve(json(configReport())), 5);
          })
        : respondOk(request),
    );
    handle = start(gate);
    await tick();
    expect(configStatusText()).toBe('Checking…');

    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(configStatusText()).toBe('Valid');

    const remount = (host: FakeHost): void => {
      handle?.dispose();
      handle = null;
      root.replaceChildren();
      handle = start(host);
    };

    const invalid = makeHost(withConfig(configReport({ validity: 'invalid', fontScaleInvalid: true })));
    remount(invalid);
    await tick();
    expect(configStatusText()).toBe('Invalid');

    remount(makeHost(withConfig(missingReport())));
    await tick();
    expect(configStatusText()).toBe('Not created');

    remount(
      makeHost(
        withConfig(
          missingReport({
            validity: 'unreadable',
            issue: { kind: 'unreadable', message: 'The config file could not be read.' },
            issues: [
              { field: 'document', kind: 'unreadable', message: 'The config file could not be read.' },
            ],
          }),
        ),
      ),
    );
    await tick();
    expect(configStatusText()).toBe('Unreadable');

    remount(makeHost(withConfig(configReport({ language: 'fr' }))));
    await tick();
    expect(configStatusText()).toBe('Invalid');
  });

  test('the full path is a focusable copy button with success and failure feedback', async () => {
    const host = makeHost();
    start(host);
    await tick();

    expect(configPathButton().tagName).toBe('BUTTON');
    expect(configPathButton().type).toBe('button');
    expect(configPathButton().tabIndex).toBe(0);
    expect(text(configPathButton())).toBe(
      '/home/tester/.config/openchamber-magpie-usage/config.jsonc',
    );

    configHead().click();
    configPathButton().click();
    await tick();
    expect(host.state.clipboard).toEqual([
      '/home/tester/.config/openchamber-magpie-usage/config.jsonc',
    ]);
    expect(text(root.querySelector('.config-copy'))).toBe('Path copied.');
    // Copying never folds the card.
    expect(configBodyEl().hidden).toBe(false);

    host.state.clipboardError = new Error('clipboard denied');
    configPathButton().click();
    await tick();
    expect(text(root.querySelector('.config-copy'))).toContain('clipboard denied');
    expect(configBodyEl().hidden).toBe(false);
  });

  test('recovery details live in the body, not in the title', async () => {
    const host = makeHost(
      withConfig(
        configReport({
          validity: 'invalid',
          issue: { kind: 'invalid-json', message: 'The config file is not valid JSONC.' },
          issues: [{ field: 'document', kind: 'invalid-json', message: 'The config file is not valid JSONC.' }],
          recovery: {
            at: '2026-11-07T00:00:00.000Z',
            restored: ['baseUrl'],
            defaulted: ['apiKey'],
            previousText: 'appended-comments',
          },
        }),
      ),
    );
    start(host);
    await tick();

    configHead().click();
    const bodyText = text(configBodyEl());
    expect(bodyText).toContain('Restored: baseUrl');
    expect(bodyText).toContain('Defaults used: apiKey');
    expect(bodyText).toContain('previous text is kept as comments');
    expect(text(configHead())).not.toContain('Restored');
    expect(configStatusText()).toBe('Invalid');
  });
});

describe('configuration creation', () => {
  test('a completed marker plus a missing file shows the button, never auto-creates', async () => {
    const host = makeHost(withConfig(missingReport()));
    host.state.storage.values.set(INIT_KEY, { version: 1 });
    start(host);
    await tick();

    expect(host.requests.filter((request) => request.path === '/config/create')).toEqual([]);
    configHead().click();
    expect((root.querySelector('.config-create') as HTMLElement).hidden).toBe(false);
    expect((root.querySelector('.config-create .config-action') as HTMLButtonElement).textContent).toBe(
      'Create config file',
    );
  });

  test('first open with no marker and no file creates once, then remembers', async () => {
    let present = false;
    const host = makeHost((request) => {
      if (request.path === '/config') return json(present ? configReport() : missingReport());
      if (request.path === '/config/create') {
        present = true;
        return json({ ok: true, created: true, present: true });
      }
      return respondOk(request);
    });
    start(host);
    await tick();

    const creates = host.requests.filter((request) => request.path === '/config/create');
    expect(creates.length).toBe(1);
    expect(JSON.parse(creates[0]?.body ?? '{}')).toEqual({ order: [] });
    expect(host.state.storage.values.get(INIT_KEY)).toMatchObject({ version: 1 });
    expect(configStatusText()).toBe('Valid');

    host.emitReady();
    await tick();
    expect(host.requests.filter((request) => request.path === '/config/create').length).toBe(1);
  });

  test('an existing file is not overwritten; the marker is written instead', async () => {
    const host = makeHost();
    start(host);
    await tick();

    expect(host.requests.filter((request) => request.path === '/config/create')).toEqual([]);
    expect(host.state.storage.values.get(INIT_KEY)).toMatchObject({ version: 1 });
  });

  test('a storage read failure does not auto-create and leaves the manual button usable', async () => {
    const host = makeHost(withConfig(missingReport()));
    host.state.storage.getError = new Error('storage unavailable');
    start(host);
    await tick();

    expect(host.requests.filter((request) => request.path === '/config/create')).toEqual([]);
    configHead().click();
    const issues = [...root.querySelectorAll('.config-body .issue')].map((node) => text(node)).join(' ');
    expect(issues).toContain('storage unavailable');
    expect((root.querySelector('.config-create') as HTMLElement).hidden).toBe(false);
  });

  test('the confirm/cancel flow posts only intent and order, then refreshes', async () => {
    let present = false;
    let release!: () => void;
    const createGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = makeHost((request) => {
      if (request.path === '/config') return json(present ? configReport() : missingReport());
      if (request.path === '/config/create') {
        return createGate.then(() => {
          present = true;
          return json({ ok: true, created: true, present: true });
        });
      }
      return respondOk(request);
    });
    host.state.storage.values.set(INIT_KEY, { version: 1 });
    start(host);
    await tick();

    configHead().click();
    (root.querySelector('.config-create .config-action') as HTMLButtonElement).click();
    expect((root.querySelector('.config-confirm') as HTMLElement).hidden).toBe(false);
    const yes = root.querySelectorAll<HTMLButtonElement>('.config-confirm .config-action')[0];
    const no = root.querySelectorAll<HTMLButtonElement>('.config-confirm .config-action')[1];
    expect(no?.textContent).toBe('Cancel');
    yes?.click();
    await tick();
    expect(yes?.disabled).toBe(true);
    expect(text(root.querySelector('.config-create-status'))).toBe('Creating…');

    release();
    await tick();
    await tick();
    const creates = host.requests.filter((request) => request.path === '/config/create');
    expect(creates.length).toBe(1);
    expect(JSON.parse(creates[0]?.body ?? '{}')).toEqual({ order: [] });
    expect(host.requests.some((request) => request.path === '/config' && request.method === 'GET')).toBe(true);
    expect(configStatusText()).toBe('Valid');
  });

  test('a failed create keeps the button usable for a retry', async () => {
    let attempts = 0;
    const host = makeHost((request) => {
      if (request.path === '/config') return json(missingReport());
      if (request.path === '/config/create') {
        attempts += 1;
        return json({ error: { kind: 'internal', message: 'The config file could not be written.' } }, 500);
      }
      return respondOk(request);
    });
    host.state.storage.values.set(INIT_KEY, { version: 1 });
    start(host);
    await tick();

    configHead().click();
    (root.querySelector('.config-create .config-action') as HTMLButtonElement).click();
    const yes = root.querySelectorAll<HTMLButtonElement>('.config-confirm .config-action')[0];
    yes?.click();
    await tick();
    expect(text(root.querySelector('.config-create-status'))).toContain('could not be written');
    expect(yes?.disabled).toBe(false);

    yes?.click();
    await tick();
    expect(attempts).toBe(2);
  });

  test('a marker write failure after creation does not roll the file back or claim success', async () => {
    let present = false;
    const host = makeHost((request) => {
      if (request.path === '/config') return json(present ? configReport() : missingReport());
      if (request.path === '/config/create') {
        present = true;
        return json({ ok: true, created: true, present: true });
      }
      return respondOk(request);
    });
    host.state.storage.setError = new Error('marker write failed');
    start(host);
    await tick();

    expect(present).toBe(true);
    expect(host.state.storage.values.get(INIT_KEY)).toBeUndefined();
    expect(text(root.querySelector('.config-body'))).toContain('marker write failed');
    expect(configStatusText()).toBe('Valid');
  });
});

describe('configuration check failures', () => {
  const configLoadIssue = (): HTMLElement =>
    root.querySelector('.config-load-issue') as HTMLElement;

  test('a failed first /config says Unable to check, not Checking, and never initialises storage', async () => {
    const host = makeHost((request) =>
      request.path === '/config'
        ? new HostRequestError('SERVICE_FAILED', 'UPSTREAM_TEXT_SECRET')
        : respondOk(request),
    );
    start(host);
    await tick();

    expect(configStatusText()).toBe('Unable to check');
    expect(root.querySelector('.config-status')?.getAttribute('data-tone')).toBe('warning');
    expect(configLoadIssue().hidden).toBe(false);
    expect(text(configLoadIssue())).toBe(
      'The configuration could not be checked: The local service stopped. It restarts on the next request.',
    );
    expect(text(root)).not.toContain('UPSTREAM_TEXT_SECRET');
    // Usage and quotas still paint; only the file state is unknown.
    expect(root.querySelectorAll('.quo-card[data-key]').length).toBe(3);
    expect((root.querySelector('.config-create') as HTMLElement).hidden).toBe(true);
    expect(host.requests.filter((request) => request.path === '/config/create')).toEqual([]);
    expect(host.state.storage.getCalls).toBe(0);
    expect(host.state.storage.setCalls).toBe(0);
  });

  test('a malformed /config is Unable to check, not Invalid', async () => {
    const host = makeHost((request) =>
      request.path === '/config' ? json({ configPath: 42 }) : respondOk(request),
    );
    start(host);
    await tick();

    expect(configStatusText()).toBe('Unable to check');
    expect(configStatusText()).not.toBe('Invalid');
    expect(text(configLoadIssue())).toBe(
      'The configuration could not be checked: The local service answered /config with an unexpected shape.',
    );
  });

  test('a failed reload after Valid shows Unable to check, then the retry restores the real validity', async () => {
    let mode: 'ok' | 'fail' | 'invalid' = 'ok';
    const host = makeHost((request) => {
      if (request.path !== '/config') return respondOk(request);
      if (mode === 'fail') return new HostRequestError('SERVICE_FAILED', 'UPSTREAM_TEXT_SECRET');
      if (mode === 'invalid') return json(configReport({ validity: 'invalid' }));
      return json(configReport());
    });
    start(host);
    await tick();
    expect(configStatusText()).toBe('Valid');
    expect(configLoadIssue().hidden).toBe(true);

    mode = 'fail';
    (root.querySelector('.refresh-slot button') as HTMLButtonElement).click();
    await tick();
    expect(configStatusText()).toBe('Unable to check');
    expect(configStatusText()).not.toBe('Valid');
    expect(text(configLoadIssue())).toContain(SERVICE_FAILED);
    expect(text(root)).not.toContain('UPSTREAM_TEXT_SECRET');
    // The last known path stays available for copying.
    configPathButton().click();
    await tick();
    expect(host.state.clipboard).toEqual([configReport().configPath]);

    mode = 'invalid';
    (root.querySelector('.refresh-slot button') as HTMLButtonElement).click();
    await tick();
    expect(configStatusText()).toBe('Invalid');
    expect(configLoadIssue().hidden).toBe(true);
  });

  test('a stale Not created answer never authorises a create, and the fold survives the failure', async () => {
    let failing = false;
    const host = makeHost((request) => {
      if (request.path === '/config') {
        return failing
          ? new HostRequestError('SERVICE_FAILED', 'UPSTREAM_TEXT_SECRET')
          : json(missingReport());
      }
      return respondOk(request);
    });
    host.state.storage.values.set(INIT_KEY, { version: 1 });
    start(host);
    await tick();

    expect(configStatusText()).toBe('Not created');
    configHead().click();
    expect(configBodyEl().hidden).toBe(false);
    expect((root.querySelector('.config-create') as HTMLElement).hidden).toBe(false);
    const markerReads = host.state.storage.getCalls;

    failing = true;
    (root.querySelector('.refresh-slot button') as HTMLButtonElement).click();
    await tick();

    expect(configStatusText()).toBe('Unable to check');
    expect(text(configLoadIssue())).toContain(SERVICE_FAILED);
    expect((root.querySelector('.config-create') as HTMLElement).hidden).toBe(true);
    expect(host.requests.filter((request) => request.path === '/config/create')).toEqual([]);
    expect(host.state.storage.getCalls).toBe(markerReads);
    expect(host.state.storage.setCalls).toBe(0);
    expect(configBodyEl().hidden).toBe(false);
  });

  test('the failure status is localized from the host locale with no config read at all', async () => {
    const host = makeHost((request) =>
      request.path === '/config'
        ? new HostRequestError('SERVICE_FAILED', 'UPSTREAM_TEXT_SECRET')
        : respondOk(request),
    );
    start(host, { locale: 'zh-CN' });
    await tick();

    expect(dom.document.documentElement.lang).toBe('zh-CN');
    expect(configStatusText()).toBe('无法检查');
    expect(text(configLoadIssue())).toBe(
      '无法检查配置文件：本地服务已停止。下次请求时会重新启动。',
    );
    expect(text(root)).not.toContain('UPSTREAM_TEXT_SECRET');

    configHead().click();
    expect(configBodyEl().hidden).toBe(false);
    host.emitReady({ locale: 'en' });
    await tick();
    expect(configStatusText()).toBe('Unable to check');
    // A repeated snapshot that changes the language never folds the card back.
    expect(configBodyEl().hidden).toBe(false);
  });

  test('usage or quota failures never turn a valid config into Unable to check', async () => {
    const host = makeHost((request) => {
      if (request.path === '/v1/magpie/usage' || request.path === '/v1/magpie/quotas') {
        return new HostRequestError('SERVICE_FAILED', 'UPSTREAM_TEXT_SECRET');
      }
      return respondOk(request);
    });
    start(host);
    await tick();

    expect(configStatusText()).toBe('Valid');
    expect(configLoadIssue().hidden).toBe(true);
  });

  test('a failed first check leaves first-open initialisation pending', async () => {
    let failing = true;
    let present = false;
    const host = makeHost((request) => {
      if (request.path === '/config') {
        if (failing) return new HostRequestError('SERVICE_FAILED', 'UPSTREAM_TEXT_SECRET');
        return json(present ? configReport() : missingReport());
      }
      if (request.path === '/config/create') {
        present = true;
        return json({ ok: true, created: true, present: true });
      }
      return respondOk(request);
    });
    start(host);
    await tick();

    expect(host.state.storage.getCalls).toBe(0);
    expect(host.requests.filter((request) => request.path === '/config/create')).toEqual([]);

    failing = false;
    (root.querySelector('.refresh-slot button') as HTMLButtonElement).click();
    await tick();
    await tick();

    expect(configStatusText()).toBe('Valid');
    expect(host.requests.filter((request) => request.path === '/config/create').length).toBe(1);
    expect(host.state.storage.values.get(INIT_KEY)).toMatchObject({ version: 1 });
  });

  test('a successful manual create clears the resolved automatic-create failure only', async () => {
    let present = false;
    let autoFails = true;
    const host = makeHost((request) => {
      if (request.path === '/config') return json(present ? configReport() : missingReport());
      if (request.path === '/config/create') {
        if (!present && autoFails) {
          autoFails = false;
          return json(
            { error: { kind: 'internal', message: 'The config file could not be written.' } },
            500,
          );
        }
        present = true;
        return json({ ok: true, created: true, present: true });
      }
      return respondOk(request);
    });
    start(host);
    await tick();

    expect(configStatusText()).toBe('Not created');
    expect(text(configBodyEl())).toContain('could not be created automatically');

    configHead().click();
    (root.querySelector('.config-create .config-action') as HTMLButtonElement).click();
    const yes = root.querySelectorAll<HTMLButtonElement>('.config-confirm .config-action')[0];
    yes?.click();
    await tick();
    await tick();

    expect(configStatusText()).toBe('Valid');
    // The create is resolved; that message must not outlive it.
    expect(text(configBodyEl())).not.toContain('could not be created automatically');
  });

  for (const filePresent of [false, true]) {
    const label = filePresent ? 'existing file' : 'missing file';

    test(`a config failure during the first-open storage read writes nothing (${label})`, async () => {
      let failing = true;
      let present = filePresent;
      const host = makeHost((request) => {
        if (request.path === '/config') {
          if (failing) return new HostRequestError('SERVICE_FAILED', 'UPSTREAM_TEXT_SECRET');
          return json(present ? configReport() : missingReport());
        }
        if (request.path === '/config/order') {
          return json({
            ok: true,
            order: [],
            recovery: { at: '2026-11-07T00:00:00.000Z', restored: [], defaulted: [], previousText: 'appended-comments' },
          });
        }
        if (request.path === '/config/create') {
          present = true;
          return json({ ok: true, created: true, present: true });
        }
        return respondOk(request);
      });
      start(host);
      await tick();
      // The failed first read leaves the first-open flow pending with cards painted.
      expect(configStatusText()).toBe('Unable to check');
      expect(host.state.storage.getCalls).toBe(0);
      expect(root.querySelectorAll('.quo-card[data-key]').length).toBe(3);

      failing = false;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      host.state.storage.getGate = gate;
      (root.querySelector('.refresh-slot button') as HTMLButtonElement).click();
      await tick();
      expect(host.state.storage.getCalls).toBe(1);

      // A concurrent read fails while the storage read is still in flight.
      failing = true;
      pressKey(0, 'ArrowDown');
      await tick();
      expect(configStatusText()).toBe('Unable to check');

      release();
      host.state.storage.getGate = null;
      await tick();
      await tick();

      expect(configStatusText()).toBe('Unable to check');
      expect(host.state.storage.setCalls).toBe(0);
      expect(host.state.storage.values.get(INIT_KEY)).toBeUndefined();
      expect(host.requests.filter((request) => request.path === '/config/create')).toEqual([]);

      // A later successful read still finishes the first-open flow exactly once.
      failing = false;
      (root.querySelector('.refresh-slot button') as HTMLButtonElement).click();
      await tick();
      await tick();
      await tick();

      expect(configStatusText()).toBe('Valid');
      expect(host.requests.filter((request) => request.path === '/config/create').length).toBe(
        filePresent ? 0 : 1,
      );
      expect(host.state.storage.setCalls).toBe(1);
      expect(host.state.storage.values.get(INIT_KEY)).toMatchObject({ version: 1 });
    });
  }

  test('a config failure during the automatic create never records first-open completion', async () => {
    let failing = true;
    let present = false;
    let createGate: Promise<void> = Promise.resolve();
    let releaseCreate!: () => void;
    const host = makeHost((request) => {
      if (request.path === '/config') {
        if (failing) return new HostRequestError('SERVICE_FAILED', 'UPSTREAM_TEXT_SECRET');
        return json(present ? configReport() : missingReport());
      }
      if (request.path === '/config/order') {
        return json({
          ok: true,
          order: [],
          recovery: { at: '2026-11-07T00:00:00.000Z', restored: [], defaulted: [], previousText: 'appended-comments' },
        });
      }
      if (request.path === '/config/create') {
        return createGate.then(() => {
          present = true;
          return json({ ok: true, created: true, present: true });
        });
      }
      return respondOk(request);
    });
    start(host);
    await tick();
    expect(configStatusText()).toBe('Unable to check');

    failing = false;
    createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    (root.querySelector('.refresh-slot button') as HTMLButtonElement).click();
    await tick();
    expect(host.requests.filter((request) => request.path === '/config/create').length).toBe(1);

    // The create answered is pending; a read fails before the marker is written.
    failing = true;
    pressKey(0, 'ArrowDown');
    await tick();
    expect(configStatusText()).toBe('Unable to check');

    releaseCreate();
    await tick();
    await tick();

    // Unknown state is not a completed first open: nothing was recorded.
    expect(host.state.storage.setCalls).toBe(0);
    expect(host.state.storage.values.get(INIT_KEY)).toBeUndefined();
    expect(configStatusText()).toBe('Unable to check');

    // The file now exists; the next successful read records the marker once.
    failing = false;
    createGate = Promise.resolve();
    (root.querySelector('.refresh-slot button') as HTMLButtonElement).click();
    await tick();
    await tick();
    await tick();

    expect(configStatusText()).toBe('Valid');
    expect(host.state.storage.setCalls).toBe(1);
    expect(host.requests.filter((request) => request.path === '/config/create').length).toBe(1);
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

/* -------------------------------------------------------------------------- */
/* Host fonts                                                                 */
/* -------------------------------------------------------------------------- */

describe('host font faces', () => {
  const style = (): HTMLStyleElement | null =>
    dom.document.getElementById('oc-magpie-host-fonts') as HTMLStyleElement | null;

  test('declares the host interface and mono families from the theme', async () => {
    const host = makeHost();
    start(host, {
      theme: {
        mode: 'dark',
        tokens: {
          ...THEME_TOKENS,
          font: '"Noto Sans", "SF Pro Text", sans-serif',
          mono: '"Fira Code", monospace',
        },
      },
    });
    await tick();

    const text = style()?.textContent ?? '';
    expect(text).toContain('font-family:"Noto Sans"');
    expect(text).toContain('font-family:"Fira Code"');
  });

  test('leaves a system stack alone and adds each family once', async () => {
    const host = makeHost();
    start(host);
    await tick();
    expect(style()).toBeNull();

    const theme = {
      mode: 'dark' as const,
      tokens: { ...THEME_TOKENS, font: '"Noto Sans", sans-serif', mono: '"Fira Code", monospace' },
    };
    host.emitReady({ theme });
    await tick();
    host.emitReady({ theme });
    await tick();

    const text = style()?.textContent ?? '';
    expect(text.split('font-family:"Noto Sans"').length - 1).toBe(3);
  });
});
