import ClipperLib from 'clipper-lib';
import type { Composition, GlyphShape, PathCommand } from '../core/types';
import { flattenCommands } from './geometry';
import { letterSpans } from './joins';

/**
 * Weight: makes letters thinner or bolder, like a pen with a finer or
 * broader nib. `weightOf` gives each letter's value in percent:
 *
 * - Bolder (positive): the outline grows by the same distance everywhere,
 *   with round corners. 100 % adds `BOLD_EM` of an em on every side.
 * - Thinner (negative): every stroke loses that percentage of its own
 *   width. A constant erosion would make hairlines vanish long before the
 *   main strokes get thin; here fine strokes stay fine, never disappear,
 *   and the letter keeps its contrast. The local stroke width is the size
 *   of the largest circle that fits inside the letter at each point of the
 *   outline.
 *
 * Connected letters must stay attached. Changing a letter on its own would
 * also move the end of its connecting stroke and open a gap at the join,
 * so a letter is processed together with the letters it joins, then cut
 * back to its own outline: its stroke keeps running right up to the seam.
 *
 * Outlines are offset with the Clipper polygon library, so the result is
 * always a clean shape whatever the value.
 */
export function applyWeight(comp: Composition, weightOf: (letter: number) => number): Composition {
  const values = new Map<number, number>();
  const weight = (letter: number) => {
    if (!values.has(letter)) values.set(letter, weightOf(letter));
    return values.get(letter)!;
  };
  if (comp.glyphs.every((g) => weight(g.letter) === 0)) return comp;

  const em = comp.unitsPerEm;
  const polygons = new Map<GlyphShape, Path[]>();
  // Each glyph is first tidied on its own (union with its own fill rule):
  // some outlines loop over themselves, and adding those loops' turning to
  // a neighbour's could cancel out and punch a hole where letters meet.
  const polysOf = (g: GlyphShape) => {
    if (!polygons.has(g)) polygons.set(g, union(toPaths(g.commands, em / 120)));
    return polygons.get(g)!;
  };

  // Letters joined to each letter (from the Arabic joining rules).
  const joined = new Map<number, number[]>();
  const spans = letterSpans(comp);
  for (let i = 0; i < spans.length - 1; i++) {
    if (!spans[i].joinsNext) continue;
    const a = spans[i].letter;
    const b = spans[i + 1].letter;
    joined.set(a, [...(joined.get(a) ?? []), b]);
    joined.set(b, [...(joined.get(b) ?? []), a]);
  }
  const bodies = new Map<number, GlyphShape[]>();
  for (const g of comp.glyphs) if (!g.isMark) bodies.set(g.letter, [...(bodies.get(g.letter) ?? []), g]);

  return {
    ...comp,
    glyphs: comp.glyphs.map((g) => {
      const w = weight(g.letter);
      if (w === 0 || !g.commands.length) return g;
      const own = polysOf(g);
      if (w > 0) return { ...g, commands: toCommands(offset(own, (w / 100) * BOLD_EM * em * SCALE, em)) };
      const gap = (em / 100) * SCALE;
      const around = g.isMark ? [] : (joined.get(g.letter) ?? []).flatMap((l) => bodies.get(l) ?? []);
      // Letters that only just touch (a hair apart in some fonts) are closed
      // up into one shape first: grown a little, then shrunk back.
      const context = around.length
        ? offset(offset(union([...own, ...around.flatMap(polysOf)]), gap, em), -gap, em)
        : own;
      const { shape, tidied, tidy } = thinned(context, Math.min(-w, MAX_THIN) / 100, em);
      // Around the joins, keep the untidied shape: tidying could cut a thin
      // bridge between two letters that only just meet.
      const seams = around.length ? intersect(shape, offset(union(around.flatMap(polysOf)), 2 * tidy + gap, em)) : [];
      return { ...g, commands: toCommands(intersect(seams.length ? union([...tidied, ...seams]) : tidied, own)) };
    }),
  };
}

/** How far 100 % bolder grows the outline, in ems. */
export const BOLD_EM = 0.08;
/** Strokes never lose more than this percentage of their width. */
const MAX_THIN = 75;

type Path = { X: number; Y: number }[];

/** Font units are multiplied by this before Clipper rounds them to integers. */
const SCALE = 8;

/**
 * Thin a shape so each stroke keeps `1 - t` of its width: every outline
 * point moves inwards by `t` times the radius of the largest circle that
 * fits inside the letter there (half the local stroke width).
 */
