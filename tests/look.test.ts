import { describe, expect, it } from 'vitest';
import { ParamState } from '../src/params/state';
import { letterFill, PALETTES, textureOf } from '../src/render/look';

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

describe('textures', () => {
  it('no texture by default, except paper which shows paper grain', () => {
    const p = new ParamState();
    expect(textureOf(p.word)).toBeNull();
    p.set(null, 'material', 'paper');
    expect(textureOf(p.word)?.id).toBe('grain');
  });

  it('paper keeps some grain even at low strength', () => {
    const p = new ParamState();
    p.set(null, 'material', 'paper');
    p.set(null, 'grain', 0);
    expect(textureOf(p.word)!.strength).toBeGreaterThan(0.4);
  });

  it('a chosen texture follows the strength and size sliders', () => {
    const p = new ParamState();
    p.set(null, 'texture', 'marble');
    p.set(null, 'grain', 30);
    p.set(null, 'textureScale', 250);
    expect(textureOf(p.word)).toEqual({ id: 'marble', strength: 0.3, scale: 2.5 });
    p.set(null, 'grain', 0);
    expect(textureOf(p.word)).toBeNull();
  });

  it('each letter can have its own texture', () => {
    const p = new ParamState();
    p.set(2, 'texture', 'fur');
    expect(textureOf(p.resolve(2))?.id).toBe('fur');
    expect(textureOf(p.resolve(1))).toBeNull();
  });
});

describe('texture catalogue', () => {
  it('every texture has a name, a size and an entry in the Texture menu', async () => {
    const { TEXTURES, TEXTURE_LABELS, TILE_SIZE, HAIRY } = await import('../src/render/textures');
    const { LOOK_PARAMS } = await import('../src/params/schema');
    const menu = LOOK_PARAMS.find((d) => d.key === 'texture')!;
    const options = 'options' in menu ? menu.options.map((o) => o.value) : [];
    for (const t of TEXTURES) {
      expect(TEXTURE_LABELS[t]).toBeTruthy();
      expect(TILE_SIZE[t]).toBeGreaterThan(0);
      expect(options).toContain(t);
    }
    for (const t of HAIRY) expect(TEXTURES).toContain(t);
  });
});
