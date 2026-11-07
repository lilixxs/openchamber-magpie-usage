// Reads the user's config file on every request, so editing it takes effect
// without restarting the service. The key never leaves this process.
import { lstat, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { parseConfigText } from '../shared/config-document.ts';
import {
  CONFIG_DIR_NAME,
  CONFIG_FILE_NAME,
  fallbackConfig,
  type ServiceConfig,
} from '../shared/magpie.ts';

/**
 * `$XDG_CONFIG_HOME/openchamber-magpie-usage/config.jsonc`, otherwise
 * `~/.config/openchamber-magpie-usage/config.jsonc`. Windows uses the same
 * `~/.config` layout because the host does. The old `config.json` is never
 * read, even when it exists beside the JSONC file.
 */
export const defaultConfigPath = (): string => {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const base = xdg && xdg !== '' ? xdg : join(homedir(), '.config');
  return join(base, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
};

export type ConfigRead = {
  config: ServiceConfig;
  path: string;
};

export type ConfigFileRead =
  | { kind: 'missing' }
  | { kind: 'ok'; text: string }
  /** A directory, symlink, device, or other non-regular entry. Never overwritten. */
  | { kind: 'not-regular' }
  | { kind: 'unreadable'; code: string | null };

/** Reads the file without parsing, distinguishing missing from unreadable. */
export const readConfigFile = async (path: string): Promise<ConfigFileRead> => {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { kind: 'missing' };
    return { kind: 'unreadable', code: code ?? null };
  }

  if (!info.isFile()) return { kind: 'not-regular' };

  try {
    return { kind: 'ok', text: await readFile(path, 'utf8') };
  } catch (error) {
    return { kind: 'unreadable', code: (error as NodeJS.ErrnoException).code ?? null };
  }
};

/** The file's permission bits, or 0600 when they cannot be read. */
export const modeOf = async (path: string): Promise<number> => {
  try {
    const info = await stat(path);
    const mode = info.mode & 0o777;
    return mode === 0 ? 0o600 : mode;
  } catch {
    return 0o600;
  }
};

const unreadable = (present: boolean, message: string): ServiceConfig => ({
  ...fallbackConfig(),
  present,
  validity: 'unreadable',
  issue: { kind: 'unreadable', message },
  issues: [{ field: 'document', kind: 'unreadable', message }],
});

export const readConfig = async (path: string): Promise<ConfigRead> => {
  const file = await readConfigFile(path);

  if (file.kind === 'missing') {
    // A missing file is normal: the panel then talks to the loopback gateway
    // with no key.
    return { config: fallbackConfig(), path };
  }

  if (file.kind === 'not-regular') {
    return {
      config: unreadable(false, 'The config path is not a regular file.'),
      path,
    };
  }

  if (file.kind === 'unreadable') {
    return {
      config: unreadable(
        false,
        `The config file could not be read (${file.code ?? 'unknown error'}).`,
      ),
      path,
    };
  }

  return { config: parseConfigText(file.text).config, path };
};
