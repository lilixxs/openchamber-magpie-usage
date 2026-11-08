/**
 * Parsers for the upstream magpie sources the icon sync reads.
 *
 * The sources are Go, so the extraction is deliberately lexical: comments and
 * strings are tokenised, then composite-literal fields are read at one brace
 * level. That is enough for `PresetDef{ID, Icon}`, `Agent{ID, Icon}`,
 * `googleApp{agent, icon}`, and `accountCard`'s `case "id": ... cardFace{...}`.
 * Nested literals (`Region{ID: ...}`) are skipped rather than mistaken for the
 * outer preset.
 */

export type IconPair = {
  id: string;
  icon: string;
};

export type IconMergeInput = {
  /** `PresetDef` entries from provider/presets.go. */
  presets: readonly IconPair[];
  /** `Agent` entries from agent/*.go. */
  agents: readonly IconPair[];
  /** Google app descriptors (`agent: "x", icon: "y"`) from provider/*.go. */
  googleApps: readonly IconPair[];
  /** `accountCard` faces from provider/*.go. */
  accountCards: readonly IconPair[];
  /** Provider ids a market plugin signs in to, with the plugin's icon. */
  market: readonly IconPair[];
};

export type IconConflict = {
  id: string;
  kept: string;
  discarded: string;
  source: string;
};

export type MergedIcons = {
  icons: Record<string, string>;
  conflicts: IconConflict[];
  counts: {
    presets: number;
    agents: number;
    googleApps: number;
    accountCards: number;
    market: number;
  };
};

type Token =
  | { kind: 'ident'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: string }
  | { kind: 'punct'; value: string };

const isIdentStart = (ch: string): boolean => /[A-Za-z_]/.test(ch);
const isIdentPart = (ch: string): boolean => /[A-Za-z0-9_]/.test(ch);

/** Decode the escapes Go permits in an interpreted string literal. */
export const unquoteGoString = (raw: string): string => {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]!;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) return out;
    i += 1;
    switch (next) {
      case 'a':
        out += '\u0007';
        break;
      case 'b':
        out += '\b';
        break;
      case 'f':
        out += '\f';
        break;
      case 'n':
        out += '\n';
        break;
      case 'r':
        out += '\r';
        break;
      case 't':
        out += '\t';
        break;
      case 'v':
        out += '\v';
        break;
      case '\\':
        out += '\\';
        break;
      case '"':
        out += '"';
        break;
      case "'":
        out += "'";
        break;
      case 'x': {
        const hex = raw.slice(i + 1, i + 3);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 2;
        } else {
          out += 'x';
        }
        break;
      }
      case 'u':
      case 'U': {
        const width = next === 'u' ? 4 : 8;
        const hex = raw.slice(i + 1, i + 1 + width);
        if (new RegExp(`^[0-9a-fA-F]{${width}}$`).test(hex)) {
          const code = Number.parseInt(hex, 16);
          out += String.fromCodePoint(code);
          i += width;
        } else {
          out += next;
        }
        break;
      }
      default:
        out += next;
        break;
    }
  }
  return out;
};

/**
 * Split Go text into identifiers, decoded string literals, and the punctuation
 * the literal parsers need. Comments, rune literals, and raw strings are
 * consumed without leaking their contents into the token stream.
 */
export const tokenizeGo = (source: string): Token[] => {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let raw = '';
      while (j < source.length) {
        const c = source[j]!;
        if (c === '\\') {
          raw += c;
          if (j + 1 < source.length) raw += source[j + 1]!;
          j += 2;
          continue;
        }
        if (c === '"') {
          j += 1;
          break;
        }
        raw += c;
        j += 1;
      }
      tokens.push({ kind: 'string', value: unquoteGoString(raw) });
      i = j;
      continue;
    }
    if (ch === '`') {
      let j = i + 1;
      let raw = '';
      while (j < source.length && source[j] !== '`') {
        raw += source[j]!;
        j += 1;
      }
      tokens.push({ kind: 'string', value: raw });
      i = j + 1;
      continue;
    }
    if (ch === "'") {
      // A rune literal is irrelevant to these parsers.
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source[j] === "'") {
          j += 1;
          break;
        }
        j += 1;
      }
      i = j;
      continue;
    }
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < source.length && isIdentPart(source[j]!)) j += 1;
      tokens.push({ kind: 'ident', value: source.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < source.length && /[0-9A-Za-z._]/.test(source[j]!)) j += 1;
      tokens.push({ kind: 'number', value: source.slice(i, j) });
      i = j;
      continue;
    }
    tokens.push({ kind: 'punct', value: ch });
    i += 1;
  }
  return tokens;
};

