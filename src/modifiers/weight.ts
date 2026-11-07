import ClipperLib from 'clipper-lib';
import type { Composition, GlyphShape } from '../core/types';
import { intersect, offset, SCALE, tidy as cleanUp, toCommands, toPaths, union, unionPositive, type Path } from './clipper';
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
      return { ...g, commands: toCommands(cleanUp(intersect(seams.length ? union([...tidied, ...seams]) : tidied, own), em)) };
    }),
  };
}

/** How far 100 % bolder grows the outline, in ems. */
export const BOLD_EM = 0.08;
/** Strokes never lose more than this percentage of their width. */
const MAX_THIN = 75;

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

  /**
   * Whether another contour (a counter) sits inside contour `ci`. A pinhole
   * (the gap between three touching dots) doesn't count: it just closes up.
   */
  const holeInside = (ci: number) =>
    sources.some(
      (other, oi) =>
        oi !== ci &&
        Math.abs(ClipperLib.Clipper.Area(other)) > PINHOLE * Math.abs(ClipperLib.Clipper.Area(sources[ci])) &&
        ClipperLib.Clipper.PointInPolygon(other[0], sources[ci]) !== 0,
    );

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

  /** Distance from a point, inwards along its normal, to the outline on the other side. */
  const acrossAt = (px: number, py: number, dx: number, dy: number, ci: number, i: number) => {
    const n = contours[ci].length;
    let best = 4 * maxRadius;
    const seen = new Set<number>();
    for (let s = 0; s * (cell / 2) <= best + cell; s++) {
      const gx = Math.floor((px + dx * s * (cell / 2) - minX) / cell);
      const gy = Math.floor((py + dy * s * (cell / 2) - minY) / cell);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const key = cellKey(gx + ox, gy + oy);
          if (seen.has(key)) continue;
          seen.add(key);
          for (const j of grid.get(key) ?? []) {
            if (owner[j] === ci) {
              const k = Math.abs(place[j] - i);
              if (Math.min(k, n - k) <= 2 * NEAR) continue;
            }
            const ex = qx[j] - px;
            const ey = qy[j] - py;
            const along = ex * dx + ey * dy;
            if (along > 0 && along < best && Math.abs(ex * dy - ey * dx) <= spacing) best = along;
          }
        }
      }
    }
    return best;
  };

  const moved: Path[] = [];
  const blobs: Path[] = [];
  contours.forEach((c, ci) => {
    const n = c.length;
    const at = <T,>(list: ArrayLike<T>, i: number) => list[(i + n) % n];
    const nx = new Float64Array(n);
    const ny = new Float64Array(n);
    const radius = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      // Tangent over a few points, so tiny wobbles don't tilt the normal.
      // Clipper's outer contours turn counter-clockwise and holes
      // clockwise: the inside of the letter is always on the left.
      const a = at(c, i - NEAR);
      const b = at(c, i + NEAR);
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      nx[i] = -(b.y - a.y) / len;
      ny[i] = (b.x - a.x) / len;

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
    // (Dots that touch, like the three of ش in some fonts, make one
    // contour that is less round but just as compact.)
    let perimeter = 0;
    for (let i = 0; i < n; i++) perimeter += Math.hypot(at(c, i + 1).x - c[i].x, at(c, i + 1).y - c[i].y);
    const compact = (4 * Math.PI * area) / (perimeter * perimeter);
    const small = area < (DOTS_EM * em * SCALE) ** 2;
    const blob = area < BLOB * Math.PI * widest * widest || (compact > COMPACT && small);
    if (area > 0 && blob && !holeInside(ci)) {
      blobs.push(...offset([sources[ci]], -t * widest, em));
      return;
    }

    // Near the end of a stroke the circle at a point is squeezed by the
    // end itself, so the corners would hardly move while the sides do and
    // the end would flare out like a fishtail. Each point takes instead the
    // largest stroke measured a little way along the outline, as long as the
    // outline between them doesn't turn inwards (that would be another
    // stroke branching off, not the end of this one).
    const step = new Float64Array(n); // turn from each point to the next
    for (let i = 0; i < n; i++) {
      const a = at(c, i - 1);
      const b = c[i];
      const d = at(c, i + 1);
      const ux = b.x - a.x, uy = b.y - a.y, vx = d.x - b.x, vy = d.y - b.y;
      step[i] = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    }
    const stroke = Float64Array.from(measured);
    for (let q = 0; q < n; q++) {
      const reach = Math.min(SPREAD_MAX, Math.ceil((SPREAD * measured[q]) / spacing));
      for (const dir of [-1, 1]) {
        // Walk along the outline until it has turned round an end.
        let turned = 0;
        let end = 0;
        for (let d = 1; d <= reach; d++) {
          turned += step[(q + dir * d + n) % n];
          if (turned < -CONCAVE) break;
          if (turned >= END_TURN) {
            end = d;
            break;
          }
        }
        for (let d = 1; d <= end; d++) {
          const j = (q + dir * d + n) % n;
          if (stroke[j] < measured[q]) stroke[j] = measured[q];
        }
      }
    }
    // Only where the stroke is still that wide straight across: a narrow
    // neck or a fine connecting stroke keeps its own size.
    for (let i = 0; i < n; i++) {
      if (stroke[i] > measured[i]) {
        let across = Infinity;
        for (const a of [-ACROSS_FAN, 0, ACROSS_FAN]) {
          const dx = nx[i] * Math.cos(a) - ny[i] * Math.sin(a);
          const dy = nx[i] * Math.sin(a) + ny[i] * Math.cos(a);
          across = Math.min(across, acrossAt(c[i].x, c[i].y, dx, dy, ci, i) * Math.cos(a));
        }
        stroke[i] = Math.max(measured[i], Math.min(stroke[i], 0.5 * across));
      }
    }
    // Smooth the stroke sizes, then the moved outline itself.
    let smooth = stroke;
    for (let pass = 0; pass < 6; pass++) {
      const next = new Float64Array(n);
      for (let i = 0; i < n; i++) next[i] = (at(smooth, i - 1) + 2 * smooth[i] + at(smooth, i + 1)) / 4;
      smooth = next;
    }
    for (let i = 0; i < n; i++) smooth[i] = Math.max(smooth[i], measured[i]);
    let xs = Float64Array.from(c, (p, i) => p.x + nx[i] * t * smooth[i]);
    let ys = Float64Array.from(c, (p, i) => p.y + ny[i] * t * smooth[i]);
    for (let pass = 0; pass < 1; pass++) {
      const x2 = new Float64Array(n);
      const y2 = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        x2[i] = (at(xs, i - 1) + 2 * xs[i] + at(xs, i + 1)) / 4;
        y2[i] = (at(ys, i - 1) + 2 * ys[i] + at(ys, i + 1)) / 4;
      }
      xs = x2;
      ys = y2;
    }
    moved.push(Array.from(xs, (x, i) => ({ X: Math.round(x), Y: Math.round(ys[i]) })));
  });
  // Corners pushed past each other make small crossed loops; they turn the
  // wrong way, so keeping only positively filled areas drops them.
  const result = union([...unionPositive(moved), ...blobs]);
  return { shape: result, tidied: result, tidy: 0 };
}

/** A shape whose area is under this many times its largest inner circle's is compact (a blob). */
const BLOB = 3;
/** …or a cluster of touching dots: this compact (4π·area / perimeter², 1 for a disc)… */
const COMPACT = 0.35;
/** …and no bigger than a square this size, in ems. */
const DOTS_EM = 0.2;
/** A counter smaller than this fraction of its shape is a pinhole. */
const PINHOLE = 0.05;
/** A point takes the stroke size measured up to this many radii along the outline. */
const SPREAD = 3.5;
/** …and never more than this many points away. */
const SPREAD_MAX = 90;
/** Spreading stops where the outline has turned inwards by this much (radians). */
const CONCAVE = 0.35;
/** The width across is checked straight in and this much (radians) to either side. */
const ACROSS_FAN = 0.45;
/** An outline that turns this much (radians) within reach goes round the end of a stroke. */
const END_TURN = 1.2;

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
