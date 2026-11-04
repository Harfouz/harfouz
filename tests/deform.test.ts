import { ExtrudeGeometry, Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildComposition } from '../src/modifiers';
import { ParamState } from '../src/params/state';
import {
  deformGeometry,
  deformPoint,
  bridgeConnectors,
  findJunctions,
  fitJoins,
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
    const build = (move: boolean) =>
      new Map(
        letters.map(({ letter, shapes }) => {
          const g = new ExtrudeGeometry(shapes, { depth: 200, bevelEnabled: false, curveSegments: 6 });
          g.translate(0, 0, -100);
          if (move) deformGeometry(g, letter, moved, found, 260);
          return [letter, g.getAttribute('position')];
        }),
      );
    // Closest pair of vertices between two letters.
    const closest = (geometries: ReturnType<typeof build>, a: number, b: number) => {
      const pa = geometries.get(a)!;
      const pb = geometries.get(b)!;
      let best = Infinity;
      const va = new Vector3();
      const vb = new Vector3();
      for (let i = 0; i < pa.count; i++) {
        va.fromBufferAttribute(pa, i);
        for (let k = 0; k < pb.count; k++) best = Math.min(best, va.distanceTo(vb.fromBufferAttribute(pb, k)));
      }
      return best;
    };
    const still = build(false);
    const after = build(true);
    for (const j of found) {
      // Some fonts make letters touch, others overlap them a little (Reem
      // Kufi): compare with the letters at rest. Moving must not open a gap.
      const before = closest(still, j.a, j.b);
      expect(closest(after, j.a, j.b), `letters ${j.a} and ${j.b} came apart`).toBeLessThan(
        before + font.unitsPerEm * 0.02,
      );
    }
    // Compares every vertex of two letters with every other: heavy, so allow time on slow machines.
  }, 30_000);
});

describe('calligraphic moves (one letter lifted or shifted far from its neighbour)', () => {
  // Letter 0 on the right (first in reading order), letter 1 on its left, joined on the baseline at x = 500.
  const seam: Junction[] = [{ a: 0, b: 1, center: new Vector2(500, 0), radius: 40 }];
  const moved = new Map([
    [0, frame(0, 800, 0, 0, new Vector3(-150, 600, 0))],
    [1, frame(1, 200, 0, 0, new Vector3(0, 0, 0))],
  ]);

  /** Steepest rise of the baseline stroke as it runs through the join. */
  function steepest(junctions: Junction[]) {
    let worst = 0;
    let previous: Vector3 | null = null;
    for (let x = -700; x <= 1700; x += 5) {
      const p = deformPoint(x >= 500 ? 0 : 1, moved, junctions, new Vector3(x, 0, 0), 260);
      if (previous) worst = Math.max(worst, Math.abs(p.y - previous.y) / Math.max(Math.abs(p.x - previous.x), 1e-6));
      previous = p;
    }
    return worst;
  }

  it('the join sweeps gently instead of kinking', () => {
    const fitted = fitJoins(seam, moved, 260, 1200);
    expect(fitted[0].softness).toBeGreaterThan(600);
    expect(steepest(seam)).toBeGreaterThan(1.5); // a fixed short blend: steep
    expect(steepest(fitted)).toBeLessThan(1.1); // fitted to the move: gentle
  });

  it('both letters still meet on the seam', () => {
    const fitted = fitJoins(seam, moved, 260, 1200);
    for (const p of [new Vector3(500, 0, 0), new Vector3(510, 30, 40)]) {
      expect(deformPoint(0, moved, fitted, p, 260).distanceTo(deformPoint(1, moved, fitted, p, 260))).toBeLessThan(1e-6);
    }
  });

  it('a moved join spans the whole of a short letter, so it sweeps instead of stepping', () => {
    const widths = new Map([
      [0, 520],
      [1, 210],
    ]);
    const lifted = new Map([
      [0, frame(0, 800, 0, 0, new Vector3(0, 0, 0))],
      [1, frame(1, 200, 0, 0, new Vector3(0, 300, 0))],
    ]);
    expect(fitJoins(seam, lifted, 150, 1200, widths)[0].softness).toBeGreaterThanOrEqual(210);
    expect(fitJoins(seam, lifted, 150, 120, widths)[0].softness).toBe(150); // never past the limit
  });

  it('small moves keep the chosen softness', () => {
    const still = new Map([
      [0, frame(0, 800, 0, 0, new Vector3(0, 40, 0))],
      [1, frame(1, 200, 0, 0, new Vector3(0, 0, 0))],
    ]);
    expect(fitJoins(seam, still, 260, 1200)[0].softness).toBe(260);
  });
});

describe('tatweels between moved letters', () => {
  const none = () => ({ offset: new Vector3(), turn: 0, tilt: 0 });
  const at = (letter: number, x: number, lift: number) => frame(letter, x, 0, 0, new Vector3(0, lift, 0));

  it('sit evenly between their neighbours instead of staying behind', () => {
    // ج ـ ـ م: ج lifted 450, م lifted 150, two tatweels left at rest.
    const frames = new Map([
      [0, at(0, 900, 450)],
      [1, at(1, 700, 0)],
      [2, at(2, 600, 0)],
      [3, at(3, 400, 150)],
    ]);
    bridgeConnectors([0, 1, 2, 3], frames, (i) => i === 1 || i === 2, none);
    expect(frames.get(1)!.offset.y).toBeCloseTo(350);
    expect(frames.get(2)!.offset.y).toBeCloseTo(250);
    expect(frames.get(0)!.offset.y).toBe(450); // letters keep their own placement
  });

  it('keep their own extra move, and stay put at the ends of a word', () => {
    const frames = new Map([
      [0, at(0, 900, 400)],
      [1, at(1, 700, 0)],
      [2, at(2, 500, 0)],
      [3, at(3, 300, 0)],
    ]);
    const extra = (i: number) => ({ offset: new Vector3(0, i === 1 ? 50 : 0, 0), turn: 0, tilt: 0 });
    bridgeConnectors([0, 1, 2, 3], frames, (i) => i === 1 || i === 3, extra);
    expect(frames.get(1)!.offset.y).toBeCloseTo(250); // halfway (200) + its own 50
    expect(frames.get(3)!.offset.y).toBe(0); // last in the word: nothing to bridge to
  });
});