const isOpen = (token: Token | undefined): boolean =>
  token?.kind === 'punct' && (token.value === '{' || token.value === '[' || token.value === '(');

const isClose = (token: Token | undefined): boolean =>
  token?.kind === 'punct' && (token.value === '}' || token.value === ']' || token.value === ')');

/**
 * Read the immediate keyed string fields of the composite literal whose `{` is
 * at `open`. Nested literals are skipped; `ID` in a `Regions` element therefore
 * cannot shadow the outer preset's `ID`.
 */
type FieldValue = {
  value: string;
  kind: 'string' | 'ident' | 'number';
};

const readObject = (
  tokens: readonly Token[],
  open: number,
): { fields: Map<string, FieldValue>; end: number } => {
  const fields = new Map<string, FieldValue>();
  let depth = 0;
  let i = open + 1;
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (isOpen(token)) {
      depth += 1;
      i += 1;
      continue;
    }
    if (isClose(token)) {
      if (depth === 0 && token.value === '}') return { fields, end: i };
      depth -= 1;
      i += 1;
      continue;
    }
    if (depth === 0 && token.kind === 'ident' && tokens[i + 1]?.value === ':') {
      const key = token.value;
      const value = tokens[i + 2];
      if (value && (value.kind === 'string' || value.kind === 'ident' || value.kind === 'number')) {
        if (!fields.has(key)) fields.set(key, { value: value.value, kind: value.kind });
        i += 3;
      } else {
        // The value is a nested literal: let the loop below see its opening
        // token so depth stays balanced. Skipping it here would make every
        // later `}` look like a closer one level too shallow.
        i += 2;
      }
      continue;
    }
    i += 1;
  }
  return { fields, end: i };
};

/**
 * Read a pair whose icon must be a string literal. An id may be a literal or a
 * package constant; an unresolved identifier (`id`, `live.ID`) is not an icon
 * mapping and is skipped.
 */
const pairFrom = (
  fields: Map<string, FieldValue>,
  idKey: string,
  iconKey: string,
  constants: ReadonlyMap<string, string> = new Map(),
): IconPair | null => {
  const id = fields.get(idKey);
  const icon = fields.get(iconKey);
  if (!id || !icon || icon.kind !== 'string') return null;
  const idValue = id.kind === 'string' ? id.value : constants.get(id.value);
  if (!idValue) return null;
  return { id: idValue, icon: icon.value };
};

/**
 * String constants in a package: `const X = "..."` and entries of `const (...)`
 * blocks. Presets use a handful of these for ids (`VertexPreset`).
 */
export const parseStringConstants = (sources: readonly string[]): Map<string, string> => {
  const constants = new Map<string, string>();
  for (const source of sources) {
    const tokens = tokenizeGo(source);
    for (let i = 0; i < tokens.length; i += 1) {
      if (tokens[i]?.kind !== 'ident' || tokens[i]?.value !== 'const') continue;
      const next = tokens[i + 1];
      if (!next) continue;
      if (next.kind === 'ident') {
        let j = i + 2;
        if (tokens[j]?.kind === 'ident') j += 1; // `const X string = "..."`.
        if (tokens[j]?.value === '=' && tokens[j + 1]?.kind === 'string') {
          constants.set(next.value, tokens[j + 1]!.value);
        }
        continue;
      }
      if (next.kind === 'punct' && next.value === '(') {
        let j = i + 2;
        while (j < tokens.length) {
          const name = tokens[j];
          if (name?.kind === 'punct' && name.value === ')') break;
          if (name?.kind === 'ident') {
            let k = j + 1;
            if (tokens[k]?.kind === 'ident') k += 1;
            if (tokens[k]?.value === '=' && tokens[k + 1]?.kind === 'string') {
              constants.set(name.value, tokens[k + 1]!.value);
              j = k + 2;
              continue;
            }
          }
          j += 1;
        }
      }
    }
  }
  return constants;
};

