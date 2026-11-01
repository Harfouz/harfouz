import { describe, expect, it } from 'vitest';
import { breaksAfter } from '../src/core/joining';
import { insertKashida } from '../src/core/kashida';
import { shapeLine } from '../src/core/shaping';
import { buildComposition } from '../src/modifiers';
import { applySpacing } from '../src/modifiers/spacing';
import { defaultsOf, SHAPE_PARAMS, type ShapeParams } from '../src/params/schema';
import { fonts, TEST_WORDS } from './fixtures';

const TATWEEL = /ـ/g;

describe('joining rules', () => {
  it('knows which letters connect to the next one', () => {
    // م→د joined, د never joins forward, ر never joins forward, س→ة joined, ة ends the word.
    expect(breaksAfter('مدرسة')).toEqual([false, true, true, false, true]);
  });

  it('treats diacritics as transparent', () => {
    // مُدَرِّسَة: the damma after م must not break the م→د join.
    const text = 'مُدَرِّسَة';
    expect(breaksAfter(text)[0]).toBe(false);
  });
});

describe('kashida insertion', () => {
  it('elongates the last join of each word', () => {
    const { text } = insertKashida('محمد', 2, 'last');
    expect(text).toBe('محمــد');
  });

  it('elongates every join', () => {
    const { text } = insertKashida('مستشفى', 1, 'all');
    expect(text.match(TATWEEL)?.length).toBe(5);
  });

  it('never splits lam-alef', () => {
    expect(insertKashida('لا', 3, 'all').text).toBe('لا');
    expect(insertKashida('السلام', 1, 'all').text).not.toContain('لـا');
  });

  it('keeps diacritics on their letter and maps tatweels back to it', () => {
    const source = 'مُدَرِّسَة';
    const { text, sourceIndex } = insertKashida(source, 2, 'last');
    expect(text.replace(TATWEEL, '')).toBe(source);
    // The tatweels come right after سَ (letter index 6) and belong to it.
    expect(text).toContain('سَــة');
    const firstTatweel = text.indexOf('ـ');
    expect(sourceIndex[firstTatweel]).toBe(source.indexOf('س'));
  });

  it('places one elongation per word in a phrase', () => {
    const { text } = insertKashida('السَّلَامُ عَلَيْكُمْ', 1, 'last');
    expect(text.match(TATWEEL)?.length).toBe(2);
  });
});

describe.each(fonts)('shape pipeline with $name', (font) => {
  const defaults = defaultsOf<ShapeParams>(SHAPE_PARAMS);
  const extreme: ShapeParams = {
    ...defaults,
    kashida: 3,
    kashidaPlacement: 'all',
    spacing: 150,
    width: 160,
    slant: 20,
    noise: 60,
  };

  it.each(TEST_WORDS)('%s: survives every modifier at once', (word) => {
    const comp = buildComposition(font, word, extreme);
    expect(comp.glyphs.length).toBeGreaterThan(0);
    for (const g of comp.glyphs) {
      for (const c of g.commands) {
        if (c.type !== 'Z') expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
      }
      // Every glyph, tatweels included, maps back to a character the user typed.
      expect(g.letter).toBeGreaterThanOrEqual(0);
      expect(g.letter).toBeLessThan(word.length);
    }
  });

  it.each(TEST_WORDS)('%s: kashida text still shapes without missing glyphs', (word) => {
    const { text, sourceIndex } = insertKashida(word, 3, 'all');
    const line = shapeLine(font, text, sourceIndex);
    for (const g of line.glyphs) expect(g.glyphId).not.toBe(0);
  });

  it.each(TEST_WORDS)('%s: spacing never opens a gap inside a join', (word) => {
    const amount = 200;
    const before = shapeLine(font, word);
    const after = applySpacing(before, amount);
    const breaks = breaksAfter(word);
    const bases = (l: typeof before) => l.glyphs.filter((g) => !g.isMark);
    const b0 = bases(before);
    const b1 = bases(after);
    // Visual order is left to right: glyph i+1 sits to the right of glyph i,
    // so it comes first logically. If it joins its left neighbour, the
    // distance between them must not change.
    for (let i = 0; i < b0.length - 1; i++) {
      const right = b0[i + 1];
      if (right.cluster === b0[i].cluster) continue;
      const gap0 = right.x - b0[i].x;
      const gap1 = b1[i + 1].x - b1[i].x;
      if (breaks[right.cluster]) expect(gap1 - gap0).toBeCloseTo(amount);
      else expect(gap1).toBeCloseTo(gap0);
    }
  });

  it('distortion is reproducible for a given seed', () => {
    const p = { ...defaults, noise: 50, seed: 3 };
    const a = buildComposition(font, 'محمد', p);
    const b = buildComposition(font, 'محمد', p);
    expect(a.glyphs[0].commands).toEqual(b.glyphs[0].commands);
    const c = buildComposition(font, 'محمد', { ...p, seed: 4 });
    expect(c.glyphs[0].commands).not.toEqual(a.glyphs[0].commands);
  });

  it('width scales the whole line', () => {
    const normal = buildComposition(font, 'مستشفى', defaults);
    const wide = buildComposition(font, 'مستشفى', { ...defaults, width: 200 });
    expect(wide.width).toBeCloseTo(normal.width * 2);
  });
});
