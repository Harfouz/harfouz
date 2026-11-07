import { Vector2 } from 'three';
import { breaksAfter, TATWEEL_CHAR } from '../core/joining';
import type { Composition } from '../core/types';
import { flattenCommands } from './geometry';

/**
 * Where connected letters meet.
 *
 * Anything that changes letters one by one (a different distortion, slant,
 * placement in space…) would open a gap at each join. The junction is the
 * seam where two connected letters touch: around it both letters use the
 * same half-and-half blend of their settings, so the two sides of the seam
 * always land on the same spot. Away from it, each letter fades back to its
 * own settings over `softness` font units.
 */

/** Horizontal extent of a letter on the line, in font units. */
export interface LetterSpan {
  letter: number;
  start: number;
  end: number;
}

/** Where two connected letters meet. */
export interface Junction {
  /** The two letters, in reading order. */
  a: number;
  b: number;
  center: Vector2;
  /** Radius of the seam: inside it, both letters share exactly the same blend. */
  radius: number;
  /** Length of the blend on each side of the seam, when it differs from the default. */
  softness?: number;
  /**
   * Length of the kashida letter `a` stretches out to this seam, if any:
   * on that side the blend runs along the whole kashida, so it slopes
   * evenly from one letter to the next instead of staying flat and then
   * kinking near the seam.
   */
  kashida?: number;
  /** How far the blend reaches into letter a and letter b (see `spanJoins`). */
  reachA?: number;
  reachB?: number;
}

/** Spans of every letter, in reading order, with whether it joins the next one. */
export function letterSpans(comp: Composition): (LetterSpan & { joinsNext: boolean })[] {
  const breaks = breaksAfter(comp.text);
  const byLetter = new Map<number, { start: number; end: number; lastCluster: number }>();
  for (const g of comp.glyphs) {
    if (g.isMark) continue;
    const s = byLetter.get(g.letter) ?? { start: Infinity, end: -Infinity, lastCluster: -1 };
    s.start = Math.min(s.start, g.x);
    s.end = Math.max(s.end, g.x + g.advance);
    s.lastCluster = Math.max(s.lastCluster, g.cluster);
    byLetter.set(g.letter, s);
  }
  return [...byLetter.entries()]
    .sort(([a], [b]) => a - b)
    .map(([letter, s]) => ({ letter, start: s.start, end: s.end, joinsNext: !breaks[s.lastCluster] }));
}

/** Vertical intervals where a set of closed polygons covers the line x = c. */
function coverage(polygons: Vector2[][], c: number): [number, number][] {
  const intervals: [number, number][] = [];
  for (const poly of polygons) {
    const ys: number[] = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.x > c !== b.x > c) ys.push(a.y + ((c - a.x) * (b.y - a.y)) / (b.x - a.x));
    }
    ys.sort((m, n) => m - n);
    for (let k = 0; k + 1 < ys.length; k += 2) intervals.push([ys[k], ys[k + 1]]);
  }
  return intervals;
}

/**
 * Find the junction of every pair of connected letters.
 *
 * Where two letters connect, both shapes cover the boundary between them:
 * we look along that boundary (a hair inside each letter) for the stretch
 * of height covered by both. That works whether the font makes letters
 * touch exactly (Amiri, Noto) or overlap a little (Reem Kufi). The junction
 * sits in the middle of that stretch and its radius covers it all. If no
 * common stretch is found, we fall back to points where the two outlines
 * touch, then to the boundary on the baseline.
 */
export function findJunctions(comp: Composition): Junction[] {
  const em = comp.unitsPerEm;
  const spans = letterSpans(comp);
  const outline = new Map<number, Vector2[][]>();
  for (const g of comp.glyphs) {
    if (g.isMark) continue;
    const polys = outline.get(g.letter) ?? [];
    let current: Vector2[] = [];
    for (const c of flattenCommands(g.commands, em / 60)) {
      if (c.type === 'Z') {
        if (current.length > 2) polys.push(current);
        current = [];
      } else {
        if (c.type === 'M' && current.length > 2) {
          polys.push(current);
          current = [];
        }
        current.push(new Vector2(c.x, c.y));
      }
    }
    if (current.length > 2) polys.push(current);
    outline.set(g.letter, polys);
  }

  // Kashida inserted after a letter: tatweel glyphs belonging to a letter
  // that has other glyphs too (a typed tatweel is a letter of its own).
  const kashidaOf = new Map<number, number>();
  for (const g of comp.glyphs) {
    if (g.isMark || comp.text[g.cluster] !== TATWEEL_CHAR) continue;
    const own = comp.glyphs.filter((o) => o.letter === g.letter && !o.isMark && comp.text[o.cluster] !== TATWEEL_CHAR).length;
    if (own) kashidaOf.set(g.letter, (kashidaOf.get(g.letter) ?? 0) + g.advance);
  }

  const junctions: Junction[] = [];
  const near = em * 0.35; // only look around the boundary
  const touch = em * 0.03; // two outlines "touch" closer than this
  const inset = em * 0.012; // how far inside each letter we look
  for (let i = 0; i < spans.length - 1; i++) {
    const A = spans[i];
    const B = spans[i + 1];
    if (!A.joinsNext) continue;
    const kashida = kashidaOf.get(A.letter);
    // Reading right to left: A ends (on its left) where B begins (on its right).
    const boundary = A.start;
    const polysA = outline.get(A.letter) ?? [];
    const polysB = outline.get(B.letter) ?? [];

    // 1. A stretch of the boundary covered by both letters.
    let best: [number, number] | null = null;
    for (const [a0, a1] of coverage(polysA, boundary + inset)) {
      for (const [b0, b1] of coverage(polysB, boundary - inset)) {
        const lo = Math.max(a0, b0);
        const hi = Math.min(a1, b1);
        if (hi > lo && (!best || hi - lo > best[1] - best[0])) best = [lo, hi];
      }
    }
    if (best) {
      junctions.push({
        a: A.letter,
        b: B.letter,
        center: new Vector2(boundary, (best[0] + best[1]) / 2),
        radius: (best[1] - best[0]) / 2 + inset + touch,
        kashida,
      });
      continue;
    }

    // 2. Points where the two outlines touch.
    const ptsA = polysA.flat().filter((p) => Math.abs(p.x - boundary) < near);
    const ptsB = polysB.flat().filter((p) => Math.abs(p.x - boundary) < near);
    const shared: Vector2[] = [];
    for (const a of ptsA) {
      for (const b of ptsB) {
        if (a.distanceTo(b) < touch) shared.push(a.clone().add(b).multiplyScalar(0.5));
      }
    }
    if (shared.length) {
      const center = shared.reduce((s, p) => s.add(p), new Vector2()).divideScalar(shared.length);
      const radius = Math.max(...shared.map((p) => p.distanceTo(center))) + touch;
      junctions.push({ a: A.letter, b: B.letter, center, radius, kashida });
      continue;
    }

    // 3. Last resort: the boundary on the baseline.
    junctions.push({ a: A.letter, b: B.letter, center: new Vector2(boundary, 0), radius: em * 0.12, kashida });
  }
  return junctions;
}

