// Reads the user's config file on every request, so editing it takes effect
// without restarting the service. The key never leaves this process.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  CONFIG_DIR_NAME,
  CONFIG_FILE_NAME,
  fallbackConfig,
  parseConfigText,
  type ServiceConfig,
} from '../shared/magpie.ts';

/**
 * `$XDG_CONFIG_HOME/openchamber-magpie-usage/config.json`, otherwise
 * `~/.config/openchamber-magpie-usage/config.json`. Windows uses the same
 * `~/.config` layout because the host does.
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

const fallbackWithIssue = (present: boolean, kind: 'unreadable', message: string): ServiceConfig => ({
  ...fallbackConfig(),
  present,
  issue: { kind, message },
});

export const readConfig = async (path: string): Promise<ConfigRead> => {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // A missing file is normal: the panel then talks to the loopback gateway
      // with no key.
      return { config: fallbackConfig(), path };
    }
    return {
      config: fallbackWithIssue(false, 'unreadable', `The config file could not be read (${code ?? 'unknown error'}).`),
      path,
    };
  }

  return { config: parseConfigText(text).config, path };
};
