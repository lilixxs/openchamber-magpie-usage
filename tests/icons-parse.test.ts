/**
 * Tests for tools/icons: pure parsing plus the sync engine under an isolated
 * runtime. Everything is offline: the transport serves a simulated yetone/magpie
 * main (contents listings, raw files, icon assets, info/refs, the commits atom
 * feed, and a codeload tar.gz snapshot), the runtime is an in-memory filesystem
 * rooted at an approved temp directory, and no real cache or config directory
 * is touched. Only the preload-lock helpers write real files, inside temporary
 * areas from tests/harness.ts. Importing the preload runs its real top-level
 * conditional sync once per process (reused from the bunfig preload instance);
 * the runPreloadSync tests drive the real engine with injected seams instead.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { makeTempDir, type TempDir } from './harness.ts';
import {
  unquoteGoString,
  tokenizeGo,
  parseStringConstants,
  parsePresetIcons,
  parseAgentIcons,
  parseGoogleAppIcons,
  parseAccountCardIcons,
  parseMarketIcons,
  mergeProviderIcons,
  iconFileCandidates,
  type IconPair,
} from '../tools/icons/parse.ts';
import {
  fetchCommit,
  parseLsRemote,
  parseCache,
  serializeCache,
  emptyCache,
  readCache,
  writeCache,
  type HttpResponse,
  type Runtime,
  type SpawnResult,
  type Transport,
} from '../tools/icons/cache.ts';
import {
  acquireLock,
  releaseLock,
  isLockStale,
  runPreloadSync,
} from '../tools/icons/preload.ts';
import { runIconSync, bundleFromArchive, type SyncOptions } from '../tools/icons/sync.ts';

/* ------------------------------------------------------------------ helpers */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const bytesOf = (text: string): Uint8Array => encoder.encode(text);
const textOf = (bytes: Uint8Array): string => decoder.decode(bytes);

const respond = (
  status: number,
  body: string | Uint8Array,
  headers: Record<string, string> = {},
): HttpResponse => ({
  status,
  headers,
  body: typeof body === 'string' ? bytesOf(body) : body,
});

/** 40 hex characters, deterministic per number. */
const testSha = (n: number): string =>
  (n.toString(16) + '1234567890abcdef'.repeat(6)).slice(0, 40);

/** Realistic SVG document: real root element plus a name marker. */
const svgBody = (name: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1" data-name="${name}"/></svg>`;
const svgBytes = (name: string): Uint8Array => bytesOf(svgBody(name));
/** Real PNG signature; nothing that could pass as HTML. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const pngBytes = (): Uint8Array => new Uint8Array([...PNG_SIGNATURE, 1, 2, 3, 4]);

/* ---------------------------------------------------------------- tartooling */

const tarBlocks = (path: string, data: Uint8Array, type: '0' | 'g' = '0'): Uint8Array[] => {
  const header = new Uint8Array(512);
  const put = (offset: number, text: string): void => {
    header.set(encoder.encode(text).subarray(0, 512 - offset), offset);
  };
  put(0, path);
  put(100, '0000644\0');
  put(108, '0000000\0');
  put(116, '0000000\0');
  put(124, `${data.length.toString(8).padStart(11, '0')}\0`);
  put(136, '00000000000\0');
  header.fill(0x20, 148, 156); // checksum placeholder
  header[156] = type === 'g' ? 0x67 : 0x30; // 'g': pax global header; '0': regular file
  put(257, 'ustar');
  let sum = 0;
  for (const byte of header) sum += byte;
  put(148, `${sum.toString(8).padStart(6, '0')}\0 `);
  const content = new Uint8Array(Math.ceil(data.length / 512) * 512);
  content.set(data);
  return [header, content];
};

/** POSIX pax record whose lengths include the digits, the space and the newline. */
const paxRecord = (comment: string): Uint8Array => {
  let digits = 2;
  for (;;) {
    const length = digits + 1 + 'comment='.length + comment.length + 1;
    if (String(length).length === digits) {
      return bytesOf(`${`${length}`} comment=${comment}\n`);
    }
    digits += 1;
  }
};

const makeArchive = (upstream: Upstream, repoName = 'magpie'): Uint8Array => {
  const blocks: Uint8Array[] = [];
  for (const [path, text] of Object.entries(upstream.files)) {
    if (!path.startsWith('internal/')) continue;
    blocks.push(...tarBlocks(`${repoName}-${upstream.sha}/${path}`, bytesOf(text)));
  }
  blocks.push(new Uint8Array(512), new Uint8Array(512));
  const total = blocks.reduce((length, block) => length + block.length, 0);
  const tar = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    tar.set(block, offset);
    offset += block.length;
  }
  return new Uint8Array(gzipSync(tar));
};

/**
 * A branch tarball: GNU names the root `<repo>-<branch>` with no sha suffix,
 * so `git archive` puts the commit into the pax global header's comment.
 */
const makeBranchArchive = (
  upstream: Upstream,
  rootName: string,
  paxComment: string | undefined,
): Uint8Array => {
  const blocks: Uint8Array[] = [];
  if (paxComment !== undefined) {
    blocks.push(...tarBlocks('pax_global_header', paxRecord(`comment=${paxComment}`), 'g'));
  }
  for (const [path, text] of Object.entries(upstream.files)) {
    if (!path.startsWith('internal/')) continue;
    blocks.push(...tarBlocks(`${rootName}/${path}`, bytesOf(text)));
  }
  blocks.push(new Uint8Array(512), new Uint8Array(512));
  const total = blocks.reduce((length, block) => length + block.length, 0);
  const tar = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    tar.set(block, offset);
    offset += block.length;
  }
  return new Uint8Array(gzipSync(tar));
};

/* simulated upstream -------------------------------------------------------- */

type IconSpec = Uint8Array | 'missing' | number | 'html' | 'badpng';
type Upstream = {
  orders: Record<string, { type: string; name: string; path: string }[]>;
  files: Record<string, string>;
  icons: Record<string, IconSpec>;
  extraHttp?: { infoRefs?: string; atom?: string; archive?: Uint8Array };
  sha: string;
  etag: string;
};

type FixtureMeta = {
  pairs: {
    presets: IconPair[];
    agents: IconPair[];
    googleApps: IconPair[];
    accountCards: IconPair[];
    market: IconPair[];
  };
  requiredNames: string[];
  missing: string[];
};

type Fixture = { upstream: Upstream; meta: FixtureMeta };

type UpstreamOpts = {
  presets: number;
  agents: number;
  market: number;
  sha: number | string;
  iconMode?: 'distinct' | 'shared';
  missing?: readonly string[];
  omitRaw?: readonly string[];
  omitDirs?: readonly string[];
};

const presetIcon = (i: number, mode: 'distinct' | 'shared'): string =>
  mode === 'distinct' ? `icon-${i}` : 'shared-preset';

