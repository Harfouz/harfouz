/**
 * Every parameter the user can tweak, described once. The panel is built
 * from this list, and the animation step will read the same ranges.
 *
 * Lengths are in thousandths of an em (‰ em) so values feel the same
 * whatever the font's internal units are.
 *
 * Most parameters apply to the whole word AND can be overridden for a
 * single letter. `scope` restricts the few that only make sense at one level.
 */

/** 'word': only for the whole word. 'letter': only for a single letter. Absent: both. */
export type ParamScope = 'word' | 'letter';

interface BaseParam {
  key: string;
  label: string;
  hint?: string;
  scope?: ParamScope;
}

export interface RangeParam extends BaseParam {
  kind: 'range';
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
}

export interface ChoiceParam extends BaseParam {
  kind: 'choice';
  options: { value: string; label: string }[];
  default: string;
}

export type ParamDef = RangeParam | ChoiceParam;

export const SHAPE_PARAMS = [
  {
    kind: 'range', key: 'weight', label: 'Weight', min: -30, max: 80, step: 1, default: 0, unit: '‰',
    hint: 'Thickens the outline (positive) or erodes it (negative).',
  },
  { kind: 'range', key: 'slant', label: 'Slant', min: -35, max: 35, step: 0.5, default: 0, unit: '°' },
  {
    kind: 'range', key: 'kashida', label: 'Kashida', min: 0, max: 8, step: 1, default: 0, unit: ' ×',
    hint: 'Inserts tatweels between connected letters, then reshapes. On a letter: elongates the join after it.',
  },
  {
    kind: 'choice', key: 'kashidaPlacement', label: 'Kashida placement', default: 'last', scope: 'word',
    options: [
      { value: 'last', label: 'Last join of each word' },
      { value: 'all', label: 'Every join' },
    ],
  },
  { kind: 'range', key: 'width', label: 'Width', min: 50, max: 220, step: 1, default: 100, unit: '%' },
  {
    kind: 'range', key: 'spacing', label: 'Spacing', min: -60, max: 400, step: 1, default: 0, unit: '‰',
    hint: 'Only opens gaps where letters are not connected, so joins never break. On a letter: the gap after it.',
  },
  { kind: 'range', key: 'noise', label: 'Distortion', min: 0, max: 120, step: 1, default: 0, unit: '‰' },
  { kind: 'range', key: 'noiseScale', label: 'Distortion scale', min: 0.5, max: 12, step: 0.1, default: 3 },
  { kind: 'range', key: 'seed', label: 'Seed', min: 1, max: 99, step: 1, default: 7 },
] as const satisfies readonly ParamDef[];

export interface ShapeParams {
  weight: number;
  slant: number;
  kashida: number;
  kashidaPlacement: 'last' | 'all';
  width: number;
  spacing: number;
  noise: number;
  noiseScale: number;
  seed: number;
}

/** 3D-only parameters: how the letters sit in space. */
export const SPACE_PARAMS = [
  { kind: 'range', key: 'depth', label: 'Depth', min: 0, max: 1200, step: 5, default: 220, unit: '‰' },
  {
    kind: 'range', key: 'bevel', label: 'Bevel', min: 0, max: 40, step: 0.5, default: 8, unit: '‰',
    hint: 'Rounds the front and back edges of the volume.',
  },
  {
    kind: 'range', key: 'stagger', label: 'Stagger', min: -600, max: 600, step: 5, default: 0, unit: '‰', scope: 'word',
    hint: 'Moves each letter further back (or forward) in space.',
  },
  {
    kind: 'range', key: 'twist', label: 'Twist', min: -90, max: 90, step: 1, default: 0, unit: '°', scope: 'word',
    hint: 'Turns each letter a little more than the previous one around its vertical axis.',
  },
  {
    kind: 'range', key: 'push', label: 'Push', min: -1500, max: 1500, step: 5, default: 0, unit: '‰', scope: 'letter',
    hint: 'Moves this letter forward (positive) or back (negative).',
  },
  {
    kind: 'range', key: 'lift', label: 'Lift', min: -1000, max: 1000, step: 5, default: 0, unit: '‰', scope: 'letter',
    hint: 'Moves this letter up or down.',
  },
  {
    kind: 'range', key: 'turn', label: 'Turn', min: -180, max: 180, step: 1, default: 0, unit: '°', scope: 'letter',
    hint: 'Rotates this letter around its vertical axis.',
  },
  {
    kind: 'range', key: 'tilt', label: 'Tilt', min: -90, max: 90, step: 1, default: 0, unit: '°', scope: 'letter',
    hint: 'Leans this letter forward or back.',
  },
] as const satisfies readonly ParamDef[];

export interface SpaceParams {
  depth: number;
  bevel: number;
  stagger: number;
  twist: number;
  push: number;
  lift: number;
  turn: number;
  tilt: number;
}

/** Every parameter, resolved for one letter (or for the whole word). */
export type Params = ShapeParams & SpaceParams;

export const ALL_PARAMS: readonly ParamDef[] = [...SHAPE_PARAMS, ...SPACE_PARAMS];

export function defaultsOf<T>(defs: readonly ParamDef[]): T {
  return Object.fromEntries(defs.map((d) => [d.key, d.default])) as T;
}

/** Can this parameter be edited at this level? */
export function inScope(def: ParamDef, level: ParamScope): boolean {
  return !def.scope || def.scope === level;
}
