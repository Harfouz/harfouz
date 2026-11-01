import { describe, expect, it } from 'vitest';
import { shapeLine } from '../src/core/shaping';
import { fonts, TEST_WORDS } from './fixtures';

describe.each(fonts)('shaping with $name', (font) => {
  it.each(TEST_WORDS)('%s: every glyph exists and has a usable outline', (word) => {
    const line = shapeLine(font, word);
    expect(line.glyphs.length).toBeGreaterThan(0);
    for (const g of line.glyphs) {
      expect(g.glyphId, 'missing glyph (.notdef)').not.toBe(0);
      // Spaces are empty, and so is the tatweel in fonts that don't stretch
      // (Aref Ruqaa: Ruqaa calligraphy has no kashida).
      const empty = word[g.cluster] === ' ' || word[g.cluster] === 'ـ';
      if (!empty) expect(g.commands.length).toBeGreaterThan(0);
    }
  });

  it.each(TEST_WORDS)('%s: diacritics stay attached to a base letter', (word) => {
    const line = shapeLine(font, word);
    const baseClusters = new Set(line.glyphs.filter((g) => !g.isMark).map((g) => g.cluster));
    // An invisible tatweel may be classed as a mark (Aref Ruqaa): it has nothing to sit on.
    for (const mark of line.glyphs.filter((g) => g.isMark && word[g.cluster] !== 'ـ')) {
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

  it('lam + alef uses the mandatory ligature', () => {
    // Fonts do this in one of two ways: a single lam-alef glyph, or two
    // interlocking glyphs (Amiri, Noto). Either way, neither letter may keep
    // its plain form.
    const bases = shapeLine(font, 'لا').glyphs.filter((g) => !g.isMark);
    const plain = [shapeLine(font, 'ل').glyphs[0].glyphId, shapeLine(font, 'ا').glyphs[0].glyphId];
    expect(bases.length).toBeLessThanOrEqual(2);
    for (const g of bases) expect(plain).not.toContain(g.glyphId);
  });

  it('marks are recognised in a vocalised word', () => {
    const marks = shapeLine(font, 'مُدَرِّسَة').glyphs.filter((g) => g.isMark);
    // damma, fatha, shadda, kasra, fatha; some fonts merge shadda + kasra.
    // Lemonada gives its merged shadda + kasra an advance, as if it were a
    // letter (a quirk of the font), so it can't be told apart.
    expect(marks.length).toBeGreaterThanOrEqual(font.id === 'lemonada' ? 3 : 4);
  });
});
