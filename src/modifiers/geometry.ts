import type { Composition, PathCommand, ShapedLine } from '../core/types';

type Point = { x: number; y: number };
type PointMap = (p: Point) => Point;

/** Place every glyph outline at its position on the line (absolute coordinates). */
export function toComposition(line: ShapedLine): Composition {
  return {
    text: line.text,
    width: line.width,
    unitsPerEm: line.unitsPerEm,
    ascender: line.ascender,
    descender: line.descender,
    glyphs: line.glyphs.map((g) => ({
      letter: g.letter,
      cluster: g.cluster,
      isMark: g.isMark,
      x: g.x,
      advance: g.advance,
      commands: mapCommands(g.commands, (p) => ({ x: p.x + g.x, y: p.y + g.y })),
    })),
  };
}

/** Apply a point transformation to every point of an outline, control points included. */
export function mapCommands(commands: PathCommand[], f: PointMap): PathCommand[] {
  return commands.map((c) => {
    switch (c.type) {
      case 'M':
      case 'L':
        return { type: c.type, ...f(c) };
      case 'Q': {
        const p1 = f({ x: c.x1, y: c.y1 });
        return { type: 'Q', x1: p1.x, y1: p1.y, ...f(c) };
      }
      case 'C': {
        const p1 = f({ x: c.x1, y: c.y1 });
        const p2 = f({ x: c.x2, y: c.y2 });
        return { type: 'C', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, ...f(c) };
      }
      case 'Z':
        return c;
    }
  });
}

export function mapComposition(comp: Composition, f: PointMap): Composition {
  return { ...comp, glyphs: comp.glyphs.map((g) => ({ ...g, commands: mapCommands(g.commands, f) })) };
}

/**
 * Horizontal stretch and slant are affine: applying them to control points
 * is exact, so curves stay curves. The whole line is transformed at once,
 * which keeps connected letters connected.
 */
export function applyWidthAndSlant(comp: Composition, widthPercent: number, slantDeg: number): Composition {
  const sx = widthPercent / 100;
  const shear = Math.tan((slantDeg * Math.PI) / 180);
  if (sx === 1 && shear === 0) return comp;
  const out = mapComposition(comp, (p) => ({ x: p.x * sx + p.y * shear, y: p.y }));
  return {
    ...out,
    width: comp.width * sx,
    glyphs: out.glyphs.map((g) => ({ ...g, x: g.x * sx, advance: g.advance * sx })),
  };
}

/**
 * Turn curves into short straight segments so a displacement field can bend
 * them smoothly. `step` is the target segment length in font units.
 */
export function flattenCommands(commands: PathCommand[], step: number): PathCommand[] {
  const out: PathCommand[] = [];
  let cur: Point = { x: 0, y: 0 };
  let start: Point = cur;
  const segments = (len: number) => Math.max(1, Math.ceil(len / step));
  const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

  for (const c of commands) {
    switch (c.type) {
      case 'M':
        cur = start = { x: c.x, y: c.y };
        out.push({ ...c });
        break;
      case 'L': {
        const end = { x: c.x, y: c.y };
        const n = segments(dist(cur, end));
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          out.push({ type: 'L', x: cur.x + (end.x - cur.x) * t, y: cur.y + (end.y - cur.y) * t });
        }
        cur = end;
        break;
      }
      case 'Q': {
        const p1 = { x: c.x1, y: c.y1 };
        const end = { x: c.x, y: c.y };
        const n = segments(dist(cur, p1) + dist(p1, end));
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          out.push({
            type: 'L',
            x: u * u * cur.x + 2 * u * t * p1.x + t * t * end.x,
            y: u * u * cur.y + 2 * u * t * p1.y + t * t * end.y,
          });
        }
        cur = end;
        break;
      }
      case 'C': {
        const p1 = { x: c.x1, y: c.y1 };
        const p2 = { x: c.x2, y: c.y2 };
        const end = { x: c.x, y: c.y };
        const n = segments(dist(cur, p1) + dist(p1, p2) + dist(p2, end));
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          const u = 1 - t;
          out.push({
            type: 'L',
            x: u * u * u * cur.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * end.x,
            y: u * u * u * cur.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * end.y,
          });
        }
        cur = end;
        break;
      }
      case 'Z':
        // Close back to the start with segments too, so the closing edge also bends.
        if (dist(cur, start) > 0) {
          const n = segments(dist(cur, start));
          for (let i = 1; i < n; i++) {
            const t = i / n;
            out.push({ type: 'L', x: cur.x + (start.x - cur.x) * t, y: cur.y + (start.y - cur.y) * t });
          }
        }
        out.push(c);
        cur = start;
        break;
    }
  }
  return out;
}
