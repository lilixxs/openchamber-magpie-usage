// src/service/server.ts
import { createServer } from "node:http";

// src/shared/magpie.ts
var DEFAULT_BASE_URL = "http://127.0.0.1:3425";
var DEFAULT_REFRESH_SECONDS = 60;
var MIN_REFRESH_SECONDS = 5;
var MAX_REFRESH_SECONDS = 3600;
var DEFAULT_FONT_SCALE = 100;
var MIN_FONT_SCALE = 50;
var MAX_FONT_SCALE = 200;
var CONFIG_DIR_NAME = "openchamber-magpie-usage";
var CONFIG_FILE_NAME = "config.json";
var CONFIG_RELATIVE_PATH = `~/.config/${CONFIG_DIR_NAME}/${CONFIG_FILE_NAME}`;
var PERIODS = ["today", "7d", "30d"];
var isPeriod = (value) => typeof value === "string" && PERIODS.includes(value);
var MAX_CARD_ORDER = 500;
var MAX_CARD_ORDER_KEY = 200;
var DEFAULT_LANGUAGE = "auto";
var fallbackConfig = () => ({
  baseUrl: DEFAULT_BASE_URL,
  host: "127.0.0.1:3425",
  loopback: true,
  apiKey: null,
  refreshSeconds: DEFAULT_REFRESH_SECONDS,
  fontScale: DEFAULT_FONT_SCALE,
  fontScaleInvalid: false,
  cardOrder: [],
  language: DEFAULT_LANGUAGE,
  languageInvalid: false,
  source: "default",
  present: false,
  issue: null
});
var LOOPBACK_V4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
var isLoopbackHostname = (hostname) => hostname === "localhost" || hostname === "::1" || hostname === "[::1]" || LOOPBACK_V4.test(hostname);
var normaliseBaseUrl = (raw) => {
  const text = raw.trim();
  if (text === "")
    return { ok: false, message: "baseUrl is empty." };
  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, message: "baseUrl is not an absolute URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, message: "baseUrl must use http or https." };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, message: "baseUrl must not carry credentials; put the key in apiKey." };
  }
  if (url.search !== "" || url.hash !== "") {
    return { ok: false, message: "baseUrl must not carry a query or a fragment." };
  }
  if (url.hostname === "")
    return { ok: false, message: "baseUrl has no host." };
  const loopback = isLoopbackHostname(url.hostname);
  if (url.protocol === "http:" && !loopback) {
    return { ok: false, message: "A non-loopback baseUrl must use https." };
  }
  const path = url.pathname.replace(/\/+$/, "");
  return { ok: true, baseUrl: `${url.origin}${path}`, host: url.host, loopback };
};
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var isControlOrSpace = /[\s\u0000-\u001f\u007f]/;
var parseCardOrder = (value) => {
  if (!Array.isArray(value))
    return [];
  const order = [];
  for (const entry of value) {
    if (order.length >= MAX_CARD_ORDER)
      break;
    if (typeof entry !== "string")
      continue;
    if (entry.length === 0 || entry.length > MAX_CARD_ORDER_KEY)
      continue;
    order.push(entry);
  }
  return order;
};
var parseConfigObject = (value) => {
  let baseUrl = DEFAULT_BASE_URL;
  let host = "127.0.0.1:3425";
  let loopback = true;
  if (value.baseUrl !== undefined) {
    if (typeof value.baseUrl !== "string")
      return { ok: false, message: "baseUrl must be a string." };
    const parsed = normaliseBaseUrl(value.baseUrl);
    if (!parsed.ok)
      return { ok: false, message: parsed.message };
    baseUrl = parsed.baseUrl;
    host = parsed.host;
    loopback = parsed.loopback;
  }
  let apiKey = null;
  if (value.apiKey !== undefined && value.apiKey !== null) {
    if (typeof value.apiKey !== "string")
      return { ok: false, message: "apiKey must be a string." };
    const key = value.apiKey.trim();
    if (key === "")
      return { ok: false, message: "apiKey is empty; remove the field instead." };
    if (key.length > 4096)
      return { ok: false, message: "apiKey is longer than 4096 characters." };
    if (isControlOrSpace.test(key))
      return { ok: false, message: "apiKey must not contain whitespace or control characters." };
    apiKey = key;
  }
  let refreshSeconds = DEFAULT_REFRESH_SECONDS;
  if (value.refreshSeconds !== undefined) {
    const raw = value.refreshSeconds;
    if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw)) {
      return { ok: false, message: "refreshSeconds must be an integer." };
    }
    if (raw < MIN_REFRESH_SECONDS || raw > MAX_REFRESH_SECONDS) {
      return {
        ok: false,
        message: `refreshSeconds must be between ${MIN_REFRESH_SECONDS} and ${MAX_REFRESH_SECONDS}.`
      };
    }
    refreshSeconds = raw;
  }
  let fontScale = DEFAULT_FONT_SCALE;
  let fontScaleInvalid = false;
  if (value.fontScale !== undefined) {
    const raw = value.fontScale;
    if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw) || raw < MIN_FONT_SCALE || raw > MAX_FONT_SCALE) {
      fontScaleInvalid = true;
    } else {
      fontScale = raw;
    }
  }
  let language = DEFAULT_LANGUAGE;
  let languageInvalid = false;
  if (value.language !== undefined) {
    if (typeof value.language === "string" && value.language !== "")
      language = value.language;
    else
      languageInvalid = true;
  }
  return {
    ok: true,
    config: {
      baseUrl,
      host,
      loopback,
      apiKey,
      refreshSeconds,
      fontScale,
      fontScaleInvalid,
      cardOrder: parseCardOrder(value.cardOrder),
      language,
      languageInvalid,
      source: "file",
      present: true,
      issue: null
    }
  };
};
var parseConfigText = (text) => {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return {
      config: {
        ...fallbackConfig(),
        present: true,
        source: "file",
        issue: { kind: "invalid-json", message: "The config file is not valid JSON." }
      }
    };
  }
  if (!isRecord(value)) {
    return {
      config: {
        ...fallbackConfig(),
        present: true,
        source: "file",
        issue: { kind: "invalid", message: "The config file must hold a JSON object." }
      }
    };
  }
  const parsed = parseConfigObject(value);
  if (!parsed.ok) {
    return {
      config: {
        ...fallbackConfig(),
        present: true,
        source: "file",
        issue: { kind: "invalid", message: parsed.message }
      }
    };
  }
  return { config: parsed.config };
};
var finite = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
var count = (value) => finite(value) ?? 0;
var text = (value) => typeof value === "string" && value !== "" ? value : null;
var readBucket = (value) => {
  if (!isRecord(value))
    return null;
  const label = text(value.label) ?? text(value.time);
  if (label === null)
    return null;
  return {
    label,
    time: text(value.time),
    calls: count(value.calls),
    input: count(value.input),
    output: count(value.output),
    cacheRead: count(value.cache_read),
    cacheWrite: count(value.cache_write),
    cost: finite(value.cost)
  };
};
var decodeUsage = (value) => {
  if (!isRecord(value))
    return { ok: false, message: "The gateway answer is not a JSON object." };
  if (finite(value.calls) === null) {
    return { ok: false, message: "The gateway answer has no numeric `calls` field." };
  }
  if (!Array.isArray(value.series)) {
    return { ok: false, message: "The gateway answer has no `series` array." };
  }
  const series = [];
  for (const entry of value.series) {
    const bucket = readBucket(entry);
    if (bucket)
      series.push(bucket);
  }
  return {
    ok: true,
    value: {
      period: text(value.period) ?? "unknown",
      since: text(value.since),
      totals: {
        calls: count(value.calls),
        errors: count(value.errors),
        retried: count(value.retried),
        loops: count(value.loops),
        input: count(value.input),
        output: count(value.output),
        cacheRead: count(value.cache_read),
        cacheWrite: count(value.cache_write),
        reasoning: count(value.reasoning),
        cost: finite(value.cost),
        unpriced: count(value.unpriced),
        credits: finite(value.credits),
        credited: count(value.credited)
      },
      series
    }
  };
};
var readWindow = (value) => {
  if (!isRecord(value))
    return null;
  return {
    name: text(value.name),
    used: finite(value.used),
    remaining: finite(value.remaining),
    amount: finite(value.amount),
    limit: finite(value.limit),
    unit: text(value.unit),
    display: text(value.display),
    resetsAt: text(value.resetsAt),
    runsOutAt: text(value.runsOutAt),
    runsOut: finite(value.runsOut),
    pool: text(value.pool),
    unlimited: value.unlimited === true
  };
};
var readCard = (value) => {
  if (!isRecord(value))
    return null;
  const windows = [];
  if (Array.isArray(value.windows)) {
    for (const entry of value.windows) {
      const window = readWindow(entry);
      if (window)
        windows.push(window);
    }
  }
  const provider = text(value.provider);
  const name = text(value.name) ?? provider;
  return {
    provider,
    name: name ?? "Unnamed card",
    kind: text(value.kind),
    plan: text(value.plan),
    user: text(value.user),
    balance: text(value.balance),
    error: text(value.error),
    readAt: text(value.readAt),
    from: text(value.from),
    windows
  };
};
var decodeQuotas = (value) => {
  if (!isRecord(value))
    return { ok: false, message: "The gateway answer is not a JSON object." };
  if (!Array.isArray(value.data)) {
    return { ok: false, message: "The gateway answer has no `data` array of quota cards." };
  }
  const cards = [];
  for (const entry of value.data) {
    const card = readCard(entry);
    if (card)
      cards.push(card);
  }
  return { ok: true, value: cards };
};
var describeServiceError = (kind) => {
  switch (kind) {
    case "bad-request":
      return "The panel asked for something the service does not serve.";
    case "internal":
      return "The local service failed to build an answer.";
    case "upstream-unauthorized":
      return "The gateway rejected the API key (HTTP 401). Check apiKey in the config file.";
    case "upstream-forbidden":
      return "The gateway refused this key (HTTP 403). It is limited to other models or accounts.";
    case "upstream-status":
      return "The gateway answered with an unexpected status.";
    case "upstream-timeout":
      return "The gateway did not answer in time.";
    case "upstream-network":
      return "The gateway could not be reached.";
    case "upstream-not-json":
      return "The gateway answered, but not with JSON.";
    case "upstream-schema":
      return "The gateway answered with JSON, but not with magpie usage data.";
    case "upstream-redirect":
      return "The gateway redirected to another origin. The redirect was not followed, so the key never leaves its origin.";
    default:
      return "The local service answered with an unknown error.";
  }
};

