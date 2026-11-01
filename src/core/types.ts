/**
 * Core geometry types shared by the whole pipeline:
 *   text → shaping → glyph geometry → modifiers → renderer
 *
 * All coordinates are in font units with the y axis pointing UP (the font's
 * own convention). Renderers are responsible for flipping to screen space.
 */

/** One drawing command of a glyph outline. Mirrors the SVG path vocabulary. */
export type PathCommand =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Z' };

/** A positioned glyph produced by the shaper. */
export interface ShapedGlyph {
  /** Glyph index inside the font (not a Unicode code point). */
  glyphId: number;
  /**
   * Index of the first source character this glyph belongs to.
   * A base letter and its diacritics share the same cluster, which is what
   * lets us treat "a letter" as one unit (e.g. for per-letter colors).
   */
  cluster: number;
  /**
   * Index of the source character this glyph belongs to, in the text the user
   * typed. Same as `cluster` unless kashidas were inserted before shaping.
   */
  letter: number;
  /**
   * For a diacritic, the letter it sits on; for anything else, `letter`.
   * Diacritics follow their base letter unless given their own settings.
   */
  base: number;
  /** Origin of the glyph on the line, in font units. */
  x: number;
  y: number;
  /** Horizontal advance (0 for most diacritics). */
  advance: number;
  /** Offset from the pen position chosen by the font (GPOS), e.g. to place a mark. */
  xOffset: number;
  /** True for combining marks (harakat, shadda, hamza above/below…). */
  isMark: boolean;
  /** Outline relative to the glyph origin. */
  commands: PathCommand[];
}

/** A shaped line of text, laid out left to right in visual order. */
export interface ShapedLine {
  text: string;
  glyphs: ShapedGlyph[];
  /** Total advance width of the line. */
  width: number;
  unitsPerEm: number;
  ascender: number;
  descender: number;
}

/**
 * A glyph whose outline has been placed on the line: commands are in
 * absolute line coordinates (still font units, y up). This is what geometry
 * modifiers transform and what renderers draw.
 */
export interface GlyphShape {
  letter: number;
  /** The letter a diacritic sits on (or `letter` itself). */
  base: number;
  cluster: number;
  isMark: boolean;
  /** Pen position and advance before geometric modifiers (used by the inspector). */
  x: number;
  advance: number;
  commands: PathCommand[];
}

export interface Composition {
  text: string;
  glyphs: GlyphShape[];
  width: number;
  unitsPerEm: number;
  ascender: number;
  descender: number;
}
