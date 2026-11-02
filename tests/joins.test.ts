import { describe, expect, it } from 'vitest';
import type { Composition } from '../src/core/types';
import { buildComposition } from '../src/modifiers';
import { flattenCommands } from '../src/modifiers/geometry';
import { findJunctions } from '../src/modifiers/joins';
import { defaultsOf, SHAPE_PARAMS, type ShapeParams } from '../src/params/schema';
import { fonts, TEST_WORDS } from './fixtures';

const WORDS = [...TEST_WORDS, 'حرفوز', 'كلمة'];

/** Every outline point of each letter (diacritics left out), curves flattened like the distortion does. */
function points(comp: Composition, flatten: boolean) {
  const byLetter = new Map<number, { x: number; y: number }[]>();
  for (const g of comp.glyphs) {
    if (g.isMark) continue;
    const commands = flatten ? flattenCommands(g.commands, comp.unitsPerEm / 80) : g.commands;
    const list = byLetter.get(g.letter) ?? [];
    for (const c of commands) if (c.type !== 'Z') list.push({ x: c.x, y: c.y });
    byLetter.set(g.letter, list);
  }
  return byLetter;
}

/**
 * Largest gap opened at a join: points where two connected letters touch
 * before the change must still touch after it (how much further apart they got).
 */
function widestGap(rest: Composition, bent: Composition, flatten: boolean) {
  const before = points(rest, flatten);
  const after = points(bent, false); // already flattened by the distortion
  let gap = 0;
  let pairs = 0;
  for (const j of findJunctions(rest)) {
    const a0 = before.get(j.a)!;
    const b0 = before.get(j.b)!;
    a0.forEach((p, i) => {
      if (Math.hypot(p.x - j.center.x, p.y - j.center.y) > j.radius) return;
      b0.forEach((q, k) => {
        if (Math.hypot(p.x - q.x, p.y - q.y) > 0.5) return;
        if (Math.hypot(q.x - j.center.x, q.y - j.center.y) > j.radius) return;
        const pa = after.get(j.a)![i];
        const pb = after.get(j.b)![k];
        gap = Math.max(gap, Math.hypot(pa.x - pb.x, pa.y - pb.y) - Math.hypot(p.x - q.x, p.y - q.y));
        pairs++;
      });
    });
  }
  return { gap, pairs };
}

const base = defaultsOf<ShapeParams>(SHAPE_PARAMS);

describe('joins stay attached when each letter is bent differently', () => {
  // Like an animated distortion with a delay between letters, plus a different slant per letter.
  const perLetter = (noise: number) => (i: number): ShapeParams =>
    i < 0 ? base : { ...base, noise, noiseScale: 3, seed: 7, noisePhase: i * 47, slant: (i % 3) * 9 };

  let pairs = 0;
  for (const font of fonts) {
    it.each(WORDS)(`${font.name}: %s`, (word) => {
      const rest = buildComposition(font, word, base);
      const distorted = widestGap(rest, buildComposition(font, word, perLetter(45)), true);
      const slanted = widestGap(rest, buildComposition(font, word, perLetter(0)), false);
      pairs += distorted.pairs + slanted.pairs;
      expect(distorted.gap).toBeLessThan(0.5);
      expect(slanted.gap).toBeLessThan(0.5);
    });
  }

  it('actually measured touching points', () => {
    expect(pairs).toBeGreaterThan(200);
  });
});
