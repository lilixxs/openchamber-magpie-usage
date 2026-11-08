// Guards for the packaged panel: the host loads a classic script in a sandboxed
// iframe, and the panel must never reach the network or storage on its own.
import { describe, expect, test } from 'bun:test';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const bundle = readFileSync(join(root, 'panel/main.js'), 'utf8');
const entry = readFileSync(join(root, 'src/panel/main.ts'), 'utf8');
const source = readFileSync(join(root, 'src/panel/app.ts'), 'utf8');
const css = readFileSync(join(root, 'panel/styles.css'), 'utf8');

describe('panel bundle', () => {
  test('is a classic script, not an ES module', () => {
    const head = bundle.trimStart();
    const classic = head.startsWith('(()=>') || head.startsWith('(function') || head.startsWith('!function');
    expect(classic).toBe(true);
    expect(/\bexport\s*[[{]/.test(bundle)).toBe(false);
    expect(/\bimport\s*[[{(]/.test(bundle)).toBe(false);
  });

  test('never reaches the network itself', () => {
    expect(bundle.includes('fetch(')).toBe(false);
    expect(bundle.includes('XMLHttpRequest')).toBe(false);
    expect(bundle.includes('http://127.0.0.1:3425')).toBe(false);
    expect(source.includes('fetch(')).toBe(false);
  });

  test('carries both locale bundles inline', () => {
    // The advanced panel deliberately inlines every locale: its sandbox forbids
    // a package fetch, and the bundle test proves no network path is added.
    expect(bundle.includes('panel.subtitle')).toBe(true);
    expect(bundle.includes('正在读取本地服务')).toBe(true);
  });

  test('uses only host instance storage, for the first-open marker', () => {
    for (const key of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']) {
      expect({ key, found: bundle.includes(key) }).toEqual({ key, found: false });
    }
    // The one approved exception: a versioned first-open marker in the host's
    // instance storage. It must never carry the config, path, key, order, or fold state.
    expect(source.includes('host.storage')).toBe(true);
    expect(source.includes('INIT_MARKER_KEY')).toBe(true);
    expect(source.includes("scope: 'instance'")).toBe(true);
    expect(source).not.toContain('host.storage.set(INIT_MARKER_KEY, state.');
  });

  test('talks to the service through the host bridge only', () => {
    expect(source.includes('host.serviceRequest(')).toBe(true);
    expect(entry.includes('connectHost(')).toBe(true);
    expect(entry.includes('mountPanel(')).toBe(true);
    // The entry only connects and mounts; every request goes through the seam.
    expect(entry.includes('serviceRequest(')).toBe(false);
  });

  test('carries its provider marks inline, as data URLs', () => {
    // A package-relative image path does not survive the web relay's opaque
    // origin, so every mark is part of the bundle itself: SVG documents as
    // percent-encoded SVG data URLs, raster marks as PNG data URLs.
    expect(bundle.includes('data:image/svg+xml')).toBe(true);
    expect(bundle.includes('data:image/png')).toBe(true);
  });

  test('the committed panel bundle stays within its size cap', () => {
    expect(statSync(join(root, 'panel/main.js')).size).toBeLessThanOrEqual(900 * 1024);
  });

  test('references no remote asset', () => {
    expect(/src\s*=\s*["']https?:/i.test(bundle)).toBe(false);
    expect(/url\(\s*["']?https?:/i.test(bundle)).toBe(false);
    expect(/url\(\s*["']?https?:/i.test(source)).toBe(false);
  });

  test('the generated icon set matches the shared icon contract', async () => {
    // Imported dynamically so the other bundle guards still run even while the
    // generator's files are not on disk yet.
    const panel = await import('../src/panel/logos.generated.ts');
    const shared = await import('../src/shared/provider-icons.generated.ts');
    const generated = panel.GENERATED_LOGOS as Record<
      string,
      { color: boolean; svg?: string; dataUrl?: string }
    >;
    const names = new Set<string>(shared.ICON_NAMES as readonly string[]);

    expect(typeof shared.SOURCE_SHA).toBe('string');
    expect((shared.SOURCE_SHA as string).length).toBeGreaterThan(0);

    // Every configured override name is either a packaged name or the generic
    // glyph the generated mapping itself uses.
    for (const [provider, name] of Object.entries(shared.PROVIDER_ICONS as Record<string, string>)) {
      expect({
        provider,
        name,
        packaged: names.has(name) || name === 'generic',
      }).toEqual({ provider, name, packaged: true });
    }
    for (const name of Object.keys(generated)) {
      expect({ name, packaged: names.has(name) }).toEqual({ name, packaged: true });
    }
    // And the packaged names are exactly the generated set plus `generic`,
    // which logos.ts hand-writes so the fallback always exists.
    for (const name of names) {
      if (name === 'generic') continue;
      expect({ name, generated: Object.hasOwn(generated, name) }).toEqual({ name, generated: true });
    }

    const entries = Object.entries(generated);
    expect(entries.length).toBeGreaterThan(0);
    for (const [name, entry] of entries) {
      expect(typeof entry.color).toBe('boolean');
      // Exactly one carrier: an SVG document or a raster data URL.
      const carriers = [entry.svg !== undefined && entry.svg !== '', entry.dataUrl !== undefined && entry.dataUrl !== ''];
      expect([name, carriers.filter(Boolean).length]).toEqual([name, 1]);
      // A mark labelled `-color` carries its brand colours; never a mask.
      if (name.endsWith('-color')) expect({ name, color: entry.color }).toEqual({ name, color: true });
    }

    // Raster marks arrive as inline PNG data URLs; both carrier kinds exist.
    expect(entries.some(([, entry]) => entry.dataUrl?.startsWith('data:image/png;base64,') === true)).toBe(true);
    expect(entries.some(([, entry]) => entry.color)).toBe(true);
    expect(entries.some(([, entry]) => !entry.color)).toBe(true);

    // The names the panel is known to rely on resolve through the generated
    // mapping, without hard-coding the whole table here.
    for (const id of ['claude', 'codex', 'copilot', 'antigravity', 'workbuddy', 'openrouter']) {
      const name = (shared.PROVIDER_ICONS as Record<string, string>)[id];
      expect({ id, mapped: name !== undefined && names.has(name) }).toEqual({ id, mapped: true });
    }
  });

  test('renders one pool grid per pool row', () => {
    expect(source.includes("el('div', 'q-pool')")).toBe(true);
    expect(css.includes('repeat(2, minmax(0, 1fr))')).toBe(true);
    expect(css.includes('container-type: inline-size')).toBe(true);
    expect(css.includes('@container (max-width: 260px)')).toBe(true);
  });

  test('styles use host colour tokens only', () => {
    expect(/#[0-9a-fA-F]{3,8}/.test(css)).toBe(false);
    expect(/\brgba?\(/.test(css)).toBe(false);
    expect(/\bhsla?\(/.test(css)).toBe(false);
    const vars = [...css.matchAll(/var\((--[A-Za-z0-9-]+)/g)].map((match) => match[1]);
    expect(vars.length).toBeGreaterThan(0);
    for (const name of vars) {
      expect({ name, host: name?.startsWith('--oc-') }).toEqual({ name, host: true });
    }
  });

  test('mounts its host controls outside onReady', () => {
    const ready = source.indexOf('host.onReady(');
    expect(ready).toBeGreaterThan(0);
    const beforeReady = source.slice(0, ready);
    expect(beforeReady.includes('mountButton(')).toBe(true);
    expect(beforeReady.includes('mountBadge(')).toBe(true);
    // One mount each: a repeated snapshot updates the same nodes.
    expect((source.match(/mountButton\(/g) ?? []).length).toBe(1);
    expect((source.match(/mountBadge\(/g) ?? []).length).toBe(1);
    // onReady only starts the loop; it must not mount another control.
    expect(source.slice(ready).includes('mountButton(')).toBe(false);
    expect(source.slice(ready).includes('mountBadge(')).toBe(false);
  });
});
