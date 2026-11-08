/**
 * OpenChamber loads its interface fonts from jsDelivr into the host document.
 * A guest frame has its own `FontFaceSet`, so the font stack alone does not
 * make the same face available here: the panel renders the local fallback
 * unless it declares the face itself.
 *
 * This module declares the matching `@font-face` rules for the families
 * OpenChamber offers. A custom family or a system stack is left alone; those
 * render from the local stack exactly as before.
 */

const FONT_SOURCE = 'https://cdn.jsdelivr.net/npm/@fontsource';

type FaceFamily = {
  /** OpenChamber's label, matched case-insensitively against the host stack. */
  family: string;
  weights: number[];
  /** Explicit files for a family that @fontsource does not publish. */
  urls?: Record<number, string>;
};

const SANS_FAMILIES: FaceFamily[] = [
  { family: 'Inter', weights: [400, 500, 600] },
  {
    family: 'Fixel Text',
    weights: [400, 500, 600],
    urls: {
      400: 'https://cdn.jsdelivr.net/gh/MacPaw/Fixel@f6ee910e98add47e830db87f1a754130506c11a2/fonts/webfonts/FixelText-Regular.woff2',
      500: 'https://cdn.jsdelivr.net/gh/MacPaw/Fixel@f6ee910e98add47e830db87f1a754130506c11a2/fonts/webfonts/FixelText-Medium.woff2',
      600: 'https://cdn.jsdelivr.net/gh/MacPaw/Fixel@f6ee910e98add47e830db87f1a754130506c11a2/fonts/webfonts/FixelText-SemiBold.woff2',
    },
  },
  { family: 'Geist Sans', weights: [400, 500, 600] },
  { family: 'Atkinson Hyperlegible', weights: [400, 700] },
  { family: 'Source Sans 3', weights: [400, 500, 600] },
  { family: 'Roboto', weights: [400, 500, 600] },
  { family: 'Noto Sans', weights: [400, 500, 600] },
  { family: 'DM Sans', weights: [400, 500, 600] },
  { family: 'Manrope', weights: [400, 500, 600] },
];

const MONO_FAMILIES: FaceFamily[] = [
  { family: 'JetBrains Mono', weights: [400, 500, 600] },
  { family: 'Fira Code', weights: [400, 500, 600] },
  { family: 'Geist Mono', weights: [400, 500, 600] },
  { family: 'Commit Mono', weights: [400, 500, 600] },
  { family: 'Source Code Pro', weights: [400, 500, 600] },
  { family: 'Cascadia Code', weights: [400, 500, 600] },
  { family: 'Roboto Mono', weights: [400, 500, 600] },
  { family: 'Iosevka', weights: [400, 500, 600] },
];

const BY_NAME = new Map(
  [...SANS_FAMILIES, ...MONO_FAMILIES].map((entry) => [entry.family.toLowerCase(), entry]),
);

/** The first family in a CSS font stack, without its quotes. */
const firstFamily = (stack: string): string | null => {
  const match = stack.match(/^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/);
  const raw = match?.[1] ?? match?.[2] ?? match?.[3];
  const family = raw?.trim();
  return family ? family : null;
};

/** @fontsource publishes one WOFF2 per weight under the family's slug. */
const sourceUrl = (entry: FaceFamily, weight: number): string => {
  const explicit = entry.urls?.[weight];
  if (explicit) return explicit;
  const slug = entry.family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${FONT_SOURCE}/${slug}/files/${slug}-latin-${weight}-normal.woff2`;
};

const faceRule = (entry: FaceFamily, weight: number): string =>
  `@font-face{font-family:${JSON.stringify(entry.family)};font-style:normal;font-weight:${weight};font-display:swap;src:url(${JSON.stringify(sourceUrl(entry, weight))}) format("woff2")}`;

export type HostFontFaces = {
  /** Declare faces for the host's interface and monospace stacks; repeated calls add nothing. */
  apply: (fontStack: string, monoStack: string) => void;
};

/**
 * The rules live in one `<style>` element. The host frame policy allows inline
 * styles and the package's `contributes.origins` entry allows the CDN.
 */
export const createHostFontFaces = (doc: Document): HostFontFaces => {
  const styleId = 'oc-magpie-host-fonts';
  const declared = new Set<string>();
  let style = doc.getElementById(styleId) as HTMLStyleElement | null;

  const apply = (fontStack: string, monoStack: string): void => {
    const rules: string[] = [];
    for (const stack of [fontStack, monoStack]) {
      const family = firstFamily(stack);
      if (!family) continue;
      const entry = BY_NAME.get(family.toLowerCase());
      if (!entry || declared.has(entry.family)) continue;
      declared.add(entry.family);
      for (const weight of entry.weights) rules.push(faceRule(entry, weight));
    }
    if (rules.length === 0) return;
    if (!style) {
      style = doc.createElement('style');
      style.id = styleId;
      (doc.head ?? doc.documentElement).append(style);
    }
    style.textContent = `${style.textContent ?? ''}${rules.join('\n')}\n`;
  };

  return { apply };
};
