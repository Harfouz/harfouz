import { ExtrudeGeometry, Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildComposition } from '../src/modifiers';
import { ParamState } from '../src/params/state';
import {
  deformGeometry,
  deformPoint,
  findJunctions,
  frameMatrix,
  type Junction,
  type LetterFrame,
} from '../src/render/three/deform';
import { shapesByLetter } from '../src/render/three/ThreeRenderer';
import { fonts } from './fixtures';

const frame = (letter: number, x: number, turn: number, tilt: number, offset: Vector3): LetterFrame => ({
  letter,
  pivot: new Vector3(x, 300, 0),
  offset,
  turn,
  tilt,
});

/** Two letters meeting at x = 500 on the baseline, moved very differently. */
const frames = new Map([
  [0, frame(0, 650, 0, 0, new Vector3(0, 300, 0))],
  [1, frame(1, 350, 1.4, 0.4, new Vector3(50, -40, 250))],
]);
const junctions: Junction[] = [{ a: 0, b: 1, center: new Vector2(500, 0), radius: 40 }];

describe('junction deformation', () => {
  it('points on the seam land in the same place from both letters', () => {
    for (const p of [new Vector3(500, 0, 0), new Vector3(500, 35, 80), new Vector3(490, -20, -60)]) {
      const fromA = deformPoint(0, frames, junctions, p, 200);
      const fromB = deformPoint(1, frames, junctions, p, 200);
      expect(fromA.distanceTo(fromB)).toBeLessThan(1e-6);
    }
  });

  it('far from the junction, a letter moves rigidly with its own placement', () => {
    const p = new Vector3(900, 400, 30);
    const expected = p.clone().applyMatrix4(frameMatrix(frames.get(0)!));
    expect(deformPoint(0, frames, junctions, p, 200).distanceTo(expected)).toBeLessThan(1e-6);
  });

  it('a strong twist does not squash the stroke', () => {
    // Two points across the thickness keep their distance.
    const a = deformPoint(1, frames, junctions, new Vector3(520, 60, -100), 200);
    const b = deformPoint(1, frames, junctions, new Vector3(520, 60, 100), 200);
    expect(a.distanceTo(b)).toBeCloseTo(200, 3);
  });

  it('the blend changes smoothly away from the seam', () => {
    let previous = deformPoint(1, frames, junctions, new Vector3(500, 41, 0), 200);
    for (let y = 45; y < 400; y += 5) {
      const next = deformPoint(1, frames, junctions, new Vector3(500, y, 0), 200);
      expect(next.distanceTo(previous)).toBeLessThan(30);
      previous = next;
    }
  });
});

describe.each(fonts)('junctions with $name', (font) => {
  const composition = (word: string) => {
    const p = new ParamState();
    return buildComposition(font, word, (i) => p.resolve(i));
  };

  it('finds one junction per pair of connected letters', () => {
    expect(findJunctions(composition('محمد')).map((j) => [j.a, j.b])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    // مدرسة: only م→د and س→ة connect.
    expect(findJunctions(composition('مدرسة')).map((j) => [j.a, j.b])).toEqual([
      [0, 1],
      [3, 4],
    ]);
  });

  it.each(['محمد', 'مستشفى', 'عليكم', 'كلمة'])('%s: connected letters still touch after strong moves', (word) => {
    const comp = composition(word);
    const found = findJunctions(comp);
    const letters = shapesByLetter(comp).filter((l) => l.shapes.length);
    // Every letter lifted, pushed, turned and tilted differently.
    const moved = new Map<number, LetterFrame>(
      letters.map(({ letter }, i) => [
        letter,
        frame(letter, 0, (i % 2 ? 0.6 : -0.5) * (i + 1) * 0.5, i % 2 ? 0.3 : -0.2, new Vector3(0, i * 120, i * -150)),
      ]),
    );
    const geometries = new Map(
      letters.map(({ letter, shapes }) => {
        const g = new ExtrudeGeometry(shapes, { depth: 200, bevelEnabled: false, curveSegments: 6 });
        g.translate(0, 0, -100);
        deformGeometry(g, letter, moved, found, 260);
        return [letter, g.getAttribute('position')];
      }),
    );
    for (const j of found) {
      const a = geometries.get(j.a)!;
      const b = geometries.get(j.b)!;
      // Closest pair of vertices between the two letters.
      let best = Infinity;
      const va = new Vector3();
      const vb = new Vector3();
      for (let i = 0; i < a.count; i++) {
        va.fromBufferAttribute(a, i);
        for (let k = 0; k < b.count; k++) best = Math.min(best, va.distanceTo(vb.fromBufferAttribute(b, k)));
      }
      expect(best, `letters ${j.a} and ${j.b} came apart`).toBeLessThan(font.unitsPerEm * 0.03);
    }
  });
});