const buildUpstream = (opts: UpstreamOpts): Fixture => {
  const mode = opts.iconMode ?? 'distinct';
  const sha = typeof opts.sha === 'number' ? testSha(opts.sha) : opts.sha;
  const upstream: Upstream = {
    orders: { 'internal/agent': [], 'internal/provider': [] },
    files: {},
    icons: {},
    sha,
    etag: `w/${sha}`,
  };

  const presetIds: IconPair[] = [];
  const presetsItems: string[] = [];
  for (let i = 0; i < opts.presets; i += 1) {
    const id = `preset-${i}`;
    const icon = presetIcon(i, mode);
    presetIds.push({ id, icon });
    presetsItems.push(`\t{ID: preset${i}ID, Icon: "${icon}", Regions: []Region{{ID: "region-${i}"}}},`);
  }
  upstream.files['internal/provider/presets.go'] = [
    'package provider',
    '',
    'var presets = []PresetDef{',
    ...presetsItems,
    '}',
    '',
  ].join('\n');

  const constLines: string[] = [];
  for (let i = 0; i < opts.presets; i += 1) {
    constLines.push(`\tpreset${i}ID = "preset-${i}"`);
  }
  upstream.files['internal/provider/ids.go'] = [
    'package provider',
    '',
    'const (',
    ...constLines,
    ')',
    '',
  ].join('\n');

  const appIcons = mode === 'distinct' ? ['mail', 'drive'] : ['shared-app', 'shared-app'];
  upstream.files['internal/provider/google.go'] = [
    'package provider',
    '',
    'func googleAppsList() []googleApp {',
    '\treturn []googleApp{',
    `\t\tgoogleApp{agent: "gmail", icon: "${appIcons[0]}"},`,
    `\t\t&googleApp{agent: "drive", icon: "${appIcons[1]}"},`,
    '\t}',
    '}',
    '',
  ].join('\n');

  upstream.files['internal/provider/cards_kept.go'] = [
    'package provider',
    '',
    'func faceFor(agent string) cardFace {',
    '\tswitch agent {',
    '\tcase "claude":',
    '\t\treturn cardFace{"Claude Code", "claude-color"}',
    '\tcase "codex", "copilot":',
    '\t\treturn cardFace{"Codex and Copilot", "codex-color"}',
    '\t}',
    '\treturn cardFace{"Other", "other"}',
    '}',
    '',
  ].join('\n');

  upstream.files['internal/provider/other.go'] =
    'package provider\n\nvar unrelated = struct { Name string }{Name: "x"}\n';

  const agentPairs: IconPair[] = [];
  const agentBody: string[] = [];
  const agentConst: string[] = [];
  for (let i = 0; i < opts.agents; i += 1) {
    const id = `agent-${i}`;
    const icon = mode === 'distinct' ? `agent-${i}` : 'shared-agent';
    agentConst.push(`\tagent${i}ID = "${id}"`);
    agentPairs.push({ id, icon });
    agentBody.push(`\t{ID: agent${i}ID, Icon: "${icon}"},`);
  }
  upstream.files['internal/agent/agents.go'] = [
    'package agent',
    '',
    'const (',
    ...agentConst,
    ')',
    '',
    'var registry = []*Agent{',
    ...agentBody,
    '}',
    '',
  ].join('\n');

  const marketProviders: string[] = [];
  for (let i = 0; i < opts.market; i += 1) {
    marketProviders.push(`market-provider-${i}`);
  }
  const marketIcon = mode === 'distinct' ? 'market-mark' : 'shared-market';
  upstream.files['internal/plugin/market.json'] = JSON.stringify({
    plugins: [
      { id: 'm', icon: marketIcon, providers: marketProviders },
      { icon: 'no-providers' },
      { providers: ['no-icon'] },
    ],
  });

  if (!opts.omitDirs?.includes('internal/agent')) {
    upstream.orders['internal/agent'] = [
      { type: 'file', name: 'agents.go', path: 'internal/agent/agents.go' },
      { type: 'file', name: 'agents_test.go', path: 'internal/agent/agents_test.go' },
    ];
  }
  if (!opts.omitDirs?.includes('internal/provider')) {
    upstream.orders['internal/provider'] = [
      { type: 'file', name: 'cards_kept.go', path: 'internal/provider/cards_kept.go' },
      { type: 'file', name: 'google.go', path: 'internal/provider/google.go' },
      { type: 'file', name: 'ids.go', path: 'internal/provider/ids.go' },
      { type: 'file', name: 'nope_test.go', path: 'internal/provider/nope_test.go' },
      { type: 'file', name: 'other.go', path: 'internal/provider/other.go' },
      { type: 'file', name: 'presets.go', path: 'internal/provider/presets.go' },
    ];
  }

  const required = new Set<string>();
  for (const pair of presetIds) required.add(pair.icon);
  required.add('claude-color');
  required.add('codex-color');
  for (const icon of appIcons) required.add(icon);
  for (const pair of agentPairs) required.add(pair.icon);
  required.add(marketIcon);
  required.add('magpie');
  const missing: string[] = [...(opts.missing ?? [])];
  for (const name of required) {
    if (missing.includes(name)) {
      upstream.icons[`${name}.svg`] = 'missing';
      upstream.icons[`${name}.png`] = 'missing';
      continue;
    }
    if (name === 'magpie') {
      // magpie only exists as a bitmap: exercises svg-404 → png candidate order.
      upstream.icons['magpie.svg'] = 'missing';
      upstream.icons['magpie.png'] = pngBytes();
      continue;
    }
    if (name === 'claude-color') {
      upstream.icons['claude-color.svg'] = svgBytes('claude');
      continue;
    }
    if (name === 'codex-color') {
      upstream.icons['codex-color.svg'] = svgBytes('codex');
      continue;
    }
    upstream.icons[`${name}.svg`] = svgBytes(name);
    upstream.icons[`${name}.png`] = pngBytes();
  }
  for (const raw of opts.omitRaw ?? []) delete upstream.files[raw];

  const meta: FixtureMeta = {
    pairs: {
      presets: presetIds,
      agents: agentPairs,
      googleApps: [
        { id: 'gmail', icon: appIcons[0]! },
        { id: 'drive', icon: appIcons[1]! },
      ],
      accountCards: [
        { id: 'claude', icon: 'claude-color' },
        { id: 'codex', icon: 'codex-color' },
        { id: 'copilot', icon: 'codex-color' },
      ],
      market: marketProviders.map((id) => ({ id, icon: marketIcon })),
    },
    requiredNames: [...required].sort(),
    missing,
  };
  return { upstream, meta };
};

/**
 * Expected counts, derived independently from the fixture's structured data:
 * merge precedence mirrors the documented rule, availability comes from which
 * icon names actually exist, and `generic` never ships. This shares one literal
 * with the builder but never reuses the produced output.
 */
const computeExpected = (meta: FixtureMeta): { downloaded: number; mappings: number } => {
  const available = new Set(meta.requiredNames.filter((name) => !meta.missing.includes(name)));
  const mapping = new Map<string, string>();
  for (const source of [
    meta.pairs.accountCards,
    meta.pairs.googleApps,
    meta.pairs.presets,
    meta.pairs.agents,
    meta.pairs.market,
  ] as const) {
    for (const pair of source) {
      const kept = mapping.get(pair.id);
      if (kept === undefined || (kept === 'generic' && pair.icon !== 'generic')) {
        mapping.set(pair.id, pair.icon);
      }
    }
  }
  let mappings = 0;
  for (const icon of mapping.values()) {
    if (icon !== 'generic' && available.has(icon)) mappings += 1;
  }
  return { downloaded: available.size, mappings };
};

type CommitRoute =
  | { kind: 'ok' }
  | { kind: 'status'; status: number }
  | { kind: 'throw' }
  | { kind: 'conditional'; etag: string; status: number }
  | { kind: 'bad-sha' };

const makeTransport = (upstream: Upstream, commit: CommitRoute) => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const transport: Transport = {
    async get(url, headers = {}) {
      calls.push({ url, headers });
      const commitMatch =
        /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/commits\/([^/?]+)/.exec(url);
      if (commitMatch) {
        if (commit.kind === 'throw') throw new Error('commits offline');
        if (commit.kind === 'status') return respond(commit.status, '{}');
        if (commit.kind === 'conditional') {
          return headers['If-None-Match'] === commit.etag
            ? respond(commit.status, '', { etag: commit.etag })
            : respond(200, JSON.stringify({ sha: upstream.sha }), { etag: upstream.etag });
        }
        if (commit.kind === 'bad-sha') return respond(200, JSON.stringify({ sha: 'zz' }));
        return respond(200, JSON.stringify({ sha: upstream.sha }), { etag: upstream.etag });
      }
      const contentsMatch =
        /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/contents\/([^?]+)\?ref=/.exec(url);
      if (contentsMatch) {
        const dir = decodeURIComponent(contentsMatch[1]!);
        const listing = upstream.orders[dir];
        if (!listing) return respond(404, 'no dir');
        return respond(200, JSON.stringify(listing));
      }
      if (/^https:\/\/github\.com\/[^/]+\/[^/]+\.git\/info\/refs\?service=git-upload-pack$/.test(url)) {
        return upstream.extraHttp?.infoRefs !== undefined
          ? respond(200, upstream.extraHttp.infoRefs)
          : respond(404, '');
      }
      if (/^https:\/\/github\.com\/[^/]+\/[^/]+\/commits\/[^/]+\.atom$/.test(url)) {
        return upstream.extraHttp?.atom !== undefined
          ? respond(200, upstream.extraHttp.atom)
          : respond(404, '');
      }
      if (/^https:\/\/codeload\.github\.com\/[^/]+\/[^/]+\/tar\.gz\//.test(url)) {
        return upstream.extraHttp?.archive !== undefined
          ? respond(200, upstream.extraHttp.archive)
          : respond(404, '');
      }
      const rawMatch =
        /^https:\/\/raw\.githubusercontent\.com\/([0-9A-Za-z_.-]+\/[0-9A-Za-z_.-]+)\/[0-9a-f]{40}\/(.+)$/.exec(url);
      if (rawMatch) {
        const path = rawMatch[2]!;
        const icons = 'internal/gui/assets/icons/';
        if (path.startsWith(icons)) {
          const spec = upstream.icons[path.slice(icons.length)];
          if (spec === 'missing') return respond(404, '');
          if (spec === 'html') return respond(200, '<html><head><title>404</title></head></html>');
          if (spec === 'badpng') return respond(200, 'iVBORwedonotsignPNG');
          if (typeof spec === 'number') return respond(spec, 'oops');
          if (spec) return respond(200, spec);
          return respond(404, '');
        }
        const file = upstream.files[path];
        if (file === undefined) return respond(404, '');
        return respond(200, bytesOf(file));
      }
      return respond(404, '');
    },
  };
  return { transport, calls };
};

/* in-memory runtime, rooted at an approved temp directory --------------------- */

type RuntimeOverrides = {
  pidAlive?: (pid: number) => boolean;
  spawn?: (command: string, args: readonly string[], cwd?: string) => Promise<SpawnResult>;
  statMtimeOffsetMs?: number;
};

/** The fake runtime keeps its own state bookkeeping alongside the Runtime seam. */
type MemoryRuntime = Runtime & {
  files: Map<string, Uint8Array>;
  spawnCalls: { command: string; args: string[]; cwd?: string }[];
  gitLsRemote: SpawnResult | null;
};

