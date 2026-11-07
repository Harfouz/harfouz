import Constrainautor from '@kninnug/constrainautor';
import Delaunator from 'delaunator';
import { BufferGeometry, Float32BufferAttribute, type Shape, type Vector2 } from 'three';

/**
 * An inflated volume: the letter swells like a balloon or a cushion
 * instead of being cut straight out of a slab. Its outline stays where it
 * is drawn and front and back meet there, with no straight wall.
 *
 * The swelling is that of a membrane under pressure (a Poisson
 * equation), so a stroke of any width gets a round cross-section and the
 * surface has no creases along the middle of the strokes. `radius` is
 * how far in from the outline the surface takes to level off at
 * `height`, on each side: a small radius gives a slab with rounded
 * edges, a large one a pillow. Strokes narrower than the radius stay
 * lower, as round rods.
 *
 * Returns null when the outline can't be meshed (crossing contours).
 */
export function inflatedGeometry(shapes: Shape[], radius: number, height: number, em: number): BufferGeometry | null {
  // Mesh spacing: fine enough for the curve near the edge and across the
  // thinner strokes (2 · area / perimeter is about their width), coarse
  // enough to stay quick.
  let area = 0;
  let perimeter = 0;
  for (const shape of shapes) {
    const { shape: outer, holes } = shape.extractPoints(8);
    for (const c of [outer, ...holes]) {
      for (let i = 0; i < c.length; i++) {
        const a = c[i], b = c[(i + 1) % c.length];
        area += (a.x * b.y - b.x * a.y) / 2;
        perimeter += a.distanceTo(b);
      }
    }
  }
  const stroke = perimeter ? (2 * Math.abs(area)) / perimeter : radius;
  const h = Math.min(Math.max(Math.min(radius, stroke) / 5, em / 800), em / 40);
  const parts: Part[] = [];
  for (const shape of shapes) {
    const part = meshShape(shape, h);
    if (part === null) return null;
    if (part) parts.push(part);
  }
  if (!parts.length) return null;

  const position: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (const { xs, ys, rim, tris, neighbours } of parts) {
    // Pressure: Δu = −1 inside, u = 0 on the outline (Gauss–Seidel; on
    // this even mesh the plain average of the neighbours is a good Laplacian).
    const n = xs.length;
    const u = new Float64Array(n);
    const step = (h * h) / 4;
    for (let it = 0; it < 300; it++) {
      let change = 0;
      for (let i = 0; i < n; i++) {
        if (rim[i]) continue;
        const nb = neighbours[i];
        let sum = 0;
        for (const j of nb) sum += u[j];
        const next = sum / nb.length + step;
        change = Math.max(change, next - u[i]);
        u[i] = next;
      }
      // Once the surface has levelled off, wider parts can only grow taller: no need to go on.
      if (change < 1e-4 * radius * radius) break;
    }
      // Height: a round profile near the edge (√(2u) is the half-width of
    // a circle across a stroke), levelling off at `height`.
    const z = Array.from(u, (v) => height * Math.tanh(Math.sqrt(2 * Math.max(v, 0)) / radius));

    const base = position.length / 3;
    const backOf = new Int32Array(n);
    for (let i = 0; i < n; i++) position.push(xs[i], ys[i], z[i]), uv.push(xs[i], ys[i]);
    let extra = base + n;
    for (let i = 0; i < n; i++) {
      if (rim[i]) backOf[i] = base + i;
      else {
        backOf[i] = extra++;
        position.push(xs[i], ys[i], -z[i]);
        uv.push(xs[i], ys[i]);
      }
    }
    for (const [a, b, c] of tris) {
      const area = (xs[b] - xs[a]) * (ys[c] - ys[a]) - (xs[c] - xs[a]) * (ys[b] - ys[a]);
      if (area === 0) continue;
      const [p, q] = area > 0 ? [b, c] : [c, b];
      index.push(base + a, base + p, base + q, backOf[a], backOf[q], backOf[p]);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/** The row of points just inside the outline, in mesh spacings. */
const RIM = 0.25;

interface Part {
  xs: number[];
  ys: number[];
  rim: boolean[];
  tris: [number, number, number][];
  neighbours: number[][];
}

/** An even triangle mesh of one shape (outline and holes), or null if it can't be built. */
function meshShape(shape: Shape, h: number): Part | null | undefined {
  const { shape: outer, holes } = shape.extractPoints(8);
  const xs: number[] = [];
  const ys: number[] = [];
  const rim: boolean[] = [];
  const edges: [number, number][] = [];
  const seen = new Map<string, number>();
  const add = (x: number, y: number, onRim: boolean) => {
    const k = `${Math.round(x * 64)},${Math.round(y * 64)}`;
    const known = seen.get(k);
    if (known !== undefined) return known;
    xs.push(x), ys.push(y), rim.push(onRim);
    seen.set(k, xs.length - 1);
    return xs.length - 1;
  };
  const segments: number[] = [];
  const rows: number[] = [];
  for (const contour of [outer, ...holes].map(open)) {
    if (contour.length < 3) continue;
    // Even spacing along the outline too.
    const ring: number[] = [];
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i];
      const b = contour[(i + 1) % contour.length];
      segments.push(a.x, a.y, b.x, b.y);
      const pieces = Math.max(1, Math.ceil(a.distanceTo(b) / h));
      // Points added along a straight edge are nudged off it by a hair:
      // exactly collinear points leave flat, zero-area triangles behind.
      const len = a.distanceTo(b) || 1;
      for (let k = 0; k < pieces; k++) {
        const nudge = k ? (k % 2 ? 1 : -1) * h * 1e-3 : 0;
        const x = a.x + ((b.x - a.x) * k) / pieces - ((b.y - a.y) / len) * nudge;
        const y = a.y + ((b.y - a.y) * k) / pieces + ((b.x - a.x) / len) * nudge;
        ring.push(add(x, y, true));
      }
    }
    const clean = ring.filter((v, i) => v !== ring[(i + 1) % ring.length]);
    if (clean.length < 3) continue;
    for (let i = 0; i < clean.length; i++) edges.push([clean[i], clean[(i + 1) % clean.length]]);
    // Candidates for a row of points just inside the outline (either side;
    // the outer one is dropped below), so the steep rim is drawn smoothly.
    for (let i = 0; i < clean.length; i++) {
      const p = clean[(i - 1 + clean.length) % clean.length], q = clean[(i + 1) % clean.length];
      const dx = xs[q] - xs[p], dy = ys[q] - ys[p];
      const len = Math.hypot(dx, dy) || 1;
      for (const side of [1, -1]) rows.push(xs[clean[i]] - (dy / len) * side * RIM * h, ys[clean[i]] + (dx / len) * side * RIM * h);
    }
  }
  if (!edges.length) return undefined;

  // Inside: a triangular lattice, kept clear of the outline.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < xs.length; i++) (x0 = Math.min(x0, xs[i])), (x1 = Math.max(x1, xs[i])), (y0 = Math.min(y0, ys[i])), (y1 = Math.max(y1, ys[i]));
  const near = segmentGrid(segments, h);
  const within = insideTest(segments, h);
  for (let i = 0; i < rows.length; i += 2)
    if (within(rows[i], rows[i + 1]) && !near(rows[i], rows[i + 1], 0.8 * RIM * h)) add(rows[i], rows[i + 1], false);
  const dy = (h * Math.sqrt(3)) / 2;
  for (let row = 0, y = y0 + dy / 2; y < y1; row++, y += dy) {
    // Only inside the letter: where this row crosses the outline, in and out by turns.
    const crossings: number[] = [];
    for (let s = 0; s < segments.length; s += 4) {
      const ay = segments[s + 1], by = segments[s + 3];
      if (ay > y === by > y) continue;
      const ax = segments[s], bx = segments[s + 2];
      crossings.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
    }
    crossings.sort((a, b) => a - b);
    const shift = row % 2 ? h / 2 : 0;
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = x0 + shift + Math.ceil((crossings[k] - x0 - shift) / h) * h;
      for (let x = from; x < crossings[k + 1]; x += h) if (!near(x, y, 0.55 * h)) add(x, y, false);
    }
  }

  // Delaunay triangles, made to follow the outline, keeping those inside.
  let tris: [number, number, number][] = [];
  try {
    const del = new Delaunator(Float64Array.from(xs.flatMap((x, i) => [x, ys[i]])));
    const con = new Constrainautor(del);
    for (const [a, b] of edges) {
      try {
        con.constrainOne(a, b);
      } catch {
        // An outline that touches itself: that edge is left to the inside test.
      }
    }
    // Tested against the outline as meshed (its points nudged), not the drawn one.
    const inside = insideTest(edges.flatMap(([a, b]) => [xs[a], ys[a], xs[b], ys[b]]), h);
    const t = del.triangles;
    for (let i = 0; i < t.length; i += 3) {
      const [a, b, c] = [t[i], t[i + 1], t[i + 2]];
      if (inside((xs[a] + xs[b] + xs[c]) / 3, (ys[a] + ys[b] + ys[c]) / 3)) tris.push([a, b, c]);
    }
  } catch {
    return null;
  }

  // An edge from outline to outline that isn't part of the outline (across
  // a stroke too thin for the lattice) gets a point in its middle, or the
  // volume would be pinched flat along it.
  const key = (a: number, b: number) => (a < b ? a * 0x200000 + b : b * 0x200000 + a);
  // (The outline: its edges, and any edge with a triangle on one side only.)
  const outline = new Set(edges.map(([a, b]) => key(a, b)));
  const uses = new Map<number, number>();
  for (const [a, b, c] of tris) for (const k of [key(a, b), key(b, c), key(c, a)]) uses.set(k, (uses.get(k) ?? 0) + 1);
  for (const [k, n] of uses) if (n === 1) outline.add(k);
  const mids = new Map<number, number>();
  const mid = (a: number, b: number) => {
    if (!rim[a] || !rim[b] || outline.has(key(a, b))) return -1;
    const k = key(a, b);
    if (!mids.has(k)) {
      xs.push((xs[a] + xs[b]) / 2), ys.push((ys[a] + ys[b]) / 2), rim.push(false);
      mids.set(k, xs.length - 1);
    }
    return mids.get(k)!;
  };
  const split: [number, number, number][] = [];
  for (const [a, b, c] of tris) {
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    const count = (ab >= 0 ? 1 : 0) + (bc >= 0 ? 1 : 0) + (ca >= 0 ? 1 : 0);
    if (count === 0) split.push([a, b, c]);
    else if (count === 3) split.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    else if (count === 1) {
      if (ab >= 0) split.push([a, ab, c], [ab, b, c]);
      else if (bc >= 0) split.push([a, b, bc], [a, bc, c]);
      else split.push([a, b, ca], [ca, b, c]);
    } else if (ab < 0) split.push([bc, c, ca], [a, b, bc], [a, bc, ca]);
    else if (bc < 0) split.push([ca, a, ab], [b, c, ca], [b, ca, ab]);
    else split.push([ab, b, bc], [c, a, ab], [c, ab, bc]);
  }
  tris = split;
  // Lattice points that fell outside the letter aren't used: drop them.
  const used = new Int32Array(xs.length).fill(-1);
  const part: Part = { xs: [], ys: [], rim: [], tris: [], neighbours: [] };
  const keep = (i: number) => {
    if (used[i] < 0) {
      used[i] = part.xs.length;
      part.xs.push(xs[i]), part.ys.push(ys[i]), part.rim.push(rim[i]), part.neighbours.push([]);
    }
    return used[i];
  };
  for (const [a, b, c] of tris) part.tris.push([keep(a), keep(b), keep(c)]);
  const links = part.neighbours.map(() => new Set<number>());
  for (const [a, b, c] of part.tris) links[a].add(b).add(c), links[b].add(a).add(c), links[c].add(a).add(b);
  part.neighbours = links.map((s) => [...s]);
  return part.tris.length ? part : undefined;
}

