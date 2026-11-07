import { Euler, Matrix4, Quaternion, ShapeUtils, Vector3, type Vector2, type BufferGeometry, type Shape } from 'three';
import { junctionsOf, spanJoins, weightsFor, type Junction } from '../../modifiers/joins';

export { findJunctions, junctionsOf, letterSpans, weightsFor, type Junction, type LetterSpan } from '../../modifiers/joins';

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

/** The rigid transform of one frame. */
export function frameMatrix(f: Pick<LetterFrame, 'pivot' | 'offset' | 'turn' | 'tilt'>): Matrix4 {
  return new Matrix4()
    .makeTranslation(f.offset.x + f.pivot.x, f.offset.y + f.pivot.y, f.offset.z + f.pivot.z)
    .multiply(new Matrix4().makeRotationFromEuler(new Euler(f.tilt, f.turn, 0)))
    .multiply(new Matrix4().makeTranslation(-f.pivot.x, -f.pivot.y, -f.pivot.z));
}

/**
 * Give each join a blend long enough for how far apart its two letters
 * were moved. A letter lifted, shifted or turned a lot would otherwise
 * have to cover the whole distance within `softness`, making a sharp kink;
 * here the connecting stroke never gets much steeper than 45°, like a
 * calligrapher's pen sweeping from one letter to the next.
 *
 * Once a join really moves, its blend also spans the narrower of its two
 * letters (`widths`, in font units): a short letter between two moved
 * neighbours then follows one continuous sweep instead of making a step.
 * Everything stays under `max` (font units) so letters keep most of their
 * shape.
 */
export function fitJoins(
  junctions: Junction[],
  frames: Map<number, LetterFrame>,
  softness: number,
  max: number,
  widths: Map<number, number> = new Map(),
): Junction[] {
  const cap = Math.max(softness, max);
  const fitted = junctions.map((j) => {
    const a = frames.get(j.a);
    const b = frames.get(j.b);
    if (!a || !b) return j;
    const seam = new Vector3(j.center.x, j.center.y, 0);
    const gap = seam.clone().applyMatrix4(frameMatrix(a)).distanceTo(seam.clone().applyMatrix4(frameMatrix(b)));
    // Fades in with the move, so a tiny nudge keeps the chosen softness.
    const moved = Math.min(1, gap / Math.max(softness, 1e-3));
    const across = Math.min(widths.get(j.a) ?? 0, widths.get(j.b) ?? 0) * moved;
    return { ...j, softness: Math.min(Math.max(softness, gap * 1.25, across), cap) };
  });
  return spanJoins(fitted, softness, widths.size ? widths : undefined);
}

/**
 * A tatweel (ـ) is only a connecting stroke, so it should not stay behind
 * when the letters around it move: each run of connectors gets placements
 * spread evenly between the letter before and the letter after it, plus
 * whatever the connector was given on its own (`extra`). The stroke then
 * flows from one letter to the next instead of dipping between them.
 * `order` lists letters in reading order. Frames are updated in place.
 */
