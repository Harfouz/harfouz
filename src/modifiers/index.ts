import type { LoadedFont } from '../core/fonts';
import { insertKashida } from '../core/kashida';
import { shapeLine } from '../core/shaping';
import type { Composition } from '../core/types';
import type { ShapeParams } from '../params/schema';
import { bendLetters } from './bend';
import { slantMap, toComposition, type PointMap } from './geometry';
import { noiseMap } from './noise';
import { applySpacing } from './spacing';
import { applyWidth } from './width';

/** Shape parameters for one letter, by its index in the typed text. */
export type ShapeResolver = (letter: number) => ShapeParams;

/**
 * The full shape pipeline, in order:
 *   1. kashida   – edits the text itself (tatweels), before shaping
 *   2. shaping   – HarfBuzz picks joined forms and places diacritics
 *   3. width     – stretches each letter and re-lays the line out
 *   4. spacing   – opens gaps only between unconnected letters
 *   5. slant     – shear of the outlines
 *   6. distortion – smooth noise field on flattened outlines
 *
 * Slant and distortion are applied together, blended across joins so
 * connected letters stay attached whatever their own settings (bend.ts).
 *
 * Every step reads the parameters of the letter it is working on, so each
 * letter can have its own values. Weight and the 3D settings are applied
 * by the renderers.
 *
 * `params` is either one set of values for the whole word or a resolver
 * giving each letter its own.
 */
export function buildComposition(
  font: LoadedFont,
  source: string,
  params: ShapeParams | ShapeResolver,
): Composition {
  const resolve: ShapeResolver = typeof params === 'function' ? params : () => params;
  const word = resolve(-1);
  const perMille = font.unitsPerEm / 1000;

  const { text, sourceIndex } = insertKashida(
    source,
    (i) => resolve(i).kashida,
    word.kashidaPlacement,
    (i) => resolve(i).kashida !== word.kashida,
  );
  let line = shapeLine(font, text, sourceIndex);
  line = applyWidth(line, (l) => resolve(l).width);
  line = applySpacing(line, (l) => resolve(l).spacing * perMille);
  let comp = toComposition(line);
  comp = bendLetters(comp, (l) => {
    const p = resolve(l);
    const slant = slantMap(p.slant);
    const noise = noiseMap(
      { amount: p.noise * perMille, scale: p.noiseScale, seed: p.seed, phase: p.noisePhase },
      font.unitsPerEm,
    );
    const map: PointMap | null = slant && noise ? (q) => noise(slant(q)) : (slant ?? noise);
    const key = [p.slant, noise ? [p.noise, p.noiseScale, p.seed, p.noisePhase] : 0].join();
    return { map, curved: noise !== null, key };
  });
  return comp;
}