// src/service/config.ts
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
var defaultConfigPath = () => {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const base = xdg && xdg !== "" ? xdg : join(homedir(), ".config");
  return join(base, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
};
var fallbackWithIssue = (present, kind, message) => ({
  ...fallbackConfig(),
  present,
  issue: { kind, message }
});
var readConfig = async (path) => {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    const code = error.code;
    if (code === "ENOENT") {
      return { config: fallbackConfig(), path };
    }
    return {
      config: fallbackWithIssue(false, "unreadable", `The config file could not be read (${code ?? "unknown error"}).`),
      path
    };
  }
  return { config: parseConfigText(text).config, path };
};

// src/service/config-write.ts
import { randomBytes } from "node:crypto";
import { chmod, copyFile, mkdir, readFile as readFile2, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
var isRecord2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var readRawConfig = async (path) => {
  let text;
  try {
    text = await readFile2(path, "utf8");
  } catch (error) {
    const code = error.code;
    if (code === "ENOENT")
      return { kind: "missing" };
    throw error;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: "invalid", text };
  }
  if (!isRecord2(value))
    return { kind: "invalid", text };
  return { kind: "ok", value };
};
var modeOf = async (path) => {
  try {
    const info = await stat(path);
    const mode = info.mode & 511;
    return mode === 0 ? 384 : mode;
  } catch {
    return 384;
  }
};
var backup = async (path) => {
  const candidates = [`${path}.bak`, `${path}.bak-${stamp(new Date)}`, `${path}.bak-${stamp(new Date)}-${randomBytes(3).toString("hex")}`];
  for (const candidate of candidates) {
    try {
      await stat(candidate);
    } catch (error) {
      if (error.code !== "ENOENT")
        throw error;
      await copyFile(path, candidate);
      return candidate;
    }
  }
  await copyFile(path, candidates[candidates.length - 1]);
  return candidates[candidates.length - 1];
};
var stamp = (date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
var writeAtomic = async (path, text, mode) => {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temp, text, { encoding: "utf8", mode });
  try {
    await chmod(temp, mode).catch(() => {
      return;
    });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {
      return;
    });
    throw error;
  }
};
var saveOnce = async (path, order) => {
  const raw = await readRawConfig(path);
  const at = new Date().toISOString();
  let merged;
  let reset = null;
  let mode = 384;
  if (raw.kind === "ok") {
    merged = { ...raw.value, cardOrder: order };
    mode = await modeOf(path);
  } else if (raw.kind === "invalid") {
    const backupPath = await backup(path);
    merged = { cardOrder: order };
    reset = { at, backupPath };
    mode = await modeOf(path);
  } else {
    merged = { cardOrder: order };
  }
  await writeAtomic(path, `${JSON.stringify(merged, null, 2)}
`, mode);
  return { order, reset };
};
var queue = Promise.resolve();
var saveCardOrder = (path, order) => {
  const next = queue.then(() => saveOnce(path, order), () => saveOnce(path, order));
  queue = next.catch(() => {
    return;
  });
  return next;
};

