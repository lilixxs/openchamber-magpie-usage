/**
 * Provider marks for the quota cards.
 *
 * The marks are vendored from magpie's own icon assets (yetone/magpie,
 * internal/gui/assets/icons/, MIT). The marks belong to their owners; they are
 * used here only to label the gateway a card reports on. See README 许可 for
 * the attribution.
 *
 * The data lives in `logos.generated.ts`, written by `tools/icons/sync.ts`;
 * do not hand-edit it. Everything here is inline: an SVG string or
 * a data URL, never a package-relative request or a remote image. Colour marks
 * go into an `img`, so duplicate gradient and clip ids in two cards cannot
 * collide; single-colour marks are used as a mask over `currentColor` and
 * follow the host theme.
 */
import { GENERATED_LOGOS } from './logos.generated.ts';

export type LogoEntry = {
  /** True when the mark carries its brand colours and must not be masked. */
  color: boolean;
  /** The SVG document, verbatim, for a mark shipped as SVG. */
  svg?: string;
  /** The image data URL, for a mark shipped as a raster file. */
  dataUrl?: string;
};

/**
 * A plain glyph for providers without a packaged mark. Not from magpie, and
 * deliberately not part of the generated data: the fallback must always exist,
 * even if the generator's source is unavailable.
 */
const GENERIC: LogoEntry = {
  color: false,
  svg: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill-rule=\"evenodd\" d=\"M12 2.2a9.8 9.8 0 100 19.6 9.8 9.8 0 000-19.6zm.1 4.1a4 4 0 014 4c0 1.4-.7 2.2-1.6 2.9-.8.6-1.2 1-1.2 1.9v.6h-2.3v-.9c0-1.6.7-2.5 1.8-3.2.8-.6 1.2-1 1.2-1.6 0-.9-.7-1.5-1.6-1.5-.9 0-1.6.5-1.9 1.4l-2.2-1.2a4.3 4.3 0 013.8-2.4zm-1.2 11h2.4v2.4h-2.4z\"/></svg>",
};

/**
 * Packaged marks, by icon name (the file name without `.svg`; PNG marks keep
 * their `.png`). `generic` is always this repo's glyph, even if the generator
 * ever ships a mark under that name.
 */
export const LOGOS: Readonly<Record<string, LogoEntry>> = { ...GENERATED_LOGOS, generic: GENERIC };

/**
 * The entry for a name, with the generic glyph for anything that did not ship.
 * Own properties only: `constructor` or `__proto__` cannot reach Object
 * internals and render a broken mark.
 */
export const logoEntry = (name: string): LogoEntry => {
  if (!Object.prototype.hasOwnProperty.call(LOGOS, name)) return GENERIC;
  return LOGOS[name] ?? GENERIC;
};

/**
 * The inline URI for an entry: SVG documents are percent-encoded UTF-8; raster
 * marks already carry a data URL. `null` only for an entry that carries
 * neither.
 */
export const logoDataUri = (entry: LogoEntry): string | null => {
  if (entry.svg !== undefined && entry.svg !== '') {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(entry.svg)}`;
  }
  if (entry.dataUrl !== undefined && entry.dataUrl !== '') return entry.dataUrl;
  return null;
};