/**
 * Top-level `PresetDef` entries in provider/presets.go.
 *
 * `presets` is a slice of composite literals. Only braces at the slice's own
 * level are elements; `Regions: []Region{{ID: ...}}` lives one level deeper and
 * is ignored.
 */
export const parsePresetIcons = (
  source: string,
  constants: ReadonlyMap<string, string> = new Map(),
): IconPair[] => {
  const tokens = tokenizeGo(source);
  let sliceOpen = -1;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (tokens[i]?.kind !== 'ident' || tokens[i]?.value !== 'presets') continue;
    if (tokens[i + 1]?.value !== '=' && tokens[i + 1]?.value !== ':=') continue;
    for (let j = i + 2; j < Math.min(tokens.length, i + 12); j += 1) {
      if (tokens[j]?.kind === 'punct' && tokens[j]?.value === '{') {
        sliceOpen = j;
        break;
      }
      if (tokens[j]?.kind === 'punct' && (tokens[j]?.value === ';' || tokens[j]?.value === '}')) break;
    }
    if (sliceOpen !== -1) break;
  }
  if (sliceOpen === -1) return [];

  const pairs: IconPair[] = [];
  let i = sliceOpen + 1;
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (token.kind === 'punct' && token.value === '}') break;
    if (token.kind === 'punct' && token.value === '{') {
      const { fields, end } = readObject(tokens, i);
      const pair = pairFrom(fields, 'ID', 'Icon', constants);
      if (pair) pairs.push(pair);
      i = end + 1;
      continue;
    }
    i += 1;
  }
  return pairs;
};

/**
 * `Agent{ID, Icon}` entries in agent/*.go. Typed literals (`&Agent{...}`) and
 * elements of a `[]*Agent` slice take the same shape, so every immediate
 * object carrying both keys is accepted. Test files are excluded by the caller.
 */
export const parseAgentIcons = (
  source: string,
  constants: ReadonlyMap<string, string> = new Map(),
): IconPair[] => {
  const tokens = tokenizeGo(source);
  const pairs: IconPair[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i]?.kind !== 'punct' || tokens[i]?.value !== '{') continue;
    const { fields } = readObject(tokens, i);
    const pair = pairFrom(fields, 'ID', 'Icon', constants);
    if (pair) pairs.push(pair);
  }
  return pairs;
};

/** `googleApp{agent: "...", icon: "..."}` descriptors in provider/*.go. */
export const parseGoogleAppIcons = (source: string): IconPair[] => {
  const tokens = tokenizeGo(source);
  const pairs: IconPair[] = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (tokens[i]?.kind !== 'ident' || tokens[i]?.value !== 'googleApp') continue;
    const open = tokens[i + 1]?.value === '{' ? i + 1 : tokens[i + 2]?.value === '{' ? i + 2 : -1;
    if (open === -1) continue;
    const { fields } = readObject(tokens, open);
    const pair = pairFrom(fields, 'agent', 'icon');
    if (pair) pairs.push(pair);
  }
  return pairs;
};

/**
 * `case "claude": return cardFace{"Claude Code", "claude-color"}` faces in
 * provider/cards_kept.go. The display name is dropped; the pair is the agent id
 * and the icon a usage card is drawn with.
 */
