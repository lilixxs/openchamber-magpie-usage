import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseManifestJson } from '@openchamber/sdk/schemas';

import pkg from '../package.json';

const root = join(import.meta.dir, '..');
const manifestJson = readFileSync(join(root, 'package.json'), 'utf8');

describe('package manifest', () => {
  test('parses as an installable OpenChamber package', () => {
    const result = parseManifestJson(manifestJson);
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    expect(result.version).toBe(pkg.version);
    expect(result.manifest.contributes.panel.id).toBe('magpie-usage');
  });

  test('declares entries that exist in the package', () => {
    const result = parseManifestJson(manifestJson);
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);

    const panelEntry = result.manifest.contributes.panel.entry;
    if (!panelEntry) throw new Error('panel.entry is missing');
    expect(existsSync(join(root, panelEntry))).toBe(true);

    const service = result.manifest.contributes.service;
    expect(service?.runtime).toBe('host');
    expect(service?.entry.endsWith('.js')).toBe(true);
  });

  test('the panel page loads only local scripts that exist', () => {
    const html = readFileSync(join(root, 'panel/index.html'), 'utf8');
    const sources = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((src): src is string => typeof src === 'string');

    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources) {
      expect(src.startsWith('http')).toBe(false);
      expect(existsSync(join(root, 'panel', src))).toBe(true);
    }
  });
});
