import type { Composition } from '../core/types';
import { flattenCommands, mapCommands } from './geometry';
import { createNoise3D } from './perlin';

export interface NoiseOptions {
  /** Maximum displacement, in font units. */
  amount: number;
  /** Number of noise "bumps" per em. */
  scale: number;
  seed: number;
  /**
   * Slides the pattern around a circle in the noise field (degrees).
   * A full turn comes back to the start, so animating it loops seamlessly.
   */
  phase?: number;
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
      const { amount, scale, seed, phase = 0 } = options(g.letter);
      if (amount <= 0) return g;
      const noise = field(seed);
      const freq = scale / em;
      const a = (phase * Math.PI) / 180;
      const ox = Math.cos(a) * 1.5;
      const oy = Math.sin(a) * 1.5;
      const displace = (p: { x: number; y: number }) => ({
        x: p.x + amount * noise(p.x * freq + ox, p.y * freq + oy, 0),
        y: p.y + amount * noise(p.x * freq + ox + 31.7, p.y * freq + oy + 17.3, 11.1),
      });
      return { ...g, commands: mapCommands(flattenCommands(g.commands, step), displace) };
    }),
  };
}
