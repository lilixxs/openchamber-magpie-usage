/**
 * Strict JSONC validation and conservative recovery for the config file.
 *
 * This module is service-only in practice, but it lives in `shared` because
 * its types are part of the contract the panel renders. It imports the pure
 * field parsers from `magpie.ts` and never touches Node or the DOM.
 */
// The Node-target bundler selects the package's UMD `main` by default. That
// wrapper passes require as a function argument, leaving ./impl/* unresolved
// in a single-file bundle. Pin the ESM entry so its imports are all bundled.
import {
  findNodeAtLocation,
  parse,
  parseTree,
  printParseErrorCode,
  type Node,
  type ParseError,
} from 'jsonc-parser/lib/esm/main.js';

import {
  DEFAULT_BASE_URL,
  DEFAULT_FONT_SCALE,
  DEFAULT_LANGUAGE,
  DEFAULT_PROVIDER_ICONS,
  DEFAULT_REFRESH_SECONDS,
  fallbackConfig,
  normaliseBaseUrl,
  parseApiKeyValue,
  parseConfigObject,
  parseFontScaleValue,
  parseLanguageValue,
  parseProviderIcons,
  parseRefreshSecondsValue,
  type ConfigField,
  type ConfigFieldIssue,
  type ServiceConfig,
} from './magpie.ts';

/**
 * Comments are allowed; trailing commas, duplicate top-level keys, and any
 * other malformed token are not. Never trust the parser's returned value
 * without checking `errors`: jsonc-parser is fault tolerant by design.
 */
