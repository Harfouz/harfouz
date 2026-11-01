import type { PathCommand } from '../../core/types';

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * Convert font-space commands (y up) into an SVG path string (y down),
 * translated by (dx, dy) in font space.
 */
export function toSvgPathData(commands: PathCommand[], dx = 0, dy = 0): string {
  const X = (x: number) => fmt(x + dx);
  const Y = (y: number) => fmt(-(y + dy));
  let d = '';
  for (const c of commands) {
    switch (c.type) {
      case 'M':
      case 'L':
        d += `${c.type}${X(c.x)} ${Y(c.y)}`;
        break;
      case 'Q':
        d += `Q${X(c.x1)} ${Y(c.y1)} ${X(c.x)} ${Y(c.y)}`;
        break;
      case 'C':
        d += `C${X(c.x1)} ${Y(c.y1)} ${X(c.x2)} ${Y(c.y2)} ${X(c.x)} ${Y(c.y)}`;
        break;
      case 'Z':
        d += 'Z';
        break;
    }
  }
  return d;
}
