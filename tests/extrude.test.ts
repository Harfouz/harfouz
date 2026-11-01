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

  it('keeps diacritics with their letter in 3D', () => {
    // مُدَرِّسَة has 5 letters; marks must not become letters of their own.
    const letters = shapesByLetter(buildComposition(font, 'مُدَرِّسَة', defaults));
    expect(letters.length).toBe(5);
  });
});