export const JSONC_PARSE_OPTIONS = {
  allowTrailingComma: false,
  disallowComments: false,
  allowEmptyContent: false,
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A UTF-8 BOM is encoding metadata, not JSONC content. Exactly one BOM is
 * allowed at the absolute start; jsonc-parser treats any BOM as InvalidSymbol,
 * so parsers and offset-based edits work on a BOM-free view. A second BOM or a
 * BOM anywhere else stays in the body and is still a syntax error.
 */
export const splitLeadingBom = (text: string): { body: string; bom: boolean } =>
  text.startsWith('\uFEFF') ? { body: text.slice(1), bom: true } : { body: text, bom: false };

export type ConfigDocumentInspection =
  | { state: 'ok'; value: Record<string, unknown> }
  | { state: 'syntax'; errors: string[] }
  | { state: 'duplicate'; keys: string[] }
  | { state: 'non-object' };

const topLevelPropertyCounts = (root: Node): Map<string, number> => {
  const counts = new Map<string, number>();
  if (root.type !== 'object' || !root.children) return counts;
  for (const child of root.children) {
    if (child.type !== 'property') continue;
    const key = child.children?.[0]?.value;
    if (typeof key !== 'string') continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

/**
 * Collects every syntax error instead of accepting the parser's partial
 * value. Duplicate top-level keys are checked separately because JSONC parsers
 * silently choose an order for them.
 */
export const inspectConfigDocument = (text: string): ConfigDocumentInspection => {
  const { body } = splitLeadingBom(text);
  const errors: ParseError[] = [];
  const value = parse(body, errors, JSONC_PARSE_OPTIONS);
  if (errors.length > 0) {
    const codes = [...new Set(errors.map((error) => printParseErrorCode(error.error)))];
    return { state: 'syntax', errors: codes };
  }
  if (!isRecord(value)) return { state: 'non-object' };

  const tree = parseTree(body, [], JSONC_PARSE_OPTIONS);
  if (tree) {
    const keys = [...topLevelPropertyCounts(tree)]
      .filter(([, count]) => count > 1)
      .map(([key]) => key)
      .sort();
    if (keys.length > 0) return { state: 'duplicate', keys };
  }

  return { state: 'ok', value };
};

const invalidConfig = (issue: ConfigFieldIssue, message: string): { config: ServiceConfig } => ({
  config: {
    ...fallbackConfig(),
    present: true,
    source: 'file',
    validity: 'invalid',
    issue: { kind: issue.kind, message },
    issues: [issue],
  },
});

/**
 * jsonc-parser materialises objects with `{}` and plain assignment, so a
 * `"__proto__"` property is swallowed by the prototype setter. The icon map is
 * the one field where that would silently lose data, so it is rebuilt from the
 * AST with own data properties instead. Comments are skipped, a later duplicate
 * key wins, and no value ever reaches a prototype.
 */
const materialiseIconMap = (node: Node): Record<string, unknown> => {
  const bag: Record<string, unknown> = {};
  if (node.type !== 'object' || !node.children) return bag;
  for (const child of node.children) {
    if (child.type !== 'property') continue;
    const keyNode = child.children?.[0];
    const valueNode = child.children?.[1];
    if (!keyNode || typeof keyNode.value !== 'string' || !valueNode) continue;
    // Park non-string values as `null`: a later duplicate still replaces an
    // earlier string, and `parseProviderIcons` then drops the entry.
    Object.defineProperty(bag, keyNode.value, {
      value: valueNode.type === 'string' ? valueNode.value : null,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return bag;
};

/** The icon mapping from an already-valid root tree, or `null` when absent. */
const providerIconsFromTree = (tree: Node | undefined): Record<string, string> | null => {
  if (!tree || tree.type !== 'object' || !tree.children) return null;
  let valueNode: Node | undefined;
  for (const child of tree.children) {
    if (child.type !== 'property') continue;
    const key = child.children?.[0]?.value;
    if (key === 'providerIcons') valueNode = child.children?.[1];
  }
  if (!valueNode) return null;
  if (valueNode.type !== 'object') return {};
  return parseProviderIcons(materialiseIconMap(valueNode));
};

/**
 * The recovery variant: the property's own source slice must parse with zero
 * errors first, and only then is the object materialised. A truncated or
 * ambiguous slice is never trusted.
 */
const provedProviderIcons = (property: Node, body: string): Record<string, string> | null => {
  const valueNode = property.children?.[1];
  if (!valueNode || valueNode.length <= 0) return null;
  const slice = body.slice(valueNode.offset, valueNode.offset + valueNode.length);
  if (slice.trim() === '') return null;
  const errors: ParseError[] = [];
  parse(slice, errors, JSONC_PARSE_OPTIONS);
  if (errors.length > 0) return null;
  const node = parseTree(slice, [], JSONC_PARSE_OPTIONS);
  if (!node || node.type !== 'object') return null;
  return parseProviderIcons(materialiseIconMap(node));
};

/**
 * Parses the config file text. A document-level problem falls back to the
 * loopback default plus a safe issue; field-level lenient problems keep the
 * endpoint and key and are listed in `issues`.
 */
export const parseConfigText = (text: string): { config: ServiceConfig } => {
  const inspection = inspectConfigDocument(text);

  if (inspection.state === 'syntax') {
    const detail = inspection.errors.length > 0 ? ` (${inspection.errors.join(', ')})` : '';
    const message = `The config file is not valid JSONC${detail}.`;
    return invalidConfig({ field: 'document', kind: 'invalid-json', message }, message);
  }

  if (inspection.state === 'duplicate') {
    const message = `The config file repeats top-level keys: ${inspection.keys.join(', ')}.`;
    return invalidConfig({ field: 'document', kind: 'duplicate-key', message }, message);
  }

  if (inspection.state === 'non-object') {
    const message = 'The config file must hold a JSON object.';
    return invalidConfig({ field: 'document', kind: 'invalid', message }, message);
  }

  const parsed = parseConfigObject(inspection.value);
  if (!parsed.ok) {
    return invalidConfig(
      { field: parsed.field, kind: 'invalid', message: parsed.message },
      parsed.message,
    );
  }

  // `inspection.value` already lost any `__proto__` icon key to the parser's
  // setter; rebuild the one field from the tree so own keys survive.
  const { body } = splitLeadingBom(text);
  const icons = providerIconsFromTree(parseTree(body, [], JSONC_PARSE_OPTIONS));
  if (icons !== null) parsed.config.providerIcons = icons;

  return { config: parsed.config };
};

export type ConfigRecoveryValues = {
  baseUrl: string;
  apiKey: string | null;
  refreshSeconds: number;
  fontScale: number;
  language: string;
  providerIcons: Record<string, string>;
};

export type ConfigRecoveryResult = {
  values: ConfigRecoveryValues;
  restored: ConfigField[];
  defaulted: ConfigField[];
};

const RECOVERABLE_FIELDS: ConfigField[] = [
  'baseUrl',
  'apiKey',
  'refreshSeconds',
  'fontScale',
  'language',
  'providerIcons',
];

const allDefaulted = (): ConfigRecoveryResult => ({
  values: {
    baseUrl: DEFAULT_BASE_URL,
    apiKey: null,
    refreshSeconds: DEFAULT_REFRESH_SECONDS,
    fontScale: DEFAULT_FONT_SCALE,
    language: DEFAULT_LANGUAGE,
    providerIcons: { ...DEFAULT_PROVIDER_ICONS },
  },
  restored: [],
  defaulted: [...RECOVERABLE_FIELDS],
});

/**
 * Conservative recovery from a damaged document. Only a root-level property
 * whose value slice parses strictly on its own is accepted; a value that needs
 * a guessed quote, bracket, comma, or comment is rejected. A duplicated field
 * uses neither occurrence. `baseUrl` and `apiKey` are restored as a pair: a key
 * without a proven endpoint is never attached to the default endpoint.
 * `providerIcons` is restored only from a proven object, keeping its valid
 * entries; otherwise it falls back to the template default.
 */
export const recoverConfigValues = (text: string): ConfigRecoveryResult => {
  const { body } = splitLeadingBom(text);
  const tree = parseTree(body, [], JSONC_PARSE_OPTIONS);
  if (!tree || tree.type !== 'object') return allDefaulted();

  const properties = new Map<string, Node[]>();
  for (const child of tree.children ?? []) {
    if (child.type !== 'property') continue;
    const key = child.children?.[0]?.value;
    if (typeof key !== 'string') continue;
    const list = properties.get(key) ?? [];
    list.push(child);
    properties.set(key, list);
  }

  const uniqueProperty = (key: string): Node | null => {
    const nodes = properties.get(key);
    return nodes && nodes.length === 1 ? nodes[0] ?? null : null;
  };

  /** The value only when its own source slice is a complete, valid JSONC value. */
  const provableValue = (key: string): unknown => {
    const property = uniqueProperty(key);
    if (!property) return undefined;
    const valueNode = property.children?.[1];
    if (!valueNode || valueNode.length <= 0) return undefined;
    const slice = body.slice(valueNode.offset, valueNode.offset + valueNode.length);
    if (slice.trim() === '') return undefined;
    const errors: ParseError[] = [];
    const value = parse(slice, errors, JSONC_PARSE_OPTIONS);
    return errors.length === 0 ? value : undefined;
  };

  const has = (key: string): boolean => (properties.get(key)?.length ?? 0) > 0;

  const result = allDefaulted();
  const restored = new Set<ConfigField>();
  const defaulted = new Set<ConfigField>();

  // baseUrl + apiKey are one group. Any duplicate in the group defaults both.
  const groupDuplicated =
    (properties.get('baseUrl')?.length ?? 0) > 1 || (properties.get('apiKey')?.length ?? 0) > 1;
  if (groupDuplicated) {
    defaulted.add('baseUrl');
    defaulted.add('apiKey');
  } else {
    const rawBase = provableValue('baseUrl');
    const rawKey = provableValue('apiKey');
    const basePresent = has('baseUrl');
    const keyPresent = has('apiKey');

    if (basePresent && typeof rawBase === 'string') {
      const endpoint = normaliseBaseUrl(rawBase);
      if (endpoint.ok) {
        result.values.baseUrl = endpoint.baseUrl;
        restored.add('baseUrl');

        if (!keyPresent) {
          defaulted.add('apiKey');
        } else {
          const parsedKey = parseApiKeyValue(rawKey);
          if (parsedKey.ok && parsedKey.value !== null) {
            result.values.apiKey = parsedKey.value;
            restored.add('apiKey');
          } else {
            defaulted.add('apiKey');
          }
        }
      } else {
        // An unproven endpoint never gets the old key either.
        defaulted.add('baseUrl');
        defaulted.add('apiKey');
      }
    } else {
      // Missing, invalid, or ambiguous endpoint: both default, even when a key
      // looks readable. The old text remains in the comments.
      defaulted.add('baseUrl');
      defaulted.add('apiKey');
    }
  }

  const scalar = <T>(
    key: 'refreshSeconds' | 'fontScale' | 'language',
    parseValue: (value: unknown) => { ok: true; value: T } | { ok: false; message: string },
    accept: (value: T) => boolean,
    assign: (value: T) => void,
  ): void => {
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

  scalar('refreshSeconds', parseRefreshSecondsValue, () => true, (value) => {
    result.values.refreshSeconds = value;
  });
  scalar('fontScale', parseFontScaleValue, () => true, (value) => {
    result.values.fontScale = value;
  });
  scalar(
    'language',
    parseLanguageValue,
    (value) => value === 'auto' || value === 'en' || value === 'zh-CN',
    (value) => {
      result.values.language = value;
    },
  );

  // A provable object keeps its valid entries and drops the rest; a duplicate,
  // an unreadable slice, or a non-object falls back to the template default.
  if (!has('providerIcons')) {
    defaulted.add('providerIcons');
  } else {
    const property = uniqueProperty('providerIcons');
    const proved = property ? provedProviderIcons(property, body) : null;
    if (proved !== null) {
      result.values.providerIcons = proved;
      restored.add('providerIcons');
    } else {
      defaulted.add('providerIcons');
    }
  }

  result.restored = RECOVERABLE_FIELDS.filter((field) => restored.has(field));
  result.defaulted = RECOVERABLE_FIELDS.filter((field) => defaulted.has(field));
  return result;
};

/**
 * Replaces the value range of the root `cardOrder`, or inserts a missing
 * property after the last property. Only that range is touched: comments,
 * unknown keys, and other formatting stay byte for byte. Comments inside the
 * old array are dropped, as documented in the template.
 */
export const setCardOrderText = (text: string, order: string[]): string | null => {
  const { body, bom } = splitLeadingBom(text);
  const inspection = inspectConfigDocument(body);
  if (inspection.state !== 'ok') return null;

  const tree = parseTree(body, [], JSONC_PARSE_OPTIONS);
  if (!tree || tree.type !== 'object') return null;

  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const indentMatch = /^([ \t]+)"/m.exec(body);
  const indent = indentMatch?.[1];
  const insertSpaces = indent ? !indent.includes('\t') : true;
  const unit = insertSpaces ? ' '.repeat(indent?.length ?? 2) : '\t';

  const propertyIndent = (node: Node): string => {
    const lineStart = body.lastIndexOf('\n', node.offset - 1) + 1;
    return /^[ \t]*/.exec(body.slice(lineStart, node.offset))?.[0] ?? '';
  };

  const arrayText = (propertyIndentText: string): string => {
    if (order.length === 0) return '[]';
    const childIndent = propertyIndentText + unit;
    const items = order.map((key) => `${childIndent}${JSON.stringify(key)}`).join(`,${eol}`);
    return `[${eol}${items}${eol}${propertyIndentText}]`;
  };

  const valueNode = findNodeAtLocation(tree, ['cardOrder']);
  if (valueNode) {
    const parent = valueNode.parent;
    const indentText = parent && parent.type === 'property' ? propertyIndent(parent) : unit;
    const next =
      body.slice(0, valueNode.offset) +
      arrayText(indentText || unit) +
      body.slice(valueNode.offset + valueNode.length);
    return bom ? `\uFEFF${next}` : next;
  }

  const properties = (tree.children ?? []).filter((child) => child.type === 'property');
  const last = properties[properties.length - 1];
  const indentText = last ? propertyIndent(last) || unit : unit;
  const anchor = last ? last.offset + last.length : tree.offset + 1;
  const prefix = last ? `,${eol}` : eol;
  const tail = body.slice(anchor);
  const tailStartsWithBreak = /^[ \t]*\r?\n/.test(tail);
  const insertion = `${prefix}${indentText}"cardOrder": ${arrayText(indentText)}${tailStartsWithBreak ? '' : eol}`;
  const next = body.slice(0, anchor) + insertion + tail;
  return bom ? `\uFEFF${next}` : next;
};
