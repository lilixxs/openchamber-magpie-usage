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
var CONFIG_FILE_NAME = "config.jsonc";
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
  cardOrderInvalid: false,
  language: DEFAULT_LANGUAGE,
  languageInvalid: false,
  source: "default",
  present: false,
  validity: "missing",
  issue: null,
  issues: []
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
var parseApiKeyValue = (raw) => {
  if (raw === undefined || raw === null)
    return { ok: true, value: null };
  if (typeof raw !== "string")
    return { ok: false, message: "apiKey must be a string." };
  const key = raw.trim();
  if (key === "")
    return { ok: false, message: "apiKey is empty; remove the field instead." };
  if (key.length > 4096)
    return { ok: false, message: "apiKey is longer than 4096 characters." };
  if (isControlOrSpace.test(key)) {
    return { ok: false, message: "apiKey must not contain whitespace or control characters." };
  }
  return { ok: true, value: key };
};
var parseRefreshSecondsValue = (raw) => {
  if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    return { ok: false, message: "refreshSeconds must be an integer." };
  }
  if (raw < MIN_REFRESH_SECONDS || raw > MAX_REFRESH_SECONDS) {
    return {
      ok: false,
      message: `refreshSeconds must be between ${MIN_REFRESH_SECONDS} and ${MAX_REFRESH_SECONDS}.`
    };
  }
  return { ok: true, value: raw };
};
var parseFontScaleValue = (raw) => {
  if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw) || raw < MIN_FONT_SCALE || raw > MAX_FONT_SCALE) {
    return { ok: false, message: `fontScale must be an integer from ${MIN_FONT_SCALE} to ${MAX_FONT_SCALE}.` };
  }
  return { ok: true, value: raw };
};
var parseLanguageValue = (raw) => {
  if (typeof raw !== "string" || raw === "") {
    return { ok: false, message: "language must be a non-empty string." };
  }
  return { ok: true, value: raw };
};
var parseCardOrderDetailed = (value) => {
  if (value === undefined)
    return { order: [], invalid: false, message: null };
  if (!Array.isArray(value)) {
    return { order: [], invalid: true, message: "cardOrder must be an array of strings." };
  }
  const order = [];
  let invalid = false;
  for (const entry of value) {
    if (order.length >= MAX_CARD_ORDER) {
      invalid = true;
      break;
    }
    if (typeof entry !== "string" || entry.length === 0 || entry.length > MAX_CARD_ORDER_KEY) {
      invalid = true;
      continue;
    }
    order.push(entry);
  }
  return {
    order,
    invalid,
    message: invalid ? `cardOrder entries must be non-empty strings of at most ${MAX_CARD_ORDER_KEY} characters; bad entries were dropped.` : null
  };
};
var parseConfigObject = (value) => {
  let baseUrl = DEFAULT_BASE_URL;
  let host = "127.0.0.1:3425";
  let loopback = true;
  if (value.baseUrl !== undefined) {
    if (typeof value.baseUrl !== "string")
      return { ok: false, field: "baseUrl", message: "baseUrl must be a string." };
    const parsed = normaliseBaseUrl(value.baseUrl);
    if (!parsed.ok)
      return { ok: false, field: "baseUrl", message: parsed.message };
    baseUrl = parsed.baseUrl;
    host = parsed.host;
    loopback = parsed.loopback;
  }
  const apiKeyResult = parseApiKeyValue(value.apiKey);
  if (!apiKeyResult.ok)
    return { ok: false, field: "apiKey", message: apiKeyResult.message };
  let refreshSeconds = DEFAULT_REFRESH_SECONDS;
  if (value.refreshSeconds !== undefined) {
    const parsed = parseRefreshSecondsValue(value.refreshSeconds);
    if (!parsed.ok)
      return { ok: false, field: "refreshSeconds", message: parsed.message };
    refreshSeconds = parsed.value;
  }
  const issues = [];
  let fontScale = DEFAULT_FONT_SCALE;
  let fontScaleInvalid = false;
  if (value.fontScale !== undefined) {
    const parsed = parseFontScaleValue(value.fontScale);
    if (parsed.ok) {
      fontScale = parsed.value;
    } else {
      fontScaleInvalid = true;
      issues.push({ field: "fontScale", kind: "invalid", message: parsed.message });
    }
  }
  let language = DEFAULT_LANGUAGE;
  let languageInvalid = false;
  if (value.language !== undefined) {
    const parsed = parseLanguageValue(value.language);
    if (parsed.ok)
      language = parsed.value;
    else {
      languageInvalid = true;
      issues.push({ field: "language", kind: "invalid", message: parsed.message });
    }
  }
  const cardOrder = parseCardOrderDetailed(value.cardOrder);
  if (cardOrder.invalid) {
    issues.push({ field: "cardOrder", kind: "invalid", message: cardOrder.message ?? "cardOrder is invalid." });
  }
  return {
    ok: true,
    issues,
    config: {
      baseUrl,
      host,
      loopback,
      apiKey: apiKeyResult.value,
      refreshSeconds,
      fontScale,
      fontScaleInvalid,
      cardOrder: cardOrder.order,
      cardOrderInvalid: cardOrder.invalid,
      language,
      languageInvalid,
      source: "file",
      present: true,
      validity: issues.length === 0 ? "valid" : "invalid",
      issue: null,
      issues
    }
  };
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
    name: name ?? "",
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
    case "config-conflict":
      return "The config file changed on disk. Nothing was overwritten; retry.";
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
import { lstat, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// node_modules/jsonc-parser/lib/esm/impl/scanner.js
function createScanner(text, ignoreTrivia = false) {
  const len = text.length;
  let pos = 0, value = "", tokenOffset = 0, token = 16, lineNumber = 0, lineStartOffset = 0, tokenLineStartOffset = 0, prevTokenLineStartOffset = 0, scanError = 0;
  function scanHexDigits(count, exact) {
    let digits = 0;
    let value = 0;
    while (digits < count || !exact) {
      let ch = text.charCodeAt(pos);
      if (ch >= 48 && ch <= 57) {
        value = value * 16 + ch - 48;
      } else if (ch >= 65 && ch <= 70) {
        value = value * 16 + ch - 65 + 10;
      } else if (ch >= 97 && ch <= 102) {
        value = value * 16 + ch - 97 + 10;
      } else {
        break;
      }
      pos++;
      digits++;
    }
    if (digits < count) {
      value = -1;
    }
    return value;
  }
  function setPosition(newPosition) {
    pos = newPosition;
    value = "";
    tokenOffset = 0;
    token = 16;
    scanError = 0;
  }
  function scanNumber() {
    let start = pos;
    if (text.charCodeAt(pos) === 48) {
      pos++;
    } else {
      pos++;
      while (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
      }
    }
    if (pos < text.length && text.charCodeAt(pos) === 46) {
      pos++;
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
      } else {
        scanError = 3;
        return text.substring(start, pos);
      }
    }
    let end = pos;
    if (pos < text.length && (text.charCodeAt(pos) === 69 || text.charCodeAt(pos) === 101)) {
      pos++;
      if (pos < text.length && text.charCodeAt(pos) === 43 || text.charCodeAt(pos) === 45) {
        pos++;
      }
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
        end = pos;
      } else {
        scanError = 3;
      }
    }
    return text.substring(start, end);
  }
  function scanString() {
    let result = "", start = pos;
    while (true) {
      if (pos >= len) {
        result += text.substring(start, pos);
        scanError = 2;
        break;
      }
      const ch = text.charCodeAt(pos);
      if (ch === 34) {
        result += text.substring(start, pos);
        pos++;
        break;
      }
      if (ch === 92) {
        result += text.substring(start, pos);
        pos++;
        if (pos >= len) {
          scanError = 2;
          break;
        }
        const ch2 = text.charCodeAt(pos++);
        switch (ch2) {
          case 34:
            result += '"';
            break;
          case 92:
            result += "\\";
            break;
          case 47:
            result += "/";
            break;
          case 98:
            result += "\b";
            break;
          case 102:
            result += "\f";
            break;
          case 110:
            result += `
`;
            break;
          case 114:
            result += "\r";
            break;
          case 116:
            result += "\t";
            break;
          case 117:
            const ch3 = scanHexDigits(4, true);
            if (ch3 >= 0) {
              result += String.fromCharCode(ch3);
            } else {
              scanError = 4;
            }
            break;
          default:
            scanError = 5;
        }
        start = pos;
        continue;
      }
      if (ch >= 0 && ch <= 31) {
        if (isLineBreak(ch)) {
          result += text.substring(start, pos);
          scanError = 2;
          break;
        } else {
          scanError = 6;
        }
      }
      pos++;
    }
    return result;
  }
  function scanNext() {
    value = "";
    scanError = 0;
    tokenOffset = pos;
    lineStartOffset = lineNumber;
    prevTokenLineStartOffset = tokenLineStartOffset;
    if (pos >= len) {
      tokenOffset = len;
      return token = 17;
    }
    let code = text.charCodeAt(pos);
    if (isWhiteSpace(code)) {
      do {
        pos++;
        value += String.fromCharCode(code);
        code = text.charCodeAt(pos);
      } while (isWhiteSpace(code));
      return token = 15;
    }
    if (isLineBreak(code)) {
      pos++;
      value += String.fromCharCode(code);
      if (code === 13 && text.charCodeAt(pos) === 10) {
        pos++;
        value += `
`;
      }
      lineNumber++;
      tokenLineStartOffset = pos;
      return token = 14;
    }
    switch (code) {
      case 123:
        pos++;
        return token = 1;
      case 125:
        pos++;
        return token = 2;
      case 91:
        pos++;
        return token = 3;
      case 93:
        pos++;
        return token = 4;
      case 58:
        pos++;
        return token = 6;
      case 44:
        pos++;
        return token = 5;
      case 34:
        pos++;
        value = scanString();
        return token = 10;
      case 47:
        const start = pos - 1;
        if (text.charCodeAt(pos + 1) === 47) {
          pos += 2;
          while (pos < len) {
            if (isLineBreak(text.charCodeAt(pos))) {
              break;
            }
            pos++;
          }
          value = text.substring(start, pos);
          return token = 12;
        }
        if (text.charCodeAt(pos + 1) === 42) {
          pos += 2;
          const safeLength = len - 1;
          let commentClosed = false;
          while (pos < safeLength) {
            const ch = text.charCodeAt(pos);
            if (ch === 42 && text.charCodeAt(pos + 1) === 47) {
              pos += 2;
              commentClosed = true;
              break;
            }
            pos++;
            if (isLineBreak(ch)) {
              if (ch === 13 && text.charCodeAt(pos) === 10) {
                pos++;
              }
              lineNumber++;
              tokenLineStartOffset = pos;
            }
          }
          if (!commentClosed) {
            pos++;
            scanError = 1;
          }
          value = text.substring(start, pos);
          return token = 13;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
      case 45:
        value += String.fromCharCode(code);
        pos++;
        if (pos === len || !isDigit(text.charCodeAt(pos))) {
          return token = 16;
        }
      case 48:
      case 49:
      case 50:
      case 51:
      case 52:
      case 53:
      case 54:
      case 55:
      case 56:
      case 57:
        value += scanNumber();
        return token = 11;
      default:
        while (pos < len && isUnknownContentCharacter(code)) {
          pos++;
          code = text.charCodeAt(pos);
        }
        if (tokenOffset !== pos) {
          value = text.substring(tokenOffset, pos);
          switch (value) {
            case "true":
              return token = 8;
            case "false":
              return token = 9;
            case "null":
              return token = 7;
          }
          return token = 16;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
    }
  }
  function isUnknownContentCharacter(code) {
    if (isWhiteSpace(code) || isLineBreak(code)) {
      return false;
    }
    switch (code) {
      case 125:
      case 93:
      case 123:
      case 91:
      case 34:
      case 58:
      case 44:
      case 47:
        return false;
    }
    return true;
  }
  function scanNextNonTrivia() {
    let result;
    do {
      result = scanNext();
    } while (result >= 12 && result <= 15);
    return result;
  }
  return {
    setPosition,
    getPosition: () => pos,
    scan: ignoreTrivia ? scanNextNonTrivia : scanNext,
    getToken: () => token,
    getTokenValue: () => value,
    getTokenOffset: () => tokenOffset,
    getTokenLength: () => pos - tokenOffset,
    getTokenStartLine: () => lineStartOffset,
    getTokenStartCharacter: () => tokenOffset - prevTokenLineStartOffset,
    getTokenError: () => scanError
  };
}
function isWhiteSpace(ch) {
  return ch === 32 || ch === 9;
}
function isLineBreak(ch) {
  return ch === 10 || ch === 13;
}
function isDigit(ch) {
  return ch >= 48 && ch <= 57;
}
var CharacterCodes;
(function(CharacterCodes) {
  CharacterCodes[CharacterCodes["lineFeed"] = 10] = "lineFeed";
  CharacterCodes[CharacterCodes["carriageReturn"] = 13] = "carriageReturn";
  CharacterCodes[CharacterCodes["space"] = 32] = "space";
  CharacterCodes[CharacterCodes["_0"] = 48] = "_0";
  CharacterCodes[CharacterCodes["_1"] = 49] = "_1";
  CharacterCodes[CharacterCodes["_2"] = 50] = "_2";
  CharacterCodes[CharacterCodes["_3"] = 51] = "_3";
  CharacterCodes[CharacterCodes["_4"] = 52] = "_4";
  CharacterCodes[CharacterCodes["_5"] = 53] = "_5";
  CharacterCodes[CharacterCodes["_6"] = 54] = "_6";
  CharacterCodes[CharacterCodes["_7"] = 55] = "_7";
  CharacterCodes[CharacterCodes["_8"] = 56] = "_8";
  CharacterCodes[CharacterCodes["_9"] = 57] = "_9";
  CharacterCodes[CharacterCodes["a"] = 97] = "a";
  CharacterCodes[CharacterCodes["b"] = 98] = "b";
  CharacterCodes[CharacterCodes["c"] = 99] = "c";
  CharacterCodes[CharacterCodes["d"] = 100] = "d";
  CharacterCodes[CharacterCodes["e"] = 101] = "e";
  CharacterCodes[CharacterCodes["f"] = 102] = "f";
  CharacterCodes[CharacterCodes["g"] = 103] = "g";
  CharacterCodes[CharacterCodes["h"] = 104] = "h";
  CharacterCodes[CharacterCodes["i"] = 105] = "i";
  CharacterCodes[CharacterCodes["j"] = 106] = "j";
  CharacterCodes[CharacterCodes["k"] = 107] = "k";
  CharacterCodes[CharacterCodes["l"] = 108] = "l";
  CharacterCodes[CharacterCodes["m"] = 109] = "m";
  CharacterCodes[CharacterCodes["n"] = 110] = "n";
  CharacterCodes[CharacterCodes["o"] = 111] = "o";
  CharacterCodes[CharacterCodes["p"] = 112] = "p";
  CharacterCodes[CharacterCodes["q"] = 113] = "q";
  CharacterCodes[CharacterCodes["r"] = 114] = "r";
  CharacterCodes[CharacterCodes["s"] = 115] = "s";
  CharacterCodes[CharacterCodes["t"] = 116] = "t";
  CharacterCodes[CharacterCodes["u"] = 117] = "u";
  CharacterCodes[CharacterCodes["v"] = 118] = "v";
  CharacterCodes[CharacterCodes["w"] = 119] = "w";
  CharacterCodes[CharacterCodes["x"] = 120] = "x";
  CharacterCodes[CharacterCodes["y"] = 121] = "y";
  CharacterCodes[CharacterCodes["z"] = 122] = "z";
  CharacterCodes[CharacterCodes["A"] = 65] = "A";
  CharacterCodes[CharacterCodes["B"] = 66] = "B";
  CharacterCodes[CharacterCodes["C"] = 67] = "C";
  CharacterCodes[CharacterCodes["D"] = 68] = "D";
  CharacterCodes[CharacterCodes["E"] = 69] = "E";
  CharacterCodes[CharacterCodes["F"] = 70] = "F";
  CharacterCodes[CharacterCodes["G"] = 71] = "G";
  CharacterCodes[CharacterCodes["H"] = 72] = "H";
  CharacterCodes[CharacterCodes["I"] = 73] = "I";
  CharacterCodes[CharacterCodes["J"] = 74] = "J";
  CharacterCodes[CharacterCodes["K"] = 75] = "K";
  CharacterCodes[CharacterCodes["L"] = 76] = "L";
  CharacterCodes[CharacterCodes["M"] = 77] = "M";
  CharacterCodes[CharacterCodes["N"] = 78] = "N";
  CharacterCodes[CharacterCodes["O"] = 79] = "O";
  CharacterCodes[CharacterCodes["P"] = 80] = "P";
  CharacterCodes[CharacterCodes["Q"] = 81] = "Q";
  CharacterCodes[CharacterCodes["R"] = 82] = "R";
  CharacterCodes[CharacterCodes["S"] = 83] = "S";
  CharacterCodes[CharacterCodes["T"] = 84] = "T";
  CharacterCodes[CharacterCodes["U"] = 85] = "U";
  CharacterCodes[CharacterCodes["V"] = 86] = "V";
  CharacterCodes[CharacterCodes["W"] = 87] = "W";
  CharacterCodes[CharacterCodes["X"] = 88] = "X";
  CharacterCodes[CharacterCodes["Y"] = 89] = "Y";
  CharacterCodes[CharacterCodes["Z"] = 90] = "Z";
  CharacterCodes[CharacterCodes["asterisk"] = 42] = "asterisk";
  CharacterCodes[CharacterCodes["backslash"] = 92] = "backslash";
  CharacterCodes[CharacterCodes["closeBrace"] = 125] = "closeBrace";
  CharacterCodes[CharacterCodes["closeBracket"] = 93] = "closeBracket";
  CharacterCodes[CharacterCodes["colon"] = 58] = "colon";
  CharacterCodes[CharacterCodes["comma"] = 44] = "comma";
  CharacterCodes[CharacterCodes["dot"] = 46] = "dot";
  CharacterCodes[CharacterCodes["doubleQuote"] = 34] = "doubleQuote";
  CharacterCodes[CharacterCodes["minus"] = 45] = "minus";
  CharacterCodes[CharacterCodes["openBrace"] = 123] = "openBrace";
  CharacterCodes[CharacterCodes["openBracket"] = 91] = "openBracket";
  CharacterCodes[CharacterCodes["plus"] = 43] = "plus";
  CharacterCodes[CharacterCodes["slash"] = 47] = "slash";
  CharacterCodes[CharacterCodes["formFeed"] = 12] = "formFeed";
  CharacterCodes[CharacterCodes["tab"] = 9] = "tab";
})(CharacterCodes || (CharacterCodes = {}));

// node_modules/jsonc-parser/lib/esm/impl/string-intern.js
var cachedSpaces = new Array(20).fill(0).map((_, index) => {
  return " ".repeat(index);
});
var maxCachedValues = 200;
var cachedBreakLinesWithSpaces = {
  " ": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return `
` + " ".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + " ".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return `\r
` + " ".repeat(index);
    })
  },
  "\t": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return `
` + "\t".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + "\t".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return `\r
` + "\t".repeat(index);
    })
  }
};

