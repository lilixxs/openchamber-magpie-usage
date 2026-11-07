// The service's only write path: create the JSONC file, merge `cardOrder`, or
// rebuild a structurally damaged file. Reads stay in config.ts; this file owns
// the write sequence (fresh read, edit, temp file, mode, publish) and the one
// in-process serialisation point shared by every write route.
import { randomBytes } from 'node:crypto';
import { chmod, link, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  inspectConfigDocument,
  recoverConfigValues,
  setCardOrderText,
  splitLeadingBom,
} from '../shared/config-document.ts';
import type { ConfigRecovery } from '../shared/magpie.ts';
import { modeOf, readConfigFile } from './config.ts';
import {
  recoveryReport,
  renderConfigTemplate,
  renderRebuiltConfig,
} from './config-template.ts';

export type ConfigWriteErrorCode = 'conflict' | 'unreadable' | 'not-regular' | 'write-failed';

export class ConfigWriteError extends Error {
  readonly code: ConfigWriteErrorCode;

  constructor(code: ConfigWriteErrorCode, message: string) {
    super(message);
    this.name = 'ConfigWriteError';
    this.code = code;
  }
}

const isCode = (error: unknown, code: string): boolean =>
  (error as NodeJS.ErrnoException).code === code;

const tempName = (path: string): string =>
  `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;

/**
 * Writes a temp file in the target directory, then publishes it. `exclusive`
 * uses a hard link, which fails with EEXIST instead of replacing a file that
 * appeared after the pre-check. The fallback is an exclusive `wx` open, still
 * unable to overwrite; it is only for filesystems without hard links.
 */
const writeAtomic = async (
  path: string,
  text: string,
  mode: number,
  options: { exclusive: boolean; expectedText?: string },
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temp = tempName(path);

  try {
    await writeFile(temp, text, { encoding: 'utf8', mode });
    // The temp file starts with `mode`; chmod covers a umask that narrowed it.
    await chmod(temp, mode).catch(() => undefined);

    if (options.exclusive) {
      try {
        await link(temp, path);
      } catch (error) {
        if (isCode(error, 'EEXIST')) throw error;
        // Hard links are unavailable on some filesystems. `wx` is still
        // exclusive, though it does not publish a fully written temp file.
        let handle;
        let createdHere = false;
        try {
          handle = await open(path, 'wx', mode);
          createdHere = true;
          await handle.writeFile(text, 'utf8');
          await handle.sync();
        } catch (fallbackError) {
          // Remove only the file this branch created; never an EEXIST rival.
          if (createdHere) await unlink(path).catch(() => undefined);
          throw fallbackError;
        } finally {
          await handle?.close().catch(() => undefined);
        }
      }
      return;
    }

    // Conflict check as close to publish as this process can get. A write in
    // another process between this read and the rename is not preventable.
    if (options.expectedText !== undefined) {
      let current: string;
      try {
        current = await readFile(path, 'utf8');
      } catch (error) {
        if (isCode(error, 'ENOENT')) {
          throw new ConfigWriteError('conflict', 'The config file disappeared; retry.');
        }
        throw new ConfigWriteError('conflict', 'The config file could not be re-read; retry.');
      }
      if (current !== options.expectedText) {
        throw new ConfigWriteError('conflict', 'The config file changed on disk; retry.');
      }
    }

    await rename(temp, path);
  } catch (error) {
    if (error instanceof ConfigWriteError) throw error;
    if (isCode(error, 'EEXIST')) {
      throw new ConfigWriteError('conflict', 'The config file appeared while it was being created.');
    }
    throw new ConfigWriteError('write-failed', 'The config file could not be written.');
  } finally {
    await unlink(temp).catch(() => undefined);
  }
};

const assertReadable = (
  file: Awaited<ReturnType<typeof readConfigFile>>,
): { kind: 'ok'; text: string } | { kind: 'missing' } => {
  if (file.kind === 'ok' || file.kind === 'missing') return file;
  if (file.kind === 'not-regular') {
    throw new ConfigWriteError('not-regular', 'The config path is not a regular file.');
  }
  throw new ConfigWriteError(
    'unreadable',
    `The config file could not be read (${file.code ?? 'unknown error'}).`,
  );
};

export type CreateResult = {
  created: boolean;
  present: true;
};

const createOnce = async (path: string, order: string[]): Promise<CreateResult> => {
  const existing = assertReadable(await readConfigFile(path));
  if (existing.kind === 'ok') return { created: false, present: true };

  try {
    await writeAtomic(path, renderConfigTemplate(order), 0o600, { exclusive: true });
    return { created: true, present: true };
  } catch (error) {
    if (!(error instanceof ConfigWriteError) || error.code !== 'conflict') throw error;
    // Another panel or process won the create. Keep its file untouched.
    const appeared = assertReadable(await readConfigFile(path));
    if (appeared.kind === 'ok') return { created: false, present: true };
    throw error;
  }
};

export type ConfigWriteHooks = {
  /** Test seam: runs after the fresh read and before the publish check. */
  beforePublish?: (path: string) => void | Promise<void>;
};

export type OrderSave = {
  /** The order as written, normalised by the caller's validation. */
  order: string[];
  /** Set when a structurally damaged file had to be rebuilt. */
  recovery: ConfigRecovery | null;
};

const saveOnce = async (
  path: string,
  order: string[],
  hooks?: ConfigWriteHooks,
): Promise<OrderSave> => {
  let existing = assertReadable(await readConfigFile(path));

  if (existing.kind === 'missing') {
    try {
      await writeAtomic(path, renderConfigTemplate(order), 0o600, { exclusive: true });
      return { order, recovery: null };
    } catch (error) {
      if (!(error instanceof ConfigWriteError) || error.code !== 'conflict') throw error;
      // The file appeared after the pre-check: merge into it instead of
      // overwriting whatever the user or another panel just created.
      existing = assertReadable(await readConfigFile(path));
      if (existing.kind === 'missing') throw error;
    }
  }

  const inspection = inspectConfigDocument(existing.text);
  const mode = await modeOf(path);

  if (inspection.state === 'ok') {
    const next = setCardOrderText(existing.text, order);
    if (next === null) {
      throw new ConfigWriteError('write-failed', 'The config file could not be edited.');
    }
    await hooks?.beforePublish?.(path);
    await writeAtomic(path, next, mode, { exclusive: false, expectedText: existing.text });
    return { order, recovery: null };
  }

  // Only a syntax error, duplicate key, or non-object root rebuilds the file.
  // Field-value problems stay in place and only `cardOrder` is edited above.
  const at = new Date().toISOString();
  const { body, bom } = splitLeadingBom(existing.text);
  const recovered = recoverConfigValues(body);
  const template = renderRebuiltConfig(body, order, recovered.values, at);
  const rebuilt = bom ? `\uFEFF${template}` : template;
  await hooks?.beforePublish?.(path);
  await writeAtomic(path, rebuilt, mode, { exclusive: false, expectedText: existing.text });
  return { order, recovery: recoveryReport(at, recovered) };
};

// One chain for every write in this process, so two panels cannot interleave a
// read-modify-write of the same file. A failed write does not block the queue.
let queue: Promise<unknown> = Promise.resolve();

const serialized = <T>(work: () => Promise<T>): Promise<T> => {
  const next = queue.then(work, work);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
};

/** Creates the file when missing; an existing file is left untouched. */
export const createConfigFile = (path: string, order: string[]): Promise<CreateResult> =>
  serialized(() => createOnce(path, order));

/** Merges `cardOrder`, or rebuilds a structurally damaged file. */
export const saveCardOrder = (
  path: string,
  order: string[],
  hooks?: ConfigWriteHooks,
): Promise<OrderSave> => serialized(() => saveOnce(path, order, hooks));