// src/service/upstream.ts
var MAX_REDIRECTS = 3;
var joinPath = (baseUrl, path) => `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
var isAbort = (error) => {
  if (typeof error !== "object" || error === null)
    return false;
  const name = error.name;
  return name === "TimeoutError" || name === "AbortError";
};
var failure = (kind, status) => ({
  kind,
  status,
  message: describeServiceError(kind)
});
var requestUpstream = async (options) => {
  const { baseUrl, apiKey, path, query, timeoutMs, fetchImpl } = options;
  let target;
  try {
    target = new URL(joinPath(baseUrl, path));
  } catch {
    return { ok: false, error: { kind: "upstream-network", message: "The configured endpoint is not a URL." } };
  }
  for (const [name, value] of Object.entries(query))
    target.searchParams.set(name, value);
  const origin = target.origin;
  let redirects = 0;
  for (;; ) {
    const headers = { accept: "application/json" };
    if (apiKey !== null && target.origin === origin)
      headers.authorization = `Bearer ${apiKey}`;
    let response;
    try {
      response = await fetchImpl(target, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      return { ok: false, error: isAbort(error) ? failure("upstream-timeout") : failure("upstream-network") };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return {
          ok: false,
          error: {
            kind: "upstream-status",
            status: response.status,
            message: `The gateway answered HTTP ${response.status} without a Location header.`
          }
        };
      }
      let next;
      try {
        next = new URL(location, target);
      } catch {
        return { ok: false, error: failure("upstream-status", response.status) };
      }
      if (next.origin !== origin)
        return { ok: false, error: failure("upstream-redirect", response.status) };
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        return { ok: false, error: failure("upstream-redirect", response.status) };
      }
      if (redirects >= MAX_REDIRECTS) {
        return {
          ok: false,
          error: { kind: "upstream-redirect", status: response.status, message: "The gateway redirected too many times." }
        };
      }
      target = next;
      redirects += 1;
      continue;
    }
    if (response.status === 401)
      return { ok: false, error: failure("upstream-unauthorized", 401) };
    if (response.status === 403)
      return { ok: false, error: failure("upstream-forbidden", 403) };
    if (!response.ok)
      return { ok: false, error: failure("upstream-status", response.status) };
    let body;
    try {
      body = await response.text();
    } catch {
      return { ok: false, error: failure("upstream-network", response.status) };
    }
    try {
      return { ok: true, value: JSON.parse(body) };
    } catch {
      return { ok: false, error: failure("upstream-not-json", response.status) };
    }
  }
};

// src/shared/health.ts
var SERVICE_NAME = "magpie-usage";
var SERVICE_API_VERSION = 1;

// src/service/server.ts
var DEFAULT_UPSTREAM_TIMEOUT_MS = 15000;
var DEFAULT_REFRESH_MIN_INTERVAL_MS = 30000;
var MAX_ORDER_BODY_BYTES = 64 * 1024;
var writeJson = (response, status, body) => {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
};
var statusFor = (kind) => {
  if (kind === "bad-request")
    return 400;
  if (kind === "internal")
    return 500;
  if (kind === "upstream-timeout")
    return 504;
  return 502;
};
var fail = (response, kind, extra = {}) => {
  const body = {
    error: {
      kind,
      message: extra.message ?? "The local service answered with an unknown error.",
      ...extra.status === undefined ? {} : { status: extra.status },
      ...extra.endpoint === undefined ? {} : { endpoint: extra.endpoint }
    }
  };
  writeJson(response, statusFor(kind), body);
};
var isRecord3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var readBody = (request) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  request.on("data", (chunk) => {
    if (tooLarge)
      return;
    size += chunk.length;
    if (size > MAX_ORDER_BODY_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", () => {
    resolve(tooLarge ? { ok: false } : { ok: true, text: Buffer.concat(chunks).toString("utf8") });
  });
  request.on("error", reject);
});
var parseOrderBody = (text) => {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord3(value) || !Array.isArray(value.order))
    return null;
  const raw = value.order;
  if (raw.length === 0 || raw.length > MAX_CARD_ORDER)
    return null;
  const order = [];
  for (const entry of raw) {
    if (typeof entry !== "string")
      return null;
    if (entry.length === 0 || entry.length > MAX_CARD_ORDER_KEY)
      return null;
    order.push(entry);
  }
  return order;
};
var createService = (options) => {
  const {
    port,
    token,
    configPath = defaultConfigPath(),
    upstreamTimeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS,
    refreshMinIntervalMs = DEFAULT_REFRESH_MIN_INTERVAL_MS,
    now = Date.now,
    fetchImpl = fetch
  } = options;
  let server;
  let boundPort = port;
  let lastGoodCards = null;
  let lastGoodAt = null;
  let lastFreshAt = null;
  let resetNotice = null;
  const loadConfig = async () => readConfig(configPath);
  const callUpstream = (baseUrl, apiKey, path, query) => requestUpstream({ baseUrl, apiKey, path, query, timeoutMs: upstreamTimeoutMs, fetchImpl });
  const answerUpstreamFailure = (response, failure, endpoint) => {
    const kind = failure.kind;
    fail(response, kind, { status: failure.status, endpoint, message: failure.message });
  };
  const handle = async (requestUrl, response) => {
    const { pathname } = requestUrl;
    if (pathname === "/health") {
      writeJson(response, 200, { ok: true, name: SERVICE_NAME, apiVersion: SERVICE_API_VERSION });
      return;
    }
    if (pathname === "/config") {
      const { config, path } = await loadConfig();
      const report = {
        configPath: path,
        baseUrl: config.baseUrl,
        host: config.host,
        loopback: config.loopback,
        apiKeyConfigured: config.apiKey !== null,
        refreshSeconds: config.refreshSeconds,
        fontScale: config.fontScale,
        fontScaleInvalid: config.fontScaleInvalid,
        cardOrder: config.cardOrder,
        language: config.language,
        languageInvalid: config.languageInvalid,
        reset: resetNotice,
        source: config.source,
        present: config.present,
        issue: config.issue
      };
      writeJson(response, 200, report);
      return;
    }
    if (pathname === "/v1/magpie/usage") {
      const raw = requestUrl.searchParams.get("period") ?? "today";
      if (!isPeriod(raw)) {
        fail(response, "bad-request", { message: "period must be one of today, 7d, 30d." });
        return;
      }
      const { config } = await loadConfig();
      const answer = await callUpstream(config.baseUrl, config.apiKey, "/v1/magpie/usage", { period: raw });
      if (!answer.ok) {
        answerUpstreamFailure(response, answer.error, config.baseUrl);
        return;
      }
      const decoded = decodeUsage(answer.value);
      if (!decoded.ok) {
        fail(response, "upstream-schema", { endpoint: config.baseUrl, message: decoded.message });
        return;
      }
      const report = {
        endpoint: config.baseUrl,
        host: config.host,
        loopback: config.loopback,
        fetchedAt: new Date(now()).toISOString(),
        period: decoded.value.period,
        since: decoded.value.since,
        totals: decoded.value.totals,
        series: decoded.value.series
      };
      writeJson(response, 200, report);
      return;
    }
    if (pathname === "/v1/magpie/quotas") {
      const kept = requestUrl.searchParams.get("kept") === "1";
      const refresh = requestUrl.searchParams.get("refresh") === "1";
      const current = now();
      if (refresh && lastFreshAt !== null && lastGoodCards !== null && current - lastFreshAt < refreshMinIntervalMs) {
        const { config } = await loadConfig();
        const report = {
          endpoint: config.baseUrl,
          host: config.host,
          loopback: config.loopback,
          fetchedAt: new Date(current).toISOString(),
          kept: false,
          throttled: true,
          stale: true,
          asOf: lastGoodAt === null ? null : new Date(lastGoodAt).toISOString(),
          cards: lastGoodCards
        };
        writeJson(response, 200, report);
        return;
      }
      const { config } = await loadConfig();
      const answer = await callUpstream(config.baseUrl, config.apiKey, "/v1/magpie/quotas", kept && !refresh ? { kept: "1" } : {});
      if (!answer.ok) {
        answerUpstreamFailure(response, answer.error, config.baseUrl);
        return;
      }
      const decoded = decodeQuotas(answer.value);
      if (!decoded.ok) {
        fail(response, "upstream-schema", { endpoint: config.baseUrl, message: decoded.message });
        return;
      }
      let cards = decoded.value;
      let stale = false;
      let asOf = current;
      let fromCache = kept && !refresh;
      if (kept && !refresh && cards.length === 0) {
        fromCache = false;
        if (lastGoodCards !== null) {
          cards = lastGoodCards;
          stale = true;
          asOf = lastGoodAt ?? current;
        } else {
          const full = await callUpstream(config.baseUrl, config.apiKey, "/v1/magpie/quotas", {});
          if (!full.ok) {
            answerUpstreamFailure(response, full.error, config.baseUrl);
            return;
          }
          const fullDecoded = decodeQuotas(full.value);
          if (!fullDecoded.ok) {
            fail(response, "upstream-schema", { endpoint: config.baseUrl, message: fullDecoded.message });
            return;
          }
          cards = fullDecoded.value;
        }
      }
      if (refresh)
        lastFreshAt = current;
      if (cards.length > 0 && !stale) {
        lastGoodCards = cards;
        lastGoodAt = current;
      }
      const report = {
        endpoint: config.baseUrl,
        host: config.host,
        loopback: config.loopback,
        fetchedAt: new Date(current).toISOString(),
        kept: fromCache,
        throttled: false,
        stale,
        asOf: new Date(asOf).toISOString(),
        cards
      };
      writeJson(response, 200, report);
      return;
    }
    writeJson(response, 404, { error: "not-found" });
  };
  const handleOrder = async (request, response) => {
    const body = await readBody(request);
    if (!body.ok) {
      fail(response, "bad-request", { message: `The order body must be JSON under ${MAX_ORDER_BODY_BYTES} bytes.` });
      return;
    }
    const order = parseOrderBody(body.text);
    if (order === null) {
      fail(response, "bad-request", {
        message: `order must be an array of 1 to ${MAX_CARD_ORDER} strings, each 1 to ${MAX_CARD_ORDER_KEY} characters.`
      });
      return;
    }
    try {
      const saved = await saveCardOrder(configPath, order);
      if (saved.reset)
        resetNotice = saved.reset;
      writeJson(response, 200, { ok: true, order: saved.order, reset: saved.reset });
    } catch {
      fail(response, "internal", { message: "The config file could not be written." });
    }
  };
  return {
    get url() {
      return `http://127.0.0.1:${boundPort}`;
    },
    async start() {
      if (server)
        return;
      const next = createServer((request, response) => {
        if (request.headers.authorization !== `Bearer ${token}`) {
          writeJson(response, 401, { error: "unauthorized" });
          return;
        }
        const method = request.method ?? "GET";
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (method === "GET") {
          handle(url, response).catch(() => {
            if (!response.headersSent)
              fail(response, "internal");
            else
              response.end();
          });
          return;
        }
        if (method === "POST" && url.pathname === "/config/order") {
          handleOrder(request, response).catch(() => {
            if (!response.headersSent)
              fail(response, "internal");
            else
              response.end();
          });
          return;
        }
        request.resume();
        response.setHeader("Allow", "GET, POST");
        writeJson(response, 405, { error: "method-not-allowed" });
      });
      await new Promise((resolve, reject) => {
        next.once("error", reject);
        next.listen(port, "127.0.0.1", () => {
          next.off("error", reject);
          resolve();
        });
      });
      const address = next.address();
      if (address && typeof address === "object")
        boundPort = address.port;
      server = next;
    },
    async stop() {
      const current = server;
      server = undefined;
      if (!current)
        return;
      await new Promise((resolve) => current.close(() => resolve()));
    }
  };
};

// src/service/main.ts
var port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
var token = process.env.OPENCHAMBER_SERVICE_TOKEN ?? "";
if (!Number.isInteger(port) || port <= 0 || port > 65535 || token === "") {
  console.error("OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required");
  process.exit(1);
}
var service = createService({ port, token });
service.start().catch((error) => {
  console.error("Local service failed to start:", error);
  process.exit(1);
});
var shutdown = () => {
  service.stop().then(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