const makeRuntime = (
  base: string,
  init: Record<string, string> = {},
  overrides: RuntimeOverrides = {},
): MemoryRuntime => {
  const files = new Map<string, Uint8Array>();
  const spawnCalls: { command: string; args: string[]; cwd?: string }[] = [];
  let clock = 1_700_000_000_000;
  const tick = (): number => {
    clock += 1;
    return clock;
  };
  const write = (key: string, value: Uint8Array): void => {
    tick();
    files.set(key, value);
  };
  for (const [key, value] of Object.entries(init)) files.set(key, bytesOf(value));
  return {
    files,
    spawnCalls,
    gitLsRemote: null,
    cwd: base,
    env: {},
    platform: 'linux',
    now: () => clock,
    async readText(path) {
      const bytes = files.get(path);
      return bytes === undefined ? null : textOf(bytes);
    },
    async readBytes(path) {
      const bytes = files.get(path);
      return bytes === undefined ? null : bytes;
    },
    async writeText(path, value) {
      write(path, bytesOf(value));
    },
    async writeBytes(path, value) {
      write(path, value);
    },
    async stageText(path, value) {
      const temp = `${path}.stage-${clock}`;
      write(temp, bytesOf(value));
      return temp;
    },
    async rename(from, to) {
      const bytes = files.get(from);
      if (bytes === undefined) throw new Error(`rename source missing: ${from}`);
      files.delete(from);
      write(to, bytes);
    },
    async remove(path) {
      tick();
      files.delete(path);
    },
    async mkdirp() {
      // A map needs no directories.
    },
    async stat(path) {
      const bytes = files.get(path);
      return bytes === undefined
        ? null
        : { mtimeMs: clock - (overrides.statMtimeOffsetMs ?? 0), size: bytes.length };
    },
    async createExclusive(path, value) {
      if (files.has(path)) return false;
      write(path, bytesOf(value));
      return true;
    },
    async spawn(command, args, cwd, _timeoutMs) {
      spawnCalls.push({ command, args: [...args], cwd });
      if (overrides.spawn) return overrides.spawn(command, args, cwd);
      if (command === 'git' && args[0] === 'ls-remote') {
        return this.gitLsRemote ?? { code: 1, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
    pidAlive: overrides.pidAlive ?? (() => true),
  };
};

/* approved temp isolation for the whole suite -------------------------------- */

let area: TempDir;
let base = '';
let SHARED = '';
let PANEL = '';
let BUNDLE = '';
let CACHE = '';
let LOCK = '';

beforeAll(() => {
  area = makeTempDir();
  base = area.path;
  // Absolute keys only: no hidden real-cache or relative path resolution.
  SHARED = join(base, 'gen', 'shared.generated.ts');
  PANEL = join(base, 'gen', 'panel.generated.ts');
  BUNDLE = join(base, 'panel', 'main.js');
  CACHE = join(base, 'state', 'commit.json');
  LOCK = join(base, 'state', 'sync.lock');
});

afterAll(() => {
  area?.dispose();
});

const BUILD = ['bun', 'run', 'build:panel'] as const;

const syncOptions = (
  running: MemoryRuntime,
  transport: Transport,
  overrides: Partial<SyncOptions> = {},
): SyncOptions => ({
  transport,
  runtime: running,
  buildCommand: BUILD,
  sharedPath: SHARED,
  panelPath: PANEL,
  panelBundlePath: BUNDLE,
  cachePath: CACHE,
  lockPath: LOCK,
  lockWaitMs: 0,
  ...overrides,
});

const readGenerated = (running: MemoryRuntime, path: string): string =>
  running.files.has(path) ? textOf(running.files.get(path)!) : '';

const bunBuilds = (running: MemoryRuntime): number =>
  running.spawnCalls.filter((call) => call.command === 'bun').length;

const sharedEntries = (text: string): [string, string][] => {
  const match = /export const PROVIDER_ICONS[\s\S]*?\{\n([\s\S]*?)\n\};/.exec(text);
  expect(match).not.toBeNull();
  return [...match![1]!.matchAll(/^  "([^"]+)": "([^"]+)",$/gm)].map(
    (entry) => [entry[1]!, entry[2]!] as [string, string],
  );
};

const baseFixture = buildUpstream({ presets: 40, agents: 30, market: 10, sha: 1 });

/* ------------------------------------------------- real fixtures: pure parse */

const fixtureDir = join(import.meta.dir, 'fixtures', 'icons');
const presetsFixture = readFileSync(join(fixtureDir, 'presets.go'), 'utf8');
const agentsFixture = readFileSync(join(fixtureDir, 'agents.go'), 'utf8');
const googleCardsFixture = readFileSync(join(fixtureDir, 'google_cards.go'), 'utf8');
const marketFixture = readFileSync(join(fixtureDir, 'market.json'), 'utf8');

describe('parsers: real tests/fixtures/icons files', () => {
  test('presets.go: constants resolve; comments and strings never become presets', () => {
    const constants = parseStringConstants([presetsFixture]);
    expect(constants.get('VertexPreset')).toBe('google-vertex');
    expect(parsePresetIcons(presetsFixture, constants)).toEqual([
      { id: 'anthropic', icon: 'claude-color' },
      { id: 'google-vertex', icon: 'vertexai-color' },
      { id: 'typesafe', icon: 'typesafe' },
    ]);
  });

  test('agents.go: nested literals ignored; const ids resolve; unresolved dropped', () => {
    const constants = parseStringConstants([agentsFixture]);
    expect(constants.get('CursorLocalID')).toBe('cursor-local');
    expect(constants.get('ScienceID')).toBeUndefined();
    expect(parseAgentIcons(agentsFixture, constants)).toEqual([
      { id: 'magpie', icon: 'magpie' },
      { id: 'raft', icon: 'generic' },
      { id: 'codex', icon: 'codex-color' },
      { id: 'cursor-local', icon: 'cursor' },
    ]);
  });

  test('google_cards.go: googleApps parsed via keyword; keyed cardFace rejected', () => {
    expect(parseGoogleAppIcons(googleCardsFixture)).toEqual([
      { id: 'gemini', icon: 'geminicli-color' },
      { id: 'antigravity', icon: 'antigravity-color' },
    ]);
    expect(parseAccountCardIcons(googleCardsFixture)).toEqual([
      { id: 'claude', icon: 'claude-color' },
      { id: 'codex', icon: 'codex-color' },
      { id: 'copilot', icon: 'githubcopilot' },
    ]);
  });

  test('market.json: provider lists inherit the plugin icon', () => {
    expect(parseMarketIcons(marketFixture)).toEqual([
      { id: 'opencode-zen-free', icon: 'opencode' },
      { id: 'opencode-zen', icon: 'opencode' },
      { id: 'workbuddy', icon: 'workbuddy-color' },
      { id: 'workbuddy-ai', icon: 'workbuddy-color' },
    ]);
  });

  test('all four fixtures merge without conflicts; ghost ids never surface', () => {
    const merged = mergeProviderIcons({
      presets: parsePresetIcons(presetsFixture, parseStringConstants([presetsFixture])),
      agents: parseAgentIcons(agentsFixture, parseStringConstants([agentsFixture])),
      googleApps: parseGoogleAppIcons(googleCardsFixture),
      accountCards: parseAccountCardIcons(googleCardsFixture),
      market: parseMarketIcons(marketFixture),
    });
    expect(merged.counts).toEqual({
      accountCards: 3,
      googleApps: 2,
      presets: 3,
      agents: 4,
      market: 4,
    });
    expect(merged.icons).toEqual({
      anthropic: 'claude-color',
      'google-vertex': 'vertexai-color',
      typesafe: 'typesafe',
      gemini: 'geminicli-color',
      antigravity: 'antigravity-color',
      claude: 'claude-color',
      codex: 'codex-color',
      copilot: 'githubcopilot',
      magpie: 'magpie',
      raft: 'generic',
      'cursor-local': 'cursor',
      'opencode-zen-free': 'opencode',
      'opencode-zen': 'opencode',
      workbuddy: 'workbuddy-color',
      'workbuddy-ai': 'workbuddy-color',
    });
    expect(merged.conflicts).toEqual([]);
    expect(merged.icons['ScienceID']).toBeUndefined();
  });
});

/* ----------------------------------------------------------- pure: lexical */

describe('parse: lexical layer', () => {
  test('unquoteGoString decodes escapes, keeps unknown escapes verbatim', () => {
    expect(unquoteGoString('a\\tb\\"\\u4e2d')).toBe('a\tb"中');
    expect(unquoteGoString('x\\q')).toBe('xq');
  });

  test('tokenizeGo drops comments and keeps string bodies as single tokens', () => {
    const tokens = tokenizeGo('s := "}{ " /* } */ // }\nnum := 42');
    expect(tokens.map((token) => token.kind)).toEqual([
      'ident', 'punct', 'punct', 'string', 'ident', 'punct', 'punct', 'number',
    ]);
    expect(tokens.find((token) => token.kind === 'string')!.value).toBe('}{ ');
    expect(tokens.some((token) => token.kind === 'punct' && token.value === '{')).toBe(false);
  });

  test('parseStringConstants reads single consts and const blocks', () => {
    const constants = parseStringConstants([
      'package p\nconst Alpha = "a"\nconst Beta string = "b"\n',
      'package p\nconst (\n\tGamma = "g"\n\tDelta string = "d"\n)\n',
    ]);
    expect(constants.get('Alpha')).toBe('a');
    expect(constants.get('Beta')).toBe('b');
    expect(constants.get('Gamma')).toBe('g');
    expect(constants.get('Delta')).toBe('d');
  });
});

/* ---------------------------------------------------- synthetic upstream: pure */

describe('synthetic upstream: shapes and merge rule', () => {
  test('presets parse top-level ID/Icon while Region inner IDs stay ignored', () => {
    const source = [
      'package provider',
      '',
      'const constID = "const-preset"',
      '',
      'var presets = []PresetDef{',
      '\t{ID: "plain", Icon: "plain-icon"},',
      '\t// } brace inside a comment',
      '\t{ID: "broken", Icon: "str-}{"},',
      '\t{ID: "with-region", Icon: "region-icon", Regions: []Region{{ID: "inner-id"}}},',
      '\t{ID: constID, Icon: "const-icon"},',
      '\t{ID: "no-icon"},',
      '\t{"raw", "positional"},',
      '}',
    ].join('\n');
    expect(parsePresetIcons(source, parseStringConstants([source]))).toEqual([
      { id: 'plain', icon: 'plain-icon' },
      { id: 'broken', icon: 'str-}{' },
      { id: 'with-region', icon: 'region-icon' },
      { id: 'const-preset', icon: 'const-icon' },
    ]);
  });

  test("a source without a `presets =` slice yields no pairs", () => {
    expect(parsePresetIcons('package p\n\nvar other = 1\n')).toEqual([]);
  });

  test('generic loses silently; other conflicts are reported with their source', () => {
    const merged = mergeProviderIcons({
      presets: [
        { id: 'g', icon: 'generic' },
        { id: 'h', icon: 'preset-h' },
        { id: 'same', icon: 'kept' },
      ],
      agents: [
        { id: 'g', icon: 'agent-real' },
        { id: 'h', icon: 'agent-h' },
        { id: 'same', icon: 'kept' },
      ],
      googleApps: [],
      accountCards: [{ id: 'h', icon: 'card-h' }],
      market: [],
    });
    expect(merged.icons).toEqual({ g: 'agent-real', h: 'card-h', same: 'kept' });
    expect(merged.conflicts).toEqual([
      { id: 'h', kept: 'card-h', discarded: 'preset-h', source: 'preset' },
      { id: 'h', kept: 'card-h', discarded: 'agent-h', source: 'agent' },
    ]);
    expect(merged.counts).toEqual({
      accountCards: 1,
      googleApps: 0,
      presets: 3,
      agents: 3,
      market: 0,
    });
  });

  test('iconFileCandidates: bare name tries svg then png; extension pins the list', () => {
    expect(iconFileCandidates('mark')).toEqual(['mark.svg', 'mark.png']);
    expect(iconFileCandidates('mark.svg')).toEqual(['mark.svg']);
    expect(iconFileCandidates('mark.png')).toEqual(['mark.png']);
  });
});

/* ------------------------------------------------------------ cache layer */

describe('cache plumbing', () => {
  test('parseCache is tolerant; serialize is stable and ordered', () => {
    expect(parseCache(null)).toEqual({});
    expect(parseCache('junk')).toEqual({});
    expect(parseCache('[1]')).toEqual({});
    expect(parseCache('{"etag":"e","sha":"s","nonsense":1}')).toEqual({ etag: 'e', sha: 's' });
    parseCache(
      serializeCache({ etag: 'e', sha: 's', generatedSha: 'g' }),
    );
    const runtime = makeRuntime(base);
    writeCache(runtime, { etag: 'e', sha: 's' }, CACHE);
    expect(readCache(runtime, CACHE)).resolves.toEqual({ etag: 'e', sha: 's' });
    expect(serializeCache(emptyCache())).toBe('{}\n');
  });

  test('fetchCommit sends If-None-Match and handles 304/200', async () => {
    const seen: Record<string, string | undefined>[] = [];
    let call = 0;
    const transport: Transport = {
      async get(_url, headers = {}) {
        seen.push({ ...headers });
        call += 1;
        if (call === 1) return respond(304, '', { etag: 'w/old' });
        return respond(200, JSON.stringify({ sha: testSha(7) }), { etag: 'w/new' });
      },
    };
    const first = await fetchCommit(transport, 'yetone/magpie', 'main', 'w/old');
    expect(first).toEqual({ status: 304, etag: 'w/old' });
    const second = await fetchCommit(transport, 'yetone/magpie', 'main');
    expect(second).toEqual({ status: 200, sha: testSha(7), etag: 'w/new' });
    expect(seen[0]!['If-None-Match']).toBe('w/old');
  });

  test('fetchCommit ignores malformed sha bodies', async () => {
    const badSha: Transport = { async get() { return respond(200, '{"sha":"zz"}'); } };
    expect(await fetchCommit(badSha, 'yetone/magpie', 'main')).toEqual({ status: 200 });
    const noJson: Transport = { async get() { return respond(200, 'no json'); } };
    expect((await fetchCommit(noJson, 'yetone/magpie', 'main')).sha).toBeUndefined();
  });

  test('parseLsRemote only takes refs/heads lines', () => {
    const stdout = [
      `${'a'.repeat(40)}\trefs/tags/v1`,
      `${'b'.repeat(40)}\trefs/heads/main`,
      'garbage',
    ].join('\n');
    expect(parseLsRemote(stdout)).toBe('b'.repeat(40));
    expect(parseLsRemote('')).toBeUndefined();
  });
});

/* ------------------------------------------- sync engine: resolution branches */

describe('sync engine: resolution, fallback, lock', () => {
  test('conditional 304 after a complete generation skips without any source fetch', async () => {
    const { upstream } = baseFixture;
    const { transport } = makeTransport(upstream, { kind: 'ok' });
    const runtime = makeRuntime(base);
    await runIconSync(syncOptions(runtime, transport));
    expect(runtime.files.has(SHARED)).toBe(true);
    expect(runtime.files.has(PANEL)).toBe(true);

    const { transport: transport304, calls } = makeTransport(upstream, {
      kind: 'conditional', etag: upstream.etag, status: 304,
    });
    const result = await runIconSync(syncOptions(runtime, transport304));
    expect(result.status).toBe('skipped');
    expect(result.sha).toBe(upstream.sha);
    expect(calls.filter((entry) => entry.url.startsWith('https://raw.githubusercontent.com/')))
      .toHaveLength(0);
    expect(bunBuilds(runtime)).toBe(1);
  });

  test('unconditional 200 whose sha equals the committed generation also skips', async () => {
    const { upstream } = baseFixture;
    const { transport } = makeTransport(upstream, { kind: 'ok' });
    const runtime = makeRuntime(base);
    await runIconSync(syncOptions(runtime, transport));
    const { transport: transportAgain } = makeTransport(upstream, { kind: 'ok' });
    const result = await runIconSync(syncOptions(runtime, transportAgain));
    expect(result.status).toBe('skipped');
    expect(result.sha).toBe(upstream.sha);
  });

  test('a shared-only generated file is not a complete skip state', async () => {
    const { upstream } = baseFixture;
    const { transport } = makeTransport(upstream, { kind: 'ok' });
    const runtime = makeRuntime(base, {
      [SHARED]: `export const SOURCE_SHA = "${upstream.sha}";`,
    });
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.status).not.toBe('skipped');
    expect(runtime.files.has(PANEL)).toBe(true);
  });

  test('a shared/panel sha mismatch is not a complete pair either', async () => {
    const { upstream } = baseFixture;
    const other = buildUpstream({ presets: 40, agents: 30, market: 10, sha: 33 });
    const { transport } = makeTransport(upstream, { kind: 'ok' });
    const runtime = makeRuntime(base, {
      [SHARED]: `export const SOURCE_SHA = "${upstream.sha}";`,
      [PANEL]: `/**\n * Upstream: yetone/magpie@${other.upstream.sha}\n */\nexport type GeneratedLogo = {};`,
    });
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.status).not.toBe('skipped');
    expect(runtime.files.has(PANEL)).toBe(true);
  });

  test('commits 403 falls back to git ls-remote and completes', async () => {
    const { upstream } = baseFixture;
    const { transport } = makeTransport(upstream, { kind: 'status', status: 403 });
    const runtime = makeRuntime(base);
    runtime.gitLsRemote = { code: 0, stdout: `${upstream.sha}\trefs/heads/main\n`, stderr: '' };
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.status).toBe('updated');
    expect(result.sha).toBe(upstream.sha);
    expect(runtime.spawnCalls.some((call) => call.command === 'git' && call.args[0] === 'ls-remote'))
      .toBe(true);
    expect(bunBuilds(runtime)).toBe(1);
  });

  test('a 200 commits body without a parseable sha falls back to git too', async () => {
    const { upstream } = baseFixture;
    const { transport } = makeTransport(upstream, { kind: 'bad-sha' });
    const runtime = makeRuntime(base);
    runtime.gitLsRemote = { code: 0, stdout: `${upstream.sha}\trefs/heads/main\n`, stderr: '' };
    expect((await runIconSync(syncOptions(runtime, transport))).status).toBe('updated');
  });

  test('commits 403 plus a dead git resolves through the info/refs advertisement', async () => {
    const fixture = buildUpstream({ presets: 40, agents: 30, market: 10, sha: 50 });
    fixture.upstream.extraHttp = {
      infoRefs: `${'0'.repeat(4)}${fixture.upstream.sha} refs/heads/main\0`,
    };
    const { transport } = makeTransport(fixture.upstream, { kind: 'status', status: 403 });
    const runtime = makeRuntime(base);
    runtime.gitLsRemote = { code: 1, stdout: '', stderr: 'no network' };
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.status).toBe('updated');
    expect(result.sha).toBe(fixture.upstream.sha);
    expect(bunBuilds(runtime)).toBe(1);
  });

  test('with git and info/refs down the atom feed resolves the sha', async () => {
    const fixture = buildUpstream({ presets: 40, agents: 30, market: 10, sha: 51 });
    fixture.upstream.extraHttp = {
      atom: `<entry><id>tag:github.com,2008:Grit::Commit/${fixture.upstream.sha}</id></entry>`,
    };
    const { transport } = makeTransport(fixture.upstream, { kind: 'status', status: 403 });
    const runtime = makeRuntime(base);
    runtime.gitLsRemote = { code: 1, stdout: '', stderr: 'no network' };
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.status).toBe('updated');
    expect(result.sha).toBe(fixture.upstream.sha);
    expect(bunBuilds(runtime)).toBe(1);
  });

  test('all four resolvers down keeps a complete committed pair (fallback)', async () => {
    const { upstream } = baseFixture;
    const { transport, calls } = makeTransport(upstream, { kind: 'throw' });
    const runtime = makeRuntime(base);
    const { transport: okTransport } = makeTransport(upstream, { kind: 'ok' });
    await runIconSync(syncOptions(runtime, okTransport));
    const sharedBefore = readGenerated(runtime, SHARED);
    runtime.gitLsRemote = { code: 1, stdout: '', stderr: 'no network' };

    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.status).toBe('fallback');
    expect(result.sha).toBe(upstream.sha);
    expect(result.built).toBe(false);
    expect(result.warnings).toEqual([`keeping committed generated pair ${upstream.sha}: upstream unavailable: Error: commits offline`]);
    expect(calls.filter((entry) => entry.url.includes('/contents/') ||
      entry.url.includes('raw.githubusercontent.com'))).toHaveLength(0);
    expect(readGenerated(runtime, SHARED)).toBe(sharedBefore);
  });

  test('all resolvers down without committed files fails loudly', async () => {
    const { upstream } = baseFixture;
    const { transport } = makeTransport(upstream, { kind: 'throw' });
    const runtime = makeRuntime(base);
    runtime.gitLsRemote = { code: 1, stdout: '', stderr: 'no network' };
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('no committed generated files');
    expect(runtime.files.has(SHARED)).toBe(false);
    expect(runtime.files.has(PANEL)).toBe(false);
  });

  test('a live lock holds: the run returns locked and writes nothing', async () => {
    const { upstream } = baseFixture;
    const { transport } = makeTransport(upstream, { kind: 'ok' });
    const runtime = makeRuntime(base, {
      [LOCK]: JSON.stringify({ pid: process.pid, token: 'other', startedAt: 1 }),
    });
    runtime.files.set(SHARED, bytesOf('old'));
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.status).toBe('locked');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(`another sync/preload still holds ${LOCK}`);
    expect(readGenerated(runtime, SHARED)).toBe('old');
    expect(runtime.files.has(CACHE)).toBe(false);
  });

  test('a dead-pid lock is reclaimed; the run completes and releases its own lock', async () => {
    const { upstream } = baseFixture;
    const { transport } = makeTransport(upstream, { kind: 'ok' });
    const runtime = makeRuntime(base, {
      [LOCK]: JSON.stringify({ pid: 999_999, token: 'ghost', startedAt: 1 }),
    }, { pidAlive: () => false });
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.status).toBe('updated');
    expect(bunBuilds(runtime)).toBe(1);
    expect(runtime.files.has(LOCK)).toBe(false);
  });

  test('an expired pid-less lock is reclaimed by mtime alone', async () => {
    const { upstream } = baseFixture;
    const { transport } = makeTransport(upstream, { kind: 'ok' });
    const runtime = makeRuntime(base, {
      [LOCK]: 'not json', // no usable pid: only age can prove abandonment
    }, { statMtimeOffsetMs: 16 * 60 * 1000 });
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.status).toBe('updated');
    expect(runtime.files.has(LOCK)).toBe(false);
  });

  test('a slow-but-live pid is never reclaimed by its mtime', async () => {
    const { upstream } = baseFixture;
    const { transport } = makeTransport(upstream, { kind: 'ok' });
    const runtime = makeRuntime(base, {
      [LOCK]: JSON.stringify({ pid: process.pid, token: 'slow-run', startedAt: 1 }),
    }, { statMtimeOffsetMs: 3 * 60 * 60 * 1000 }); // hours old, but the pid lives
    runtime.files.set(SHARED, bytesOf('old'));
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.status).toBe('locked');
    expect(readGenerated(runtime, SHARED)).toBe('old');
  });

  test('concurrent runs contend for one lock: the loser goes locked and the retry skips', async () => {
    const { upstream } = baseFixture;
    const { transport } = makeTransport(upstream, { kind: 'ok' });
    // Gate the winner's very first request so its lock window is definite;
    // the loser starts while that gate is closed, waits on state, not timing.
    let releaseGate: () => void = () => undefined;
    const opened = new Promise<void>((resolve) => { releaseGate = resolve; });
    let probeCalls = 0;
    const gatedTransport: Transport = {
      async get(url, headers = {}) {
        probeCalls += 1;
        if (probeCalls === 1) await opened;
        return transport.get(url, headers);
      },
    };
    const runtime = makeRuntime(base);
    const winner = runIconSync(syncOptions(runtime, gatedTransport));
    while (!runtime.files.has(LOCK)) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    releaseGate();

    const loser = await runIconSync(syncOptions(runtime, transport, { lockWaitMs: 0 }));
    expect(loser.status).toBe('locked');
    expect(loser.warnings).toHaveLength(1);
    expect(loser.warnings[0]).toContain(`another sync/preload still holds ${LOCK}`);
    // The loser wrote nothing: the winner's generation is still in flight.
    expect(runtime.files.has(SHARED)).toBe(false);

    const result = await winner;
    expect(result.status).toBe('updated');
    expect(result.built).toBe(true);

    // The retry now finds the complete pair at the same upstream sha and skips.
    const retry = await runIconSync(syncOptions(runtime, transport));
    expect(retry.status).toBe('skipped');
    // Exactly one generation and one build across the entire sequence.
    expect(bunBuilds(runtime)).toBe(1);
  });
});

