import type { LoadedFont } from '../core/fonts';
import { insertKashida } from '../core/kashida';
import { shapeLine } from '../core/shaping';
import type { Composition } from '../core/types';
import type { ShapeParams } from '../params/schema';
import { applyWidthAndSlant, toComposition } from './geometry';
import { applyNoise } from './noise';
import { applySpacing } from './spacing';

/**
 * The full shape pipeline, in order:
 *   1. kashida   – edits the text itself (tatweels), before shaping
 *   2. shaping   – HarfBuzz picks joined forms and places diacritics
 *   3. spacing   – opens gaps only between unconnected letters
 *   4. width + slant – exact affine transforms of the whole line
 *   5. distortion – smooth noise field on flattened outlines
 *
 * Weight is not here: it is a rendering effect (stroke / erosion).
 */
export function buildComposition(font: LoadedFont, source: string, params: ShapeParams, time = 0): Composition {
  const perMille = font.unitsPerEm / 1000;
  const { text, sourceIndex } = insertKashida(source, params.kashida, params.kashidaPlacement);
  let line = shapeLine(font, text, sourceIndex);
  line = applySpacing(line, params.spacing * perMille);
  let comp = toComposition(line);
  comp = applyWidthAndSlant(comp, params.width, params.slant);
  comp = applyNoise(comp, {
    amount: params.noise * perMille,
    scale: params.noiseScale,
    seed: params.seed,
    time,
  });
  return comp;
}
