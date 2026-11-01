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

/**
 * Bend outlines with a smooth displacement field.
 *
 * The field is sampled in absolute line coordinates, so two letters that
 * touch at a join get the exact same displacement there and stay connected.
 */
export function applyNoise(comp: Composition, { amount, scale, seed, time = 0 }: NoiseOptions): Composition {
  if (amount <= 0) return comp;
  const noise = createNoise3D(seed);
  const em = comp.unitsPerEm;
  const freq = scale / em;
  const step = em / 80;
  const displace = (p: { x: number; y: number }) => ({
    x: p.x + amount * noise(p.x * freq, p.y * freq, time),
    y: p.y + amount * noise(p.x * freq + 31.7, p.y * freq + 17.3, time + 11.1),
  });
  return {
    ...comp,
    glyphs: comp.glyphs.map((g) => ({ ...g, commands: mapCommands(flattenCommands(g.commands, step), displace) })),
  };
}