function thinned(shape: Path[], t: number, em: number): { shape: Path[]; tidied: Path[]; tidy: number } {
  const spacing = (em / 160) * SCALE;
  const sources = shape.filter((c) => resample(c, spacing).length >= 3);
  const contours = sources.map((c) => resample(c, spacing));
  // Every outline point, for the inscribed-circle search.
  const total = contours.reduce((n, c) => n + c.length, 0);
  const qx = new Float64Array(total);
  const qy = new Float64Array(total);
  const owner = new Int32Array(total); // contour of each point
  const place = new Int32Array(total); // its index on that contour
  let k = 0;
  contours.forEach((c, ci) => c.forEach((p, i) => ((qx[k] = p.x), (qy[k] = p.y), (owner[k] = ci), (place[k++] = i))));

  /** Whether another contour (a counter) sits inside contour `ci`. */
  const holeInside = (ci: number) =>
    sources.some((other, oi) => oi !== ci && ClipperLib.Clipper.PointInPolygon(other[0], sources[ci]) !== 0);

  const maxRadius = 0.2 * em * SCALE;
  // Grid of outline points: a point at distance d can only make a circle of
  // radius d / 2 or more, so the search stops once rings get far enough.
  const cell = 0.02 * em * SCALE;
  let minX = Infinity;
  let minY = Infinity;
  for (let j = 0; j < total; j++) (minX = Math.min(minX, qx[j])), (minY = Math.min(minY, qy[j]));
  const grid = new Map<number, number[]>();
  const cellKey = (cx: number, cy: number) => cx * 65536 + cy;
  for (let j = 0; j < total; j++) {
    const key = cellKey(Math.floor((qx[j] - minX) / cell), Math.floor((qy[j] - minY) / cell));
    const bucket = grid.get(key);
    if (bucket) bucket.push(j);
    else grid.set(key, [j]);
  }

  const moved: Path[] = [];
  const blobs: Path[] = [];
  contours.forEach((c, ci) => {
    const n = c.length;
    const at = <T,>(list: ArrayLike<T>, i: number) => list[(i + n) % n];
    const nx = new Float64Array(n);
    const ny = new Float64Array(n);
    const radius = new Float64Array(n);
    // How sharply the outline turns at each point (positive: a convex corner).
    const turn = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      // Tangent over a few points, so tiny wobbles don't tilt the normal.
      // Clipper's outer contours turn counter-clockwise and holes
      // clockwise: the inside of the letter is always on the left.
      const a = at(c, i - NEAR);
      const b = at(c, i + NEAR);
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      nx[i] = -(b.y - a.y) / len;
      ny[i] = (b.x - a.x) / len;
      const inX = c[i].x - a.x;
      const inY = c[i].y - a.y;
      const outX = b.x - c[i].x;
      const outY = b.y - c[i].y;
      turn[i] = Math.atan2(inX * outY - inY * outX, inX * outX + inY * outY);

      // Largest circle tangent here that no other outline point enters.
      let r = maxRadius;
      const px = c[i].x;
      const py = c[i].y;
      const cx = Math.floor((px - minX) / cell);
      const cy = Math.floor((py - minY) / cell);
      for (let ring = 0; (ring - 1) * cell <= 2 * r; ring++) {
        for (let gx = cx - ring; gx <= cx + ring; gx++) {
          for (let gy = cy - ring; gy <= cy + ring; gy++) {
            if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) !== ring) continue;
            const bucket = grid.get(cellKey(gx, gy));
            if (!bucket) continue;
            for (const j of bucket) {
              // The outline's own next few points only measure its wobble.
              if (owner[j] === ci) {
                const step = Math.abs(place[j] - i);
                if (Math.min(step, n - step) <= NEAR) continue;
              }
              const dx = qx[j] - px;
              const dy = qy[j] - py;
              const along = dx * nx[i] + dy * ny[i];
              if (along <= 1e-9) continue;
              const candidate = (dx * dx + dy * dy) / (2 * along);
              if (candidate < r) r = candidate;
            }
          }
        }
      }
      radius[i] = r;
    }

    // A median drops isolated readings.
    const measured = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      measured[i] = [-2, -1, 0, 1, 2].map((d) => at(radius, i + d)).sort((x, y) => x - y)[2];
    }

    // A compact shape on its own (a dot, a small blob) is not a stroke:
    // shrunk stroke by stroke a diamond would turn into a star. It shrinks
    // evenly instead, keeping its shape.
    const area = ClipperLib.Clipper.Area(sources[ci]);
    const widest = Math.max(...measured);
    if (area > 0 && area < BLOB * Math.PI * widest * widest && !holeInside(ci)) {
      blobs.push(...offset([sources[ci]], -t * widest, em));
      return;
    }

    // Near a convex corner, the circle at a point is squeezed by the
    // neighbouring side, so the corner would hardly move while its sides
    // do, leaving a spike. There, a point takes the stroke size measured
    // just beside the corner, and the corner itself moves like a mitred
    // offset: it stays sharp and follows its sides.
    const corrected = Float64Array.from(measured);
    for (let i = 0; i < n; i++) {
      if (turn[i] < CORNER) continue;
      // Not a corner if a sharper turn sits right beside it.
      if (at(turn, i - 1) > turn[i] || at(turn, i + 1) >= turn[i]) continue;
      // The stroke size beside the corner, looking just past its reach.
      let size = 0;
      for (let d = 1; d <= CORNER_REACH; d++) size = Math.max(size, at(measured, i - d), at(measured, i + d));
      const reach = Math.min(CORNER_REACH, Math.ceil((1.5 * size) / spacing));
      for (let d = -reach; d <= reach; d++) {
        const j = (i + d + n) % n;
        // Mitre: the corner point moves further along its diagonal.
        const mitre = d === 0 ? Math.min(2, 1 / Math.max(Math.cos(turn[i] / 2), 0.5)) : 1;
        corrected[j] = Math.max(corrected[j], size * mitre * (1 - Math.abs(d) / (reach + 1)) + measured[j] * (Math.abs(d) / (reach + 1)));
      }
    }

    // Light smoothing, never moving a point further than its own stroke
    // allows: averaging would otherwise carry wide strokes' radii into a
    // narrow neck (where two letters meet, say) and cut it.
    let smooth = corrected;
    for (let pass = 0; pass < 4; pass++) {
      const next = new Float64Array(n);
      for (let i = 0; i < n; i++) next[i] = (at(smooth, i - 1) + 2 * smooth[i] + at(smooth, i + 1)) / 4;
      smooth = next;
    }
    for (let i = 0; i < n; i++) smooth[i] = Math.min(smooth[i], corrected[i]);
    moved.push(
      c.map((p, i) => ({ X: Math.round(p.x + nx[i] * t * smooth[i]), Y: Math.round(p.y + ny[i] * t * smooth[i]) })),
    );
  });
  // Corners pushed past each other make small crossed loops; they turn the
  // wrong way, so keeping only positively filled areas drops them.
  const result = union([...unionPositive(moved), ...blobs]);
  return { shape: result, tidied: result, tidy: 0 };
}