// node_modules/jsonc-parser/lib/esm/impl/parser.js
var ParseOptions;
(function(ParseOptions) {
  ParseOptions.DEFAULT = {
    allowTrailingComma: false
  };
})(ParseOptions || (ParseOptions = {}));
function parse(text, errors = [], options = ParseOptions.DEFAULT) {
  let currentProperty = null;
  let currentParent = [];
  const previousParents = [];
  function onValue(value) {
    if (Array.isArray(currentParent)) {
      currentParent.push(value);
    } else if (currentProperty !== null) {
      currentParent[currentProperty] = value;
    }
  }
  const visitor = {
    onObjectBegin: () => {
      const object = {};
      onValue(object);
      previousParents.push(currentParent);
      currentParent = object;
      currentProperty = null;
    },
    onObjectProperty: (name) => {
      currentProperty = name;
    },
    onObjectEnd: () => {
      currentParent = previousParents.pop();
    },
    onArrayBegin: () => {
      const array = [];
      onValue(array);
      previousParents.push(currentParent);
      currentParent = array;
      currentProperty = null;
    },
    onArrayEnd: () => {
      currentParent = previousParents.pop();
    },
    onLiteralValue: onValue,
    onError: (error, offset, length) => {
      errors.push({ error, offset, length });
    }
  };
  visit(text, visitor, options);
  return currentParent[0];
}
function parseTree(text, errors = [], options = ParseOptions.DEFAULT) {
  let currentParent = { type: "array", offset: -1, length: -1, children: [], parent: undefined };
  function ensurePropertyComplete(endOffset) {
    if (currentParent.type === "property") {
      currentParent.length = endOffset - currentParent.offset;
      currentParent = currentParent.parent;
    }
  }
  function onValue(valueNode) {
    currentParent.children.push(valueNode);
    return valueNode;
  }
  const visitor = {
    onObjectBegin: (offset) => {
      currentParent = onValue({ type: "object", offset, length: -1, parent: currentParent, children: [] });
    },
    onObjectProperty: (name, offset, length) => {
      currentParent = onValue({ type: "property", offset, length: -1, parent: currentParent, children: [] });
      currentParent.children.push({ type: "string", value: name, offset, length, parent: currentParent });
    },
    onObjectEnd: (offset, length) => {
      ensurePropertyComplete(offset + length);
      currentParent.length = offset + length - currentParent.offset;
      currentParent = currentParent.parent;
      ensurePropertyComplete(offset + length);
    },
    onArrayBegin: (offset, length) => {
      currentParent = onValue({ type: "array", offset, length: -1, parent: currentParent, children: [] });
    },
    onArrayEnd: (offset, length) => {
      currentParent.length = offset + length - currentParent.offset;
      currentParent = currentParent.parent;
      ensurePropertyComplete(offset + length);
    },
    onLiteralValue: (value, offset, length) => {
      onValue({ type: getNodeType(value), offset, length, parent: currentParent, value });
      ensurePropertyComplete(offset + length);
    },
    onSeparator: (sep, offset, length) => {
      if (currentParent.type === "property") {
        if (sep === ":") {
          currentParent.colonOffset = offset;
        } else if (sep === ",") {
          ensurePropertyComplete(offset);
        }
      }
    },
    onError: (error, offset, length) => {
      errors.push({ error, offset, length });
    }
  };
  visit(text, visitor, options);
  const result = currentParent.children[0];
  if (result) {
    delete result.parent;
  }
  return result;
}
function findNodeAtLocation(root, path) {
  if (!root) {
    return;
  }
  let node = root;
  for (let segment of path) {
    if (typeof segment === "string") {
      if (node.type !== "object" || !Array.isArray(node.children)) {
        return;
      }
      let found = false;
      for (const propertyNode of node.children) {
        if (Array.isArray(propertyNode.children) && propertyNode.children[0].value === segment && propertyNode.children.length === 2) {
          node = propertyNode.children[1];
          found = true;
          break;
        }
      }
      if (!found) {
        return;
      }
    } else {
      const index = segment;
      if (node.type !== "array" || index < 0 || !Array.isArray(node.children) || index >= node.children.length) {
        return;
      }
      node = node.children[index];
    }
  }
  return node;
}
function visit(text, visitor, options = ParseOptions.DEFAULT) {
  const _scanner = createScanner(text, false);
  const _jsonPath = [];
  let suppressedCallbacks = 0;
  function toNoArgVisit(visitFunction) {
    return visitFunction ? () => suppressedCallbacks === 0 && visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisit(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisitWithPath(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice()) : () => true;
  }
  function toBeginVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks++;
      } else {
        let cbReturn = visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice());
        if (cbReturn === false) {
          suppressedCallbacks = 1;
        }
      }
    } : () => true;
  }
  function toEndVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks--;
      }
      if (suppressedCallbacks === 0) {
        visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter());
      }
    } : () => true;
  }
  const onObjectBegin = toBeginVisit(visitor.onObjectBegin), onObjectProperty = toOneArgVisitWithPath(visitor.onObjectProperty), onObjectEnd = toEndVisit(visitor.onObjectEnd), onArrayBegin = toBeginVisit(visitor.onArrayBegin), onArrayEnd = toEndVisit(visitor.onArrayEnd), onLiteralValue = toOneArgVisitWithPath(visitor.onLiteralValue), onSeparator = toOneArgVisit(visitor.onSeparator), onComment = toNoArgVisit(visitor.onComment), onError = toOneArgVisit(visitor.onError);
  const disallowComments = options && options.disallowComments;
  const allowTrailingComma = options && options.allowTrailingComma;
  function scanNext() {
    while (true) {
      const token = _scanner.scan();
      switch (_scanner.getTokenError()) {
        case 4:
          handleError(14);
          break;
        case 5:
          handleError(15);
          break;
        case 3:
          handleError(13);
          break;
        case 1:
          if (!disallowComments) {
            handleError(11);
          }
          break;
        case 2:
          handleError(12);
          break;
        case 6:
          handleError(16);
          break;
      }
      switch (token) {
        case 12:
        case 13:
          if (disallowComments) {
            handleError(10);
          } else {
            onComment();
          }
          break;
        case 16:
          handleError(1);
          break;
        case 15:
        case 14:
          break;
        default:
          return token;
      }
    }
  }
  function handleError(error, skipUntilAfter = [], skipUntil = []) {
    onError(error);
    if (skipUntilAfter.length + skipUntil.length > 0) {
      let token = _scanner.getToken();
      while (token !== 17) {
        if (skipUntilAfter.indexOf(token) !== -1) {
          scanNext();
          break;
        } else if (skipUntil.indexOf(token) !== -1) {
          break;
        }
        token = scanNext();
      }
    }
  }
  function parseString(isValue) {
    const value = _scanner.getTokenValue();
    if (isValue) {
      onLiteralValue(value);
    } else {
      onObjectProperty(value);
      _jsonPath.push(value);
    }
    scanNext();
    return true;
  }
  function parseLiteral() {
    switch (_scanner.getToken()) {
      case 11:
        const tokenValue = _scanner.getTokenValue();
        let value = Number(tokenValue);
        if (isNaN(value)) {
          handleError(2);
          value = 0;
        }
        onLiteralValue(value);
        break;
      case 7:
        onLiteralValue(null);
        break;
      case 8:
        onLiteralValue(true);
        break;
      case 9:
        onLiteralValue(false);
        break;
      default:
        return false;
    }
    scanNext();
    return true;
  }
  function parseProperty() {
    if (_scanner.getToken() !== 10) {
      handleError(3, [], [2, 5]);
      return false;
    }
    parseString(false);
    if (_scanner.getToken() === 6) {
      onSeparator(":");
      scanNext();
      if (!parseValue()) {
        handleError(4, [], [2, 5]);
      }
    } else {
      handleError(5, [], [2, 5]);
    }
    _jsonPath.pop();
    return true;
  }
  function parseObject() {
    onObjectBegin();
    scanNext();
    let needsComma = false;
    while (_scanner.getToken() !== 2 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 2 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (!parseProperty()) {
        handleError(4, [], [2, 5]);
      }
      needsComma = true;
    }
    onObjectEnd();
    if (_scanner.getToken() !== 2) {
      handleError(7, [2], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseArray() {
    onArrayBegin();
    scanNext();
    let isFirstElement = true;
    let needsComma = false;
    while (_scanner.getToken() !== 4 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 4 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (isFirstElement) {
        _jsonPath.push(0);
        isFirstElement = false;
      } else {
        _jsonPath[_jsonPath.length - 1]++;
      }
      if (!parseValue()) {
        handleError(4, [], [4, 5]);
      }
      needsComma = true;
    }
    onArrayEnd();
    if (!isFirstElement) {
      _jsonPath.pop();
    }
    if (_scanner.getToken() !== 4) {
      handleError(8, [4], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseValue() {
    switch (_scanner.getToken()) {
      case 3:
        return parseArray();
      case 1:
        return parseObject();
      case 10:
        return parseString(true);
      default:
        return parseLiteral();
    }
  }
  scanNext();
  if (_scanner.getToken() === 17) {
    if (options.allowEmptyContent) {
      return true;
    }
    handleError(4, [], []);
    return false;
  }
  if (!parseValue()) {
    handleError(4, [], []);
    return false;
  }
  if (_scanner.getToken() !== 17) {
    handleError(9, [], []);
  }
  return true;
}
function getNodeType(value) {
  switch (typeof value) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "string":
      return "string";
    case "object": {
      if (!value) {
        return "null";
      } else if (Array.isArray(value)) {
        return "array";
      }
      return "object";
    }
    default:
      return "null";
  }
}

// node_modules/jsonc-parser/lib/esm/main.js
var ScanError;
(function(ScanError) {
  ScanError[ScanError["None"] = 0] = "None";
  ScanError[ScanError["UnexpectedEndOfComment"] = 1] = "UnexpectedEndOfComment";
  ScanError[ScanError["UnexpectedEndOfString"] = 2] = "UnexpectedEndOfString";
  ScanError[ScanError["UnexpectedEndOfNumber"] = 3] = "UnexpectedEndOfNumber";
  ScanError[ScanError["InvalidUnicode"] = 4] = "InvalidUnicode";
  ScanError[ScanError["InvalidEscapeCharacter"] = 5] = "InvalidEscapeCharacter";
  ScanError[ScanError["InvalidCharacter"] = 6] = "InvalidCharacter";
})(ScanError || (ScanError = {}));
var SyntaxKind;
(function(SyntaxKind) {
  SyntaxKind[SyntaxKind["OpenBraceToken"] = 1] = "OpenBraceToken";
  SyntaxKind[SyntaxKind["CloseBraceToken"] = 2] = "CloseBraceToken";
  SyntaxKind[SyntaxKind["OpenBracketToken"] = 3] = "OpenBracketToken";
  SyntaxKind[SyntaxKind["CloseBracketToken"] = 4] = "CloseBracketToken";
  SyntaxKind[SyntaxKind["CommaToken"] = 5] = "CommaToken";
  SyntaxKind[SyntaxKind["ColonToken"] = 6] = "ColonToken";
  SyntaxKind[SyntaxKind["NullKeyword"] = 7] = "NullKeyword";
  SyntaxKind[SyntaxKind["TrueKeyword"] = 8] = "TrueKeyword";
  SyntaxKind[SyntaxKind["FalseKeyword"] = 9] = "FalseKeyword";
  SyntaxKind[SyntaxKind["StringLiteral"] = 10] = "StringLiteral";
  SyntaxKind[SyntaxKind["NumericLiteral"] = 11] = "NumericLiteral";
  SyntaxKind[SyntaxKind["LineCommentTrivia"] = 12] = "LineCommentTrivia";
  SyntaxKind[SyntaxKind["BlockCommentTrivia"] = 13] = "BlockCommentTrivia";
  SyntaxKind[SyntaxKind["LineBreakTrivia"] = 14] = "LineBreakTrivia";
  SyntaxKind[SyntaxKind["Trivia"] = 15] = "Trivia";
  SyntaxKind[SyntaxKind["Unknown"] = 16] = "Unknown";
  SyntaxKind[SyntaxKind["EOF"] = 17] = "EOF";
})(SyntaxKind || (SyntaxKind = {}));
var parse2 = parse;
var parseTree2 = parseTree;
var findNodeAtLocation2 = findNodeAtLocation;
var ParseErrorCode;
(function(ParseErrorCode) {
  ParseErrorCode[ParseErrorCode["InvalidSymbol"] = 1] = "InvalidSymbol";
  ParseErrorCode[ParseErrorCode["InvalidNumberFormat"] = 2] = "InvalidNumberFormat";
  ParseErrorCode[ParseErrorCode["PropertyNameExpected"] = 3] = "PropertyNameExpected";
  ParseErrorCode[ParseErrorCode["ValueExpected"] = 4] = "ValueExpected";
  ParseErrorCode[ParseErrorCode["ColonExpected"] = 5] = "ColonExpected";
  ParseErrorCode[ParseErrorCode["CommaExpected"] = 6] = "CommaExpected";
  ParseErrorCode[ParseErrorCode["CloseBraceExpected"] = 7] = "CloseBraceExpected";
  ParseErrorCode[ParseErrorCode["CloseBracketExpected"] = 8] = "CloseBracketExpected";
  ParseErrorCode[ParseErrorCode["EndOfFileExpected"] = 9] = "EndOfFileExpected";
  ParseErrorCode[ParseErrorCode["InvalidCommentToken"] = 10] = "InvalidCommentToken";
  ParseErrorCode[ParseErrorCode["UnexpectedEndOfComment"] = 11] = "UnexpectedEndOfComment";
  ParseErrorCode[ParseErrorCode["UnexpectedEndOfString"] = 12] = "UnexpectedEndOfString";
  ParseErrorCode[ParseErrorCode["UnexpectedEndOfNumber"] = 13] = "UnexpectedEndOfNumber";
  ParseErrorCode[ParseErrorCode["InvalidUnicode"] = 14] = "InvalidUnicode";
  ParseErrorCode[ParseErrorCode["InvalidEscapeCharacter"] = 15] = "InvalidEscapeCharacter";
  ParseErrorCode[ParseErrorCode["InvalidCharacter"] = 16] = "InvalidCharacter";
})(ParseErrorCode || (ParseErrorCode = {}));
function printParseErrorCode(code) {
  switch (code) {
    case 1:
      return "InvalidSymbol";
    case 2:
      return "InvalidNumberFormat";
    case 3:
      return "PropertyNameExpected";
    case 4:
      return "ValueExpected";
    case 5:
      return "ColonExpected";
    case 6:
      return "CommaExpected";
    case 7:
      return "CloseBraceExpected";
    case 8:
      return "CloseBracketExpected";
    case 9:
      return "EndOfFileExpected";
    case 10:
      return "InvalidCommentToken";
    case 11:
      return "UnexpectedEndOfComment";
    case 12:
      return "UnexpectedEndOfString";
    case 13:
      return "UnexpectedEndOfNumber";
    case 14:
      return "InvalidUnicode";
    case 15:
      return "InvalidEscapeCharacter";
    case 16:
      return "InvalidCharacter";
  }
  return "<unknown ParseErrorCode>";
}

// src/shared/config-document.ts
var JSONC_PARSE_OPTIONS = {
  allowTrailingComma: false,
  disallowComments: false,
  allowEmptyContent: false
};
var isRecord2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var splitLeadingBom = (text) => text.startsWith("\uFEFF") ? { body: text.slice(1), bom: true } : { body: text, bom: false };
var topLevelPropertyCounts = (root) => {
  const counts = new Map;
  if (root.type !== "object" || !root.children)
    return counts;
  for (const child of root.children) {
    if (child.type !== "property")
      continue;
    const key = child.children?.[0]?.value;
    if (typeof key !== "string")
      continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};
var inspectConfigDocument = (text) => {
  const { body } = splitLeadingBom(text);
  const errors = [];
  const value = parse2(body, errors, JSONC_PARSE_OPTIONS);
  if (errors.length > 0) {
    const codes = [...new Set(errors.map((error) => printParseErrorCode(error.error)))];
    return { state: "syntax", errors: codes };
  }
  if (!isRecord2(value))
    return { state: "non-object" };
  const tree = parseTree2(body, [], JSONC_PARSE_OPTIONS);
  if (tree) {
    const keys = [...topLevelPropertyCounts(tree)].filter(([, count]) => count > 1).map(([key]) => key).sort();
    if (keys.length > 0)
      return { state: "duplicate", keys };
  }
  return { state: "ok", value };
};
var invalidConfig = (issue, message) => ({
  config: {
    ...fallbackConfig(),
    present: true,
    source: "file",
    validity: "invalid",
    issue: { kind: issue.kind, message },
    issues: [issue]
  }
});
var parseConfigText = (text) => {
  const inspection = inspectConfigDocument(text);
  if (inspection.state === "syntax") {
    const detail = inspection.errors.length > 0 ? ` (${inspection.errors.join(", ")})` : "";
    const message = `The config file is not valid JSONC${detail}.`;
    return invalidConfig({ field: "document", kind: "invalid-json", message }, message);
  }
  if (inspection.state === "duplicate") {
    const message = `The config file repeats top-level keys: ${inspection.keys.join(", ")}.`;
    return invalidConfig({ field: "document", kind: "duplicate-key", message }, message);
  }
  if (inspection.state === "non-object") {
    const message = "The config file must hold a JSON object.";
    return invalidConfig({ field: "document", kind: "invalid", message }, message);
  }
  const parsed = parseConfigObject(inspection.value);
  if (!parsed.ok) {
    return invalidConfig({ field: parsed.field, kind: "invalid", message: parsed.message }, parsed.message);
  }
  return { config: parsed.config };
};
var RECOVERABLE_FIELDS = [
  "baseUrl",
  "apiKey",
  "refreshSeconds",
  "fontScale",
  "language"
];
var allDefaulted = () => ({
  values: {
    baseUrl: DEFAULT_BASE_URL,
    apiKey: null,
    refreshSeconds: DEFAULT_REFRESH_SECONDS,
    fontScale: DEFAULT_FONT_SCALE,
    language: DEFAULT_LANGUAGE
  },
  restored: [],
  defaulted: [...RECOVERABLE_FIELDS]
});
var recoverConfigValues = (text) => {
  const { body } = splitLeadingBom(text);
  const tree = parseTree2(body, [], JSONC_PARSE_OPTIONS);
  if (!tree || tree.type !== "object")
    return allDefaulted();
  const properties = new Map;
  for (const child of tree.children ?? []) {
    if (child.type !== "property")
      continue;
    const key = child.children?.[0]?.value;
    if (typeof key !== "string")
      continue;
    const list = properties.get(key) ?? [];
    list.push(child);
    properties.set(key, list);
  }
  const uniqueProperty = (key) => {
    const nodes = properties.get(key);
    return nodes && nodes.length === 1 ? nodes[0] ?? null : null;
  };
  const provableValue = (key) => {
    const property = uniqueProperty(key);
    if (!property)
      return;
    const valueNode = property.children?.[1];
    if (!valueNode || valueNode.length <= 0)
      return;
    const slice = body.slice(valueNode.offset, valueNode.offset + valueNode.length);
    if (slice.trim() === "")
      return;
    const errors = [];
    const value = parse2(slice, errors, JSONC_PARSE_OPTIONS);
    return errors.length === 0 ? value : undefined;
  };
  const has = (key) => (properties.get(key)?.length ?? 0) > 0;
  const result = allDefaulted();
  const restored = new Set;
  const defaulted = new Set;
  const groupDuplicated = (properties.get("baseUrl")?.length ?? 0) > 1 || (properties.get("apiKey")?.length ?? 0) > 1;
  if (groupDuplicated) {
    defaulted.add("baseUrl");
    defaulted.add("apiKey");
  } else {
    const rawBase = provableValue("baseUrl");
    const rawKey = provableValue("apiKey");
    const basePresent = has("baseUrl");
    const keyPresent = has("apiKey");
    if (basePresent && typeof rawBase === "string") {
      const endpoint = normaliseBaseUrl(rawBase);
      if (endpoint.ok) {
        result.values.baseUrl = endpoint.baseUrl;
        restored.add("baseUrl");
        if (!keyPresent) {
          defaulted.add("apiKey");
        } else {
          const parsedKey = parseApiKeyValue(rawKey);
          if (parsedKey.ok && parsedKey.value !== null) {
            result.values.apiKey = parsedKey.value;
            restored.add("apiKey");
          } else {
            defaulted.add("apiKey");
          }
        }
      } else {
        defaulted.add("baseUrl");
        defaulted.add("apiKey");
      }
    } else {
      defaulted.add("baseUrl");
      defaulted.add("apiKey");
    }
  }
  const scalar = (key, parseValue, accept, assign) => {
    if (!has(key)) {
      defaulted.add(key);
      return;
    }
    const raw = provableValue(key);
    if (raw === undefined) {
      defaulted.add(key);
      return;
    }
    const parsed = parseValue(raw);
    if (!parsed.ok || !accept(parsed.value)) {
      defaulted.add(key);
      return;
    }
    assign(parsed.value);
    restored.add(key);
  };
  scalar("refreshSeconds", parseRefreshSecondsValue, () => true, (value) => {
    result.values.refreshSeconds = value;
  });
  scalar("fontScale", parseFontScaleValue, () => true, (value) => {
    result.values.fontScale = value;
  });
  scalar("language", parseLanguageValue, (value) => value === "auto" || value === "en" || value === "zh-CN", (value) => {
    result.values.language = value;
  });
  result.restored = RECOVERABLE_FIELDS.filter((field) => restored.has(field));
  result.defaulted = RECOVERABLE_FIELDS.filter((field) => defaulted.has(field));
  return result;
};
var setCardOrderText = (text, order) => {
  const { body, bom } = splitLeadingBom(text);
  const inspection = inspectConfigDocument(body);
  if (inspection.state !== "ok")
    return null;
  const tree = parseTree2(body, [], JSONC_PARSE_OPTIONS);
  if (!tree || tree.type !== "object")
    return null;
  const eol = body.includes(`\r
`) ? `\r
` : `
`;
  const indentMatch = /^([ \t]+)"/m.exec(body);
  const indent = indentMatch?.[1];
  const insertSpaces = indent ? !indent.includes("\t") : true;
  const unit = insertSpaces ? " ".repeat(indent?.length ?? 2) : "\t";
  const propertyIndent = (node) => {
    const lineStart = body.lastIndexOf(`
`, node.offset - 1) + 1;
    return /^[ \t]*/.exec(body.slice(lineStart, node.offset))?.[0] ?? "";
  };
  const arrayText = (propertyIndentText) => {
    if (order.length === 0)
      return "[]";
    const childIndent = propertyIndentText + unit;
    const items = order.map((key) => `${childIndent}${JSON.stringify(key)}`).join(`,${eol}`);
    return `[${eol}${items}${eol}${propertyIndentText}]`;
  };
  const valueNode = findNodeAtLocation2(tree, ["cardOrder"]);
  if (valueNode) {
    const parent = valueNode.parent;
    const indentText = parent && parent.type === "property" ? propertyIndent(parent) : unit;
    const next = body.slice(0, valueNode.offset) + arrayText(indentText || unit) + body.slice(valueNode.offset + valueNode.length);
    return bom ? `\uFEFF${next}` : next;
  }
  const properties = (tree.children ?? []).filter((child) => child.type === "property");
  const last = properties[properties.length - 1];
  const indentText = last ? propertyIndent(last) || unit : unit;
  const anchor = last ? last.offset + last.length : tree.offset + 1;
  const prefix = last ? `,${eol}` : eol;
  const tail = body.slice(anchor);
  const tailStartsWithBreak = /^[ \t]*\r?\n/.test(tail);
  const insertion = `${prefix}${indentText}"cardOrder": ${arrayText(indentText)}${tailStartsWithBreak ? "" : eol}`;
  const next = body.slice(0, anchor) + insertion + tail;
  return bom ? `\uFEFF${next}` : next;
};

// src/service/config.ts
var defaultConfigPath = () => {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const base = xdg && xdg !== "" ? xdg : join(homedir(), ".config");
  return join(base, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
};
var readConfigFile = async (path) => {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    const code = error.code;
    if (code === "ENOENT")
      return { kind: "missing" };
    return { kind: "unreadable", code: code ?? null };
  }
  if (!info.isFile())
    return { kind: "not-regular" };
  try {
    return { kind: "ok", text: await readFile(path, "utf8") };
  } catch (error) {
    return { kind: "unreadable", code: error.code ?? null };
  }
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
var unreadable = (present, message) => ({
  ...fallbackConfig(),
  present,
  validity: "unreadable",
  issue: { kind: "unreadable", message },
  issues: [{ field: "document", kind: "unreadable", message }]
});
var readConfig = async (path) => {
  const file = await readConfigFile(path);
  if (file.kind === "missing") {
    return { config: fallbackConfig(), path };
  }
  if (file.kind === "not-regular") {
    return {
      config: unreadable(false, "The config path is not a regular file."),
      path
    };
  }
  if (file.kind === "unreadable") {
    return {
      config: unreadable(false, `The config file could not be read (${file.code ?? "unknown error"}).`),
      path
    };
  }
  return { config: parseConfigText(file.text).config, path };
};

// src/service/config-write.ts
import { randomBytes } from "node:crypto";
import { chmod, link, mkdir, open, readFile as readFile2, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// src/service/config-template.ts
var TEMPLATE_DEFAULTS = {
  baseUrl: "http://127.0.0.1:3425",
  apiKey: null,
  refreshSeconds: 60,
  fontScale: 100,
  language: "auto"
};
var orderBlock = (order) => JSON.stringify(order, null, 2).split(`
`).map((line, index) => index === 0 ? line : `  ${line}`).join(`
`);
var renderConfigTemplate = (order = [], values = TEMPLATE_DEFAULTS) => {
  const key = values.apiKey === null ? "null" : JSON.stringify(values.apiKey);
  return [
    "{",
    "  // baseUrl: absolute http(s) URL of the magpie gateway. Plain http is accepted only for a loopback host.",
    "  // baseUrl：magpie 网关的绝对 http(s) URL；仅环回地址允许使用明文 http。",
    `  "baseUrl": ${JSON.stringify(values.baseUrl)},`,
    "",
    "  // apiKey: the gateway key. Only the local service reads it; the panel never displays it.",
    "  // apiKey：网关密钥。只由本地服务读取，面板不会显示。",
    '  // Example / 示例: "apiKey": "replace-with-your-gateway-key"',
    `  "apiKey": ${key},`,
    "",
    "  // refreshSeconds: integer from 5 to 3600.",
    "  // refreshSeconds：5 到 3600 的整数。",
    `  "refreshSeconds": ${values.refreshSeconds},`,
    "",
    "  // fontScale: integer from 50 to 200, the panel's type scale in percent.",
    "  // fontScale：50 到 200 的整数，面板字号百分比。",
    `  "fontScale": ${values.fontScale},`,
    "",
    "  // cardOrder is managed by the panel's drag and keyboard reordering. The whole array",
    "  // is replaced on save, so comments inside the array may be dropped.",
    "  // cardOrder 由面板拖拽与键盘排序管理；保存时整个数组会被替换，数组内注释可能丢失。",
    `  "cardOrder": ${orderBlock(order)},`,
    "",
    '  // language: "auto", "en", or "zh-CN".',
    '  // language："auto"、"en" 或 "zh-CN"。',
    `  "language": ${JSON.stringify(values.language)}`,
    "}",
    ""
  ].join(`
`);
};
var commentPreviousText = (text) => {
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > 1 && lines[lines.length - 1] === "")
    lines.pop();
  return lines.map((line) => line === "" ? "//" : `// ${line}`).join(`
`);
};
var renderRebuiltConfig = (previousText, order, values, at) => {
  const active = renderConfigTemplate(order, values);
  const marker = [
    "// --- Previous config text, kept as comments / 旧配置原文（保留为注释）---",
    `// Rebuilt on ${at} after a syntax, duplicate-key, or root-shape error.`,
    `// 因语法、重复键或根结构错误，已于 ${at} 重建。`,
    "// The active settings above are the template defaults plus any field that could be",
    "// proved complete in the old text; everything else fell back to its default.",
    "// 上方生效值是模板默认值加上旧文中可证明完整的字段；其余字段已回退默认。",
    ""
  ].join(`
`);
  return `${active}
${marker}${commentPreviousText(previousText)}
`;
};
var recoveryReport = (at, recovered) => ({
  at,
  restored: recovered.restored,
  defaulted: recovered.defaulted,
  previousText: "appended-comments"
});

// src/service/config-write.ts
class ConfigWriteError extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "ConfigWriteError";
    this.code = code;
  }
}
var isCode = (error, code) => error.code === code;
var tempName = (path) => `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
var writeAtomic = async (path, text, mode, options) => {
  await mkdir(dirname(path), { recursive: true });
  const temp = tempName(path);
  try {
    await writeFile(temp, text, { encoding: "utf8", mode });
    await chmod(temp, mode).catch(() => {
      return;
    });
    if (options.exclusive) {
      try {
        await link(temp, path);
      } catch (error) {
        if (isCode(error, "EEXIST"))
          throw error;
        let handle;
        let createdHere = false;
        try {
          handle = await open(path, "wx", mode);
          createdHere = true;
          await handle.writeFile(text, "utf8");
          await handle.sync();
        } catch (fallbackError) {
          if (createdHere)
            await unlink(path).catch(() => {
              return;
            });
          throw fallbackError;
        } finally {
          await handle?.close().catch(() => {
            return;
          });
        }
      }
      return;
    }
    if (options.expectedText !== undefined) {
      let current;
      try {
        current = await readFile2(path, "utf8");
      } catch (error) {
        if (isCode(error, "ENOENT")) {
          throw new ConfigWriteError("conflict", "The config file disappeared; retry.");
        }
        throw new ConfigWriteError("conflict", "The config file could not be re-read; retry.");
      }
      if (current !== options.expectedText) {
        throw new ConfigWriteError("conflict", "The config file changed on disk; retry.");
      }
    }
    await rename(temp, path);
  } catch (error) {
    if (error instanceof ConfigWriteError)
      throw error;
    if (isCode(error, "EEXIST")) {
      throw new ConfigWriteError("conflict", "The config file appeared while it was being created.");
    }
    throw new ConfigWriteError("write-failed", "The config file could not be written.");
  } finally {
    await unlink(temp).catch(() => {
      return;
    });
  }
};
var assertReadable = (file) => {
  if (file.kind === "ok" || file.kind === "missing")
    return file;
  if (file.kind === "not-regular") {
    throw new ConfigWriteError("not-regular", "The config path is not a regular file.");
  }
  throw new ConfigWriteError("unreadable", `The config file could not be read (${file.code ?? "unknown error"}).`);
};
var createOnce = async (path, order) => {
  const existing = assertReadable(await readConfigFile(path));
  if (existing.kind === "ok")
    return { created: false, present: true };
  try {
    await writeAtomic(path, renderConfigTemplate(order), 384, { exclusive: true });
    return { created: true, present: true };
  } catch (error) {
    if (!(error instanceof ConfigWriteError) || error.code !== "conflict")
      throw error;
    const appeared = assertReadable(await readConfigFile(path));
    if (appeared.kind === "ok")
      return { created: false, present: true };
    throw error;
  }
};
var saveOnce = async (path, order, hooks) => {
  let existing = assertReadable(await readConfigFile(path));
  if (existing.kind === "missing") {
    try {
      await writeAtomic(path, renderConfigTemplate(order), 384, { exclusive: true });
      return { order, recovery: null };
    } catch (error) {
      if (!(error instanceof ConfigWriteError) || error.code !== "conflict")
        throw error;
      existing = assertReadable(await readConfigFile(path));
      if (existing.kind === "missing")
        throw error;
    }
  }
  const inspection = inspectConfigDocument(existing.text);
  const mode = await modeOf(path);
  if (inspection.state === "ok") {
    const next = setCardOrderText(existing.text, order);
    if (next === null) {
      throw new ConfigWriteError("write-failed", "The config file could not be edited.");
    }
    await hooks?.beforePublish?.(path);
    await writeAtomic(path, next, mode, { exclusive: false, expectedText: existing.text });
    return { order, recovery: null };
  }
  const at = new Date().toISOString();
  const { body, bom } = splitLeadingBom(existing.text);
  const recovered = recoverConfigValues(body);
  const template = renderRebuiltConfig(body, order, recovered.values, at);
  const rebuilt = bom ? `\uFEFF${template}` : template;
  await hooks?.beforePublish?.(path);
  await writeAtomic(path, rebuilt, mode, { exclusive: false, expectedText: existing.text });
  return { order, recovery: recoveryReport(at, recovered) };
};
var queue = Promise.resolve();
var serialized = (work) => {
  const next = queue.then(work, work);
  queue = next.then(() => {
    return;
  }, () => {
    return;
  });
  return next;
};
var createConfigFile = (path, order) => serialized(() => createOnce(path, order));
var saveCardOrder = (path, order, hooks) => serialized(() => saveOnce(path, order, hooks));

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
  if (kind === "config-conflict")
    return 409;
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
var parseOrderArray = (raw, allowEmpty) => {
  if (!Array.isArray(raw))
    return null;
  if (!allowEmpty && raw.length === 0)
    return null;
  if (raw.length > MAX_CARD_ORDER)
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
var parseOrderBody = (text) => {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord3(value))
    return null;
  return parseOrderArray(value.order, false);
};
var parseCreateBody = (text) => {
  if (text.trim() === "")
    return [];
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord3(value))
    return null;
  if (value.order === undefined)
    return [];
  return parseOrderArray(value.order, true);
};
var createService = (options) => {
  const {
    port,
    token,
    configPath = defaultConfigPath(),
    upstreamTimeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS,
    refreshMinIntervalMs = DEFAULT_REFRESH_MIN_INTERVAL_MS,
    beforeConfigPublish,
    now = Date.now,
    fetchImpl = fetch
  } = options;
  let server;
  let boundPort = port;
  let lastGoodCards = null;
  let lastGoodAt = null;
  let lastFreshAt = null;
  let recoveryNotice = null;
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
        cardOrderInvalid: config.cardOrderInvalid,
        language: config.language,
        languageInvalid: config.languageInvalid,
        recovery: recoveryNotice,
        source: config.source,
        present: config.present,
        validity: config.validity,
        issue: config.issue,
        issues: config.issues
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
  const failWrite = (response, error) => {
    if (error instanceof ConfigWriteError) {
      if (error.code === "conflict") {
        fail(response, "config-conflict", { message: error.message });
        return;
      }
      fail(response, "internal", { message: error.message });
      return;
    }
    fail(response, "internal", { message: "The config file could not be written." });
  };
  const handleConfigWrite = async (pathname, request, response) => {
    const body = await readBody(request);
    if (!body.ok) {
      fail(response, "bad-request", { message: `The body must be JSON under ${MAX_ORDER_BODY_BYTES} bytes.` });
      return;
    }
    if (pathname === "/config/create") {
      const order = parseCreateBody(body.text);
      if (order === null) {
        fail(response, "bad-request", {
          message: `order, when present, must be an array of 0 to ${MAX_CARD_ORDER} strings, each 1 to ${MAX_CARD_ORDER_KEY} characters.`
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
      fail(response, "bad-request", {
        message: `order must be an array of 1 to ${MAX_CARD_ORDER} strings, each 1 to ${MAX_CARD_ORDER_KEY} characters.`
      });
      return;
    }
    try {
      const saved = await saveCardOrder(configPath, order, beforeConfigPublish === undefined ? undefined : { beforePublish: beforeConfigPublish });
      if (saved.recovery)
        recoveryNotice = saved.recovery;
      writeJson(response, 200, { ok: true, order: saved.order, recovery: saved.recovery });
    } catch (error) {
      failWrite(response, error);
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
        if (method === "POST" && (url.pathname === "/config/order" || url.pathname === "/config/create")) {
          handleConfigWrite(url.pathname, request, response).catch(() => {
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