/* ------------------------------------------------------- generation end-to-end */

describe('sync engine: generation', () => {
  test('full upstream builds once; output stable, sorted, timestamp-free; byte-identical reruns', async () => {
    const { upstream, meta } = baseFixture;
    const expected = computeExpected(meta);
    const { transport, calls } = makeTransport(upstream, { kind: 'ok' });

    const runtime = makeRuntime(base);
    const firstRun = await runIconSync(syncOptions(runtime, transport));
    expect(firstRun.status).toBe('updated');
    expect(firstRun.built).toBe(true);
    expect(firstRun.sha).toBe(upstream.sha);
    expect(firstRun.counts?.presets).toBe(meta.pairs.presets.length);
    expect(firstRun.counts?.agents).toBe(meta.pairs.agents.length);
    expect(firstRun.counts?.marketProviders).toBe(
      new Set(meta.pairs.market.map((pair) => pair.id)).size,
    );
    expect(firstRun.counts?.downloadedIcons).toBe(expected.downloaded);
    expect(firstRun.counts?.providerIcons).toBe(expected.mappings);
    expect(firstRun.warnings).toEqual([]);
    expect(bunBuilds(runtime)).toBe(1);

    const sharedText = readGenerated(runtime, SHARED);
    const panelText = readGenerated(runtime, PANEL);

    expect(sharedText.startsWith('/**\n * Generated by tools/icons/sync.ts from yetone/magpie main.'))
      .toBe(true);
    expect(sharedText).toContain(`Upstream: yetone/magpie@${upstream.sha}`);
    expect(sharedText).toContain(`export const SOURCE_SHA = "${upstream.sha}"`);
    for (const text of [sharedText, panelText]) {
      expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(text).not.toContain('Date');
    }

    const entries = sharedEntries(sharedText);
    const keys = entries.map(([id]) => id);
    expect(keys).toEqual([...keys].sort((left, right) => left.localeCompare(right)));
    const byKey = new Map(entries);
    expect(byKey.get('preset-0')).toBe('icon-0');
    expect(byKey.get('preset-39')).toBe('icon-39');
    expect(byKey.get('agent-5')).toBe('agent-5');
    expect(byKey.get('claude')).toBe('claude-color');
    expect(byKey.get('codex')).toBe('codex-color');
    expect(byKey.get('gmail')).toBe('mail');
    expect(byKey.get('market-provider-3')).toBe('market-mark');
    expect(byKey.size).toBe(expected.mappings);

    // png asset becomes a data URL; svg stays inline text; color flags follow rules.
    expect(panelText).toContain('export type GeneratedLogo =');
    expect(panelText).toContain('data:image/png;base64,');
    expect(panelText).toContain(Buffer.from(pngBytes()).toString('base64'));
    expect(panelText).toContain(`color: false, svg: ${JSON.stringify(svgBody('icon-0'))}`);
    expect(panelText).toContain(`color: true, svg: ${JSON.stringify(svgBody('claude'))}`);
    expect(panelText).toContain('color: true, dataUrl:');
    expect(panelText).toContain('"magpie.png"');

    // magpie has no svg: candidates tried svg then png, in that order.
    const magpieCalls = calls.filter((entry) => entry.url.includes('icons/magpie.'));
    expect(magpieCalls.map((entry) => (entry.url.endsWith('magpie.svg') ? 'svg' : 'png')))
      .toEqual(['svg', 'png']);

    // Same upstream on a fresh runtime yields byte-identical files.
    const second = makeRuntime(base);
    const secondOptions = syncOptions(second, transport);
    secondOptions.sharedPath = SHARED;
    secondOptions.panelPath = PANEL;
    await runIconSync(secondOptions);
    expect(readGenerated(second, SHARED)).toBe(sharedText);
    expect(readGenerated(second, PANEL)).toBe(panelText);

    // Same runtime again: the skip-check precedes the content comparison, so
    // only a forced run can reach the "unchanged" branch.
    runtime.gitLsRemote = { code: 0, stdout: `${upstream.sha}\trefs/heads/main\n`, stderr: '' };
    const secondRun = await runIconSync(syncOptions(runtime, transport, { force: true }));
    expect(secondRun.status).toBe('unchanged');
    expect(secondRun.built).toBe(false);
    expect(bunBuilds(runtime)).toBe(1);
  });

  test('changed upstream triggers exactly one more build with the new sha', async () => {
    const { transport: transport1 } = makeTransport(baseFixture.upstream, { kind: 'ok' });
    const runtime = makeRuntime(base);
    await runIconSync(syncOptions(runtime, transport1));
    expect(bunBuilds(runtime)).toBe(1);

    const second = buildUpstream({ presets: 40, agents: 30, market: 10, sha: 2 });
    second.upstream.files['internal/provider/presets.go'] =
      second.upstream.files['internal/provider/presets.go']!.replace(
        'Icon: "icon-0"', 'Icon: "icon-0-renamed"');
    delete second.upstream.icons['icon-0.svg'];
    second.upstream.icons['icon-0-renamed.svg'] = svgBytes('renamed');
    const { transport: transport2 } = makeTransport(second.upstream, { kind: 'ok' });

    const rebuilt = await runIconSync(syncOptions(runtime, transport2));
    expect(rebuilt.status).toBe('updated');
    expect(rebuilt.sha).toBe(testSha(2));
    expect(bunBuilds(runtime)).toBe(2);
    expect(readGenerated(runtime, SHARED)).toContain(`SOURCE_SHA = "${testSha(2)}"`);
    expect(readGenerated(runtime, SHARED)).toContain('"preset-0": "icon-0-renamed"');
  });
});

