// Runs under the app's Node runtime on 127.0.0.1. The panel reaches it only
// through the host's authenticated `serviceRequest` proxy.
//
// Routes:
//   GET    /health                     unchanged contract
//   GET    /config                     path, endpoint, validity, card order
//   POST   /config/create              idempotent creation of the JSONC file
//   POST   /config/order               merge `cardOrder`, or rebuild a damaged file
//   GET    /v1/magpie/usage?period=    normalised usage summary
//   GET    /v1/magpie/quotas[?kept=1]  normalised quota cards
//   GET    /v1/magpie/quotas?refresh=1 a fresh read, throttled
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
  MAX_CARD_ORDER,
  MAX_CARD_ORDER_KEY,
  decodeQuotas,
  decodeUsage,
  isPeriod,
  type ConfigRecovery,
  type ConfigReport,
  type QuotaCard,
  type QuotaReport,
  type ServiceErrorBody,
  type ServiceErrorKind,
  type UsageReport,
} from '../shared/magpie.ts';
import { defaultConfigPath, readConfig } from './config.ts';
import { ConfigWriteError, createConfigFile, saveCardOrder } from './config-write.ts';
import { requestUpstream, type UpstreamFailure } from './upstream.ts';
import { SERVICE_API_VERSION, SERVICE_NAME } from '../shared/health.ts';

export type ServiceOptions = {
  /** 0 asks the OS for a free port. */
  port: number;
  token: string;
  /** Defaults to `~/.config/openchamber-magpie-usage/config.jsonc`. */
  configPath?: string;
  /** Upstream read timeout. Defaults to 15 s. */
  upstreamTimeoutMs?: number;
  /** Shortest gap between two fresh quota reads. Defaults to 30 s. */
  refreshMinIntervalMs?: number;
  /** Test seam: runs between the fresh read and the publish check of an order save. */
  beforeConfigPublish?: (path: string) => void | Promise<void>;
  now?: () => number;
  /** Test seam; defaults to the runtime `fetch`. */
  fetchImpl?: typeof fetch;
};

export type LocalService = {
  readonly url: string;
  start(): Promise<void>;
  stop(): Promise<void>;
};

const DEFAULT_UPSTREAM_TIMEOUT_MS = 15_000;
const DEFAULT_REFRESH_MIN_INTERVAL_MS = 30_000;
/** Cap for a `/config/order` body; an order of 500 keys is far smaller. */
const MAX_ORDER_BODY_BYTES = 64 * 1024;

const writeJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
};

const statusFor = (kind: ServiceErrorKind): number => {
  if (kind === 'bad-request') return 400;
  if (kind === 'config-conflict') return 409;
  if (kind === 'internal') return 500;
  if (kind === 'upstream-timeout') return 504;
  return 502;
};

const fail = (
  response: ServerResponse,
  kind: ServiceErrorKind,
  extra: { status?: number; endpoint?: string; message?: string } = {},
): void => {
  const body: ServiceErrorBody = {
    error: {
      kind,
      message: extra.message ?? 'The local service answered with an unknown error.',
      ...(extra.status === undefined ? {} : { status: extra.status }),
      ...(extra.endpoint === undefined ? {} : { endpoint: extra.endpoint }),
    },
  };
  writeJson(response, statusFor(kind), body);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type BodyRead = { ok: true; text: string } | { ok: false };

/** Reads a bounded body; an oversized one is drained and reported, not buffered. */
const readBody = (request: IncomingMessage): Promise<BodyRead> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_ORDER_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      resolve(tooLarge ? { ok: false } : { ok: true, text: Buffer.concat(chunks).toString('utf8') });
    });
    request.on('error', reject);
  });

/** 0–500 keys of 1–200 characters each. */
const parseOrderArray = (raw: unknown, allowEmpty: boolean): string[] | null => {
  if (!Array.isArray(raw)) return null;
  if (!allowEmpty && raw.length === 0) return null;
  if (raw.length > MAX_CARD_ORDER) return null;

  const order: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') return null;
    if (entry.length === 0 || entry.length > MAX_CARD_ORDER_KEY) return null;
    order.push(entry);
  }
  return order;
};

/** `{ "order": string[] }` with 1–500 keys, or `null`. */
const parseOrderBody = (text: string): string[] | null => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  return parseOrderArray(value.order, false);
};

/**
 * `{}` or `{ "order"?: string[] }`. An empty body and an empty order are both
 * valid: the panel sends only its intent and, when it has one, the order it
 * currently shows. It never sends a path or config content.
 */
