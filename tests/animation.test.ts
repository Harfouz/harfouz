import { describe, expect, it } from 'vitest';
import { buildComposition } from '../src/modifiers';
import { AnimationState, DEFAULT_ANIM, isAnimatable, MOTION_PRESETS, wave, WAVES } from '../src/params/animation';
import { ALL_PARAMS } from '../src/params/schema';
import { ParamState } from '../src/params/state';
import { fonts, TEST_WORDS } from './fixtures';

describe('waves', () => {
  it.each(WAVES)('%s comes back to its start after one cycle (seamless loops)', (kind) => {
    for (const x of [0, 0.13, 0.5, 0.87]) expect(wave(kind, x + 1)).toBeCloseTo(wave(kind, x), 6);
    if (kind !== 'ramp') expect(wave(kind, 0.999999)).toBeCloseTo(wave(kind, 0), 3);
  });

  it.each(WAVES)('%s stays between -1 and 1', (kind) => {
    for (let x = 0; x < 1; x += 0.01) {
      expect(wave(kind, x)).toBeGreaterThanOrEqual(-1);
      expect(wave(kind, x)).toBeLessThanOrEqual(1);
    }
  });

  it('sine and triangle share the same timing', () => {
    for (const x of [0, 0.25, 0.5, 0.75]) expect(wave('triangle', x)).toBeCloseTo(wave('sine', x), 6);
  });
});

describe('what can be animated', () => {
  it('offers motion on sliders, but not on the random seed', () => {
    expect(isAnimatable('noisePhase')).toBe(true);
    expect(isAnimatable('weight')).toBe(true);
    expect(isAnimatable('seed')).toBe(false);
    expect(isAnimatable('material')).toBe(false);
  });
});

describe('AnimationState', () => {
  const p = new ParamState();

  it('moves a value around its still value', () => {
    const a = new AnimationState();
    a.set(null, 'lift', { ...DEFAULT_ANIM, amount: 100 });
    expect(a.apply(p.word, null, 0, 0).lift).toBeCloseTo(0);
    expect(a.apply(p.word, null, 0, 0.25).lift).toBeCloseTo(100);
    expect(a.apply(p.word, null, 0, 0.75).lift).toBeCloseTo(-100);
  });

  it('delays each letter by the spread, in reading order', () => {
    const a = new AnimationState();
    a.set(null, 'lift', { ...DEFAULT_ANIM, amount: 100, spread: 0.25 });
    // At t = 0.25 the first letter is at its peak, the second one is still at rest.
    expect(a.apply(p.resolve(0), 0, 0, 0.25).lift).toBeCloseTo(100);
    expect(a.apply(p.resolve(1), 1, 1, 0.25).lift).toBeCloseTo(0);
  });

  it("a letter's own motion replaces the word's for that letter only", () => {
    const a = new AnimationState();
    a.set(null, 'turn', { ...DEFAULT_ANIM, amount: 30 });
    a.set(2, 'turn', { ...DEFAULT_ANIM, amount: 0 });
    expect(a.apply(p.resolve(1), 1, 1, 0.25).turn).toBeCloseTo(30);
    expect(a.apply(p.resolve(2), 2, 2, 0.25).turn).toBeCloseTo(0);
  });

  it('keeps values inside their range, except angles which may wrap', () => {
    const a = new AnimationState();
    a.set(null, 'depth', { ...DEFAULT_ANIM, amount: -5000 });
    a.set(null, 'spin', { ...DEFAULT_ANIM, amount: 360, wave: 'ramp' });
    // At t = 0.25 the sine is at +1: depth is pushed far below 0, spin passes 90°.
    const v = a.apply(p.word, null, 0, 0.25);
    expect(v.depth).toBe(0);
    expect(v.spin).toBeCloseTo(90);
    expect(a.apply(p.word, null, 0, 0.75).spin).toBeCloseTo(270);
  });

  it('kashida stays a whole number of tatweels', () => {
    const a = new AnimationState();
    a.set(null, 'kashida', { ...DEFAULT_ANIM, amount: 3, wave: 'bounce' });
    for (let t = 0; t < 1; t += 0.07) expect(Number.isInteger(a.apply(p.word, null, 0, t).kashida)).toBe(true);
  });

  it('presets only animate parameters that exist', () => {
    const keys = new Set(ALL_PARAMS.map((d) => d.key));
    for (const preset of Object.values(MOTION_PRESETS)) {
      for (const key of Object.keys(preset.anims)) expect(keys.has(key)).toBe(true);
    }
  });
});

describe.each(fonts)('animated shapes with $name', (font) => {
  it.each(TEST_WORDS)('%s: every frame of every preset builds a valid word', (word) => {
    const p = new ParamState();
    const a = new AnimationState();
    for (const preset of Object.values(MOTION_PRESETS)) {
      for (const [key, config] of Object.entries(preset.anims)) a.set(null, key as never, { ...DEFAULT_ANIM, ...config });
    }
    for (const t of [0, 0.2, 0.5, 0.9]) {
      const comp = buildComposition(font, word, (i) => a.apply(i < 0 ? p.word : p.resolve(i), i < 0 ? null : i, i, t));
      for (const g of comp.glyphs) for (const c of g.commands) if (c.type !== 'Z') expect(Number.isFinite(c.x + c.y)).toBe(true);
    }
  });
});
