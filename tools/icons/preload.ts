/**
 * Bun test preload plus the shared lock helpers.
 *
 * The preload runs the same `runIconSync` the CLI uses: a conditional commits
 * check, a full generation and `build:panel` only when needed. `runIconSync`
 * takes and releases the sync lock internally, so this module never holds that
 * lock itself (taking it here and then calling the sync would deadlock).
 *
 * A failure is one warning and never blocks the test run. The lock helpers stay
 * exported for tests and for callers that need the same stale/crash handling.
 */

import { closeSync, existsSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { SYNC_LOCK } from './cache.ts';
import {
  inspectGeneratedPair,
  runIconSync,
  type SyncOptions,
  type SyncResult,
} from './sync.ts';

/** The CLI and the test preload contend for this one file. */
export const DEFAULT_LOCK_PATH = SYNC_LOCK;
export const DEFAULT_STALE_MS = 10 * 60 * 1000;
export const PRELOAD_LOCK_WAIT_MS = 10 * 60 * 1000;

export type LockHandle = {
  path: string;
  token: string;
};

export type AcquireLockOptions = {
  staleMs?: number;
  now?: () => number;
  pid?: number;
  /** Test seam: report the reason instead of writing to stderr. */
  onWarning?: (message: string) => void;
};

type LockFile = {
  pid?: number;
  token?: string;
  startedAt?: number;
};

const readLockFile = (path: string): LockFile | null => {
  try {
    const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof data !== 'object' || data === null) return null;
    const record = data as Record<string, unknown>;
    return {
      pid: typeof record.pid === 'number' ? record.pid : undefined,
      token: typeof record.token === 'string' ? record.token : undefined,
      startedAt: typeof record.startedAt === 'number' ? record.startedAt : undefined,
    };
  } catch {
    return null;
  }
};

/** True when a pid is still alive (EPERM means it exists but is not ours). */
export const isProcessAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

export const isLockStale = (
  path: string,
  options: { staleMs?: number; now?: () => number } = {},
): boolean => {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const now = options.now ?? Date.now;
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    return true; // Vanished: the next exclusive create can win it.
  }
  const lock = readLockFile(path);
  // A live, trusted pid owns the lock no matter how long the slow sync takes.
  if (lock?.pid !== undefined) return !isProcessAlive(lock.pid);
  // No usable pid (corrupt/legacy lock): only age can prove it abandoned.
  return now() - mtimeMs > staleMs;
};

const randomToken = (): string =>
  `${process.pid.toString(36)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * Try to take `path`. Returns null when another live, fresh run holds it.
 * A stale lock (dead pid or old mtime) is removed once and retried.
 */
export const acquireLock = (
  path: string,
  options: AcquireLockOptions = {},
): LockHandle | null => {
  const token = randomToken();
  const pid = options.pid ?? process.pid;
  const body = JSON.stringify({ pid, token, startedAt: (options.now ?? Date.now)() });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    mkdirSync(dirname(path), { recursive: true });
    let fd: number | null = null;
    try {
      fd = openSync(path, 'wx');
      writeSync(fd, body);
      closeSync(fd);
      return { path, token };
    } catch (error) {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          // ignore
        }
      }
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        options.onWarning?.(`lock ${path}: ${(error as Error).message}`);
        return null;
      }
      if (attempt > 0 || !isLockStale(path, options)) return null;
      try {
        unlinkSync(path);
      } catch {
        return null;
      }
    }
  }
  return null;
};

/** Release only our own lock; a replaced lock belongs to someone else. */
export const releaseLock = (handle: LockHandle | null): void => {
  if (!handle) return;
  const current = readLockFile(handle.path);
  // Strict token match: a missing or corrupt token is not ours to delete.
  if (current?.token !== handle.token) return;
  try {
    if (existsSync(handle.path)) unlinkSync(handle.path);
  } catch {
    // A lock that cannot be removed becomes stale and is reclaimed later.
  }
};

let installed: LockHandle | null | undefined;

/**
 * Compatibility helper: take a lock once per process. The preload itself does
 * not call this; `runIconSync` owns the lock so it cannot deadlock itself.
 */
export const installPreloadLock = (
  path = DEFAULT_LOCK_PATH,
  options: AcquireLockOptions = {},
): LockHandle | null => {
  if (installed !== undefined) return installed;
  const warn = options.onWarning ?? ((message: string) => console.warn(`[icons] ${message}`));
  try {
    const handle = acquireLock(path, { ...options, onWarning: warn });
    installed = handle;
    if (handle) {
      process.once('exit', () => releaseLock(handle));
    } else {
      warn(`preload lock busy at ${path}; continuing without it`);
    }
  } catch (error) {
    installed = null;
    warn(`preload lock failed: ${(error as Error).message}`);
  }
  return installed;
};

export type PreloadRun = (options: SyncOptions) => Promise<SyncResult>;

export type PreloadSyncOptions = {
  /** Inject the sync engine; tests use this to count the one call. */
  run?: PreloadRun;
  /** Extra sync options (paths, transport, runtime, …). */
  sync?: SyncOptions;
  /**
   * Test-only injection: call the function with `disabled: true` to exercise
   * the helper without spending a network check. The formal top-level call
   * below never sets it, so `bun test` always attempts the sync.
   */
  disabled?: boolean;
  warn?: (message: string) => void;
};

/**
 * Run the conditional icon check once for the test process. Any failure is
 * reported as one warning; the test run continues. A half-written pair after a
 * lock timeout is named explicitly, but is never used as proof of completion.
 */
export const runPreloadSync = async (
  options: PreloadSyncOptions = {},
): Promise<SyncResult | null> => {
  // No environment switch: only an explicit test call can skip the check.
  if (options.disabled === true) return null;

  const warn = options.warn ?? ((message: string) => console.warn(`[icons] ${message}`));
  const syncOptions: SyncOptions = {
    fetchTimeoutMs: 10_000,
    gitTimeoutMs: 10_000,
    ...options.sync,
    lockWaitMs: options.sync?.lockWaitMs ?? PRELOAD_LOCK_WAIT_MS,
    // Warnings are collected here and emitted once.
    onWarning: () => undefined,
    onLog: () => undefined,
  };

  try {
    const result = await (options.run ?? runIconSync)(syncOptions);
    const messages = [...result.warnings];
    if (result.status === 'failed' && result.reason && !messages.includes(result.reason)) {
      messages.push(result.reason);
    }
    if (result.status === 'locked') {
      const pair = await inspectGeneratedPair({
        runtime: syncOptions.runtime,
        sharedPath: syncOptions.sharedPath,
        panelPath: syncOptions.panelPath,
      }).catch(() => null);
      if (!pair?.complete) {
        messages.push('generated icon pair is incomplete while another sync holds the lock');
      }
    }
    const unique = [...new Set(messages)];
    if (unique.length > 0) warn(unique.join('; '));
    return result;
  } catch (error) {
    warn(`preload icon sync failed: ${(error as Error).message}`);
    return null;
  }
};

// Bun's test preload imports this module for its side effect. The sync takes
// and releases the lock internally; nothing here owns it afterwards.
export const preloadResult = await runPreloadSync();
