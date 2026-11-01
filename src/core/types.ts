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
  /** Origin of the glyph on the line, in font units. */
  x: number;
  y: number;
  /** Horizontal advance (0 for most diacritics). */
  advance: number;
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
