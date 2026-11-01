import { describe, expect, it } from 'vitest';
import { ParamState } from '../src/params/state';
import { grainOf, letterFill, PALETTES } from '../src/render/look';

const INK = '#1a1612';

describe('letter colours', () => {
  it('solid mode uses the word colour, and "ink" follows the theme', () => {
    const p = new ParamState();
    expect(letterFill(p.word, p.resolve(0), 0, INK)).toBe(INK);
    p.set(null, 'color', '#336699');
    expect(letterFill(p.word, p.resolve(0), 0, INK)).toBe('#336699');
  });

  it('palette mode gives letters successive palette colours, wrapping around', () => {
    const p = new ParamState();
    p.set(null, 'fill', 'palette');
    p.set(null, 'palette', 'lagoon');
    const colors = [0, 1, 5].map((order) => letterFill(p.word, p.resolve(order), order, INK));
    expect(colors).toEqual([PALETTES.lagoon[0], PALETTES.lagoon[1], PALETTES.lagoon[0]]);
  });

  it('gradient mode is left to the renderer', () => {
    const p = new ParamState();
    p.set(null, 'fill', 'gradient');
    expect(letterFill(p.word, p.resolve(2), 2, INK)).toBe('gradient');
  });

  it("a letter's own colour wins over every mode", () => {
    const p = new ParamState();
    p.set(null, 'fill', 'palette');
    p.set(4, 'color', '#ff0000');
    expect(letterFill(p.word, p.resolve(4), 3, INK)).toBe('#ff0000');
  });
});

describe('grain', () => {
  it('paper always has some grain, other materials follow the slider', () => {
    const p = new ParamState();
    p.set(null, 'material', 'paper');
    expect(grainOf(p.word)).toBeGreaterThan(0);
    p.set(null, 'material', 'metal');
    expect(grainOf(p.word)).toBe(0);
    p.set(null, 'grain', 30);
    expect(grainOf(p.word)).toBeCloseTo(0.3);
  });
});
