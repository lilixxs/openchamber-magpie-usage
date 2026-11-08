// The panel cannot see the host document's FontFace set, so it declares the
// host's interface font itself. These tests pin the declaration, not the
// network: no request leaves the process.
import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { createHostFontFaces } from '../src/panel/fonts.ts';

const setup = () => {
  const dom = new Window({ url: 'https://openchamber.test/' });
  const fonts = createHostFontFaces(dom.document as unknown as Document);
  return { dom, fonts };
};

const css = (dom: Window): string =>
  dom.document.getElementById('oc-magpie-host-fonts')?.textContent ?? '';

const count = (text: string, needle: string): number => text.split(needle).length - 1;

describe('host font faces', () => {
  test('declares the host sans and mono families at the host weights', () => {
    const { dom, fonts } = setup();
    fonts.apply('"Noto Sans", "SF Pro Text", sans-serif', '"Fira Code", monospace');
    const text = css(dom);

    expect(text).toContain('font-family:"Noto Sans"');
    expect(text).toContain('font-weight:400');
    expect(text).toContain('font-weight:500');
    expect(text).toContain('font-weight:600');
    expect(text).toContain(
      'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2',
    );
    expect(text).toContain('font-family:"Fira Code"');
    expect(text).toContain(
      'https://cdn.jsdelivr.net/npm/@fontsource/fira-code/files/fira-code-latin-600-normal.woff2',
    );
  });

  test('leaves a system or custom stack to the local fallback', () => {
    const { dom, fonts } = setup();
    fonts.apply('system-ui, "Segoe UI", sans-serif', 'ui-monospace, monospace');

    expect(dom.document.getElementById('oc-magpie-host-fonts')).toBeNull();
  });

  test('uses the host CDN files for Fixel Text', () => {
    const { dom, fonts } = setup();
    fonts.apply('"Fixel Text", sans-serif', '');

    expect(css(dom)).toContain('FixelText-SemiBold.woff2');
  });

  test('loads the two weights the host loads for Atkinson Hyperlegible', () => {
    const { dom, fonts } = setup();
    fonts.apply('"Atkinson Hyperlegible", sans-serif', '');

    expect(css(dom)).toContain('font-weight:400');
    expect(css(dom)).toContain('font-weight:700');
    expect(css(dom)).not.toContain('font-weight:500');
  });

  test('adds each family once across repeated host snapshots', () => {
    const { dom, fonts } = setup();
    fonts.apply('"Noto Sans", sans-serif', '"Fira Code", monospace');
    fonts.apply('"Noto Sans", sans-serif', '"Fira Code", monospace');

    const text = css(dom);
    expect(count(text, 'font-family:"Noto Sans"')).toBe(3);
    expect(count(text, 'font-family:"Fira Code"')).toBe(3);
    expect(dom.document.querySelectorAll('#oc-magpie-host-fonts').length).toBe(1);
  });
});