/* ------------------------------------------------------------ force behavior */

describe('sync engine: force does not touch the commits API', () => {
  test('force with identical upstream lands on unchanged without another build', async () => {
    const { upstream } = baseFixture;
    const { transport, calls } = makeTransport(upstream, { kind: 'ok' });
    const runtime = makeRuntime(base);
    await runIconSync(syncOptions(runtime, transport));
    expect(bunBuilds(runtime)).toBe(1);

    runtime.gitLsRemote = { code: 0, stdout: `${upstream.sha}\trefs/heads/main\n`, stderr: '' };
    const forced = await runIconSync(syncOptions(runtime, transport, { force: true }));
    expect(forced.status).toBe('unchanged');
    expect(forced.built).toBe(false);
    expect(forced.sha).toBe(upstream.sha);
    expect(bunBuilds(runtime)).toBe(1);
    expect(calls.filter((entry) => entry.url.includes('/commits/'))).toHaveLength(1); // only the first, non-forced run
  });

  test('force resolves via git and regenerates even when the sha was already generated', async () => {
    const { transport: transport1 } = makeTransport(baseFixture.upstream, { kind: 'ok' });
    const runtime = makeRuntime(base);
    await runIconSync(syncOptions(runtime, transport1));
    expect(runtime.files.has(SHARED)).toBe(true);

    const second = buildUpstream({ presets: 40, agents: 30, market: 10, sha: 3 });
    const { transport: transport2, calls } = makeTransport(second.upstream, { kind: 'ok' });
    runtime.gitLsRemote = { code: 0, stdout: `${second.upstream.sha}\trefs/heads/main\n`, stderr: '' };
    const result = await runIconSync(syncOptions(runtime, transport2, { force: true }));
    expect(result.status).toBe('updated');
    expect(result.sha).toBe(second.upstream.sha);
    expect(bunBuilds(runtime)).toBe(2);
    expect(calls.filter((entry) => entry.url.includes('/commits/'))).toHaveLength(0);
  });

  test('force with every resolver down keeps the complete committed pair', async () => {
    const { upstream } = baseFixture;
    const runtime = makeRuntime(base);
    const { transport: okTransport } = makeTransport(upstream, { kind: 'ok' });
    await runIconSync(syncOptions(runtime, okTransport));

    const { transport, calls } = makeTransport(upstream, { kind: 'throw' });
    runtime.gitLsRemote = { code: 1, stdout: '', stderr: 'no network' };
    const result = await runIconSync(syncOptions(runtime, transport, { force: true }));
    expect(result.status).toBe('fallback');
    expect(result.sha).toBe(upstream.sha);
    // Force never calls the commits API; the atom URL merely contains a
    // '/commits/' substring, so filter on the api.github.com host too.
    expect(calls.filter((entry) =>
      entry.url.includes('api.github.com') && entry.url.includes('/commits/'))).toHaveLength(0);
  });
});

