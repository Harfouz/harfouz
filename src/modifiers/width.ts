import type { ShapedLine } from '../core/types';
import { mapCommands } from './geometry';

/**
 * Horizontal stretch, letter by letter.
 *
 * Each glyph is scaled around its own origin, then the line is laid out
 * again so the next glyph starts where the stretched one ends. Arabic joins
 * sit on the glyph edges, so connected letters stay connected even when
 * each has its own width. Diacritics follow their letter's factor.
 */
export function applyWidth(line: ShapedLine, widthPercent: (letter: number) => number): ShapedLine {
  let pen = 0;
  let changed = false;
  const glyphs = line.glyphs.map((g) => {
    const s = widthPercent(g.letter) / 100;
    if (s !== 1) changed = true;
    const glyph = {
      ...g,
      x: pen + g.xOffset * s,
      advance: g.advance * s,
      xOffset: g.xOffset * s,
      commands: s === 1 ? g.commands : mapCommands(g.commands, (p) => ({ x: p.x * s, y: p.y })),
    };
    pen += g.advance * s;
    return glyph;
  });
  return changed ? { ...line, glyphs, width: pen } : line;
}
