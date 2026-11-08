/**
 * Shared runtime seams for the icon sync: HTTP transport, filesystem/process
 * runtime, and the ETag cache for `commits/main`.
 *
 * Everything here is injectable so the sync can be exercised offline, and the
 * cache deliberately separates "the sha upstream reports" from "the sha these
 * generated files were built from". A failed generation therefore never looks
 * generated on the next run.
 */

export type HttpResponse = {
  status: number;
  /** Header names are lower-cased. */
  headers: Record<string, string>;
  body: Uint8Array;
};

export type Transport = {
  get(url: string, headers?: Record<string, string>): Promise<HttpResponse>;
};

export type RuntimeStat = {
  mtimeMs: number;
  size: number;
};

export type SpawnResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type Runtime = {
  cwd: string;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  now(): number;
  readText(path: string): Promise<string | null>;
  readBytes(path: string): Promise<Uint8Array | null>;
  /** Write a file through a temporary file in the same directory + rename. */
  writeText(path: string, text: string): Promise<void>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  /** Write a staged file and return the temporary path (no rename yet). */
  stageText(path: string, text: string): Promise<string>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  mkdirp(path: string): Promise<void>;
  stat(path: string): Promise<RuntimeStat | null>;
  /** Atomic create; false when the path already exists. */
  createExclusive(path: string, text: string): Promise<boolean>;
  spawn(
    command: string,
    args: readonly string[],
    cwd?: string,
    timeoutMs?: number,
  ): Promise<SpawnResult>;
  /** Whether a pid from a lock file is still alive. */
  pidAlive(pid: number): boolean;
};

export type CacheState = {
  /** ETag of the last successful commits/main response. */
  etag?: string;
  /** The sha upstream reported (seen, not necessarily generated). */
  sha?: string;
  /** Set only after both generated files were committed and the build passed. */
  generatedSha?: string;
  /**
   * Project-relative paths of the generated files from that successful run.
   * Never absolute paths, timestamps, or secrets.
   */
  generatedFiles?: readonly string[];
};

export const CACHE_DIR = '.cache/magpie-icons';
export const CACHE_FILE = `${CACHE_DIR}/commit.json`;
/** One lock for the test preload and the manual `icons:sync` CLI. */
export const SYNC_LOCK = `${CACHE_DIR}/sync.lock`;

export const emptyCache = (): CacheState => ({});

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** Tolerant cache reader: a corrupt cache is treated as absent. */
export const parseCache = (text: string | null): CacheState => {
  if (!text) return {};
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof data !== 'object' || data === null) return {};
  const record = data as Record<string, unknown>;
  const state: CacheState = {};
  const etag = asString(record.etag);
  const sha = asString(record.sha);
  const generatedSha = asString(record.generatedSha);
  if (etag) state.etag = etag;
  if (sha) state.sha = sha;
  if (generatedSha) state.generatedSha = generatedSha;
  if (Array.isArray(record.generatedFiles)) {
    const files = record.generatedFiles.filter(
      (value): value is string => typeof value === 'string' && value !== '',
    );
    if (files.length > 0) state.generatedFiles = files;
  }
  return state;
};

export const serializeCache = (state: CacheState): string => {
  const ordered: CacheState = {};
  if (state.etag) ordered.etag = state.etag;
  if (state.sha) ordered.sha = state.sha;
  if (state.generatedSha) ordered.generatedSha = state.generatedSha;
  if (state.generatedFiles && state.generatedFiles.length > 0) {
    ordered.generatedFiles = [...state.generatedFiles];
  }
  return `${JSON.stringify(ordered, null, 2)}\n`;
};

export const readCache = async (runtime: Runtime, path = CACHE_FILE): Promise<CacheState> =>
  parseCache(await runtime.readText(path));

export const writeCache = async (
  runtime: Runtime,
  state: CacheState,
  path = CACHE_FILE,
): Promise<void> => {
  await runtime.writeText(path, serializeCache(state));
};

export type CommitLookup = {
  status: number;
  sha?: string;
  etag?: string;
};

/**
 * Read `commits/main`, conditional on the cached ETag. A 304 means the cached
 * sha is still main; a 200 carries the new sha and ETag. Any other status is
 * handed to the caller so it can fall back to `git ls-remote`.
 */
export const fetchCommit = async (
  transport: Transport,
  repo: string,
  branch: string,
  etag?: string,
): Promise<CommitLookup> => {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'openchamber-magpie-usage-icons',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (etag) headers['If-None-Match'] = etag;
  const response = await transport.get(
    `https://api.github.com/repos/${repo}/commits/${branch}`,
    headers,
  );
  if (response.status === 304) {
    return { status: 304, etag: response.headers.etag ?? etag };
  }
  if (response.status !== 200) return { status: response.status };
  let sha: string | undefined;
  try {
    const data = JSON.parse(new TextDecoder().decode(response.body)) as { sha?: unknown };
    if (typeof data.sha === 'string' && /^[0-9a-f]{40}$/.test(data.sha)) sha = data.sha;
  } catch {
    sha = undefined;
  }
  return { status: 200, sha, etag: response.headers.etag };
};