/** Whether a point is inside the outline (even–odd), with segments sorted into bands. */
function insideTest(segments: number[], band: number) {
  const bands = new Map<number, number[]>();
  for (let s = 0; s < segments.length; s += 4) {
    const ay = segments[s + 1], by = segments[s + 3];
    for (let k = Math.floor(Math.min(ay, by) / band); k <= Math.floor(Math.max(ay, by) / band); k++) {
      const list = bands.get(k);
      if (list) list.push(s);
      else bands.set(k, [s]);
    }
  }
  return (x: number, y: number) => {
    let inside = false;
    for (const s of bands.get(Math.floor(y / band)) ?? []) {
      const ax = segments[s], ay = segments[s + 1], bx = segments[s + 2], by = segments[s + 3];
      if (ay > y === by > y) continue;
      if (ax + ((y - ay) / (by - ay)) * (bx - ax) > x) inside = !inside;
    }
    return inside;
  };
}

/** Whether a point lies within `reach` of the outline (reach ≤ cell size). */
function segmentGrid(segments: number[], cell: number) {
  const grid = new Map<string, number[]>();
  for (let s = 0; s < segments.length; s += 4) {
    const ax = segments[s], ay = segments[s + 1], bx = segments[s + 2], by = segments[s + 3];
    for (let gx = Math.floor(Math.min(ax, bx) / cell); gx <= Math.floor(Math.max(ax, bx) / cell); gx++)
      for (let gy = Math.floor(Math.min(ay, by) / cell); gy <= Math.floor(Math.max(ay, by) / cell); gy++) {
        const k = `${gx},${gy}`;
        const list = grid.get(k);
        if (list) list.push(s);
        else grid.set(k, [s]);
      }
  }
  return (x: number, y: number, reach: number) => {
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    for (let i = gx - 1; i <= gx + 1; i++)
      for (let j = gy - 1; j <= gy + 1; j++)
        for (const s of grid.get(`${i},${j}`) ?? []) {
          const ax = segments[s], ay = segments[s + 1];
          const dx = segments[s + 2] - ax, dy = segments[s + 3] - ay;
          const len = dx * dx + dy * dy;
          const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
          if (Math.hypot(x - ax - t * dx, y - ay - t * dy) < reach) return true;
        }
    return false;
  };
}

/** A contour without its closing point (three repeats the first point at the end). */
function open(points: Vector2[]) {
  return points.length > 1 && points[0].equals(points[points.length - 1]) ? points.slice(0, -1) : points;
}