/** A shape whose area is under this many times its largest inner circle's is compact (a blob). */
const BLOB = 3;
/** A turn sharper than this (radians, over the tangent span) is a corner. */
const CORNER = 0.6;
/** How many points either side of a corner it can affect. */
const CORNER_REACH = 24;

/** Neighbouring points left out when measuring the stroke at a point. */
const NEAR = 3;

/** Points evenly spaced along a closed contour. */
function resample(path: Path, spacing: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[i];
    const b = path[(i + 1) % path.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.X - a.X, b.Y - a.Y) / spacing));
    for (let s = 0; s < steps; s++) out.push({ x: a.X + ((b.X - a.X) * s) / steps, y: a.Y + ((b.Y - a.Y) * s) / steps });
  }
  return out;
}

function toPaths(commands: PathCommand[], step: number): Path[] {
  const paths: Path[] = [];
  let current: Path = [];
  const close = () => {
    if (current.length > 2) paths.push(current);
    current = [];
  };
  for (const c of flattenCommands(commands, step)) {
    if (c.type === 'Z') close();
    else {
      if (c.type === 'M') close();
      current.push({ X: Math.round(c.x * SCALE), Y: Math.round(c.y * SCALE) });
    }
  }
  close();
  return paths;
}

function toCommands(paths: Path[]): PathCommand[] {
  const out: PathCommand[] = [];
  for (const path of paths) {
    if (path.length < 3) continue;
    path.forEach((p, i) => out.push({ type: i === 0 ? 'M' : 'L', x: p.X / SCALE, y: p.Y / SCALE }));
    out.push({ type: 'Z' });
  }
  return out;
}

const { Clipper, ClipperOffset, ClipType, PolyType, PolyFillType, JoinType, EndType } = ClipperLib;

function union(paths: Path[]): Path[] {
  const c = new Clipper();
  c.AddPaths(paths, PolyType.ptSubject, true);
  const out: Path[] = [];
  c.Execute(ClipType.ctUnion, out, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  return out;
}

function unionPositive(paths: Path[]): Path[] {
  const c = new Clipper();
  c.AddPaths(paths, PolyType.ptSubject, true);
  const out: Path[] = [];
  c.Execute(ClipType.ctUnion, out, PolyFillType.pftPositive, PolyFillType.pftPositive);
  return out;
}

function intersect(a: Path[], b: Path[]): Path[] {
  const c = new Clipper();
  c.AddPaths(a, PolyType.ptSubject, true);
  c.AddPaths(b, PolyType.ptClip, true);
  const out: Path[] = [];
  c.Execute(ClipType.ctIntersection, out, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  return out;
}

/** Grow (positive) or shrink the outline by `delta` (scaled units), with round corners. */
function offset(paths: Path[], delta: number, em: number): Path[] {
  const co = new ClipperOffset(2, (em / 500) * SCALE);
  co.AddPaths(paths, JoinType.jtRound, EndType.etClosedPolygon);
  const out: Path[] = [];
  co.Execute(out, delta);
  return out;
}
