// The service's only write path: merging `cardOrder` into the user's config
// file. Reads stay in config.ts; this file exists so the write sequence (read,
// merge, temp file, mode, rename) has one owner and one serialisation point.
import { randomBytes } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { ResetNotice } from '../shared/magpie.ts';

export type RawConfig =
  | { kind: 'missing' }
  /** Present but not a JSON object, so it cannot hold `cardOrder`. */
  | { kind: 'invalid'; text: string }
  | { kind: 'ok'; value: Record<string, unknown> };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads the file as it is, without normalising anything. */
export const readRawConfig = async (path: string): Promise<RawConfig> => {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { kind: 'missing' };
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: 'invalid', text };
  }
  if (!isRecord(value)) return { kind: 'invalid', text };
  return { kind: 'ok', value };
};

/** The file's permission bits, or 0600 when they cannot be read. */
const modeOf = async (path: string): Promise<number> => {
  try {
    const info = await stat(path);
    const mode = info.mode & 0o777;
    return mode === 0 ? 0o600 : mode;
  } catch {
    return 0o600;
  }
};

/** `config.json.bak`, then `config.json.bak-<stamp>`, then a random suffix. */
const backup = async (path: string): Promise<string> => {
  const candidates = [`${path}.bak`, `${path}.bak-${stamp(new Date())}`, `${path}.bak-${stamp(new Date())}-${randomBytes(3).toString('hex')}`];
  for (const candidate of candidates) {
    try {
      await stat(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await copyFile(path, candidate);
      return candidate;
    }
  }
  // Unreachable: the random suffix makes a collision vanishingly unlikely.
  await copyFile(path, candidates[candidates.length - 1]!);
  return candidates[candidates.length - 1]!;
};

/** `20261101T031500Z`: no colons, so the name is legal on Windows too. */
const stamp = (date: Date): string => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

const writeAtomic = async (path: string, text: string, mode: number): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temp, text, { encoding: 'utf8', mode });
  try {
    // The temp file starts with `mode`; chmod covers a umask that narrowed it.
    await chmod(temp, mode).catch(() => undefined);
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
};

export type OrderSave = {
  /** The order as written, normalised by the caller's validation. */
  order: string[];
  /** Set when the previous file was unusable and had to be replaced. */
  reset: ResetNotice | null;
};

/**
 * Merges `cardOrder` into the file and rewrites it atomically.
 *
 * An unusable file is copied aside first, so the parse error is recoverable,
 * and the fresh file carries only the order: there is nothing else readable
 * to keep. Unknown top-level keys of a valid file survive, and so does the
 * key, because it was already in the file and is written back unchanged.
 */
const saveOnce = async (path: string, order: string[]): Promise<OrderSave> => {
  const raw = await readRawConfig(path);
  const at = new Date().toISOString();

  let merged: Record<string, unknown>;
  let reset: ResetNotice | null = null;
  let mode = 0o600;

  if (raw.kind === 'ok') {
    merged = { ...raw.value, cardOrder: order };
    mode = await modeOf(path);
  } else if (raw.kind === 'invalid') {
    const backupPath = await backup(path);
    merged = { cardOrder: order };
    reset = { at, backupPath };
    mode = await modeOf(path);
  } else {
    merged = { cardOrder: order };
  }

  await writeAtomic(path, `${JSON.stringify(merged, null, 2)}\n`, mode);
  return { order, reset };
};

// One chain for every write in this process, so two panels cannot interleave
// a read-modify-write of the same file.
let queue: Promise<unknown> = Promise.resolve();

export const saveCardOrder = (path: string, order: string[]): Promise<OrderSave> => {
  const next = queue.then(
    () => saveOnce(path, order),
    () => saveOnce(path, order),
  );
  queue = next.catch(() => undefined);
  return next;
};
