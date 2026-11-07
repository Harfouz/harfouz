import { describe, expect, it } from 'vitest';
import type { Composition } from '../src/core/types';
import { buildComposition } from '../src/modifiers';
import { flattenCommands } from '../src/modifiers/geometry';
import { letterSpans } from '../src/modifiers/joins';
import { defaultsOf, SHAPE_PARAMS, type ShapeParams } from '../src/params/schema';
import { fonts, TEST_WORDS } from './fixtures';

const WORDS = [...TEST_WORDS, 'حرفوز', 'كلمة'];
const base = defaultsOf<ShapeParams>(SHAPE_PARAMS);

/** Filled area of each letter (diacritics included under their own index). */
function areas(comp: Composition) {
  const out = new Map<number, number>();
  for (const g of comp.glyphs) {
    let sum = 0;
    let start: { x: number; y: number } | null = null;
    let prev: { x: number; y: number } | null = null;
    for (const c of flattenCommands(g.commands, comp.unitsPerEm / 100)) {
      if (c.type === 'M') start = prev = { x: c.x, y: c.y };
      else if (c.type === 'Z') {
        if (prev && start) sum += prev.x * start.y - start.x * prev.y;
        prev = start;
      } else {
        sum += prev!.x * c.y - c.x * prev!.y;
        prev = { x: c.x, y: c.y };
      }
    }
    out.set(g.letter, (out.get(g.letter) ?? 0) + Math.abs(sum / 2));
  }
  return out;
}

/** Outline points of each letter body. */
function points(comp: Composition) {
  const out = new Map<number, { x: number; y: number }[]>();
  for (const g of comp.glyphs) {
    if (g.isMark) continue;
    const list = out.get(g.letter) ?? [];
    for (const c of flattenCommands(g.commands, comp.unitsPerEm / 200)) if (c.type !== 'Z') list.push(c);
    out.set(g.letter, list);
  }
  return out;
}

describe('weight and soften', () => {
  for (const font of fonts) {
    it.each(WORDS)(`${font.name}: %s gets thinner and bolder without losing a letter or a join`, (word) => {
      const rest = buildComposition(font, word, base);
      const thin = buildComposition(font, word, { ...base, weight: -60 });
      const thinnest = buildComposition(font, word, { ...base, weight: -75 });
      const bold = buildComposition(font, word, { ...base, weight: 60 });
      const a0 = areas(rest);
      const aThin = areas(thin);
      const aThinnest = areas(thinnest);
      const aBold = areas(bold);
      for (const [letter, area] of a0) {
        if (area < 1) continue;
        // Never vanishes, even at the thinnest setting.
        expect(aThinnest.get(letter) ?? 0).toBeGreaterThan(area * 0.01);
        expect(aThinnest.get(letter)!).toBeLessThan(aThin.get(letter)!);
        expect(aThin.get(letter)!).toBeLessThan(area);
        expect(aBold.get(letter)!).toBeGreaterThan(area);
      }

      // Joined letters still touch once thinned.
      const em = rest.unitsPerEm;
      const before = points(rest);
      const after = points(thin);
      const spans = letterSpans(rest);
      for (let i = 0; i < spans.length - 1; i++) {
        if (!spans[i].joinsNext) continue;
        const near = (m: Map<number, { x: number; y: number }[]>) => {
          const A = m.get(spans[i].letter) ?? [];
          const B = m.get(spans[i + 1].letter) ?? [];
          let best = Infinity;
          for (const p of A) for (const q of B) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
          return best;
        };
        if (near(before) > em * 0.01) continue; // these two outlines don't meet in this font
        expect(near(after)).toBeLessThan(em * 0.01);
      }
    });
  }

  for (const font of fonts) {
    it.each(WORDS)(`${font.name}: %s softens without losing a stroke or a join`, (word) => {
      const rest = buildComposition(font, word, base);
      const soft = buildComposition(font, word, { ...base, soften: 100 });
      const both = buildComposition(font, word, { ...base, soften: 100, weight: -60 });
      const thin = buildComposition(font, word, { ...base, weight: -60 });
      const a0 = areas(rest);
      const aSoft = areas(soft);
      const aBoth = areas(both);
      const aThin = areas(thin);
      for (const [letter, area] of a0) {
        if (area < 1) continue;
        // Rounding trims corners and fills inner ones: the letter keeps roughly its ink.
        expect(aSoft.get(letter)!).toBeGreaterThan(area * 0.75);
        expect(aSoft.get(letter)!).toBeLessThan(area * 1.3);
        expect(aBoth.get(letter)!).toBeGreaterThan(aThin.get(letter)! * 0.6);
      }
      const em = rest.unitsPerEm;
      const spans = letterSpans(rest);
      for (const [before, after] of [[rest, soft], [thin, both]]) {
        const p0 = points(before);
        const p1 = points(after);
        for (let i = 0; i < spans.length - 1; i++) {
          if (!spans[i].joinsNext) continue;
          const near = (m: Map<number, { x: number; y: number }[]>) => {
            const A = m.get(spans[i].letter) ?? [];
            const B = m.get(spans[i + 1].letter) ?? [];
            let best = Infinity;
            for (const p of A) for (const q of B) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
            return best;
          };
          if (near(p0) > em * 0.01) continue;
          expect(near(p1)).toBeLessThan(em * 0.01);
        }
      }
    });
  }

  it('is quick enough to drag the slider', () => {
    const font = fonts[0];
    buildComposition(font, 'السَّلَامُ عَلَيْكُمْ', { ...base, weight: -50 });
    const start = performance.now();
    for (let i = 0; i < 5; i++) buildComposition(font, 'السَّلَامُ عَلَيْكُمْ', { ...base, weight: -50 - i });
    const each = (performance.now() - start) / 5;
    process.stderr.write(`weight: ${each.toFixed(0)} ms per composition\n`);
    expect(each).toBeLessThan(400);
  });

  it('softens quickly enough to drag the slider', () => {
    const font = fonts[0];
    const start = performance.now();
    for (let i = 0; i < 5; i++) buildComposition(font, 'السَّلَامُ عَلَيْكُمْ', { ...base, soften: 60 + i * 5 });
    const each = (performance.now() - start) / 5;
    process.stderr.write(`soften: ${each.toFixed(0)} ms per composition\n`);
    expect(each).toBeLessThan(400);
  });
});