/** Eases 0 → 1 with no jump in slope or curvature at either end: joins flow without a visible kink. */
const smootherstep = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * c * (c * (c * 6 - 15) + 10);
};

/**
 * How far each join's blend reaches into its two letters (font units,
 * along the line). The blend spreads as wide as the letters allow, so
 * the stroke curves gently from one letter's placement to the next:
 *
 * - up to `softness` (or the join's own fitted softness) on each side;
 * - never past the middle of a letter's body, so a letter joined on both
 *   sides still has all of its own placement in its middle;
 * - along the whole of a kashida, which is a connecting stroke.
 *
 * `widths` (letter → width on the line) keep a letter joined on one side
 * only from being bent over its whole width.
 */
export function spanJoins(junctions: Junction[], softness: number, widths?: Map<number, number>): Junction[] {
  const kashidaAt = (l: number, j: Junction) => (j.a === l ? (j.kashida ?? 0) : 0);
  const into = (l: number, j: Junction) => {
    const soft = Math.max(j.softness ?? softness, 1);
    const own = kashidaAt(l, j);
    const others = junctions.filter((k) => k !== j && (k.a === l || k.b === l));
    let body = Infinity;
    for (const k of others) body = Math.min(body, Math.abs(k.center.x - j.center.x) - own - kashidaAt(l, k));
    const share = others.length ? 0.5 : SINGLE;
    if (!others.length && widths?.has(l)) body = widths.get(l)! - own;
    return own + Math.min(soft, Math.max(share * body, 1));
  };
  return junctions.map((j) => ({ ...j, reachA: into(j.a, j), reachB: into(j.b, j) }));
}

/** A letter joined on one side only bends over at most this share of its body. */
const SINGLE = 0.6;

/**
 * Weights of the letters influencing a point of `letter`, given the
 * junctions that letter takes part in.
 *
 * Each join blends its two letters along the line only: across the
 * stretch from `reachB` before the seam to `reachA` after it, the weight
 * eases smoothly from one letter to the other. Height doesn't count, so
 * upright strokes and dots move as one with the part of the letter under
 * them. Both letters see exactly the same blend at the same spot, so the
 * stroke never breaks, whatever the font, and it bends in a smooth curve.
 */
export function weightsFor(
  letter: number,
  junctions: Junction[],
  x: number,
  _y: number,
  softness: number,
): Map<number, number> {
  const weights = new Map<number, number>();
  let others = 0;
  for (const j of junctions) {
    if (j.a !== letter && j.b !== letter) continue;
    const soft = Math.max(j.softness ?? softness, 1e-3);
    const intoA = j.reachA ?? (j.kashida ?? 0) + soft;
    const intoB = j.reachB ?? soft;
    // Reading right to left: letter a lies at larger x, letter b at smaller x.
    const t = (x - (j.center.x - intoB)) / (intoA + intoB);
    const towardA = smootherstep(t);
    const other = j.a === letter ? j.b : j.a;
    const w = j.a === letter ? 1 - towardA : towardA;
    if (w > 0) {
      weights.set(other, (weights.get(other) ?? 0) + w);
      others += w;
    }
  }
  if (others > 1) {
    // Safety net: never more than all of it.
    for (const [k, w] of weights) weights.set(k, w / others);
    others = 1;
  }
  weights.set(letter, 1 - others);
  return weights;
}

/** Junctions a letter takes part in. */
export function junctionsOf(letter: number, junctions: Junction[]): Junction[] {
  return junctions.filter((j) => j.a === letter || j.b === letter);
}
