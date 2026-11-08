/**
 * Generate the committed provider-icon tables from yetone/magpie main.
 *
 * The CLI is deliberately small: resolve main's sha (commits API + ETag,
 * falling back to `git ls-remote`), read only the Go/JSON sources the tables
 * need, download only the icons those sources name, validate the result, then
 * replace the two generated files atomically. A failed run restores the last
 * usable generated files (and panel bundle) instead of leaving a partial
 * update behind. `runIconSync` takes transport/runtime seams so it can be
 * exercised offline.
 */

import { gunzipSync } from 'node:zlib';

import {
  iconFileCandidates,
  mergeProviderIcons,
  parseAccountCardIcons,
  parseAgentIcons,
  parseGoogleAppIcons,
  parseMarketIcons,
  parsePresetIcons,
  parseStringConstants,
  type IconPair,
} from './parse.ts';
import {
  CACHE_FILE,
  SYNC_LOCK,
  createFetchTransport,
  createRuntime,
  fetchCommit,
  parseLsRemote,
  readCache,
  writeCache,
  type Runtime,
  type Transport,
} from './cache.ts';

export { SYNC_LOCK } from './cache.ts';
export type {
  CacheState,
  HttpResponse,
  Runtime,
  Transport,
} from './cache.ts';

export const REPO = 'yetone/magpie';
export const BRANCH = 'main';
export const SHARED_GENERATED = 'src/shared/provider-icons.generated.ts';
export const PANEL_GENERATED = 'src/panel/logos.generated.ts';
export const PANEL_BUNDLE = 'panel/main.js';
/** Bundler runs are bounded; a timeout kills the whole child tree first. */
export const BUILD_TIMEOUT_MS = 120_000;

/**
 * Assets the panel needs even when no upstream source names them: the two card
 * faces, and `magpie` for the config template's `~keys` default. The `~keys`
 * provider id is deliberately not added to PROVIDER_ICONS; only the real asset
 * is downloaded from upstream.
 */
const REQUIRED_ICONS = ['claude-color', 'codex-color', 'magpie'] as const;

export type SyncStatus =
  | 'skipped'
  | 'updated'
  | 'unchanged'
  | 'fallback'
  | 'failed'
  | 'locked';

export type SyncCounts = {
  presets: number;
  agents: number;
  marketProviders: number;
  downloadedIcons: number;
  providerIcons: number;
};

export type SyncResult = {
  status: SyncStatus;
  sha?: string;
  reason?: string;
  counts?: SyncCounts;
  bytes?: { shared: number; panel: number };
  built: boolean;
  warnings: string[];
};

export type SyncOptions = {
  transport?: Transport;
  runtime?: Runtime;
  repo?: string;
  branch?: string;
  force?: boolean;
  /** Bootstrap only: generate files without running `bun run build:panel`. */
  noBuild?: boolean;
  concurrency?: number;
  sharedPath?: string;
  panelPath?: string;
  panelBundlePath?: string;
  cachePath?: string;
  lockPath?: string;
  /** How long to wait for the preload/another sync to release the lock. */
  lockWaitMs?: number;
  buildCommand?: readonly string[];
  /** Per-request network timeout; the test preload uses a short one. */
  fetchTimeoutMs?: number;
  /** Bound for `git ls-remote`; the test preload uses a short one. */
  gitTimeoutMs?: number;
  /** Collect and emit warnings once, after the run. */
  onWarning?: (message: string) => void;
  /** Progress lines; the test preload silences them. */
  onLog?: (message: string) => void;
};

type Logger = (message: string) => void;

type Asset = {
  name: string;
  kind: 'svg' | 'png';
  bytes: Uint8Array;
};

/** A source snapshot, pinned to one commit sha. */
type SourceBundle = {
  sha: string;
  agentFiles: string[];
  providerFiles: string[];
  texts: Map<string, string>;
};

type GeneratedPair = {
  complete: boolean;
  sha?: string;
  shared: string | null;
  panel: string | null;
};

/** A generation floor/required-asset failure must not be hidden by fallback. */
class SelfCheckError extends Error {}

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

const compareText = (left: string | null, right: string): boolean => left === right;

const escapeForSingleLine = (value: string): string => JSON.stringify(value);

/** Code-point order, independent of the machine's locale. */
const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const sortedRecord = (record: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(record).sort(([left], [right]) => compareStrings(left, right)));

const rawUrl = (repo: string, sha: string, path: string): string =>
  `https://raw.githubusercontent.com/${repo}/${sha}/${path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')}`;

const contentsUrl = (repo: string, sha: string, path: string): string =>
  `https://api.github.com/repos/${repo}/contents/${path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')}?ref=${encodeURIComponent(sha)}`;

const apiHeaders = (): Record<string, string> => ({
  Accept: 'application/vnd.github+json',
  'User-Agent': 'openchamber-magpie-usage-icons',
  'X-GitHub-Api-Version': '2022-11-28',
});

/** Run `worker` over `items` with a bounded number in flight. */
export const mapLimit = async <T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
  return results;
};

const fetchText = async (
  transport: Transport,
  url: string,
  headers?: Record<string, string>,
): Promise<{ status: number; text: string; bytes: Uint8Array; headers: Record<string, string> }> => {
  const response = await transport.get(url, headers);
  return {
    status: response.status,
    text: decode(response.body),
    bytes: response.body,
    headers: response.headers,
  };
};

