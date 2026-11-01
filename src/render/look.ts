import type { Params } from '../params/schema';
import type { TextureId } from './textures';

/** Letter colour palettes for the "one colour per letter" mode. */
export const PALETTES: Record<string, string[]> = {
  // Rubrication red, lapis, gold leaf, malachite, aubergine ink.
  manuscript: ['#c0412b', '#1f3a5f', '#b8892d', '#2e5e4e', '#6b2d5c'],
  dusk: ['#ff7b54', '#ffb26b', '#e5c07b', '#939b62', '#6c4f8c'],
  lagoon: ['#0f4c5c', '#5f9ea0', '#e36414', '#fb8b24', '#9a031e'],
  zellige: ['#1b6f70', '#f2e8cf', '#2a4d8f', '#d9a441', '#3c7d3b'],
};

/** Turn 'ink' into the theme's actual ink colour (as #rrggbb). */
export function resolveColor(value: string, ink: string): string {
  return value === 'ink' ? ink : value;
}

/** Current ink colour of an element, as #rrggbb. */
export function inkOf(element: Element): string {
  const rgb = getComputedStyle(element).color.match(/\d+(\.\d+)?/g)?.map(Number) ?? [0, 0, 0];
  return `#${rgb
    .slice(0, 3)
    .map((n) => Math.round(n).toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * The colour of one letter:
 * - a colour the letter overrides wins,
 * - otherwise the word's colour mode decides: one solid colour, a palette
 *   colour picked by reading order, or 'gradient' (the renderer blends
 *   `word.color` → `word.color2` from the start of the word to its end).
 */
export function letterFill(word: Params, letter: Params, order: number, ink: string): string | 'gradient' {
  if (letter.color !== word.color) return resolveColor(letter.color, ink);
  switch (word.fill) {
    case 'gradient':
      return 'gradient';
    case 'palette': {
      const palette = PALETTES[word.palette] ?? PALETTES.manuscript;
      return palette[order % palette.length];
    }
    default:
      return resolveColor(word.color, ink);
  }
}

export interface TextureChoice {
  id: TextureId;
  /** 0 → 1 */
  strength: number;
  /** Size multiplier (1 = the texture's natural size). */
  scale: number;
}

/**
 * The texture on a letter, or null. Paper shows paper grain when no other
 * texture is chosen, and always at least a little of it.
 */
export function textureOf(p: Params): TextureChoice | null {
  const paperDefault = p.texture === 'none' && p.material === 'paper';
  const id: TextureId | null = p.texture !== 'none' ? p.texture : paperDefault ? 'grain' : null;
  if (!id) return null;
  const strength = (paperDefault ? Math.max(p.grain, 45) : p.grain) / 100;
  if (strength <= 0) return null;
  // Rounded, so slowly animated values don't create a new texture every frame.
  const round = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(2));
  return { id, strength: round(strength, 0.05), scale: round(p.textureScale / 100, 0.05) };
}
