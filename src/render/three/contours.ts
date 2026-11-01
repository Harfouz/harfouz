import { Path, Shape } from 'three';
import type { PathCommand } from '../../core/types';
import { flattenCommands } from '../../modifiers/geometry';

type Point = { x: number; y: number };

/** Split an outline into closed contours (each starts with M, ends with Z). */
export function splitContours(commands: PathCommand[]): PathCommand[][] {
  const contours: PathCommand[][] = [];
  let current: PathCommand[] = [];
  for (const c of commands) {
    if (c.type === 'M' && current.length) {
      contours.push(current);
      current = [];
    }
    current.push(c);
    if (c.type === 'Z') {
      contours.push(current);
      current = [];
    }
  }
  if (current.length > 1) contours.push(current);
  return contours.filter((c) => c.some((cmd) => cmd.type !== 'M' && cmd.type !== 'Z'));
}

function polygonOf(contour: PathCommand[], step: number): Point[] {
  return flattenCommands(contour, step).flatMap((c) => (c.type === 'Z' ? [] : [{ x: c.x, y: c.y }]));
}

function area(poly: Point[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x - poly[i].x) * (poly[j].y + poly[i].y);
  return a / 2;
}

function contains(poly: Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function toPath<T extends Path>(target: T, contour: PathCommand[]): T {
  for (const c of contour) {
    switch (c.type) {
      case 'M':
        target.moveTo(c.x, c.y);
        break;
      case 'L':
        target.lineTo(c.x, c.y);
        break;
      case 'Q':
        target.quadraticCurveTo(c.x1, c.y1, c.x, c.y);
        break;
      case 'C':
        target.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y);
        break;
      case 'Z':
        target.closePath();
        break;
    }
  }
  return target;
}

/**
 * Turn glyph outlines into Three.js shapes with holes (the counters of
 * letters like ه, م, ف). A contour is a hole when it sits inside an odd
 * number of other contours; it is attached to the smallest one around it.
 * This does not rely on contour direction, so it works whatever the font's
 * winding convention.
 */
export function outlinesToShapes(commands: PathCommand[], unitsPerEm: number): Shape[] {
  const contours = splitContours(commands);
  const step = unitsPerEm / 60;
  const polys = contours.map((c) => polygonOf(c, step));
  const areas = polys.map((p) => Math.abs(area(p)));

  const parents = polys.map((poly, i) => {
    const probe = poly[0];
    return polys.map((_, j) => j).filter((j) => j !== i && areas[j] > areas[i] && contains(polys[j], probe));
  });
  const isHole = parents.map((p) => p.length % 2 === 1);

  const shapes = new Map<number, Shape>();
  contours.forEach((contour, i) => {
    if (!isHole[i] && areas[i] > 0) shapes.set(i, toPath(new Shape(), contour));
  });
  contours.forEach((contour, i) => {
    if (!isHole[i]) return;
    const outers = parents[i].filter((j) => shapes.has(j));
    if (!outers.length) return;
    const parent = outers.reduce((a, b) => (areas[a] < areas[b] ? a : b));
    shapes.get(parent)!.holes.push(toPath(new Path(), contour));
  });
  return [...shapes.values()];
}
