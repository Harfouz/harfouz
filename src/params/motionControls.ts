import type { ParamDef, RangeParam } from './schema';

/**
 * Controls of the Motion panel: the settings of one parameter's motion
 * (shown under its slider), and the playback clock.
 */

/** Settings of one parameter's motion. */
export function animDefs(def: RangeParam): ParamDef[] {
  const span = def.max - def.min;
  const defs: ParamDef[] = [
    {
      kind: 'range', key: `anim-${def.key}-amount`, i18n: 'anim.amount', label: 'Amount',
      min: -span, max: span, step: def.step, default: 0, unit: def.unit,
    },
    {
      kind: 'choice', key: `anim-${def.key}-wave`, i18n: 'anim.wave', label: 'Wave', default: 'sine',
      options: [
        { value: 'sine', label: 'Sine (smooth back and forth)' },
        { value: 'triangle', label: 'Triangle (even speed)' },
        { value: 'bounce', label: 'Bounce (hops)' },
        { value: 'ramp', label: 'Ramp (keeps going: spins, drifts)' },
        { value: 'noise', label: 'Noise (organic)' },
      ],
    },
    {
      kind: 'range', key: `anim-${def.key}-cycles`, i18n: 'anim.cycles', label: 'Repeats per loop',
      min: 1, max: 8, step: 1, default: 1, unit: '×',
    },
  ];
  if (def.scope !== 'word') {
    defs.push({
      kind: 'range', key: `anim-${def.key}-spread`, i18n: 'anim.spread', label: 'Delay between letters',
      min: 0, max: 0.5, step: 0.01, default: 0,
      hint: 'Each letter starts a little after the previous one: a ripple through the word.',
    });
  }
  return defs;
}

/** Playback speed and loop length. */
export const CLOCK_PARAMS: ParamDef[] = [
  { kind: 'range', key: 'speed', i18n: 'clock.speed', label: 'Speed', min: 0.1, max: 3, step: 0.05, default: 1, unit: '×' },
  {
    kind: 'range', key: 'loop', i18n: 'clock.loop', label: 'Loop length', min: 1, max: 20, step: 0.5, default: 4, unit: ' s',
    hint: 'Every motion comes back to its start after one loop.',
  },
];
