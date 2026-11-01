import { describe, expect, it } from 'vitest';
import { shapeLine } from '../src/core/shaping';
import { fonts, TEST_WORDS } from './fixtures';

describe.each(fonts)('shaping with $name', (font) => {
  it.each(TEST_WORDS)('%s: every glyph exists and has a usable outline', (word) => {
    const line = shapeLine(font, word);
    expect(line.glyphs.length).toBeGreaterThan(0);
    for (const g of line.glyphs) {
      expect(g.glyphId, 'missing glyph (.notdef)').not.toBe(0);
      const isSpace = word[g.cluster] === ' ';
      if (!isSpace) expect(g.commands.length).toBeGreaterThan(0);
    }
  });

  it.each(TEST_WORDS)('%s: diacritics stay attached to a base letter', (word) => {
    const line = shapeLine(font, word);
    const baseClusters = new Set(line.glyphs.filter((g) => !g.isMark).map((g) => g.cluster));
    for (const mark of line.glyphs.filter((g) => g.isMark)) {
      expect(baseClusters.has(mark.cluster)).toBe(true);
      expect(mark.advance).toBe(0);
    }
  });

  it('letters inside a word take joined forms, not isolated ones', () => {
    const word = 'مستشفى';
    const isolated = [...word].map((ch) => shapeLine(font, ch).glyphs[0].glyphId);
    // Visual order is left to right, so reverse to get logical order back.
    const joined = shapeLine(font, word)
      .glyphs.filter((g) => !g.isMark)
      .reverse()
      .map((g) => g.glyphId);
    // Every letter of this word connects to its neighbours, so none of them
    // may keep its isolated shape.
    joined.forEach((id, i) => expect(id, `letter ${i} kept its isolated form`).not.toBe(isolated[i]));
  });

  it('lam + alef uses the mandatory ligature forms', () => {
    // Amiri and Noto build lam-alef from two interlocking glyphs (rlig)
    // rather than a single one, so we check that neither keeps its plain form.
    const [alef, lam] = shapeLine(font, 'لا').glyphs.filter((g) => !g.isMark);
    expect(lam.glyphId).not.toBe(shapeLine(font, 'ل').glyphs[0].glyphId);
    expect(alef.glyphId).not.toBe(shapeLine(font, 'ا').glyphs[0].glyphId);
  });

  it('marks are recognised in a vocalised word', () => {
    const marks = shapeLine(font, 'مُدَرِّسَة').glyphs.filter((g) => g.isMark);
    // damma, fatha, shadda, kasra, fatha (some fonts merge shadda + kasra).
    expect(marks.length).toBeGreaterThanOrEqual(4);
  });
});