const listDirectory = async (
  transport: Transport,
  repo: string,
  sha: string,
  path: string,
): Promise<string[]> => {
  const response = await fetchText(transport, contentsUrl(repo, sha, path), apiHeaders());
  if (response.status !== 200) {
    throw new Error(`contents ${path} returned ${response.status}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(response.text);
  } catch {
    throw new Error(`contents ${path} is not JSON`);
  }
  if (!Array.isArray(data)) throw new Error(`contents ${path} is not a directory listing`);
  const files: string[] = [];
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as { type?: unknown; name?: unknown; path?: unknown };
    if (record.type !== 'file' || typeof record.name !== 'string') continue;
    if (!record.name.endsWith('.go') || record.name.endsWith('_test.go')) continue;
    if (typeof record.path === 'string') files.push(record.path);
  }
  return files.sort();
};

const fetchRaw = async (
  transport: Transport,
  repo: string,
  sha: string,
  path: string,
  optional = false,
): Promise<string | null> => {
  const response = await fetchText(transport, rawUrl(repo, sha, path), {
    'User-Agent': 'openchamber-magpie-usage-icons',
  });
  if (response.status === 404 && optional) return null;
  if (response.status !== 200) throw new Error(`raw ${path} returned ${response.status}`);
  return response.text;
};

const cString = (bytes: Uint8Array, start: number, length: number): string => {
  let end = start;
  const limit = Math.min(bytes.length, start + length);
  while (end < limit && bytes[end] !== 0) end += 1;
  return decode(bytes.subarray(start, end));
};

const parseOctal = (bytes: Uint8Array, start: number, length: number): number => {
  const text = cString(bytes, start, length).trim();
  return text === '' ? 0 : Number.parseInt(text, 8) || 0;
};

const parsePax = (text: string): Record<string, string> => {
  const records: Record<string, string> = {};
  let offset = 0;
  while (offset < text.length) {
    const space = text.indexOf(' ', offset);
    if (space === -1) break;
    const length = Number.parseInt(text.slice(offset, space), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = text.slice(offset, offset + length);
    const equal = record.indexOf('=');
    if (equal !== -1) {
      const key = record.slice(space - offset + 1, equal);
      records[key] = record.slice(equal + 1).replace(/\n$/, '');
    }
    offset += length;
  }
  return records;
};

type TarEntry = {
  path: string;
  data: Uint8Array;
};

type TarRead = {
  entries: TarEntry[];
  /** `git archive` puts the commit sha in the pax global header's comment. */
  globalComment?: string;
};

const readTar = (bytes: Uint8Array): TarRead => {
  const entries: TarEntry[] = [];
  let offset = 0;
  let longPath: string | undefined;
  let paxPath: string | undefined;
  let globalComment: string | undefined;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = parseOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] ?? 0);
    const name = cString(header, 0, 100);
    const prefix = cString(header, 345, 155);
    const headerPath = prefix ? `${prefix}/${name}` : name;
    const dataStart = offset + 512;
    const data = bytes.subarray(dataStart, dataStart + size);
    if (type === 'L') {
      longPath = decode(data).replace(/\0+$/, '');
    } else if (type === 'x' || type === 'g') {
      const pax = parsePax(decode(data));
      if (pax.path) paxPath = pax.path;
      if (pax.comment) globalComment = pax.comment;
    } else if (type === '0' || type === '\0') {
      entries.push({ path: longPath ?? paxPath ?? headerPath, data: new Uint8Array(data) });
      longPath = undefined;
      paxPath = undefined;
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return { entries, globalComment };
};

/** Minimal ustar/pax reader: GitHub codeload archives use these headers. */
export const parseTar = (bytes: Uint8Array): TarEntry[] => readTar(bytes).entries;

export const archiveUrl = (repo: string, ref: string): string =>
  `https://codeload.github.com/${repo}/tar.gz/${
    /^[0-9a-f]{40}$/.test(ref) ? ref : `refs/heads/${ref}`
  }`;

const archiveHeaders = (): Record<string, string> => ({
  Accept: 'application/x-gzip',
  'User-Agent': 'openchamber-magpie-usage-icons',
});

/**
 * Read one codeload snapshot. GitHub names the root `<repo>-<sha>`; the sha is
 * read from that root, so the archive cannot silently mix two commits.
 */
export const bundleFromArchive = (repo: string, bytes: Uint8Array): SourceBundle => {
  let tar: Uint8Array;
  try {
    tar = new Uint8Array(gunzipSync(bytes));
  } catch {
    throw new Error('codeload archive is not gzip');
  }
  const { entries, globalComment } = readTar(tar);
  if (entries.length === 0) throw new Error('codeload archive is empty');
  const first = entries[0]!.path.replace(/^\.\//, '');
  const root = first.split('/')[0] ?? '';
  // Branch archives are named `<repo>-<branch>`; commit archives end in the
  // sha, and git archive's pax global header carries the sha either way.
  const rootSha = /([0-9a-f]{40})$/.exec(root)?.[1];
  const headerSha = globalComment ? /([0-9a-f]{40})/.exec(globalComment)?.[1] : undefined;
  const sha = rootSha ?? headerSha;
  if (!sha) throw new Error('codeload archive has no commit sha');
  if (root === '') throw new Error('codeload archive has no root directory');
  const prefix = `${root}/`;
  const texts = new Map<string, string>();
  for (const entry of entries) {
    const path = entry.path.replace(/^\.\//, '');
    if (!path.startsWith(prefix)) continue;
    const relative = path.slice(prefix.length);
    const isGoSource =
      (relative.startsWith('internal/agent/') || relative.startsWith('internal/provider/')) &&
      relative.endsWith('.go') &&
      !relative.endsWith('_test.go');
    if (isGoSource || relative === 'internal/plugin/market.json') {
      texts.set(relative, decode(entry.data));
    }
  }
  if (texts.size === 0) throw new Error('codeload archive has no source files');
  return {
    sha,
    agentFiles: [...texts.keys()]
      .filter((path) => path.startsWith('internal/agent/'))
      .sort(),
    providerFiles: [...texts.keys()]
      .filter((path) => path.startsWith('internal/provider/'))
      .sort(),
    texts,
  };
};

const loadBundleViaArchive = async (
  transport: Transport,
  repo: string,
  ref: string,
): Promise<SourceBundle> => {
  const response = await transport.get(archiveUrl(repo, ref), archiveHeaders());
  if (response.status !== 200) throw new Error(`codeload ${ref} returned ${response.status}`);
  return bundleFromArchive(repo, response.body);
};

const loadBundleViaContents = async (
  transport: Transport,
  repo: string,
  sha: string,
  concurrency: number,
): Promise<SourceBundle> => {
  const [agentFiles, providerFiles] = await Promise.all([
    listDirectory(transport, repo, sha, 'internal/agent'),
    listDirectory(transport, repo, sha, 'internal/provider'),
  ]);
  const paths = [
    ...agentFiles,
    ...providerFiles,
    'internal/provider/presets.go',
    'internal/plugin/market.json',
  ];
  const unique = [...new Set(paths)].sort();
  const values = await mapLimit(unique, concurrency, async (path) => ({
    path,
    text: (await fetchRaw(transport, repo, sha, path)) ?? '',
  }));
  return {
    sha,
    agentFiles,
    providerFiles,
    texts: new Map(values.map((value) => [value.path, value.text])),
  };
};

/**
 * Sources for a full generation. A codeload snapshot pinned to the same sha is
 * the fallback when the contents API is unavailable; a failure in both is an
 * upstream error, and the caller then keeps the last complete pair.
 */
const loadBundle = async (args: {
  transport: Transport;
  repo: string;
  sha: string;
  concurrency: number;
  snapshot?: SourceBundle;
  log: Logger;
}): Promise<SourceBundle> => {
  if (args.snapshot) {
    if (args.snapshot.sha !== args.sha) {
      throw new Error(`snapshot sha ${args.snapshot.sha} != ${args.sha}`);
    }
    return args.snapshot;
  }
  try {
    return await loadBundleViaContents(args.transport, args.repo, args.sha, args.concurrency);
  } catch (contentsError) {
    args.log(`contents unavailable (${(contentsError as Error).message}); trying codeload ${args.sha}`);
    const archive = await loadBundleViaArchive(args.transport, args.repo, args.sha);
    if (archive.sha !== args.sha) {
      throw new Error(`codeload sha ${archive.sha} != ${args.sha}`);
    }
    return archive;
  }
};

const headerComment = (sha: string): string =>
  [
    '/**',
    ' * Generated by tools/icons/sync.ts from yetone/magpie main.',
    ` * Upstream: yetone/magpie@${sha}`,
    ' * The icons belong to their respective owners; magpie\'s icon set is MIT.',
    ' * Do not edit by hand.',
    ' */',
  ].join('\n');

const buildSharedSource = (
  sha: string,
  providerIcons: Record<string, string>,
  iconNames: readonly string[],
): string => {
  const sortedIcons = sortedRecord(providerIcons);
  const lines = [
    headerComment(sha),
    '',
    `export const SOURCE_SHA = ${escapeForSingleLine(sha)};`,
    '',
    'export const ICON_NAMES: readonly string[] = [',
    ...iconNames.map((name) => `  ${escapeForSingleLine(name)},`),
    '];',
    '',
    'export const PROVIDER_ICONS: Readonly<Record<string, string>> = {',
    ...Object.entries(sortedIcons).map(
      ([id, icon]) => `  ${escapeForSingleLine(id)}: ${escapeForSingleLine(icon)},`,
    ),
    '};',
    '',
  ];
  return lines.join('\n');
};

/**
 * Generated logo keys. Every bitmap gets its extensionless name plus a
 * `<name>.png` alias, because `logoFor` tries id, id-color, then id.png. SVGs
 * get only their extensionless name: a `.png` alias on an SVG would make the
 * colour rule ambiguous. ICON_NAMES and GENERATED_LOGOS both use this exact
 * list so a name can never be present in one and absent from the other.
 */
const generatedLogoKeys = (assets: readonly Asset[]): string[] => {
  const keys = new Set(assets.map((asset) => asset.name));
  for (const asset of assets) {
    if (asset.kind !== 'png' || asset.name.endsWith('.png')) continue;
    const alias = `${asset.name}.png`;
    if (!keys.has(alias)) keys.add(alias);
  }
  return [...keys].sort(compareStrings);
};

const buildPanelSource = (sha: string, assets: readonly Asset[]): string => {
  const sorted = [...assets].sort((left, right) => compareStrings(left.name, right.name));
  const declarations: string[] = [];
  const variables = new Map<string, string>();

  sorted.forEach((asset, index) => {
    const variable = `LOGO_${index}`;
    variables.set(asset.name, variable);
    const color = asset.kind === 'png' || asset.name.endsWith('-color');
    if (asset.kind === 'png') {
      const base64 = Buffer.from(asset.bytes).toString('base64');
      declarations.push(
        `const ${variable}: GeneratedLogo = { color: true, dataUrl: ${escapeForSingleLine(
          `data:image/png;base64,${base64}`,
        )} };`,
      );
    } else {
      declarations.push(
        `const ${variable}: GeneratedLogo = { color: ${color}, svg: ${escapeForSingleLine(
          decode(asset.bytes),
        )} };`,
      );
    }
  });

  const entries = generatedLogoKeys(sorted).map((key) => {
    const base = key.endsWith('.png') ? key.slice(0, -4) : key;
    const variable = variables.get(base);
    if (!variable) throw new Error(`generated logo ${key} has no asset`);
    return `  ${escapeForSingleLine(key)}: ${variable},`;
  });

  return [
    headerComment(sha),
    '',
    'export type GeneratedLogo = { svg?: string; dataUrl?: string; color: boolean };',
    '',
    ...declarations,
    '',
    'export const GENERATED_LOGOS: Readonly<Record<string, GeneratedLogo>> = {',
    ...entries,
    '};',
    '',
  ].join('\n');
};

const generatedSha = (text: string | null): string | undefined => {
  if (!text) return undefined;
  const match = /export const SOURCE_SHA = "([0-9a-f]{40})"/.exec(text);
  return match?.[1];
};

const generatedPanelSha = (text: string | null): string | undefined => {
  if (!text) return undefined;
  const match = /Upstream:\s*yetone\/magpie@([0-9a-f]{40})/.exec(text);
  return match?.[1];
};

/** Cache manifest paths are project-relative; absolute machine paths are omitted. */
const cacheManifestPaths = (cwd: string, paths: readonly string[]): string[] => {
  const normalize = (value: string): string => value.replace(/\\/g, '/');
  const base = normalize(cwd).replace(/\/$/, '');
  const baseFold = base.toLowerCase();
  const out: string[] = [];
  for (const path of paths) {
    const normalized = normalize(path);
    const fold = normalized.toLowerCase();
    if (fold === baseFold) continue;
    if (fold.startsWith(`${baseFold}/`)) {
      out.push(normalized.slice(base.length + 1));
      continue;
    }
    if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) continue;
    out.push(normalized);
  }
  return [...new Set(out)];
};

/** Public read-only view, used by the test preload to reject a half-written pair. */
export const inspectGeneratedPair = async (
  options: { runtime?: Runtime; sharedPath?: string; panelPath?: string } = {},
): Promise<GeneratedPair> =>
  readGeneratedPair(
    options.runtime ?? createRuntime(),
    options.sharedPath ?? SHARED_GENERATED,
    options.panelPath ?? PANEL_GENERATED,
  );

/**
 * The two generated files are one deliverable. A shared file alone is not a
 * reason to skip or fall back: the panel file must exist and carry the same
 * source sha, or a half-written pair would be treated as usable.
 */
const readGeneratedPair = async (
  runtime: Runtime,
  sharedPath: string,
  panelPath: string,
): Promise<GeneratedPair> => {
  const [shared, panel] = await Promise.all([
    runtime.readText(sharedPath),
    runtime.readText(panelPath),
  ]);
  const sharedSha = generatedSha(shared);
  const panelSha = generatedPanelSha(panel);
  return {
    complete: Boolean(sharedSha && panelSha && sharedSha === panelSha),
    sha: sharedSha ?? panelSha,
    shared,
    panel,
  };
};

const parseLockFile = (text: string | null): { pid?: number; token?: string } => {
  if (!text) return {};
  try {
    const data = JSON.parse(text) as { pid?: unknown; token?: unknown };
    return {
      pid: typeof data.pid === 'number' ? data.pid : undefined,
      token: typeof data.token === 'string' ? data.token : undefined,
    };
  } catch {
    return {};
  }
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runtime-backed lock for the sync; it is the same file the test preload takes,
 * so a manual `icons:sync` waits for a running test run (and vice versa) rather
 * than racing the two generated files. `waitMs` bounds the wait.
 */
const acquireSyncLock = async (
  runtime: Runtime,
  path: string,
  staleMs: number,
  waitMs: number,
  onWait?: () => void,
): Promise<{ token: string } | null> => {
  const token = `${runtime.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const body = JSON.stringify({ pid: process.pid, token, startedAt: runtime.now() });
  const deadline = runtime.now() + Math.max(0, waitMs);
  let announced = false;
  let staleRetries = 0;
  for (;;) {
    const created = await runtime.createExclusive(path, body);
    if (created) return { token };
    const [info, text] = await Promise.all([runtime.stat(path), runtime.readText(path)]);
    const lock = parseLockFile(text);
    // A trusted, live pid owns the lock even when a slow full sync outlives the
    // stale window. mtime only decides for locks with no usable pid.
    const dead = lock.pid !== undefined && !runtime.pidAlive(lock.pid);
    const expired = !info || (lock.pid === undefined && runtime.now() - info.mtimeMs > staleMs);
    if (dead || expired) {
      if (staleRetries >= 2) return null;
      staleRetries += 1;
      await runtime.remove(path);
      continue;
    }
    if (runtime.now() >= deadline) return null;
    if (!announced) {
      announced = true;
      onWait?.();
    }
    await sleep(Math.min(500, Math.max(1, deadline - runtime.now())));
  }
};

const releaseSyncLock = async (
  runtime: Runtime,
  path: string,
  handle: { token: string } | null,
): Promise<void> => {
  if (!handle) return;
  const current = parseLockFile(await runtime.readText(path));
  // Strict token match: never delete a lock whose token is missing or differs.
  if (current.token !== handle.token) return;
  await runtime.remove(path).catch(() => undefined);
};

const restoreFile = async (
  runtime: Runtime,
  path: string,
  previous: string | null,
): Promise<void> => {
  if (previous === null) {
    await runtime.remove(path).catch(() => undefined);
    return;
  }
  await runtime.writeText(path, previous);
};

const restoreBytes = async (
  runtime: Runtime,
  path: string,
  previous: Uint8Array | null,
): Promise<void> => {
  if (previous === null) {
    await runtime.remove(path).catch(() => undefined);
    return;
  }
  await runtime.writeBytes(path, previous);
};

const commitGenerated = async (args: {
  runtime: Runtime;
  sharedPath: string;
  panelPath: string;
  panelBundlePath: string;
  shared: string;
  panel: string;
  build: boolean;
  buildCommand: readonly string[];
  log: Logger;
}): Promise<{ built: boolean }> => {
  const { runtime, sharedPath, panelPath, panelBundlePath, shared, panel } = args;
  const previousShared = await runtime.readText(sharedPath);
  const previousPanel = await runtime.readText(panelPath);
  const previousBundle = args.build ? await runtime.readBytes(panelBundlePath) : null;

  let sharedTemp: string | null = null;
  let panelTemp: string | null = null;
  let sharedMoved = false;
  let panelMoved = false;
  let built = false;
  try {
    sharedTemp = await runtime.stageText(sharedPath, shared);
    panelTemp = await runtime.stageText(panelPath, panel);
    await runtime.rename(sharedTemp, sharedPath);
    sharedMoved = true;
    sharedTemp = null;
    await runtime.rename(panelTemp, panelPath);
    panelMoved = true;
    panelTemp = null;
    if (args.build) {
      const result = await runtime.spawn(
        args.buildCommand[0] ?? 'bun',
        args.buildCommand.slice(1),
        runtime.cwd,
        BUILD_TIMEOUT_MS,
      );
      if (result.code !== 0) {
        throw new Error(
          `build failed (${result.code}): ${(result.stderr || result.stdout).trim().slice(0, 2000)}`,
        );
      }
      built = true;
    }
    return { built };
  } catch (error) {
    if (sharedTemp) await runtime.remove(sharedTemp).catch(() => undefined);
    if (panelTemp) await runtime.remove(panelTemp).catch(() => undefined);
    if (panelMoved) await restoreFile(runtime, panelPath, previousPanel).catch(() => undefined);
    if (sharedMoved) await restoreFile(runtime, sharedPath, previousShared).catch(() => undefined);
    if (args.build) await restoreBytes(runtime, panelBundlePath, previousBundle).catch(() => undefined);
    throw error;
  }
};

const newCounts = (
  presets: number,
  agents: number,
  marketProviders: number,
  downloadedIcons: number,
  providerIcons: number,
): SyncCounts => ({ presets, agents, marketProviders, downloadedIcons, providerIcons });

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Reject a 200 response that is HTML, a 404 page, or an empty body. */
const validateAssetBody = (file: string, bytes: Uint8Array): void => {
  if (file.endsWith('.png')) {
    if (
      bytes.length < PNG_SIGNATURE.length ||
      !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
    ) {
      throw new Error(`icon ${file} returned an invalid PNG body`);
    }
    return;
  }
  if (bytes.length === 0) throw new Error(`icon ${file} returned an empty body`);
  const text = decode(bytes).replace(/^\uFEFF/, '').trim();
  if (text === '' || /<html[\s>]/i.test(text) || /<!doctype\s+html/i.test(text)) {
    throw new Error(`icon ${file} returned an invalid SVG body`);
  }
  if (!/<svg[\s>]/i.test(text)) {
    throw new Error(`icon ${file} returned an invalid SVG body`);
  }
};

const downloadIcons = async (
  transport: Transport,
  repo: string,
  sha: string,
  names: readonly string[],
  concurrency: number,
): Promise<{ assets: Asset[]; missing: string[] }> => {
  const results = await mapLimit(names, concurrency, async (name): Promise<Asset | null> => {
    for (const file of iconFileCandidates(name)) {
      const response = await fetchText(
        transport,
        rawUrl(repo, sha, `internal/gui/assets/icons/${file}`),
        { 'User-Agent': 'openchamber-magpie-usage-icons' },
      );
      if (response.status === 200) {
        const kind = file.endsWith('.png') ? 'png' : 'svg';
        validateAssetBody(file, response.bytes);
        return { name, kind, bytes: response.bytes };
      }
      if (response.status !== 404) {
        throw new Error(`icon ${file} returned ${response.status}`);
      }
    }
    return null;
  });
  const assets: Asset[] = [];
  const missing: string[] = [];
  results.forEach((asset, index) => {
    if (asset) assets.push(asset);
    else missing.push(names[index]!);
  });
  return { assets, missing };
};

const fullSync = async (args: {
  transport: Transport;
  repo: string;
  sha: string;
  concurrency: number;
  snapshot?: SourceBundle;
  log: Logger;
  warn: (message: string) => void;
}): Promise<{
  shared: string;
  panel: string;
  counts: SyncCounts;
  missing: string[];
}> => {
  const { transport, repo, sha, concurrency } = args;
  const bundle = await loadBundle({
    transport,
    repo,
    sha,
    concurrency,
    snapshot: args.snapshot,
    log: args.log,
  });
  const agentSources = bundle.agentFiles
    .map((path) => bundle.texts.get(path))
    .filter((text): text is string => typeof text === 'string');
  const providerSources = bundle.providerFiles
    .map((path) => bundle.texts.get(path))
    .filter((text): text is string => typeof text === 'string');
  const presetSource = bundle.texts.get('internal/provider/presets.go') ?? '';
  const marketSource = bundle.texts.get('internal/plugin/market.json') ?? '';

  const providerConstants = parseStringConstants(providerSources);
  const agentConstants = parseStringConstants(agentSources);
  const presets = parsePresetIcons(presetSource, providerConstants);
  const agents = agentSources.flatMap((source) => parseAgentIcons(source, agentConstants));
  const googleApps = providerSources.flatMap((source) => parseGoogleAppIcons(source));
  const accountCards = providerSources.flatMap((source) => parseAccountCardIcons(source));
  const market = parseMarketIcons(marketSource);
  const merged = mergeProviderIcons({ presets, agents, googleApps, accountCards, market });

  if (presets.length < 40) throw new SelfCheckError(`self-check: presets ${presets.length} < 40`);
  if (agents.length < 30) throw new SelfCheckError(`self-check: agents ${agents.length} < 30`);
  const marketProviders = new Set(market.filter((pair) => pair.icon).map((pair) => pair.id)).size;
  if (marketProviders < 10) {
    throw new SelfCheckError(`self-check: market providers with icons ${marketProviders} < 10`);
  }

  const required = new Set<string>();
  for (const icon of Object.values(merged.icons)) {
    if (icon && icon !== 'generic') required.add(icon);
  }
  for (const icon of REQUIRED_ICONS) required.add(icon);
  const names = [...required].sort();

  const { assets, missing } = await downloadIcons(transport, repo, sha, names, concurrency);
  const requiredMissing = REQUIRED_ICONS.filter((name) => missing.includes(name));
  if (requiredMissing.length > 0) {
    throw new SelfCheckError(`self-check: required icon missing: ${requiredMissing.join(', ')}`);
  }
  if (assets.length < 40) {
    throw new SelfCheckError(`self-check: downloaded icons ${assets.length} < 40`);
  }
  if (missing.length > 0) {
    args.warn(`missing upstream icons (their provider mappings were dropped): ${missing.join(', ')}`);
  }

  const available = new Set(assets.map((asset) => asset.name));
  const providerIcons: Record<string, string> = {};
  for (const [id, icon] of Object.entries(merged.icons)) {
    if (icon === 'generic' || available.has(icon)) providerIcons[id] = icon;
  }
  const iconNames = generatedLogoKeys(assets);
  const shared = buildSharedSource(sha, providerIcons, iconNames);
  const panel = buildPanelSource(sha, assets);
  return {
    shared,
    panel,
    counts: newCounts(presets.length, agents.length, marketProviders, assets.length, Object.keys(providerIcons).length),
    missing,
  };
};

const resolveGitSha = async (
  runtime: Runtime,
  repo: string,
  branch: string,
  log: Logger,
  timeoutMs: number,
): Promise<string | undefined> => {
  try {
    const result = await runtime.spawn(
      'git',
      ['ls-remote', `https://github.com/${repo}.git`, `refs/heads/${branch}`],
      runtime.cwd,
      timeoutMs,
    );
    if (result.code === 0) {
      const sha = parseLsRemote(result.stdout);
      if (sha) {
        log(`git ls-remote gives ${sha}`);
        return sha;
      }
      log(`git ls-remote returned no ${branch} sha`);
    } else {
      log(`git ls-remote exited ${result.code}: ${result.stderr.trim().slice(0, 300)}`);
    }
  } catch (error) {
    log(`git ls-remote failed: ${(error as Error).message}`);
  }
  return undefined;
};

/**
 * GitHub's smart-HTTP advertisement carries the branch sha without the commits
 * API and without a `git` executable. It is the fallback when both of those
 * are unavailable but the host is reachable.
 */
const resolveHttpRefSha = async (
  transport: Transport,
  repo: string,
  branch: string,
  log: Logger,
): Promise<string | undefined> => {
  try {
    const response = await transport.get(
      `https://github.com/${repo}.git/info/refs?service=git-upload-pack`,
      {
        Accept: 'application/x-git-upload-pack-advertisement',
        'User-Agent': 'openchamber-magpie-usage-icons',
      },
    );
    if (response.status !== 200) {
      log(`info/refs returned ${response.status}`);
      return undefined;
    }
    const text = decode(response.body);
    for (const match of text.matchAll(/([0-9a-f]{40})\s+refs\/heads\/([^\0\s]+)/g)) {
      if (match[2] === branch) {
        log(`info/refs gives ${match[1]}`);
        return match[1];
      }
    }
    log(`info/refs has no refs/heads/${branch}`);
  } catch (error) {
    log(`info/refs failed: ${(error as Error).message}`);
  }
  return undefined;
};

/** GitHub's commit feed also names the branch head, without the REST API. */
const resolveAtomSha = async (
  transport: Transport,
  repo: string,
  branch: string,
  log: Logger,
): Promise<string | undefined> => {
  try {
    const response = await transport.get(
      `https://github.com/${repo}/commits/${branch}.atom`,
      { 'User-Agent': 'openchamber-magpie-usage-icons' },
    );
    if (response.status !== 200) {
      log(`commits feed returned ${response.status}`);
      return undefined;
    }
    const match = /Grit::Commit\/([0-9a-f]{40})/.exec(decode(response.body));
    if (match) {
      log(`commits feed gives ${match[1]}`);
      return match[1];
    }
    log('commits feed has no commit id');
  } catch (error) {
    log(`commits feed failed: ${(error as Error).message}`);
  }
  return undefined;
};

const resolveArchiveMain = async (
  transport: Transport,
  repo: string,
  branch: string,
  log: Logger,
): Promise<SourceBundle | undefined> => {
  try {
    const bundle = await loadBundleViaArchive(transport, repo, branch);
    log(`codeload ${branch} snapshot gives ${bundle.sha}`);
    return bundle;
  } catch (error) {
    log(`codeload ${branch} failed: ${(error as Error).message}`);
    return undefined;
  }
};

const keepCommitted = (
  pair: GeneratedPair,
  reason: string,
  warn: (message: string) => void,
): SyncResult => {
  if (pair.complete && pair.sha) {
    warn(`keeping committed generated pair ${pair.sha}: ${reason}`);
    return { status: 'fallback', sha: pair.sha, reason, built: false, warnings: [] };
  }
  const missingReason = `${reason}; no committed generated files with a matching source sha`;
  warn(missingReason);
  return { status: 'failed', reason: missingReason, built: false, warnings: [] };
};

/**
 * Run one sync. The default transport/runtime are the real network and disk;
 * every branch can be driven with fakes for offline tests.
 *
 * `--force` (options.force) skips the commits API entirely: the sha comes from
 * git or a codeload snapshot, then a real full download follows.
 */
const runIconSyncImpl = async (
  options: SyncOptions,
  warn: (message: string) => void,
): Promise<SyncResult> => {
  const runtime = options.runtime ?? createRuntime();
  const transport =
    options.transport ?? createFetchTransport(fetch, options.fetchTimeoutMs);
  const repo = options.repo ?? REPO;
  const branch = options.branch ?? BRANCH;
  const concurrency = Math.max(8, Math.min(16, options.concurrency ?? 8));
  const gitTimeoutMs = options.gitTimeoutMs ?? 30_000;
  const sharedPath = options.sharedPath ?? SHARED_GENERATED;
  const panelPath = options.panelPath ?? PANEL_GENERATED;
  const panelBundlePath = options.panelBundlePath ?? PANEL_BUNDLE;
  const cachePath = options.cachePath ?? CACHE_FILE;
  const lockPath = options.lockPath ?? SYNC_LOCK;
  const buildCommand = options.buildCommand ?? ['bun', 'run', 'build:panel'];
  const log: Logger = options.onLog ?? ((message) => console.log(`[icons] ${message}`));

  let lock: { token: string } | null = null;
  try {
    lock = await acquireSyncLock(
      runtime,
      lockPath,
      15 * 60 * 1000,
      options.lockWaitMs ?? 5_000,
      () => log(`waiting for ${lockPath} (test preload or another sync holds it)`),
    );
  } catch (error) {
    const reason = `lock failed: ${(error as Error).message}`;
    warn(reason);
    return { status: 'failed', reason, built: false, warnings: [] };
  }
  if (!lock) {
    warn(`another sync/preload still holds ${lockPath}; nothing written`);
    return { status: 'locked', built: false, warnings: [] };
  }

  try {
    const cache = await readCache(runtime, cachePath);
    const pairBefore = await readGeneratedPair(runtime, sharedPath, panelPath);
    let sha: string | undefined;
    let lookupStatus: number | undefined;
    let lookupError: unknown;
    let snapshot: SourceBundle | undefined;

    if (options.force) {
      // No conditional commits request: force is a full download.
      sha = await resolveGitSha(runtime, repo, branch, log, gitTimeoutMs);
      if (!sha) sha = await resolveHttpRefSha(transport, repo, branch, log);
      if (!sha) sha = await resolveAtomSha(transport, repo, branch, log);
      if (!sha) {
        snapshot = await resolveArchiveMain(transport, repo, branch, log);
        sha = snapshot?.sha;
      }
      if (sha) cache.sha = sha;
    } else {
      try {
        const lookup = await fetchCommit(transport, repo, branch, cache.etag);
        lookupStatus = lookup.status;
        if (lookup.status === 304) {
          sha = cache.sha;
          if (!sha) lookupError = new Error('304 without a cached sha');
        } else if (lookup.status === 200) {
          sha = lookup.sha;
          if (!sha) lookupError = new Error('commits response has no sha');
        } else {
          lookupError = new Error(`commits ${repo}/${branch} returned ${lookup.status}`);
        }
        if (lookup.etag) cache.etag = lookup.etag;
        if (sha) cache.sha = sha;
      } catch (error) {
        lookupError = error;
      }

      if (!sha) {
        sha = await resolveGitSha(runtime, repo, branch, log, gitTimeoutMs);
        if (sha) cache.sha = sha;
      }
      if (!sha) {
        sha = await resolveHttpRefSha(transport, repo, branch, log);
        if (sha) cache.sha = sha;
      }
      if (!sha) {
        sha = await resolveAtomSha(transport, repo, branch, log);
        if (sha) cache.sha = sha;
      }
      if (!sha) {
        snapshot = await resolveArchiveMain(transport, repo, branch, log);
        sha = snapshot?.sha;
        if (sha) cache.sha = sha;
      }
    }

    if (!sha) {
      return keepCommitted(
        pairBefore,
        `upstream unavailable: ${String(lookupError ?? 'no sha from commits, git, or codeload')}`,
        warn,
      );
    }

    // Persist what upstream reported (never generatedSha yet).
    await writeCache(runtime, cache, cachePath).catch((error) => {
      warn(`cache write failed: ${(error as Error).message}`);
    });

    if (!options.force && pairBefore.complete && pairBefore.sha === sha) {
      cache.generatedSha = sha;
      await writeCache(runtime, cache, cachePath).catch(() => undefined);
      log(`upstream ${sha} already generated; nothing to do`);
      return { status: 'skipped', sha, built: false, warnings: [] };
    }

    log(
      `upstream ${sha} (${
        options.force ? 'force' : lookupStatus === 304 ? 'etag hit' : 'resolved'
      }); syncing sources and icons`,
    );
    let generated: Awaited<ReturnType<typeof fullSync>>;
    try {
      generated = await fullSync({
        transport,
        repo,
        sha,
        concurrency,
        snapshot,
        log,
        warn,
      });
    } catch (error) {
      if (error instanceof SelfCheckError) {
        const reason = `sync failed: ${error.message}`;
        warn(reason);
        return { status: 'failed', sha, reason, built: false, warnings: [] };
      }
      return keepCommitted(pairBefore, `sync failed: ${(error as Error).message}`, warn);
    }

    const existingShared = pairBefore.shared;
    const existingPanel = pairBefore.panel;
    const sharedUnchanged = compareText(existingShared, generated.shared);
    const panelUnchanged = compareText(existingPanel, generated.panel);
    if (sharedUnchanged && panelUnchanged) {
      cache.generatedSha = sha;
      cache.generatedFiles = cacheManifestPaths(runtime.cwd, [sharedPath, panelPath]);
      await writeCache(runtime, cache, cachePath).catch(() => undefined);
      log(`generated files already match ${sha}; nothing to do`);
      return {
        status: 'unchanged',
        sha,
        counts: generated.counts,
        bytes: { shared: generated.shared.length, panel: generated.panel.length },
        built: false,
        warnings: [],
      };
    }

    let built = false;
    try {
      ({ built } = await commitGenerated({
        runtime,
        sharedPath,
        panelPath,
        panelBundlePath,
        shared: generated.shared,
        panel: generated.panel,
        build: options.noBuild !== true,
        buildCommand,
        log,
      }));
    } catch (error) {
      const reason = `sync failed: write/build failed: ${(error as Error).message}`;
      warn(reason);
      return { status: 'failed', sha, reason, counts: generated.counts, built: false, warnings: [] };
    }

    cache.generatedSha = sha;
    cache.generatedFiles = cacheManifestPaths(runtime.cwd, [sharedPath, panelPath]);
    await writeCache(runtime, cache, cachePath).catch((error) => {
      warn(`cache write failed after generation: ${(error as Error).message}`);
    });
    log(
      `generated ${generated.counts.providerIcons} provider mappings and ${generated.counts.downloadedIcons} icons for ${sha}`,
    );
    return {
      status: 'updated',
      sha,
      counts: generated.counts,
      bytes: { shared: generated.shared.length, panel: generated.panel.length },
      built,
      warnings: [],
    };
  } finally {
    try {
      await releaseSyncLock(runtime, lockPath, lock);
    } catch (error) {
      warn(`lock release failed: ${(error as Error).message}`);
    }
  }
};

/** Run once and emit every collected warning as one line. */
export const runIconSync = async (options: SyncOptions = {}): Promise<SyncResult> => {
  const collected: string[] = [];
  const warn = (message: string): void => {
    collected.push(message);
  };
  let result: SyncResult;
  try {
    result = await runIconSyncImpl(options, warn);
  } catch (error) {
    result = {
      status: 'failed',
      reason: `sync failed: ${(error as Error).message}`,
      built: false,
      warnings: [],
    };
  }
  if (result.status === 'failed' && result.reason && !collected.includes(result.reason)) {
    collected.push(result.reason);
  }
  const warnings = [...new Set([...collected, ...(result.warnings ?? [])])];
  const final = { ...result, warnings };
  if (warnings.length > 0) {
    const emit = options.onWarning ?? ((message: string) => console.warn(`[icons] ${message}`));
    emit(warnings.join('; '));
  }
  return final;
};

const usage = (): string =>
  [
    'Usage: bun tools/icons/sync.ts [--force]',
    '',
    '  --force  skip the conditional commits check and download a full snapshot',
  ].join('\n');

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage());
    return;
  }
  const unknown = args.filter((arg) => arg !== '--force');
  if (unknown.length > 0) {
    console.error(`unknown argument: ${unknown.join(' ')}`);
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  const result = await runIconSync({
    force: args.includes('--force'),
    lockWaitMs: 10 * 60 * 1000,
  });
  console.log(`[icons] status=${result.status}${result.sha ? ` sha=${result.sha}` : ''}`);
  if (result.counts) {
    console.log(
      `[icons] presets=${result.counts.presets} agents=${result.counts.agents} market=${result.counts.marketProviders} downloads=${result.counts.downloadedIcons} mappings=${result.counts.providerIcons}`,
    );
  }
  if (result.bytes) console.log(`[icons] bytes shared=${result.bytes.shared} panel=${result.bytes.panel}`);
  if (result.status === 'failed') process.exitCode = 1;
};

if (import.meta.main) {
  await main();
}
