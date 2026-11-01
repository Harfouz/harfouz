import type { Params } from '../params/schema';

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

/** Paper always shows some grain, other materials only what the slider asks for. */
export function grainOf(p: Params): number {
  return (p.material === 'paper' ? Math.max(p.grain, 45) : p.grain) / 100;
}
