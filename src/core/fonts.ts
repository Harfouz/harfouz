import * as hb from 'harfbuzzjs';
import { parse as parseOpenType, type Font as OpenTypeFont } from 'opentype.js';
import type { PathCommand } from './types';

/** Fonts bundled with Harfouz. Files live in /public/fonts (SIL OFL 1.1). */
export const FONT_CATALOG = [
  { id: 'amiri', name: 'Amiri', url: 'fonts/amiri/Amiri-Regular.ttf' },
  { id: 'noto-naskh', name: 'Noto Naskh Arabic', url: 'fonts/noto-naskh-arabic/NotoNaskhArabic-Variable.ttf' },
] as const;

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
      .then((bytes) => createFont(entry.id, entry.name, bytes));
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