export const parseAccountCardIcons = (source: string): IconPair[] => {
  const tokens = tokenizeGo(source);
  const pairs: IconPair[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i]?.kind !== 'ident' || tokens[i]?.value !== 'case') continue;
    const cases: string[] = [];
    let j = i + 1;
    while (j < tokens.length) {
      const token = tokens[j]!;
      if (token.kind === 'string') {
        cases.push(token.value);
        j += 1;
        continue;
      }
      if (token.kind === 'punct' && token.value === ',') {
        j += 1;
        continue;
      }
      break;
    }
    if (cases.length === 0 || tokens[j]?.value !== ':') continue;
    let k = j + 1;
    while (k < tokens.length && !(tokens[k]?.kind === 'ident' && tokens[k]?.value === 'return')) {
      if (tokens[k]?.kind === 'punct' && tokens[k]?.value === '}') break;
      k += 1;
    }
    if (tokens[k]?.kind !== 'ident' || tokens[k]?.value !== 'return') continue;
    if (tokens[k + 1]?.kind !== 'ident' || tokens[k + 1]?.value !== 'cardFace') continue;
    if (tokens[k + 2]?.value !== '{') continue;
    const { fields, end } = readObject(tokens, k + 2);
    if (fields.size > 0) continue; // A keyed cardFace is not the upstream shape.
    const first = tokens[k + 3];
    const second = tokens[k + 5];
    if (first?.kind === 'string' && tokens[k + 4]?.value === ',' && second?.kind === 'string') {
      for (const id of cases) pairs.push({ id, icon: second.value });
    }
    i = end;
  }
  return pairs;
};

/** `plugins[].providers[]` with `plugins[].icon` from plugin/market.json. */
export const parseMarketIcons = (text: string): IconPair[] => {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof data !== 'object' || data === null) return [];
  const plugins = (data as { plugins?: unknown }).plugins;
  if (!Array.isArray(plugins)) return [];
  const pairs: IconPair[] = [];
  for (const plugin of plugins) {
    if (typeof plugin !== 'object' || plugin === null) continue;
    const icon = (plugin as { icon?: unknown }).icon;
    const providers = (plugin as { providers?: unknown }).providers;
    if (typeof icon !== 'string' || icon === '' || !Array.isArray(providers)) continue;
    for (const provider of providers) {
      if (typeof provider === 'string' && provider !== '') pairs.push({ id: provider, icon });
    }
  }
  return pairs;
};

const mergePairs = (
  target: Map<string, string>,
  pairs: readonly IconPair[],
  source: string,
  conflicts: IconConflict[],
): number => {
  let count = 0;
  for (const pair of pairs) {
    if (!pair.id || !pair.icon) continue;
    count += 1;
    const kept = target.get(pair.id);
    if (kept === undefined || (kept === 'generic' && pair.icon !== 'generic')) {
      target.set(pair.id, pair.icon);
      continue;
    }
    if (kept !== pair.icon) conflicts.push({ id: pair.id, kept, discarded: pair.icon, source });
  }
  return count;
};

/**
 * Merge the five upstream sources. More specific faces win over presets, and a
 * real mark wins over `generic`; otherwise the first mapping is kept and the
 * conflict is reported.
 */
export const mergeProviderIcons = (input: IconMergeInput): MergedIcons => {
  const icons = new Map<string, string>();
  const conflicts: IconConflict[] = [];
  const counts = {
    accountCards: mergePairs(icons, input.accountCards, 'accountCard', conflicts),
    googleApps: mergePairs(icons, input.googleApps, 'googleApp', conflicts),
    presets: mergePairs(icons, input.presets, 'preset', conflicts),
    agents: mergePairs(icons, input.agents, 'agent', conflicts),
    market: mergePairs(icons, input.market, 'market', conflicts),
  };
  return { icons: Object.fromEntries(icons), conflicts, counts };
};

/** Whether an icon name needs a bitmap fetch after the SVG 404. */
export const iconFileCandidates = (name: string): string[] =>
  name.endsWith('.svg') || name.endsWith('.png')
    ? [name]
    : [`${name}.svg`, `${name}.png`];
