import ClipperLib from 'clipper-lib';
import type { PathCommand } from '../core/types';
import { flattenCommands } from './geometry';

// Outline operations on polygons, with the Clipper library (Angus Johnson).
// Outlines are flattened to integer polygons: font units times SCALE.

export type Path = { X: number; Y: number }[];

/** Font units are multiplied by this before Clipper rounds them to integers. */
export const SCALE = 8;

const { Clipper, ClipperOffset, ClipType, PolyType, PolyFillType, JoinType, EndType } = ClipperLib;

export function toPaths(commands: PathCommand[], step: number): Path[] {
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

export function toCommands(paths: Path[]): PathCommand[] {
  const out: PathCommand[] = [];
  for (const path of paths) {
    if (path.length < 3) continue;
    path.forEach((p, i) => out.push({ type: i === 0 ? 'M' : 'L', x: p.X / SCALE, y: p.Y / SCALE }));
    out.push({ type: 'Z' });
  }
  return out;
}


export function union(paths: Path[]): Path[] {
  const c = new Clipper();
  c.AddPaths(paths, PolyType.ptSubject, true);
  const out: Path[] = [];
  c.Execute(ClipType.ctUnion, out, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  return out;
}

export function unionPositive(paths: Path[]): Path[] {
  const c = new Clipper();
  c.AddPaths(paths, PolyType.ptSubject, true);
  const out: Path[] = [];
  c.Execute(ClipType.ctUnion, out, PolyFillType.pftPositive, PolyFillType.pftPositive);
  return out;
}

export function intersect(a: Path[], b: Path[]): Path[] {
  const c = new Clipper();
  c.AddPaths(a, PolyType.ptSubject, true);
  c.AddPaths(b, PolyType.ptClip, true);
  const out: Path[] = [];
  c.Execute(ClipType.ctIntersection, out, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  return out;
}

/** Grow (positive) or shrink the outline by `delta` (scaled units), with round corners. */
export function offset(paths: Path[], delta: number, em: number, tolerance = em / 500): Path[] {
  const co = new ClipperOffset(2, tolerance * SCALE);
  co.AddPaths(paths, JoinType.jtRound, EndType.etClosedPolygon);
  const out: Path[] = [];
  co.Execute(out, delta);
  return out;
}

/** Parts of `a` outside `b`. */
export function difference(a: Path[], b: Path[]): Path[] {
  if (!b.length) return union(a); // Clipper returns nothing without a clip
  const c = new Clipper();
  c.AddPaths(a, PolyType.ptSubject, true);
  c.AddPaths(b, PolyType.ptClip, true);
  const out: Path[] = [];
  c.Execute(ClipType.ctDifference, out, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
  return out;
}

/** Area of a polygon (positive for outer contours). */
export const area = (path: Path) => Clipper.Area(path);

/** Drop points closer than `distance` to their neighbours' line (keeps the shape, fewer points). */
export const clean = (paths: Path[], distance: number): Path[] => Clipper.CleanPolygons(paths, distance);

/**
 * Final clean-up before outlines become 3D volumes: drops points that sit
 * almost on top of a neighbour or on its line, hairpin spikes and specks.
 * The bevel would turn each of those into a visible spike.
 */
export function tidy(paths: Path[], em: number): Path[] {
  const speck = ((em / 300) * SCALE) ** 2;
  return clean(paths, (em / 5000) * SCALE).filter((p) => p.length >= 3 && Math.abs(area(p)) > speck);
}
