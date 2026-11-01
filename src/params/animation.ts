import { createNoise3D } from '../modifiers/perlin';
import { ALL_PARAMS, type Params, type RangeParam } from './schema';

/**
 * Animation: any numeric parameter can move over time.
 *
 * Time is measured in loops (0 → 1 is one loop), so an animation always
 * comes back to where it started: handy to export seamless loops later.
 * A moving parameter is its still value plus `amount × wave`, where the
 * wave repeats `cycles` times per loop. `spread` delays each letter a little
 * more than the previous one, which turns a bounce into a ripple running
 * through the word (in reading order).
 *
 * Like the parameters themselves, an animation can be set for the whole
 * word or for a single letter.
 */

export const WAVES = ['sine', 'triangle', 'bounce', 'ramp', 'noise'] as const;
export type Wave = (typeof WAVES)[number];

export interface AnimConfig {
  enabled: boolean;
  /** How far the value moves, in the parameter's own unit. */
  amount: number;
  wave: Wave;
  /** Repeats per loop (whole numbers keep the loop seamless). */
  cycles: number;
  /** Delay between consecutive letters, as a fraction of a cycle. */
  spread: number;
}

export const DEFAULT_ANIM: AnimConfig = { enabled: true, amount: 0, wave: 'sine', cycles: 1, spread: 0 };

const loopNoise = createNoise3D(11);

/**
 * Value of a wave at phase x (in cycles).
 * sine, triangle and noise swing between -1 and 1; bounce goes 0 → 1 → 0
 * (a hop); ramp climbs steadily from 0 to 1, then starts again (spins).
 */
export function wave(kind: Wave, x: number): number {
  const f = x - Math.floor(x);
  switch (kind) {
    case 'triangle':
      // Same timing as the sine (0 → 1 → 0 → -1 → 0), with straight lines.
      return 1 - 4 * Math.abs(((f + 0.25) % 1) - 0.5);
    case 'bounce':
      return Math.abs(Math.sin(Math.PI * f));
    case 'ramp':
      return f;
    case 'noise': {
      // Walk around a circle in the noise field: smooth, random-looking, and
      // back to its start after one cycle.
      const a = 2 * Math.PI * f;
      return Math.max(-1, Math.min(1, loopNoise(Math.cos(a) * 1.2, Math.sin(a) * 1.2, 0.5) * 1.6));
    }
    default:
      return Math.sin(2 * Math.PI * f);
  }
}

const RANGES = new Map(
  ALL_PARAMS.filter((d): d is RangeParam => d.kind === 'range').map((d) => [d.key as keyof Params, d]),
);

/** Parameters that can be animated (the numeric ones). */
export function isAnimatable(key: string): boolean {
  return RANGES.has(key as keyof Params);
}

/** A sensible starting amount: a quarter of the slider's range. */
export function defaultAmount(key: keyof Params): number {
  const def = RANGES.get(key);
  if (!def) return 0;
  const raw = (def.max - def.min) / 4;
  return Math.round(raw / def.step) * def.step;
}

/** Keep animated values usable: angles may wrap freely, everything else stays in its slider's range. */
function clampFor(def: RangeParam, value: number): number {
  const v = def.unit === '°' ? value : Math.min(def.max, Math.max(def.min, value));
  return def.key === 'kashida' ? Math.round(v) : v;
}

export class AnimationState {
  private word = new Map<keyof Params, AnimConfig>();
  private letters = new Map<number, Map<keyof Params, AnimConfig>>();
  /** Diacritic → the letter it sits on. */
  private parents = new Map<number, number>();

  setParents(parents: Map<number, number>) {
    this.parents = parents;
  }

  /** The configuration in effect for a letter or diacritic (its own, else its letter's, else the word's). */
  config(letter: number | null, key: keyof Params): AnimConfig | undefined {
    if (letter !== null) {
      const own = this.letters.get(letter)?.get(key);
      if (own) return own;
      const parent = this.parents.get(letter);
      const inherited = parent === undefined ? undefined : this.letters.get(parent)?.get(key);
      if (inherited) return inherited;
    }
    return this.word.get(key);
  }

  /** The configuration stored at exactly this level (no fallback). */
  own(letter: number | null, key: keyof Params): AnimConfig | undefined {
    return letter === null ? this.word.get(key) : this.letters.get(letter)?.get(key);
  }

  set(letter: number | null, key: keyof Params, config: AnimConfig) {
    if (letter === null) {
      this.word.set(key, config);
      return;
    }
    const map = this.letters.get(letter) ?? new Map();
    map.set(key, config);
    this.letters.set(letter, map);
  }

  /** Remove the configuration at this level (a letter falls back to the word). */
  clear(letter: number | null, key: keyof Params) {
    if (letter === null) this.word.delete(key);
    else {
      this.letters.get(letter)?.delete(key);
      if (this.letters.get(letter)?.size === 0) this.letters.delete(letter);
    }
  }

  clearAll() {
    this.word.clear();
    this.letters.clear();
  }

  /** Is anything moving at all? */
  get active(): boolean {
    const any = (m: Map<keyof Params, AnimConfig>) => [...m.values()].some((c) => c.enabled && c.amount !== 0);
    return any(this.word) || [...this.letters.values()].some(any);
  }

  /** Keep letter animations only where the same character stays in place. */
  retarget(oldText: string, newText: string) {
    for (const index of [...this.letters.keys()]) {
      if (oldText[index] !== newText[index]) this.letters.delete(index);
    }
  }

  /**
   * Values of a letter at time t (in loops). `order` is the letter's
   * position in reading order, used by `spread`.
   */
  apply(base: Params, letter: number | null, order: number, t: number): Params {
    let out: Params | null = null;
    for (const [key, def] of RANGES) {
      const c = this.config(letter, key);
      if (!c || !c.enabled || c.amount === 0) continue;
      const delay = def.scope === 'word' ? 0 : order * c.spread;
      const value = (base[key] as number) + c.amount * wave(c.wave, t * c.cycles - delay);
      out ??= { ...base };
      (out as unknown as Record<string, number>)[key] = clampFor(def, value);
    }
    return out ?? base;
  }
}

/** Ready-made motions, to start from. */
export interface MotionPreset {
  label: string;
  anims: Partial<Record<keyof Params, Partial<AnimConfig>>>;
  /** Still values the motion needs (only applied if the current value is the default). */
  base?: Partial<Record<keyof Params, number>>;
}

export const MOTION_PRESETS: Record<string, MotionPreset> = {
  wave: { label: 'Wave (letters rise in turn)', anims: { lift: { amount: 180, wave: 'sine', spread: 0.12 } } },
  hop: { label: 'Hop', anims: { lift: { amount: 260, wave: 'bounce', spread: 0.15, cycles: 2 } } },
  breathe: { label: 'Breathe (weight)', anims: { weight: { amount: 18, wave: 'sine' }, width: { amount: 12, wave: 'sine' } } },
  ribbon: { label: 'Ribbon (twist and depth)', anims: { twist: { amount: 18, wave: 'sine' }, stagger: { amount: 140, wave: 'sine' } } },
  spin: { label: 'Turntable', anims: { spin: { amount: 360, wave: 'ramp' } } },
  flow: {
    label: 'Liquid (flowing distortion)',
    anims: { noisePhase: { amount: 360, wave: 'ramp' } },
    base: { noise: 45, noiseScale: 3 },
  },
  stretch: { label: 'Kashida stretch', anims: { kashida: { amount: 3, wave: 'bounce' } } },
};