/* -------------------------------------------- strict self-checks and floors */

describe('sync engine: strict self-check floors', () => {
  const failingFixture = (
    overrides: Partial<UpstreamOpts>,
  ): { upstream: Upstream; meta: FixtureMeta; transport: Transport; runtime: MemoryRuntime } => {
    const fixture = buildUpstream({
      presets: 40, agents: 30, market: 10, sha: 9, iconMode: 'shared', ...overrides,
    });
    const { transport } = makeTransport(fixture.upstream, { kind: 'ok' });
    return { ...fixture, transport, runtime: makeRuntime(base) };
  };

  test('presets 39 fails at its floor and writes nothing', async () => {
    const { transport, runtime } = failingFixture({ presets: 39 });
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('sync failed: self-check: presets 39 < 40');
    expect(runtime.files.has(SHARED)).toBe(false);
    expect(runtime.files.has(PANEL)).toBe(false);
  });

  test('agents 29 fails at its floor', async () => {
    const { transport, runtime } = failingFixture({ agents: 29 });
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.reason).toBe('sync failed: self-check: agents 29 < 30');
  });

  test('market providers with icons 9 fails at its floor', async () => {
    const { transport, runtime } = failingFixture({ market: 9 });
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.reason).toBe('sync failed: self-check: market providers with icons 9 < 10');
  });

  test('downloaded icons below 40 fails with the compact shared-icon fixture', async () => {
    const { meta, transport, runtime } = failingFixture({});
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.reason).toBe(
      `sync failed: self-check: downloaded icons ${computeExpected(meta).downloaded} < 40`,
    );
    expect(bunBuilds(runtime)).toBe(0);
  });

  test('the magpie asset is required: its double 404 fails the whole run', async () => {
    const fixture = buildUpstream({ presets: 40, agents: 30, market: 10, sha: 14, missing: ['magpie'] });
    const { transport } = makeTransport(fixture.upstream, { kind: 'ok' });
    const runtime = makeRuntime(base);
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('sync failed: self-check: required icon missing: magpie');
    expect(runtime.files.has(SHARED)).toBe(false);
    expect(runtime.files.has(PANEL)).toBe(false);
  });

  test('a double-404 regular icon drops its mapping with one aggregated warning', async () => {
    const fixture = buildUpstream({ presets: 40, agents: 30, market: 10, sha: 4, missing: ['icon-5'] });
    const { transport } = makeTransport(fixture.upstream, { kind: 'ok' });
    const runtime = makeRuntime(base);
    const collected: string[] = [];
    const ok = await runIconSync(syncOptions(runtime, transport, {
      // The publish path emits every collected warning at most once.
      noBuild: false,
      ...{ onWarning: (message) => { collected.push(message); } } as Partial<SyncOptions>,
    }));
    expect(ok.status).toBe('updated');
    expect(ok.warnings).toEqual([
      'missing upstream icons (their provider mappings were dropped): icon-5',
    ]);
    expect(collected).toHaveLength(1);
    expect(collected[0]).toContain('missing upstream icons');
    const availableAfterDrop = fixture.meta.requiredNames.filter((name) => name !== 'icon-5').length;
    expect(ok.counts?.downloadedIcons).toBe(availableAfterDrop);
    expect(ok.counts?.providerIcons).toBe(computeExpected(fixture.meta).mappings);
    const byKey = new Map(sharedEntries(readGenerated(runtime, SHARED)));
    expect(byKey.has('preset-5')).toBe(false);
    expect(byKey.has('preset-6')).toBe(true);
  });

  test('a failed run persists the seen sha but never a generatedSha or manifest paths', async () => {
    const { upstream, transport, runtime } = failingFixture({ sha: 11 });
    await runIconSync(syncOptions(runtime, transport));
    const cacheText = readGenerated(runtime, CACHE);
    expect(JSON.parse(cacheText).sha).toBe(upstream.sha);
    expect(cacheText.includes('generatedSha')).toBe(false);
    // The manifest of generated paths is only written by a successful run.
    expect(cacheText.includes('generatedFiles')).toBe(false);
    expect(JSON.parse(cacheText).generatedFiles).toBeUndefined();
  });

  test('after a failed generation the same sha is retried, not skipped', async () => {
    const { transport, runtime } = failingFixture({ sha: 12 });
    await runIconSync(syncOptions(runtime, transport));
    const again = await runIconSync(syncOptions(runtime, transport));
    expect(again.status).toBe('failed');
    expect(again.reason).toContain('self-check: downloaded icons');
    expect(bunBuilds(runtime)).toBe(0);
    expect(runtime.files.has(SHARED)).toBe(false);
  });

  test('a failing new sha over committed files leaves the previous generation', async () => {
    const committed = buildUpstream({ presets: 40, agents: 30, market: 10, sha: 20 });
    const { transport: okTransport } = makeTransport(committed.upstream, { kind: 'ok' });
    const runtime = makeRuntime(base);
    await runIconSync(syncOptions(runtime, okTransport));
    expect(runtime.files.has(SHARED)).toBe(true);
    const before = readGenerated(runtime, SHARED);

    const failing = buildUpstream({ presets: 39, agents: 30, market: 10, sha: 21, iconMode: 'shared' });
    const { transport: badTransport } = makeTransport(failing.upstream, { kind: 'ok' });
    const result = await runIconSync(syncOptions(runtime, badTransport));
    expect(result.status).toBe('failed');
    expect(readGenerated(runtime, SHARED)).toBe(before);
  });
});

/* ------------------------------------------- upstream read/download failures */