const parseCreateBody = (text: string): string[] | null => {
  if (text.trim() === '') return [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (value.order === undefined) return [];
  return parseOrderArray(value.order, true);
};

export const createService = (options: ServiceOptions): LocalService => {
  const {
    port,
    token,
    configPath = defaultConfigPath(),
    upstreamTimeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS,
    refreshMinIntervalMs = DEFAULT_REFRESH_MIN_INTERVAL_MS,
    beforeConfigPublish,
    now = Date.now,
    fetchImpl = fetch,
  } = options;

  let server: Server | undefined;
  let boundPort = port;

  // Cached quota reads come from the gateway's own snapshot; the fresh ones
  // also feed the throttle. `lastGood*` holds the newest non-empty list so an
  // empty `kept=1` answer never wipes the panel.
  let lastGoodCards: QuotaCard[] | null = null;
  let lastGoodAt: number | null = null;
  let lastFreshAt: number | null = null;
  // Set when a write rebuilt a damaged file. In memory only: the panel shows
  // it until the service restarts; the previous text stays in the file comments.
  let recoveryNotice: ConfigRecovery | null = null;

  const loadConfig = async () => readConfig(configPath);

  const callUpstream = (baseUrl: string, apiKey: string | null, path: string, query: Record<string, string>) =>
    requestUpstream({ baseUrl, apiKey, path, query, timeoutMs: upstreamTimeoutMs, fetchImpl });

  const answerUpstreamFailure = (response: ServerResponse, failure: UpstreamFailure, endpoint: string): void => {
    const kind = failure.kind;
    fail(response, kind, { status: failure.status, endpoint, message: failure.message });
  };

  const handle = async (requestUrl: URL, response: ServerResponse): Promise<void> => {
    const { pathname } = requestUrl;

    if (pathname === '/health') {
      writeJson(response, 200, { ok: true, name: SERVICE_NAME, apiVersion: SERVICE_API_VERSION });
      return;
    }

    if (pathname === '/config') {
      const { config, path } = await loadConfig();
      const report: ConfigReport = {
        configPath: path,
        baseUrl: config.baseUrl,
        host: config.host,
        loopback: config.loopback,
        // Never the key itself, nor its length or a prefix of it.
        apiKeyConfigured: config.apiKey !== null,
        refreshSeconds: config.refreshSeconds,
        fontScale: config.fontScale,
        fontScaleInvalid: config.fontScaleInvalid,
        cardOrder: config.cardOrder,
        cardOrderInvalid: config.cardOrderInvalid,
        language: config.language,
        languageInvalid: config.languageInvalid,
        providerIcons: config.providerIcons,
        recovery: recoveryNotice,
        source: config.source,
        present: config.present,
        validity: config.validity,
        issue: config.issue,
        issues: config.issues,
      };
      writeJson(response, 200, report);
      return;
    }

    if (pathname === '/v1/magpie/usage') {
      const raw = requestUrl.searchParams.get('period') ?? 'today';
      if (!isPeriod(raw)) {
        fail(response, 'bad-request', { message: 'period must be one of today, 7d, 30d.' });
        return;
      }

      const { config } = await loadConfig();
      const answer = await callUpstream(config.baseUrl, config.apiKey, '/v1/magpie/usage', { period: raw });
      if (!answer.ok) {
        answerUpstreamFailure(response, answer.error, config.baseUrl);
        return;
      }

      const decoded = decodeUsage(answer.value);
      if (!decoded.ok) {
        fail(response, 'upstream-schema', { endpoint: config.baseUrl, message: decoded.message });
        return;
      }

      const report: UsageReport = {
        endpoint: config.baseUrl,
        host: config.host,
        loopback: config.loopback,
        fetchedAt: new Date(now()).toISOString(),
        period: decoded.value.period,
        since: decoded.value.since,
        totals: decoded.value.totals,
        series: decoded.value.series,
      };
      writeJson(response, 200, report);
      return;
    }

    if (pathname === '/v1/magpie/quotas') {
      const kept = requestUrl.searchParams.get('kept') === '1';
      const refresh = requestUrl.searchParams.get('refresh') === '1';
      const current = now();

      // Manual refresh, inside the throttle window: answer from the last read.
      if (refresh && lastFreshAt !== null && lastGoodCards !== null && current - lastFreshAt < refreshMinIntervalMs) {
        const { config } = await loadConfig();
        const report: QuotaReport = {
          endpoint: config.baseUrl,
          host: config.host,
          loopback: config.loopback,
          fetchedAt: new Date(current).toISOString(),
          kept: false,
          throttled: true,
          stale: true,
          asOf: lastGoodAt === null ? null : new Date(lastGoodAt).toISOString(),
          cards: lastGoodCards,
        };
        writeJson(response, 200, report);
        return;
      }

      const { config } = await loadConfig();
      const answer = await callUpstream(
        config.baseUrl,
        config.apiKey,
        '/v1/magpie/quotas',
        kept && !refresh ? { kept: '1' } : {},
      );
      if (!answer.ok) {
        answerUpstreamFailure(response, answer.error, config.baseUrl);
        return;
      }

      const decoded = decodeQuotas(answer.value);
      if (!decoded.ok) {
        fail(response, 'upstream-schema', { endpoint: config.baseUrl, message: decoded.message });
        return;
      }

      let cards = decoded.value;
      let stale = false;
      let asOf = current;
      // Whether the cards are the gateway's own cached answer. A fallback read
      // below is a real read, so it clears this.
      let fromCache = kept && !refresh;

      if (kept && !refresh && cards.length === 0) {
        // The gateway answered `kept=1` with nothing. Its cache is empty on
        // this machine, so fall back to the last list we read; with none, make
        // one ordinary read so the panel opens with cards instead of a blank.
        fromCache = false;
        if (lastGoodCards !== null) {
          cards = lastGoodCards;
          stale = true;
          asOf = lastGoodAt ?? current;
        } else {
          const full = await callUpstream(config.baseUrl, config.apiKey, '/v1/magpie/quotas', {});
          if (!full.ok) {
            answerUpstreamFailure(response, full.error, config.baseUrl);
            return;
          }
          const fullDecoded = decodeQuotas(full.value);
          if (!fullDecoded.ok) {
            fail(response, 'upstream-schema', { endpoint: config.baseUrl, message: fullDecoded.message });
            return;
          }
          cards = fullDecoded.value;
        }
      }

      if (refresh) lastFreshAt = current;
      if (cards.length > 0 && !stale) {
        lastGoodCards = cards;
        lastGoodAt = current;
      }

      const report: QuotaReport = {
        endpoint: config.baseUrl,
        host: config.host,
        loopback: config.loopback,
        fetchedAt: new Date(current).toISOString(),
        kept: fromCache,
        throttled: false,
        stale,
        asOf: new Date(asOf).toISOString(),
        cards,
      };
      writeJson(response, 200, report);
      return;
    }

    writeJson(response, 404, { error: 'not-found' });
  };

  const failWrite = (response: ServerResponse, error: unknown): void => {
    if (error instanceof ConfigWriteError) {
      if (error.code === 'conflict') {
        fail(response, 'config-conflict', { message: error.message });
        return;
      }
      fail(response, 'internal', { message: error.message });
      return;
    }
    fail(response, 'internal', { message: 'The config file could not be written.' });
  };

  const handleConfigWrite = async (
    pathname: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const body = await readBody(request);
    if (!body.ok) {
      fail(response, 'bad-request', { message: `The body must be JSON under ${MAX_ORDER_BODY_BYTES} bytes.` });
      return;
    }

    if (pathname === '/config/create') {
      const order = parseCreateBody(body.text);
      if (order === null) {
        fail(response, 'bad-request', {
          message: `order, when present, must be an array of 0 to ${MAX_CARD_ORDER} strings, each 1 to ${MAX_CARD_ORDER_KEY} characters.`,
        });
        return;
      }
      try {
        const created = await createConfigFile(configPath, order);
        writeJson(response, 200, { ok: true, created: created.created, present: created.present });
      } catch (error) {
        failWrite(response, error);
      }
      return;
    }

    const order = parseOrderBody(body.text);
    if (order === null) {
      fail(response, 'bad-request', {
        message: `order must be an array of 1 to ${MAX_CARD_ORDER} strings, each 1 to ${MAX_CARD_ORDER_KEY} characters.`,
      });
      return;
    }
    try {
      const saved = await saveCardOrder(
        configPath,
        order,
        beforeConfigPublish === undefined ? undefined : { beforePublish: beforeConfigPublish },
      );
      if (saved.recovery) recoveryNotice = saved.recovery;
      writeJson(response, 200, { ok: true, order: saved.order, recovery: saved.recovery });
    } catch (error) {
      failWrite(response, error);
    }
  };

  return {
    get url(): string {
      return `http://127.0.0.1:${boundPort}`;
    },

    async start(): Promise<void> {
      if (server) return;
      const next = createServer((request, response) => {
        if (request.headers.authorization !== `Bearer ${token}`) {
          writeJson(response, 401, { error: 'unauthorized' });
          return;
        }
        const method = request.method ?? 'GET';
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (method === 'GET') {
          void handle(url, response).catch(() => {
            if (!response.headersSent) fail(response, 'internal');
            else response.end();
          });
          return;
        }
        if (
          method === 'POST' &&
          (url.pathname === '/config/order' || url.pathname === '/config/create')
        ) {
          void handleConfigWrite(url.pathname, request, response).catch(() => {
            if (!response.headersSent) fail(response, 'internal');
            else response.end();
          });
          return;
        }
        request.resume();
        response.setHeader('Allow', 'GET, POST');
        writeJson(response, 405, { error: 'method-not-allowed' });
      });

      await new Promise<void>((resolve, reject) => {
        next.once('error', reject);
        next.listen(port, '127.0.0.1', () => {
          next.off('error', reject);
          resolve();
        });
      });

      const address = next.address();
      if (address && typeof address === 'object') boundPort = address.port;
      server = next;
    },

    async stop(): Promise<void> {
      const current = server;
      server = undefined;
      if (!current) return;
      await new Promise<void>((resolve) => current.close(() => resolve()));
    },
  };
};
