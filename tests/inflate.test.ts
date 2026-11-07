import { describe, expect, it } from 'vitest';
import { buildComposition } from '../src/modifiers';
import { defaultsOf, SHAPE_PARAMS, type ShapeParams } from '../src/params/schema';
import { inflatedGeometry } from '../src/render/three/inflate';
import { shapesByLetter } from '../src/render/three/ThreeRenderer';
import { fonts, TEST_WORDS } from './fixtures';

const base = defaultsOf<ShapeParams>(SHAPE_PARAMS);

describe('inflated volume (Soften in 3D)', () => {
  for (const font of fonts) {
    it.each(TEST_WORDS)(`${font.name}: %s swells into a closed, smooth volume`, (word) => {
      for (const p of [{ soften: 17, weight: -75 }, { soften: 60 }, { soften: 100, weight: 40 }]) {
        const comp = buildComposition(font, word, { ...base, ...p });
        const em = comp.unitsPerEm;
        const height = 110;
        for (const { shapes } of shapesByLetter(comp)) {
          const g = inflatedGeometry(shapes, (p.soften / 100) * 0.25 * em, height, em);
          // (null: an outline that can't be meshed falls back to the straight extrusion.)
          if (!g) continue;
          const pos = g!.getAttribute('position');
          const normal = g!.getAttribute('normal');
          expect(pos.count).toBeGreaterThan(0);
          let top = 0;
          let tallest = 0;
          let weak = 0;
          for (let i = 0; i < pos.count; i++) {
            top = Math.max(top, pos.getZ(i));
            tallest = Math.max(tallest, Math.abs(pos.getZ(i)));
            if (Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) < 0.5) weak++;
          }
          expect(tallest).toBeLessThanOrEqual(height + 1e-6);
          // No flat, zero-thickness patches: normals are real directions (bar a stray point).
          expect(weak).toBeLessThan(pos.count * 0.01 + 8);
          expect(top).toBeGreaterThan(0);
          // Watertight: every edge is shared by exactly two triangles (bar a
          // few where the outline touches itself).
          const index = g!.getIndex()!.array;
          const edges = new Map<string, number>();
          for (let i = 0; i < index.length; i += 3)
            for (const [a, b] of [[index[i], index[i + 1]], [index[i + 1], index[i + 2]], [index[i + 2], index[i]]]) {
              const k = a < b ? `${a},${b}` : `${b},${a}`;
              edges.set(k, (edges.get(k) ?? 0) + 1);
            }
          const open = [...edges.values()].filter((n) => n !== 2).length;
          expect(open).toBeLessThan(edges.size * 0.002 + 16);
        }
      }
    });
  }

  it('is quick enough to drag the slider', () => {
    const comp = buildComposition(fonts[0], 'السَّلَامُ عَلَيْكُمْ', { ...base, soften: 40 });
    const em = comp.unitsPerEm;
    const start = performance.now();
    for (const { shapes } of shapesByLetter(comp)) inflatedGeometry(shapes, 0.4 * 0.25 * em, 110, em);
    const ms = performance.now() - start;
    process.stderr.write(`inflate: ${ms.toFixed(0)} ms per phrase\n`);
    expect(ms).toBeLessThan(600);
  });
});
