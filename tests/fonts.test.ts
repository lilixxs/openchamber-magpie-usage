import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const fontsDir = join(root, 'panel', 'fonts');
const css = readFileSync(join(root, 'panel', 'styles.css'), 'utf8');

type ManifestFile = {
  name: string;
  bytes: number;
  sha256: string;
  source: string;
  modification: string;
  license: string;
};

const manifest = JSON.parse(readFileSync(join(fontsDir, 'manifest.json'), 'utf8')) as {
  chars: number;
  files: ManifestFile[];
};

describe('bundled fonts', () => {
  test('declares six faces backed by local woff2 files', () => {
    const faces = [...css.matchAll(/@font-face\s*{([^}]+)}/g)].map((match) => match[1] ?? '');
    expect(faces).toHaveLength(6);

    for (const face of faces) {
      expect(face).not.toMatch(/https?:/);
      const src = /url\("([^"]+)"\)/.exec(face)?.[1];
      expect(src).toBeDefined();
      expect(src?.startsWith('./fonts/')).toBe(true);
      expect(src?.endsWith('.woff2')).toBe(true);
      expect(existsSync(join(root, 'panel', src?.slice(2) ?? ''))).toBe(true);
    }
  });

  test('uses the renamed Chinese subset and ships no Arabic font', () => {
    expect(css).toContain('font-family: "Magpie Sans SC"');
    expect(css).not.toContain('IBM Plex Sans SC');
    expect(manifest.files).toHaveLength(6);
    expect(manifest.files.some((file) => file.name.includes('arabic'))).toBe(false);

    const chinese = manifest.files.filter((file) => file.name.startsWith('magpie-sans-sc-'));
    expect(chinese).toHaveLength(2);
    for (const file of chinese) {
      expect(file.modification).toContain('renamed Magpie Sans SC');
    }
    expect(manifest.chars).toBeGreaterThanOrEqual(3500);
  });

  test('stays within the committed size budget', () => {
    expect(manifest.files.reduce((total, file) => total + file.bytes, 0)).toBeLessThanOrEqual(1.3 * 1024 * 1024);
    const budget = {
      'plex-sans-400.woff2': 80 * 1024,
      'plex-sans-600.woff2': 80 * 1024,
      'magpie-sans-sc-400.woff2': 500 * 1024,
      'magpie-sans-sc-600.woff2': 500 * 1024,
      'plex-mono-400.woff2': 60 * 1024,
      'plex-mono-500.woff2': 60 * 1024,
    } satisfies Record<string, number>;

    for (const file of manifest.files) {
      const limit = budget[file.name as keyof typeof budget];
      expect(limit).toBeDefined();
      expect(statSync(join(fontsDir, file.name)).size).toBe(file.bytes);
      expect(file.bytes).toBeLessThanOrEqual(limit ?? 0);
      const digest = createHash('sha256').update(readFileSync(join(fontsDir, file.name))).digest('hex');
      expect(digest).toBe(file.sha256);
    }
  });

  test('keeps type sizes relative to the root scale', () => {
    const pxSizes = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((match) => match[1]);
    expect(pxSizes).toEqual(['14']);
    expect(css).not.toMatch(/font:\s*[\d.]+px/);
  });

  test('puts the bundled families on the body stack', () => {
    expect(css).toContain('"IBM Plex Sans", "Magpie Sans SC"');
    expect(css).toContain('"IBM Plex Mono"');
    expect(css).toContain('--oc-font:');
    expect(css).toContain('--oc-mono:');
  });

  test('ships the licence and modification notice', () => {
    expect(existsSync(join(fontsDir, 'OFL.txt'))).toBe(true);
    expect(existsSync(join(fontsDir, 'NOTICE.md'))).toBe(true);
    expect(readFileSync(join(fontsDir, 'NOTICE.md'), 'utf8')).toContain('Modified Version');
  });

  test('covers every Chinese character in the zh-CN bundle', () => {
    const chinese = readFileSync(join(root, 'panel', 'locales', 'zh-CN.json'), 'utf8');
    const subset = new Set(readFileSync(join(root, 'tools', 'fonts', 'chars-3500.txt'), 'utf8'));
    const missing = [...new Set([...chinese].filter((char) => /[\u4E00-\u9FFF]/.test(char)))].filter(
      (char) => !subset.has(char),
    );
    expect(missing).toEqual([]);
  });
});