describe('sync engine: upstream read failures keep files intact', () => {
  test('a dead directory listing leaves no agent sources and fails the floor', async () => {
    const fixture = buildUpstream({
      presets: 40, agents: 30, market: 10, sha: 5, omitDirs: ['internal/agent'],
    });
    const { transport } = makeTransport(fixture.upstream, { kind: 'ok' });
    const runtime = makeRuntime(base);
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.status).toBe('failed');
    // The listing contract makes every agent source vanish, so the agent floor
    // fires first; nothing is published.
    expect(result.reason).toBe('sync failed: self-check: agents 0 < 30');
    expect(runtime.files.has(SHARED)).toBe(false);
    expect(runtime.files.has(PANEL)).toBe(false);
  });

  test('a required raw file 404 fails the run after the codeload probe', async () => {
    const fixture = buildUpstream({
      presets: 40, agents: 30, market: 10, sha: 6,
      omitRaw: ['internal/plugin/market.json'],
    });
    const { transport } = makeTransport(fixture.upstream, { kind: 'ok' });
    const runtime = makeRuntime(base, { [SHARED]: 'old-shared', [PANEL]: 'old-panel' });
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('codeload');
    expect(result.reason).toContain('no committed generated files with a matching source sha');
    expect(readGenerated(runtime, SHARED)).toBe('old-shared');
    expect(readGenerated(runtime, PANEL)).toBe('old-panel');
  });

  test('a non-404 error while downloading an icon fails before any publish', async () => {
    const fixture = buildUpstream({ presets: 40, agents: 30, market: 10, sha: 7 });
    fixture.upstream.icons['icon-0.svg'] = 503;
    const { transport } = makeTransport(fixture.upstream, { kind: 'ok' });
    const runtime = makeRuntime(base, { [SHARED]: 'old-shared', [PANEL]: 'old-panel' });
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('sync failed: icon icon-0.svg returned 503; no committed generated files with a matching source sha');
    expect(readGenerated(runtime, SHARED)).toBe('old-shared');
    expect(readGenerated(runtime, PANEL)).toBe('old-panel');
  });

  test('a status-0 icon response is treated as a non-404 failure', async () => {
    const fixture = buildUpstream({ presets: 40, agents: 30, market: 10, sha: 8 });
    fixture.upstream.icons['icon-3.svg'] = 0;
    const { transport } = makeTransport(fixture.upstream, { kind: 'ok' });
    const runtime = makeRuntime(base);
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('sync failed: icon icon-3.svg returned 0; no committed generated files with a matching source sha');
    expect(runtime.files.has(SHARED)).toBe(false);
    expect(runtime.files.has(CACHE)).toBe(true);
  });

  test('an HTML body served for an icon is rejected', async () => {
    const fixture = buildUpstream({ presets: 40, agents: 30, market: 10, sha: 17 });
    fixture.upstream.icons['icon-1.svg'] = 'html';
    const { transport } = makeTransport(fixture.upstream, { kind: 'ok' });
    const runtime = makeRuntime(base);
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('invalid SVG body');
    expect(runtime.files.has(SHARED)).toBe(false);
  });

  test('a body without the PNG signature is rejected', async () => {
    const fixture = buildUpstream({ presets: 40, agents: 30, market: 10, sha: 18 });
    fixture.upstream.icons['icon-1.svg'] = 'missing';
    fixture.upstream.icons['icon-1.png'] = 'badpng';
    const { transport } = makeTransport(fixture.upstream, { kind: 'ok' });
    const runtime = makeRuntime(base);
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('invalid PNG body');
    expect(runtime.files.has(SHARED)).toBe(false);
  });
});

/* ------------------------------------------------- codeload snapshot fallback */

describe('sync engine: codeload snapshot fallback', () => {
  test('with commits, git, info/refs and atom all down, the tar.gz snapshot generates', async () => {
    const { upstream, meta } = baseFixture;
    const expected = computeExpected(meta);
    const fixture = buildUpstream({ presets: 40, agents: 30, market: 10, sha: upstream.sha });
    fixture.upstream.extraHttp = { archive: makeArchive(fixture.upstream) };
    const { transport, calls } = makeTransport(fixture.upstream, { kind: 'status', status: 403 });
    const runtime = makeRuntime(base);
    runtime.gitLsRemote = { code: 1, stdout: '', stderr: 'no network' };
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.status).toBe('updated');
    expect(result.sha).toBe(upstream.sha);
    expect(result.counts?.presets).toBe(meta.pairs.presets.length);
    expect(result.counts?.downloadedIcons).toBe(expected.downloaded);
    expect(calls.filter((entry) => entry.url.includes('/contents/'))).toHaveLength(0);
    expect(calls.some((entry) => entry.url.includes('codeload.github.com'))).toBe(true);
    expect(bunBuilds(runtime)).toBe(1);
  });

  test('the archive root name supplies the snapshot sha and relative paths', () => {
    const fixture = buildUpstream({ presets: 40, agents: 30, market: 10, sha: 19 });
    // The snapshot sha comes from the archive root, not from the transport's
    // commit route: the resolver takes whatever the snapshot reports.
    const bundle = bundleFromArchive('yetone/magpie', makeArchive(fixture.upstream));
    expect(bundle.sha).toBe(fixture.upstream.sha);
    expect(bundle.texts.get('internal/provider/presets.go')).toBe(
      fixture.upstream.files['internal/provider/presets.go'],
    );
    expect(bundle.texts.get('internal/plugin/market.json')).toBe(
      fixture.upstream.files['internal/plugin/market.json'],
    );
    expect(bundle.agentFiles).toEqual(['internal/agent/agents.go']);
    expect(bundle.providerFiles).toEqual([
      'internal/provider/cards_kept.go',
      'internal/provider/google.go',
      'internal/provider/ids.go',
      'internal/provider/other.go',
      'internal/provider/presets.go',
    ]);
    // Test sources are excluded from the snapshot bundle.
    expect(bundle.agentFiles.some((path) => path.endsWith('_test.go'))).toBe(false);
  });

  test('a non-gzip codeload body and an empty archive are rejected', () => {
    const fixture = buildUpstream({ presets: 40, agents: 30, market: 10, sha: 19 });
    expect(() => bundleFromArchive('yetone/magpie', bytesOf('<html>not gzip</html>')))
      .toThrow('codeload archive is not gzip');
    const archive = new Uint8Array(gzipSync(new Uint8Array(1024).fill(0)));
    expect(() => bundleFromArchive('yetone/magpie', archive))
      .toThrow('codeload archive is empty');
  });

  test('a branch archive carries the commit only in the pax global comment', () => {
    const snapshotSha = testSha(60);
    const fixture = buildUpstream({ presets: 40, agents: 30, market: 10, sha: 60 });
    const bundle = bundleFromArchive(
      'yetone/magpie',
      makeBranchArchive(fixture.upstream, 'magpie-main', snapshotSha),
    );
    expect(bundle.sha).toBe(snapshotSha);
    expect(bundle.texts.get('internal/provider/presets.go')).toBe(
      fixture.upstream.files['internal/provider/presets.go'],
    );
    expect(bundle.texts.get('internal/plugin/market.json')).toBe(
      fixture.upstream.files['internal/plugin/market.json'],
    );
    expect(bundle.providerFiles).toContain('internal/provider/ids.go');
    // Without a pax comment, a sha-less branch root must be refused outright.
    const shaless = makeBranchArchive(fixture.upstream, 'magpie-main', undefined);
    expect(() => bundleFromArchive('yetone/magpie', shaless))
      .toThrow('codeload archive has no commit sha');
  });

  test('a branch codeload snapshot wins when commits, git, refs and atom are down', async () => {
    const snapshotSha = testSha(61);
    const fixture = buildUpstream({ presets: 40, agents: 30, market: 10, sha: 61 });
    const meta = fixture.meta;
    fixture.upstream.extraHttp = {
      archive: makeBranchArchive(fixture.upstream, 'magpie-main', snapshotSha),
    };
    const { transport, calls } = makeTransport(fixture.upstream, { kind: 'status', status: 403 });
    const runtime = makeRuntime(base);
    runtime.gitLsRemote = { code: 1, stdout: '', stderr: 'no network' };
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.status).toBe('updated');
    expect(result.sha).toBe(snapshotSha);
    expect(result.counts?.presets).toBe(meta.pairs.presets.length);
    expect(calls.filter((entry) => entry.url.includes('codeload.github.com'))).toHaveLength(1);
    expect(calls.some((entry) => entry.url.includes('.atom'))).toBe(true);
    expect(bunBuilds(runtime)).toBe(1);
    // The published pair is pinned to the snapshot's sha, not the branch name.
    expect(readGenerated(runtime, SHARED)).toContain(`SOURCE_SHA = "${snapshotSha}"`);
  });
});

/* ------------------------------------------------------------ build rollback */

describe('sync engine: build failure rollback', () => {
  const failingBuild = (): RuntimeOverrides['spawn'] => async (command) =>
    command === 'bun'
      ? { code: 1, stdout: '', stderr: 'boom' }
      : { code: 0, stdout: '', stderr: '' };

  test('a failing bundler restores generated files and the panel bundle', async () => {
    const fixture = buildUpstream({ presets: 40, agents: 30, market: 10, sha: 22 });
    const { transport } = makeTransport(fixture.upstream, { kind: 'ok' });
    const previousBundle = new Uint8Array([9, 8, 7]);
    const runtime = makeRuntime(
      base,
      { [SHARED]: 'old-shared', [PANEL]: 'old-panel' },
      { spawn: (command) =>
          command === 'bun'
            ? Promise.resolve<{ code: number; stdout: string; stderr: string }>({ code: 1, stdout: '', stderr: 'boom' })
            : Promise.resolve({ code: 0, stdout: '', stderr: '' }) },
    );
    runtime.files.set(BUNDLE, previousBundle);

    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('sync failed: write/build failed: build failed (1): boom');
    expect(result.built).toBe(false);
    expect(readGenerated(runtime, SHARED)).toBe('old-shared');
    expect(readGenerated(runtime, PANEL)).toBe('old-panel');
    expect(runtime.files.get(BUNDLE)).toEqual(previousBundle);
  });

  test('a failing first build removes both generated files entirely', async () => {
    const { transport } = makeTransport(baseFixture.upstream, { kind: 'ok' });
    const runtime = makeRuntime(base, {}, { spawn: failingBuild() });
    const result = await runIconSync(syncOptions(runtime, transport));
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('build failed');
    expect(runtime.files.has(SHARED)).toBe(false);
    expect(runtime.files.has(PANEL)).toBe(false);
    expect(runtime.files.has(BUNDLE)).toBe(false);
  });

  test('a failed panel rename rolls the pair and bundle back byte-for-byte, then recovers', async () => {
    // A complete committed pair plus a staged bundle; the next upstream sha
    // changes both generated files, so the publish involves two renames.
    const committed = buildUpstream({ presets: 40, agents: 30, market: 10, sha: 30 });
    const runtime = makeRuntime(base);
    const { transport: okTransport } = makeTransport(committed.upstream, { kind: 'ok' });
    await runIconSync(syncOptions(runtime, okTransport));
    const previousShared = readGenerated(runtime, SHARED);
    const previousPanel = readGenerated(runtime, PANEL);
    const previousBundle = new Uint8Array([1, 2, 3, 4]);
    runtime.files.set(BUNDLE, previousBundle);

    const changed = buildUpstream({ presets: 40, agents: 30, market: 10, sha: 31 });
    const { transport: changedTransport } = makeTransport(changed.upstream, { kind: 'ok' });
    const realRename = runtime.rename.bind(runtime);
    let renames = 0;
    runtime.rename = async (from: string, to: string): Promise<void> => {
      renames += 1;
      if (renames === 2) throw new Error('injected panel rename failure'); // panel publish is rename #2
      return realRename(from, to);
    };
    const result = await runIconSync(syncOptions(runtime, changedTransport));
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('sync failed: write/build failed: injected panel rename failure');
    // Both generated files return to the previous bytes; the bundle is never touched.
    expect(readGenerated(runtime, SHARED)).toBe(previousShared);
    expect(readGenerated(runtime, PANEL)).toBe(previousPanel);
    expect(runtime.files.get(BUNDLE)).toEqual(previousBundle);

    // Once the fault clears, the same upstream publishes without leftovers.
    runtime.rename = realRename;
    const retry = await runIconSync(syncOptions(runtime, changedTransport));
    expect(retry.status).toBe('updated');
    expect(retry.built).toBe(true);
    expect(readGenerated(runtime, SHARED)).toContain(`SOURCE_SHA = "${changed.upstream.sha}"`);
    expect(readGenerated(runtime, PANEL)).toContain(`Upstream: yetone/magpie@${changed.upstream.sha}`);
  });
});

