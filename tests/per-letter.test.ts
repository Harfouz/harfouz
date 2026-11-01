import { describe, expect, it } from 'vitest';
import { insertKashida } from '../src/core/kashida';
import { shapeLine } from '../src/core/shaping';
import { buildComposition } from '../src/modifiers';
import { applyWidth } from '../src/modifiers/width';
import { ParamState } from '../src/params/state';
import { fonts, TEST_WORDS } from './fixtures';

describe('ParamState', () => {
  it('letters inherit the word until they override a value', () => {
    const p = new ParamState();
    p.set(null, 'slant', 10);
    expect(p.resolve(2).slant).toBe(10);
    p.set(2, 'slant', -5);
    expect(p.resolve(2).slant).toBe(-5);
    expect(p.resolve(1).slant).toBe(10);
    // Changing the word still reaches the letter's other parameters.
    p.set(null, 'width', 150);
    expect(p.resolve(2).width).toBe(150);
  });

  it('resetting a letter value falls back to the word', () => {
    const p = new ParamState();
    p.set(null, 'noise', 20);
    p.set(3, 'noise', 80);
    p.reset(3, 'noise');
    expect(p.resolve(3).noise).toBe(20);
    expect(p.hasOverrides(3)).toBe(false);
  });

  it('keeps overrides only where the same character stays in place', () => {
    const p = new ParamState();
    p.set(0, 'lift', 100); // م of محمد
    p.set(3, 'lift', 100); // د of محمد
    p.retarget('محمد', 'محمود');
    expect(p.hasOverrides(0)).toBe(true);
    expect(p.hasOverrides(3)).toBe(false);
  });
});

describe('per-letter kashida', () => {
  it('elongates only the join after the chosen letter', () => {
    // Word value 0, letter 1 (ح) has 3.
    const { text } = insertKashida('محمد', (i) => (i === 1 ? 3 : 0), 'last', (i) => i === 1);
    expect(text).toBe('محـــمد');
  });

  it('still respects the placement for other letters', () => {
    const { text } = insertKashida('محمد', (i) => (i === 0 ? 1 : 2), 'last', (i) => i === 0);
    // م (forced, 1 tatweel) and the last join م→د (word value, 2 tatweels).
    expect(text).toBe('مـحمــد');
  });
});

describe.each(fonts)('per-letter shapes with $name', (font) => {
  it('stretching one letter moves its neighbours but leaves their shapes alone', () => {
    const line = shapeLine(font, 'مستشفى');
    const target = line.glyphs.find((g) => !g.isMark && g.letter === 2)!; // ت
    const stretched = applyWidth(line, (l) => (l === 2 ? 200 : 100));
    expect(stretched.width).toBeCloseTo(line.width + target.advance);
    stretched.glyphs.forEach((g, i) => {
      if (g.letter === 2) return;
      expect(g.commands).toEqual(line.glyphs[i].commands);
    });
  });

  it.each(TEST_WORDS)('%s: every letter can carry different settings', (word) => {
    const p = new ParamState();
    for (let i = 0; i < word.length; i += 2) {
      p.set(i, 'width', 60 + i * 15);
      p.set(i, 'slant', i * 3);
      p.set(i, 'noise', 30);
      p.set(i, 'kashida', 1);
      p.set(i, 'spacing', 80);
    }
    const comp = buildComposition(font, word, (i) => p.resolve(i));
    expect(comp.glyphs.length).toBeGreaterThan(0);
    for (const g of comp.glyphs) {
      for (const c of g.commands) if (c.type !== 'Z') expect(Number.isFinite(c.x + c.y)).toBe(true);
    }
  });
});