/** Parse the single `refs/heads/<branch>` line of `git ls-remote`. */
export const parseLsRemote = (stdout: string): string | undefined => {
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^([0-9a-f]{40})\s+refs\/heads\/[^\s]+$/.exec(line.trim());
    if (match) return match[1];
  }
  return undefined;
};

export const DEFAULT_FETCH_TIMEOUT_MS = 60_000;

/**
 * A fetch-backed transport; tests replace it with a fixture transport.
 *
 * GitHub redirects (codeload) are followed: this transport only talks to the
 * public icon sources, not to a user's gateway. A timeout keeps a dead network
 * or stalled TLS connection from hanging the test preload.
 */
export const createFetchTransport = (
  fetchImpl: typeof fetch = fetch,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Transport => ({
  async get(url, headers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
    try {
      const response = await fetchImpl(url, {
        headers,
        redirect: 'follow',
        signal: controller.signal,
      });
      const body = new Uint8Array(await response.arrayBuffer());
      const normalized: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        normalized[key.toLowerCase()] = value;
      });
      return { status: response.status, headers: normalized, body };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`fetch ${url} timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  },
});

type FsPromises = typeof import('node:fs/promises');

const importFs = async (): Promise<FsPromises> => import('node:fs/promises');

/** Node/Bun runtime used by the CLI; every operation is explicit so tests can fake it. */
export const createRuntime = (): Runtime => {
  const atomicWrite = async (path: string, data: string | Uint8Array): Promise<void> => {
    const fs = await importFs();
    const pathModule = await import('node:path');
    await fs.mkdir(pathModule.dirname(path), { recursive: true });
    const temp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
    try {
      await fs.writeFile(temp, data);
      await fs.rename(temp, path);
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  };

  return {
    cwd: process.cwd(),
    env: process.env,
    platform: process.platform,
    now: () => Date.now(),
    async readText(path) {
      const fs = await importFs();
      try {
        return await fs.readFile(path, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async readBytes(path) {
      const fs = await importFs();
      try {
        return new Uint8Array(await fs.readFile(path));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    writeText: (path, text) => atomicWrite(path, text),
    writeBytes: (path, bytes) => atomicWrite(path, bytes),
    async stageText(path, text) {
      const fs = await importFs();
      const pathModule = await import('node:path');
      await fs.mkdir(pathModule.dirname(path), { recursive: true });
      const temp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
      await fs.writeFile(temp, text);
      return temp;
    },
    async rename(from, to) {
      const fs = await importFs();
      const pathModule = await import('node:path');
      await fs.mkdir(pathModule.dirname(to), { recursive: true });
      await fs.rename(from, to);
    },
    async remove(path) {
      const fs = await importFs();
      await fs.rm(path, { force: true });
    },
    async mkdirp(path) {
      const fs = await importFs();
      await fs.mkdir(path, { recursive: true });
    },
    async stat(path) {
      const fs = await importFs();
      try {
        const info = await fs.stat(path);
        return { mtimeMs: info.mtimeMs, size: info.size };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async createExclusive(path, text) {
      const fs = await importFs();
      const pathModule = await import('node:path');
      await fs.mkdir(pathModule.dirname(path), { recursive: true });
      let handle: Awaited<ReturnType<FsPromises['open']>> | null = null;
      try {
        handle = await fs.open(path, 'wx');
        await handle.writeFile(text);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw error;
      } finally {
        await handle?.close().catch(() => undefined);
      }
    },
    pidAlive(pid) {
      if (!Number.isInteger(pid) || pid <= 0) return false;
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
      }
    },
    async spawn(command, args, cwd, timeoutMs) {
      const { spawn } = await import('node:child_process');
      const isWindows = process.platform === 'win32';
      return await new Promise<SpawnResult>((resolve, reject) => {
        const child = spawn(command, [...args], {
          cwd,
          shell: isWindows,
          windowsHide: true,
          detached: !isWindows,
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        let timedOut = false;
        const finish = (result: SpawnResult): void => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          resolve(result);
        };
        const killTree = (): void => {
          if (!child.pid) {
            try {
              child.kill('SIGKILL');
            } catch {
              // Already gone.
            }
            return;
          }
          if (isWindows) {
            // `shell: true` means child.pid is cmd.exe; taskkill /T is the
            // only way to stop the bundler it started as well.
            const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
              windowsHide: true,
              stdio: 'ignore',
            });
            killer.on('error', () => {
              try {
                child.kill();
              } catch {
                // Already gone.
              }
            });
            return;
          }
          try {
            // The child is a process-group leader because detached is true.
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            try {
              child.kill('SIGKILL');
            } catch {
              // Already gone.
            }
          }
        };
        const timer = timeoutMs
          ? setTimeout(() => {
              timedOut = true;
              stderr += `\n${command} timed out after ${timeoutMs}ms`;
              killTree();
            }, Math.max(1, timeoutMs))
          : null;
        child.stdout?.on('data', (chunk) => {
          stdout += String(chunk);
        });
        child.stderr?.on('data', (chunk) => {
          stderr += String(chunk);
        });
        child.on('error', (error) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          reject(error);
        });
        // Resolve only after the tree has exited, so a build timeout cannot
        // race generated-file rollback against a still-running bundler.
        child.on('close', (code) => finish({ code: timedOut ? 124 : code ?? 1, stdout, stderr }));
      });
    },
  };
};
