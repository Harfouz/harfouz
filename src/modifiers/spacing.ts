import { breaksAfter } from '../core/joining';
import type { ShapedLine } from '../core/types';

/**
 * Letter spacing that respects Arabic joins.
 *
 * Adding space between two connected letters would break the line that
 * links them, so extra space only goes where a letter is NOT connected to
 * the next one (after ا د ر و…, between words). Diacritics move with their
 * letter because offsets are computed per cluster.
 */
export function applySpacing(line: ShapedLine, amount: number): ShapedLine {
  if (amount === 0) return line;
  const breaks = breaksAfter(line.text);

  // Walk bases from right to left (logical order) and accumulate the shift
  // every glyph receives. Everything is pushed leftward, then re-anchored at 0.
  const bases = line.glyphs.filter((g) => !g.isMark);
  const shiftByCluster = new Map<number, number>();
  let shift = 0;
  for (let i = bases.length - 1; i >= 0; i--) {
    const g = bases[i];
    if (!shiftByCluster.has(g.cluster)) shiftByCluster.set(g.cluster, shift);
    const isLast = i === 0;
    if (!isLast && breaks[g.cluster]) shift -= amount;
  }
  const total = -shift;

  const glyphs = line.glyphs.map((g) => ({ ...g, x: g.x + total + (shiftByCluster.get(g.cluster) ?? 0) }));
  return { ...line, glyphs, width: line.width + total };
}
