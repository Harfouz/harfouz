import { BufferAttribute, BufferGeometry } from 'three';

/**
 * Cut a volume into thin vertical slices, every `step` font units along
 * the line.
 *
 * Letters are bent by moving their vertices, and a straight edge only
 * bends where it has vertices. Geometric fonts (Kufi) draw long strokes
 * and kashidas with a point at each end only: without slices those
 * strokes would stay rigid and come apart from their neighbours instead
 * of curving into them.
 *
 * The cuts sit on the same grid (x = k · step) for every letter, so two
 * faces that share an edge are cut at the same places and stay sealed.
 */
export function sliceAlongX(input: BufferGeometry, step: number): BufferGeometry {
  const source = input.index ? input.toNonIndexed() : input;
  const names = Object.keys(source.attributes);
  const attrs = names.map((n) => source.getAttribute(n) as BufferAttribute);
  const sizes = attrs.map((a) => a.itemSize);
  const stride = sizes.reduce((s, n) => s + n, 0);
  const xAt = 0; // position comes first (see `order`)
  const order = [names.indexOf('position'), ...names.map((_, i) => i).filter((i) => names[i] !== 'position')];
  const out: number[] = [];

  const vertex = (i: number) => {
    const v: number[] = [];
    for (const k of order) for (let c = 0; c < sizes[k]; c++) v.push(attrs[k].array[i * sizes[k] + c] as number);
    return v;
  };
  const lerp = (a: number[], b: number[], t: number) => a.map((x, i) => x + (b[i] - x) * t);
  const emit = (poly: number[][]) => {
    for (let i = 1; i + 1 < poly.length; i++) out.push(...poly[0], ...poly[i], ...poly[i + 1]);
  };
  // Part of a convex polygon on one side of the line x = c.
  const clip = (poly: number[][], c: number, keepLeft: boolean) => {
    const inside = (v: number[]) => (keepLeft ? v[xAt] <= c : v[xAt] >= c);
    const result: number[][] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      if (inside(p)) result.push(p);
      if (inside(p) !== inside(q)) result.push(lerp(p, q, (c - p[xAt]) / (q[xAt] - p[xAt])));
    }
    return result;
  };

  const groups = source.groups.length ? source.groups : [{ start: 0, count: source.getAttribute('position').count, materialIndex: 0 }];
  const newGroups: { start: number; count: number; materialIndex?: number }[] = [];
  for (const g of groups) {
    const before = out.length / stride;
    for (let t = g.start; t + 2 < g.start + g.count; t += 3) {
      let poly = [vertex(t), vertex(t + 1), vertex(t + 2)];
      const xs = poly.map((v) => v[xAt]);
      const first = Math.floor(Math.min(...xs) / step) + 1;
      const last = Math.ceil(Math.max(...xs) / step) - 1;
      for (let k = first; k <= last && poly.length >= 3; k++) {
        const c = k * step;
        emit(clip(poly, c, true));
        poly = clip(poly, c, false);
      }
      if (poly.length >= 3) emit(poly);
    }
    newGroups.push({ start: before, count: out.length / stride - before, materialIndex: g.materialIndex });
  }

  const result = new BufferGeometry();
  const count = out.length / stride;
  let offset = 0;
  for (const k of order) {
    const size = sizes[k];
    const data = new Float32Array(count * size);
    for (let i = 0; i < count; i++) for (let c = 0; c < size; c++) data[i * size + c] = out[i * stride + offset + c];
    result.setAttribute(names[k], new BufferAttribute(data, size));
    offset += size;
  }
  if (source.groups.length) for (const g of newGroups) result.addGroup(g.start, g.count, g.materialIndex);
  if (result.getAttribute('normal')) {
    const n = result.getAttribute('normal') as BufferAttribute;
    for (let i = 0; i < n.count; i++) {
      const l = Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) || 1;
      n.setXYZ(i, n.getX(i) / l, n.getY(i) / l, n.getZ(i) / l);
    }
  }
  return result;
}
