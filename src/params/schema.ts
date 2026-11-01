/**
 * Every parameter the user can tweak, described once. The panel is built
 * from this list, and the animation step will read the same ranges.
 *
 * Lengths are in thousandths of an em (‰ em) so values feel the same
 * whatever the font's internal units are.
 */

export interface RangeParam {
  kind: 'range';
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
  hint?: string;
}

export interface ChoiceParam {
  kind: 'choice';
  key: string;
  label: string;
  options: { value: string; label: string }[];
  default: string;
  hint?: string;
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
    hint: 'Inserts tatweels between connected letters, then reshapes.',
  },
  {
    kind: 'choice', key: 'kashidaPlacement', label: 'Kashida placement', default: 'last',
    options: [
      { value: 'last', label: 'Last join of each word' },
      { value: 'all', label: 'Every join' },
    ],
  },
  { kind: 'range', key: 'width', label: 'Width', min: 50, max: 220, step: 1, default: 100, unit: '%' },
  {
    kind: 'range', key: 'spacing', label: 'Spacing', min: -60, max: 400, step: 1, default: 0, unit: '‰',
    hint: 'Only opens gaps where letters are not connected, so joins never break.',
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

export function defaultsOf<T>(defs: readonly ParamDef[]): T {
  return Object.fromEntries(defs.map((d) => [d.key, d.default])) as T;
}
