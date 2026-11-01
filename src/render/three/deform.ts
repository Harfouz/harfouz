import { Euler, Matrix4, Quaternion, Vector2, Vector3, type BufferGeometry } from 'three';
import { breaksAfter } from '../../core/joining';
import type { Composition } from '../../core/types';
import { flattenCommands } from '../../modifiers/geometry';

/**
 * Keeping connected letters attached in 3D.
 *
 * Moving or turning each letter as a rigid block opens a gap at every join.
 * Instead, we find the junction where two connected letters meet (the seam
 * where their outlines touch). Around that point both letters use the same
 * half-and-half blend of their placements, so the two sides of the seam
 * always land on the same spot. Moving away from the junction, each letter
 * fades back to its own placement over `softness` font units: the
 * connecting stroke bends, twists and stretches, and the rest of the letter
 * stays rigid.
 *
 * Working from the junction point (rather than from horizontal position)
 * matters for scripts like Amiri's, where a letter's swash can run under
 * its neighbours: those parts are far from the junction and keep following
 * their own letter.
 *
 * The placement settings (offset, pivot, angles) are blended, not rotation
 * matrices: averaging two very different matrices squashes the shape, while
 * averaging angles gives a clean ribbon-like twist.
 */

/** Horizontal extent of a letter on the line, in font units. */
export interface LetterSpan {
  letter: number;
  start: number;
  end: number;
}

/** A letter's placement: turn around `pivot`, then move by `offset`. Angles in radians. */
export interface LetterFrame {
  letter: number;
  pivot: Vector3;
  offset: Vector3;
  /** Rotation around the vertical axis. */
  turn: number;
  /** Rotation around the horizontal axis (leaning forward or back). */
  tilt: number;
}

/** Where two connected letters meet. */
export interface Junction {
  /** The two letters, in reading order. */
  a: number;
  b: number;
  center: Vector2;
  /** Radius of the seam: inside it, both letters share exactly the same blend. */
  radius: number;
}

/** The rigid transform of one frame. */
export function frameMatrix(f: Pick<LetterFrame, 'pivot' | 'offset' | 'turn' | 'tilt'>): Matrix4 {
  return new Matrix4()
    .makeTranslation(f.offset.x + f.pivot.x, f.offset.y + f.pivot.y, f.offset.z + f.pivot.z)
    .multiply(new Matrix4().makeRotationFromEuler(new Euler(f.tilt, f.turn, 0)))
    .multiply(new Matrix4().makeTranslation(-f.pivot.x, -f.pivot.y, -f.pivot.z));
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

  const junctions: Junction[] = [];
  const near = em * 0.35; // only look around the boundary
  const touch = em * 0.03; // two outlines "touch" closer than this
  const inset = em * 0.012; // how far inside each letter we look
  for (let i = 0; i < spans.length - 1; i++) {
    const A = spans[i];
    const B = spans[i + 1];
    if (!A.joinsNext) continue;
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
      junctions.push({ a: A.letter, b: B.letter, center, radius });
      continue;
    }

    // 3. Last resort: the boundary on the baseline.
    junctions.push({ a: A.letter, b: B.letter, center: new Vector2(boundary, 0), radius: em * 0.12 });
  }
  return junctions;
}

const smoothstep = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/**
 * Weights of the letters influencing a point of `letter`, given the
 * junctions that letter takes part in.
 */
export function weightsFor(
  letter: number,
  junctions: Junction[],
  x: number,
  y: number,
  softness: number,
): Map<number, number> {
  const weights = new Map<number, number>();
  let others = 0;
  for (const j of junctions) {
    const other = j.a === letter ? j.b : j.a;
    const d = Math.hypot(x - j.center.x, y - j.center.y);
    if (d <= j.radius) {
      // On the seam: exactly half and half, identical from both sides.
      return new Map([
        [letter, 0.5],
        [other, 0.5],
      ]);
    }
    const w = 0.5 * (1 - smoothstep((d - j.radius) / Math.max(softness, 1e-3)));
    if (w > 0) {
      weights.set(other, (weights.get(other) ?? 0) + w);
      others += w;
    }
  }
  if (others > 1) {
    // A very short letter between two close junctions: share fairly.
    for (const [k, w] of weights) weights.set(k, w / others);
    others = 1;
  }
  weights.set(letter, 1 - others);
  return weights;
}

/** Blended placement for points of one letter. */
class Blender {
  private pivot = new Vector3();
  private offset = new Vector3();
  readonly rotation = new Quaternion();
  private euler = new Euler();

  constructor(
    private letter: number,
    private frames: Map<number, LetterFrame>,
    private junctions: Junction[],
    private softness: number,
  ) {}

  /** Prepare the transform for a point at (x, y). */
  at(x: number, y: number) {
    let turn = 0;
    let tilt = 0;
    this.pivot.set(0, 0, 0);
    this.offset.set(0, 0, 0);
    for (const [index, w] of weightsFor(this.letter, this.junctions, x, y, this.softness)) {
      const f = this.frames.get(index);
      if (!f || w === 0) continue;
      turn += f.turn * w;
      tilt += f.tilt * w;
      this.pivot.addScaledVector(f.pivot, w);
      this.offset.addScaledVector(f.offset, w);
    }
    this.rotation.setFromEuler(this.euler.set(tilt, turn, 0));
    return this;
  }

  /** Apply the prepared transform to a point (in place). */
  point(p: Vector3): Vector3 {
    return p.sub(this.pivot).applyQuaternion(this.rotation).add(this.pivot).add(this.offset);
  }
}

/** Junctions a letter takes part in. */
export function junctionsOf(letter: number, junctions: Junction[]): Junction[] {
  return junctions.filter((j) => j.a === letter || j.b === letter);
}

/** Move one point of `letter`. */
export function deformPoint(
  letter: number,
  frames: Map<number, LetterFrame>,
  junctions: Junction[],
  p: Vector3,
  softness: number,
): Vector3 {
  const blend = new Blender(letter, frames, junctionsOf(letter, junctions), softness);
  return blend.at(p.x, p.y).point(p.clone());
}

/**
 * Deform a letter's geometry in place. Normals are turned by the same
 * blended rotation so curved surfaces keep their smooth shading.
 */
export function deformGeometry(
  geometry: BufferGeometry,
  letter: number,
  frames: Map<number, LetterFrame>,
  junctions: Junction[],
  softness: number,
) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const blend = new Blender(letter, frames, junctionsOf(letter, junctions), softness);
  const p = new Vector3();
  const n = new Vector3();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);
    blend.at(p.x, p.y).point(p);
    position.setXYZ(i, p.x, p.y, p.z);
    if (normal) {
      n.fromBufferAttribute(normal, i).applyQuaternion(blend.rotation);
      normal.setXYZ(i, n.x, n.y, n.z);
    }
  }
  position.needsUpdate = true;
  if (normal) normal.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}
