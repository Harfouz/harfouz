import * as hb from 'harfbuzzjs';
import { parse as parseOpenType, type Font as OpenTypeFont } from 'opentype.js';
import type { PathCommand } from './types';

/** Fonts bundled with Harfouz. Files live in /public/fonts (SIL OFL 1.1, see CREDITS.md). */
export const FONT_CATALOG = [
  // Naskh: the everyday book hand.
  { id: 'amiri', name: 'Amiri', style: 'Naskh', url: 'fonts/amiri/Amiri-Regular.ttf' },
  { id: 'noto-naskh', name: 'Noto Naskh Arabic', style: 'Naskh', url: 'fonts/noto-naskh-arabic/NotoNaskhArabic-Variable.ttf' },
  { id: 'scheherazade-new', name: 'Scheherazade New', style: 'Naskh', url: 'fonts/scheherazade-new/ScheherazadeNew-Regular.ttf' },
  { id: 'markazi-text', name: 'Markazi Text', style: 'Naskh', url: 'fonts/markazi-text/MarkaziText-Variable.ttf' },
  // Kufi: geometric, angular.
  { id: 'reem-kufi', name: 'Reem Kufi', style: 'Kufi', url: 'fonts/reem-kufi/ReemKufi-Variable.ttf' },
  // Ruqaa: quick, slanted handwriting.
  { id: 'aref-ruqaa', name: 'Aref Ruqaa', style: 'Ruqaa', url: 'fonts/aref-ruqaa/ArefRuqaa-Regular.ttf' },
  // Sans: contemporary, even strokes.
  { id: 'cairo', name: 'Cairo', style: 'Sans', url: 'fonts/cairo/Cairo-Variable.ttf' },
  { id: 'tajawal', name: 'Tajawal', style: 'Sans', url: 'fonts/tajawal/Tajawal-Regular.ttf' },
  { id: 'lemonada', name: 'Lemonada', style: 'Sans', url: 'fonts/lemonada/Lemonada-Variable.ttf' },
  // Display: for titles and posters.
  { id: 'el-messiri', name: 'El Messiri', style: 'Display', url: 'fonts/el-messiri/ElMessiri-Variable.ttf' },
  { id: 'lalezar', name: 'Lalezar', style: 'Display', url: 'fonts/lalezar/Lalezar-Regular.ttf' },
  { id: 'rakkas', name: 'Rakkas', style: 'Display', url: 'fonts/rakkas/Rakkas-Regular.ttf' },
] as const;

/** CSS font-family under which a bundled font is registered in the page. */
export const cssFamily = (id: string) => `Harfouz ${id}`;

export type FontId = (typeof FONT_CATALOG)[number]['id'];

/**
 * A font loaded twice from the same bytes:
 * - HarfBuzz decides WHICH glyphs to use and WHERE (shaping),
 * - opentype.js gives us each glyph's outline.
 * Both read the same file, so glyph indices match.
 */
export interface LoadedFont {
  id: string;
  name: string;
  hbFont: hb.Font;
  otFont: OpenTypeFont;
  hbFace: hb.Face;
  unitsPerEm: number;
  ascender: number;
  descender: number;
  /** Outline cache, keyed by glyph index. */
  outlines: Map<number, PathCommand[]>;
}

export function createFont(id: string, name: string, bytes: ArrayBuffer): LoadedFont {
  const hbFace = new hb.Face(new hb.Blob(bytes));
  const hbFont = new hb.Font(hbFace);
  const otFont = parseOpenType(bytes);
  const extents = hbFont.hExtents();
  return {
    id,
    name,
    hbFont,
    hbFace,
    otFont,
    unitsPerEm: hbFace.upem,
    ascender: extents.ascender,
    descender: extents.descender,
    outlines: new Map(),
  };
}

const loaded = new Map<string, Promise<LoadedFont>>();

/** Fetch a bundled font once and keep it in memory. */
export function loadFont(id: FontId): Promise<LoadedFont> {
  const entry = FONT_CATALOG.find((f) => f.id === id);
  if (!entry) throw new Error(`Unknown font: ${id}`);
  let promise = loaded.get(id);
  if (!promise) {
    promise = fetch(import.meta.env.BASE_URL + entry.url)
      .then((res) => {
        if (!res.ok) throw new Error(`Could not load ${entry.url} (${res.status})`);
        return res.arrayBuffer();
      })
      .then((bytes) => {
        // Also make the font available to CSS (the 2D inspector compares
        // against the browser's own rendering).
        if (typeof FontFace !== 'undefined') {
          const face = new FontFace(cssFamily(entry.id), bytes.slice(0));
          document.fonts.add(face);
          face.load().catch(() => {});
        }
        return createFont(entry.id, entry.name, bytes);
      });
    loaded.set(id, promise);
  }
  return promise;
}

/** Outline of a glyph in font units (y up), read with opentype.js. */
export function glyphOutline(font: LoadedFont, glyphId: number): PathCommand[] {
  let commands = font.outlines.get(glyphId);
  if (!commands) {
    const glyph = font.otFont.glyphs.get(glyphId);
    commands = (glyph.path.commands as PathCommand[]).map((c) => ({ ...c }));
    font.outlines.set(glyphId, commands);
  }
  return commands;
}