export function bridgeConnectors(
  order: number[],
  frames: Map<number, LetterFrame>,
  isConnector: (letter: number) => boolean,
  extra: (letter: number) => Pick<LetterFrame, 'offset' | 'turn' | 'tilt'>,
) {
  for (let k = 0; k < order.length; k++) {
    if (!isConnector(order[k])) continue;
    let before = k - 1;
    while (before >= 0 && isConnector(order[before])) before--;
    let after = k + 1;
    while (after < order.length && isConnector(order[after])) after++;
    const from = frames.get(order[before]);
    const to = frames.get(order[after]);
    const own = frames.get(order[k]);
    if (!from || !to || !own) continue; // at the very start or end: keeps its own placement
    const t = (k - before) / (after - before);
    const e = extra(order[k]);
    frames.set(order[k], {
      letter: order[k],
      pivot: from.pivot.clone().lerp(to.pivot, t),
      offset: from.offset.clone().lerp(to.offset, t).add(e.offset),
      turn: from.turn + (to.turn - from.turn) * t + e.turn,
      tilt: from.tilt + (to.tilt - from.tilt) * t + e.tilt,
    });
  }
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

/** Joins with their reach worked out (see `spanJoins`), if not done already. */
const spanned = (junctions: Junction[], softness: number) =>
  junctions.every((j) => j.reachA !== undefined) ? junctions : spanJoins(junctions, softness);

/** Move one point of `letter`. */
export function deformPoint(
  letter: number,
  frames: Map<number, LetterFrame>,
  junctions: Junction[],
  p: Vector3,
  softness: number,
): Vector3 {
  const blend = new Blender(letter, frames, junctionsOf(letter, spanned(junctions, softness)), softness);
  return blend.at(p.x, p.y).point(p.clone());
}

/** Whether two closed outlines overlap or come within `near` of each other. */
function touching(a: Vector2[], b: Vector2[], near: number): boolean {
  const box = (pts: Vector2[]) => pts.reduce((r, p) => [Math.min(r[0], p.x), Math.min(r[1], p.y), Math.max(r[2], p.x), Math.max(r[3], p.y)], [Infinity, Infinity, -Infinity, -Infinity]);
  const [ax0, ay0, ax1, ay1] = box(a);
  const [bx0, by0, bx1, by1] = box(b);
  if (ax0 > bx1 + near || bx0 > ax1 + near || ay0 > by1 + near || by0 > ay1 + near) return false;
  const inside = (p: Vector2, poly: Vector2[]) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const u = poly[i], v = poly[j];
      if (u.y > p.y !== v.y > p.y && p.x < ((v.x - u.x) * (p.y - u.y)) / (v.y - u.y) + u.x) c = !c;
    }
    return c;
  };
  const toSegment = (p: Vector2, u: Vector2, v: Vector2) => {
    const dx = v.x - u.x, dy = v.y - u.y;
    const t = Math.max(0, Math.min(1, ((p.x - u.x) * dx + (p.y - u.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p.x - u.x - t * dx, p.y - u.y - t * dy);
  };
  const close = (pts: Vector2[], poly: Vector2[]) =>
    pts.some((p) => inside(p, poly) || poly.some((u, i) => toSegment(p, u, poly[(i + 1) % poly.length]) < near));
  return close(a, b) || close(b, a);
}

/** Where a point takes its placement from, if not from itself (see `anchorsFor`). */
export type Anchor = (x: number, y: number) => { x: number; y: number } | null;

/**
 * Dots and other small pieces of a letter (and its diacritics) move with
 * the part of the letter they belong to. Placement blends with distance
 * from the joins, so on a short letter between two joins a dot high above
 * the stroke would otherwise take more of the letter's own move than the
 * stroke under it, and float off. Each piece instead moves rigidly, as the
 * nearest point of the letter's body does.
 *
 * `body` is the letter's shapes and `seams` where it joins its neighbours:
 * the shapes reaching a seam are the body, the rest are pieces (with no
 * seam, the largest shape is the body). `pieces`, if given, are anchored
 * as one (a diacritic).
 */
export function anchorsFor(body: Shape[], seams: { x: number; y: number }[], em: number, pieces?: Shape[]): Anchor {
  const near = 0.03 * em;
  const sized = body.map((shape) => {
    const pts = shape.getPoints(4);
    const touches = seams.some((c) => pts.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < near));
    return { shape, pts, touches, area: Math.abs(ShapeUtils.area(pts)) };
  });
  // Some fonts draw one letter (or each piece of a kashida) as several
  // overlapping outlines: every piece that touches the body is body too,
  // so only pieces standing on their own (dots) move as one block.
  const inBody = new Set(sized.filter((s) => s.touches));
  if (!inBody.size && sized.length) inBody.add(sized.reduce((a, b) => (b.area > a.area ? b : a)));
  for (let grew = true; grew; ) {
    grew = false;
    for (const s of sized) {
      if (inBody.has(s)) continue;
      if ([...inBody].some((b) => touching(s.pts, b.pts, near))) {
        inBody.add(s);
        grew = true;
      }
    }
  }
  const isBody = (s: (typeof sized)[number]) => inBody.has(s);
  const main = sized.filter(isBody).map((s) => s.shape);
  const small = pieces ?? sized.filter((s) => !isBody(s)).map((s) => s.shape);
  if (!small.length || !main.length) return () => null;
  const outline = main.flatMap((s) => s.getPoints(4));
  const islands = small.map((shape) => {
    const pts = shape.getPoints(4);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) (x0 = Math.min(x0, p.x)), (x1 = Math.max(x1, p.x)), (y0 = Math.min(y0, p.y)), (y1 = Math.max(y1, p.y));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    let best = outline[0];
    for (const p of outline) if (Math.hypot(p.x - cx, p.y - cy) < Math.hypot(best.x - cx, best.y - cy)) best = p;
    const pad = 0.05 * Math.max(x1 - x0, y1 - y0, 1);
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad, anchor: { x: best.x, y: best.y } };
  });
  if (pieces) return () => islands[0].anchor; // a diacritic: the whole geometry is one piece
  return (x, y) => islands.find((i) => x >= i.x0 && x <= i.x1 && y >= i.y0 && y <= i.y1)?.anchor ?? null;
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
  anchor: Anchor = () => null,
) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const blend = new Blender(letter, frames, junctionsOf(letter, spanned(junctions, softness)), softness);
  const p = new Vector3();
  const n = new Vector3();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);
    const at = anchor(p.x, p.y);
    blend.at(at ? at.x : p.x, at ? at.y : p.y).point(p);
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
