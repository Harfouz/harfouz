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
 * letters like ه, م, ف).
 *
 * Fonts draw outer contours in one direction and holes in the other. The
 * largest contour is always an outer one, so it tells us which direction
 * means "outer" for this glyph; contours turning the other way are holes,
 * attached to the smallest outer contour around them. This also works for
 * fonts that build letters from overlapping pieces.
 */
export function outlinesToShapes(commands: PathCommand[], unitsPerEm: number): Shape[] {
  const contours = splitContours(commands);
  if (!contours.length) return [];
  const step = unitsPerEm / 60;
  const polys = contours.map((c) => polygonOf(c, step));
  const signed = polys.map(area);
  const areas = signed.map(Math.abs);
  const largest = areas.indexOf(Math.max(...areas));
  const outerSign = Math.sign(signed[largest]) || 1;
  const isHole = signed.map((a) => Math.sign(a) === -outerSign);

  const shapes = new Map<number, Shape>();
  contours.forEach((contour, i) => {
    if (!isHole[i] && areas[i] > 0) shapes.set(i, toPath(new Shape(), contour));
  });
  contours.forEach((contour, i) => {
    if (!isHole[i]) return;
    const probe = polys[i][0];
    const outers = [...shapes.keys()].filter((j) => areas[j] > areas[i] && contains(polys[j], probe));
    if (!outers.length) return;
    const parent = outers.reduce((a, b) => (areas[a] < areas[b] ? a : b));
    shapes.get(parent)!.holes.push(toPath(new Path(), contour));
  });
  return [...shapes.values()];
}
