import type { Shape, Vector2 } from 'three';

/**
 * Half the width of a letter's thinner strokes, measured on its outline:
 * for each outline point, the distance to the nearest point across the
 * stroke (points just beside it on the same contour don't count). A low
 * percentile skips stroke ends and corners, where that distance is
 * meaningless, while still following the fine strokes.
 *
 * The 3D renderer uses it to size a rounded edge that never folds over
 * a stroke narrower than itself.
 */
export function thinHalfWidth(shapes: Shape[]): number {
  const contours: Vector2[][] = [];
  for (const shape of shapes) {
    contours.push(shape.getPoints(4));
    for (const hole of shape.holes) contours.push(hole.getPoints(4));
  }
  // Evenly spaced samples, a few hundred at most.
  const all = contours.flat();
  if (all.length < 3) return 0;
  let length = 0;
  for (const c of contours) for (let i = 0; i < c.length; i++) length += c[i].distanceTo(c[(i + 1) % c.length]);
  const step = length / Math.min(600, Math.max(60, all.length));
  const samples: { x: number; y: number; contour: number; at: number }[] = [];
  contours.forEach((c, ci) => {
    let along = 0;
    let next = 0;
    for (let i = 0; i < c.length; i++) {
      const a = c[i];
      const b = c[(i + 1) % c.length];
      const d = a.distanceTo(b);
      while (next <= along + d) {
        const t = d ? (next - along) / d : 0;
        samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, contour: ci, at: next });
        next += step;
      }
      along += d;
    }
  });
  const perimeterOf = contours.map((c) => {
    let p = 0;
    for (let i = 0; i < c.length; i++) p += c[i].distanceTo(c[(i + 1) % c.length]);
    return p;
  });

  const widths: number[] = [];
  for (const s of samples) {
    let best = Infinity;
    for (const o of samples) {
      const dx = o.x - s.x;
      const dy = o.y - s.y;
      const d = Math.hypot(dx, dy);
      if (d >= best || d < 1e-6) continue;
      if (o.contour === s.contour) {
        // Along the outline, a point within reach isn't across the stroke.
        const gap = Math.abs(o.at - s.at);
        if (Math.min(gap, perimeterOf[s.contour] - gap) <= 2.5 * d + step) continue;
      }
      best = d;
    }
    if (best < Infinity) widths.push(best);
  }
  if (!widths.length) return 0;
  widths.sort((a, b) => a - b);
  return widths[Math.floor(widths.length * 0.15)] / 2;
}
