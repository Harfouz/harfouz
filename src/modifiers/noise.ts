import type { Composition } from '../core/types';
import { flattenCommands, mapCommands } from './geometry';
import { createNoise3D } from './perlin';

export interface NoiseOptions {
  /** Maximum displacement, in font units. */
  amount: number;
  /** Number of noise "bumps" per em. */
  scale: number;
  seed: number;
  /** Position along the third noise axis (time, for animation). */
  time?: number;
}

const fields = new Map<number, ReturnType<typeof createNoise3D>>();
function field(seed: number) {
  let noise = fields.get(seed);
  if (!noise) {
    noise = createNoise3D(seed);
    fields.set(seed, noise);
  }
  return noise;
}

/**
 * Bend outlines with a smooth displacement field.
 *
 * The field is sampled in absolute line coordinates, so two letters that
 * touch at a join get the exact same displacement there and stay connected
 * (as long as they share the same distortion settings).
 */
export function applyNoise(comp: Composition, options: (letter: number) => NoiseOptions): Composition {
  const em = comp.unitsPerEm;
  const step = em / 80;
  return {
    ...comp,
    glyphs: comp.glyphs.map((g) => {
      const { amount, scale, seed, time = 0 } = options(g.letter);
      if (amount <= 0) return g;
      const noise = field(seed);
      const freq = scale / em;
      const displace = (p: { x: number; y: number }) => ({
        x: p.x + amount * noise(p.x * freq, p.y * freq, time),
        y: p.y + amount * noise(p.x * freq + 31.7, p.y * freq + 17.3, time + 11.1),
      });
      return { ...g, commands: mapCommands(flattenCommands(g.commands, step), displace) };
    }),
  };
}
