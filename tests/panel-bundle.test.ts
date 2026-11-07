// Guards for the packaged panel: the host loads a classic script in a sandboxed
// iframe, and the panel must never reach the network or storage on its own.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
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
    // origin, so every mark is part of the bundle itself.
    expect(bundle.includes('data:image/svg+xml')).toBe(true);
    const logos = readFileSync(join(root, 'src/panel/logos.ts'), 'utf8');
    expect(logos.includes('data:image')).toBe(false);
    // Ten marks: nine vendored from magpie plus the generic glyph.
    expect((logos.match(/\n {4}svg: "/g) ?? []).length).toBe(10);
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
