import type { PointMap } from './geometry';
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
 * A smooth displacement field, sampled in absolute line coordinates: two
 * letters with the same settings move the same way where they touch.
 * Returns null when there is nothing to do.
 */
export function noiseMap(options: NoiseOptions, unitsPerEm: number): PointMap | null {
  const { amount, scale, seed, phase = 0 } = options;
  if (amount <= 0) return null;
  const noise = field(seed);
  const freq = scale / unitsPerEm;
  const a = (phase * Math.PI) / 180;
  const ox = Math.cos(a) * 1.5;
  const oy = Math.sin(a) * 1.5;
  return (p) => ({
    x: p.x + amount * noise(p.x * freq + ox, p.y * freq + oy, 0),
    y: p.y + amount * noise(p.x * freq + ox + 31.7, p.y * freq + oy + 17.3, 11.1),
  });
}
