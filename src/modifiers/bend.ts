import type { Composition } from '../core/types';
import { flattenCommands, mapCommands, type PointMap } from './geometry';
import { findJunctions, junctionsOf, spanJoins, weightsFor } from './joins';

/** What one letter's settings do to its outline. */
export interface LetterBend {
  /** The point transformation, or null to leave the letter as it is. */
  map: PointMap | null;
  /** True when the map bends straight lines (curves are then flattened first). */
  curved: boolean;
  /** Two letters with the same key get exactly the same map. */
  key: string;
}

/**
 * Apply each letter's own point transformation (slant, distortion…) while
 * keeping connected letters attached.
 *
 * When neighbours have different settings (per-letter values, or an
 * animation that delays each letter), every point near a join is moved by
 * a blend of both letters' transformations, weighted by distance to the
 * junction (see joins.ts). On the seam the blend is half and half from
 * both sides, so the two letters meet exactly. Weights are read from the
 * point before it moves, which both sides of the seam share.
 */
export function bendLetters(comp: Composition, bendOf: (letter: number) => LetterBend): Composition {
  const bends = new Map<number, LetterBend>();
  const bend = (letter: number) => {
    let b = bends.get(letter);
    if (!b) bends.set(letter, (b = bendOf(letter)));
    return b;
  };

  // Same settings everywhere: one shared field, joins stay attached on their own.
  const keys = new Set(comp.glyphs.filter((g) => !g.isMark).map((g) => bend(g.letter).key));
  const em = comp.unitsPerEm;
  const softness = em * 0.3;
  const junctions = keys.size > 1 ? spanJoins(findJunctions(comp), softness) : [];
  const step = em / 80;

  return {
    ...comp,
    glyphs: comp.glyphs.map((g) => {
      const own = bend(g.letter);
      const near = g.isMark ? [] : junctionsOf(g.letter, junctions);
      const involved = [own, ...near.map((j) => bend(j.a === g.letter ? j.b : j.a))];
      if (involved.every((b) => !b.map)) return g;
      const commands = involved.some((b) => b.curved) ? flattenCommands(g.commands, step) : g.commands;
      if (!near.length) return { ...g, commands: mapCommands(commands, own.map!) };
      return {
        ...g,
        commands: mapCommands(commands, (p) => {
          let x = 0;
          let y = 0;
          for (const [letter, w] of weightsFor(g.letter, near, p.x, p.y, softness)) {
            const q = bend(letter).map?.(p) ?? p;
            x += q.x * w;
            y += q.y * w;
          }
          return { x, y };
        }),
      };
    }),
  };
}