/* ------------------------------------------------------------- preload lock */

describe('preload lock helpers (real temp dirs)', () => {
  const areas: TempDir[] = [];

  afterAll(() => {
    for (const dir of areas.splice(0)) dir.dispose();
  });

  test('isLockStale: a live pid owns the lock no matter how old the mtime is', () => {
    const dir = areas[areas.push(makeTempDir()) - 1]!.path;
    const path = join(dir, 'live.lock');
    writeFileSync(path, JSON.stringify({ pid: process.pid, token: 'slow', startedAt: 0 }));
    const farFuture = () => Date.now() + 10 * 60 * 60 * 1000;
    expect(isLockStale(path, { now: farFuture })).toBe(false);
  });

  test('isLockStale: a dead pid is stale even when the mtime is fresh', () => {
    const dir = areas[areas.push(makeTempDir()) - 1]!.path;
    const path = join(dir, 'dead.lock');
    writeFileSync(path, JSON.stringify({ pid: -1, token: 'ghost', startedAt: 0 }));
    expect(isLockStale(path)).toBe(true);
  });

  test('acquire creates the lock; a live foreign lock blocks; no lock file leaks', () => {
    const dir = areas[areas.push(makeTempDir()) - 1]!.path;
    const path = join(dir, 'first.lock');
    expect(existsSync(path)).toBe(false);
    const first = acquireLock(path);
    expect(first).not.toBeNull();
    expect(existsSync(path)).toBe(true);
    const blocked = acquireLock(path, { onWarning: () => undefined });
    expect(blocked).toBeNull();
    releaseLock(first);
    expect(existsSync(path)).toBe(false);
  });

  test('a dead-pid lock is reclaimed by acquire', () => {
    const dir = areas[areas.push(makeTempDir()) - 1]!.path;
    const path = join(dir, 'second.lock');
    writeFileSync(path, JSON.stringify({ pid: -1, token: 'ghost', startedAt: 1 }));
    const reclaimed = acquireLock(path);
    expect(reclaimed).not.toBeNull();
    releaseLock(reclaimed);
  });

  test('release is a no-op when the on-disk token belongs to someone else', () => {
    const dir = areas[areas.push(makeTempDir()) - 1]!.path;
    const path = join(dir, 'third.lock');
    const handle = acquireLock(path);
    expect(handle).not.toBeNull();
    writeFileSync(path, JSON.stringify({ pid: process.pid, token: 'someone-else' }));
    releaseLock(handle);
    expect(existsSync(path)).toBe(true);
  });
});

/* -------------------------------------------------------- runPreloadSync contract */

describe('runPreloadSync (injectable, offline)', () => {
  test('disabled short-circuits without touching the sync', async () => {
    let runs = 0;
    const run = async (): Promise<never> => {
      runs += 1;
      throw new Error('must not run');
    };
    expect(await runPreloadSync({ run, disabled: true, warn: () => undefined })).toBeNull();
    expect(runs).toBe(0);
  });

  test('the helper calls run exactly once and aggregates warnings into one line', async () => {
    let runs = 0;
    const seenOptions: SyncOptions[] = [];
    const warnCalls: string[] = [];
    const result = await runPreloadSync({
      run: async (options) => {
        runs += 1;
        seenOptions.push(options);
        return {
          status: 'failed',
          reason: 'self-check failure reason',
          built: false,
          warnings: ['missing upstream icons', 'missing upstream icons', 'cache write failed'],
        };
      },
      warn: (message) => { warnCalls.push(message); },
    });
    expect(runs).toBe(1);
    expect(seenOptions).toHaveLength(1);
    expect(result?.status).toBe('failed');
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]).toBe(
      'missing upstream icons; cache write failed; self-check failure reason',
    );
  });

  test('a thrown run is reported once and never blocks the tests', async () => {
    const warnCalls: string[] = [];
    const result = await runPreloadSync({
      run: async () => {
        throw new Error('kaboom');
      },
      warn: (message) => { warnCalls.push(message); },
    });
    expect(result).toBeNull();
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]).toBe('preload icon sync failed: kaboom');
  });

  test('a locked run with an incomplete pair names the missing deliverable', async () => {
    const runtime = makeRuntime(base, {
      [SHARED]: `export const SOURCE_SHA = "${testSha(31)}";`, // panel missing
    });
    const warnCalls: string[] = [];
    const result = await runPreloadSync({
      run: async () => ({ status: 'locked', built: false, warnings: [] }),
      sync: { runtime, sharedPath: SHARED, panelPath: PANEL },
      warn: (message) => { warnCalls.push(message); },
    });
    expect(result?.status).toBe('locked');
    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]).toBe(
      'generated icon pair is incomplete while another sync holds the lock',
    );
  });

  test('a locked run over a complete pair stays silent', async () => {
    const runtime = makeRuntime(base, {
      [SHARED]: `export const SOURCE_SHA = "${testSha(32)}";`,
      [PANEL]: `/**\n * Upstream: yetone/magpie@${testSha(32)}\n */`,
    });
    const warnCalls: string[] = [];
    const result = await runPreloadSync({
      run: async () => ({ status: 'locked', built: false, warnings: [] }),
      sync: { runtime, sharedPath: SHARED, panelPath: PANEL },
      warn: (message) => { warnCalls.push(message); },
    });
    expect(result?.status).toBe('locked');
    expect(warnCalls).toHaveLength(0);
  });

  test('changed upstream through the preload builds panel once and never spawns bun test', async () => {
    // Seed a complete committed pair for the old upstream first.
    const old = buildUpstream({ presets: 40, agents: 30, market: 10, sha: 41 });
    const runtime = makeRuntime(base);
    const { transport: oldTransport } = makeTransport(old.upstream, { kind: 'ok' });
    await runIconSync(syncOptions(runtime, oldTransport));
    const bunSpawnsBefore = runtime.spawnCalls.filter((call) => call.command === 'bun').length;

    // The changed upstream: preload drives the REAL engine (no injected run).
    const changed = buildUpstream({ presets: 40, agents: 30, market: 10, sha: 42 });
    changed.upstream.files['internal/provider/presets.go'] =
      changed.upstream.files['internal/provider/presets.go']!.replace(
        'Icon: "icon-1"', 'Icon: "icon-1-renamed"');
    delete changed.upstream.icons['icon-1.svg'];
    changed.upstream.icons['icon-1-renamed.svg'] = svgBytes('renamed');
    const { transport, calls } = makeTransport(changed.upstream, { kind: 'ok' });

    const warnCalls: string[] = [];
    const result = await runPreloadSync({
      sync: syncOptions(runtime, transport),
      warn: (message) => { warnCalls.push(message); },
    });
    expect(result?.status).toBe('updated');
    expect(result?.built).toBe(true);
    expect(result?.sha).toBe(changed.upstream.sha);
    expect(warnCalls).toHaveLength(0);
    // One check is one commits request: the helper ran the sync exactly once.
    expect(calls.filter((entry) =>
      entry.url.includes('api.github.com') && entry.url.includes('/commits/'))).toHaveLength(1);

    // Exactly one new bundler spawn, and its arguments are `run build:panel`.
    const newBunSpawns = runtime.spawnCalls
      .filter((call) => call.command === 'bun')
      .slice(bunSpawnsBefore);
    expect(newBunSpawns).toHaveLength(1);
    expect(newBunSpawns[0]!.args).toEqual(['run', 'build:panel']);
    // And no spawn ever starts a nested `bun test`.
    expect(runtime.spawnCalls.some((call) =>
      call.command === 'bun' && call.args[0] === 'test')).toBe(false);

    // The published pair is complete and pinned to the changed sha.
    expect(readGenerated(runtime, SHARED)).toContain(`SOURCE_SHA = "${changed.upstream.sha}"`);
    expect(readGenerated(runtime, PANEL)).toContain(`Upstream: yetone/magpie@${changed.upstream.sha}`);
  });
});
