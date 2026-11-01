import { ExtrudeGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { shapeLine } from '../src/core/shaping';
import { buildComposition } from '../src/modifiers';
import { defaultsOf, SHAPE_PARAMS, type ShapeParams } from '../src/params/schema';
import { outlinesToShapes, splitContours } from '../src/render/three/contours';
import { shapesByLetter } from '../src/render/three/ThreeRenderer';
import { fonts, TEST_WORDS } from './fixtures';

const defaults = defaultsOf<ShapeParams>(SHAPE_PARAMS);

describe.each(fonts)('3D extrusion with $name', (font) => {
  it('finds the counter of ه as a hole, not as a filled shape', () => {
    const glyph = shapeLine(font, 'ه').glyphs[0];
    const shapes = outlinesToShapes(glyph.commands, font.unitsPerEm);
    const holes = shapes.reduce((n, s) => n + s.holes.length, 0);
    // Every contour is used, either as a shape or as a hole.
    expect(splitContours(glyph.commands).length).toBe(shapes.length + holes);
    // Markazi Text draws its ه as one looping contour: no separate counter.
    if (font.id !== 'markazi-text') expect(holes).toBeGreaterThan(0);
  });

  it.each(TEST_WORDS)('%s: every letter extrudes into a valid volume', (word) => {
    for (const params of [defaults, { ...defaults, noise: 60, slant: 15, kashida: 2 }]) {
      const letters = shapesByLetter(buildComposition(font, word, params));
      expect(letters.length).toBeGreaterThan(0);
      for (const { shapes } of letters) {
        if (!shapes.length) continue; // e.g. a space
        const geometry = new ExtrudeGeometry(shapes, {
          depth: 200,
          bevelEnabled: true,
          bevelThickness: 8,
          bevelSize: 8,
          bevelOffset: -8,
          bevelSegments: 3,
        });
        const positions = geometry.getAttribute('position').array;
        expect(positions.length).toBeGreaterThan(0);
        expect(Array.from(positions).every(Number.isFinite)).toBe(true);
        geometry.dispose();
      }
    }
  });

  it('gives each diacritic its own volume, linked to its letter', () => {
    const word = 'مُدَرِّسَة';
    const comp = buildComposition(font, word, defaults);
    const groups = shapesByLetter(comp).map((g) => g.letter);
    // The five letters are there…
    for (const i of [0, 2, 4, 7, 9]) expect(groups).toContain(i);
    // …and every diacritic glyph sits on the letter just before it.
    for (const g of comp.glyphs.filter((x) => x.letter !== x.base)) {
      expect('ُ َ ِّ'.replace(/ /g, '')).toContain(word[g.letter]);
      expect(g.base).toBeLessThan(g.letter);
    }
    expect(comp.glyphs.some((g) => g.letter !== g.base)).toBe(true);
  });
});
