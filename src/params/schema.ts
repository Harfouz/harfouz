import { HAIRY, TEXTURE_LABELS, TEXTURES, type TextureId } from '../render/textures';

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

export interface ShowIf {
  key: string;
  equals?: string;
  notEquals?: string;
  oneOf?: readonly string[];
  /** Only check this condition at this level (word or letter); elsewhere it always passes. */
  level?: ParamScope;
}

/** Is a parameter with this condition visible, given the current values? */
export function isShown(
  def: { showIf?: ShowIf | ShowIf[] },
  get: (key: string) => unknown,
  level: ParamScope = 'word',
): boolean {
  if (!def.showIf) return true;
  const conditions = Array.isArray(def.showIf) ? def.showIf : [def.showIf];
  return conditions.some((c) => {
    if (c.level && c.level !== level) return true;
    const v = String(get(c.key));
    if (c.equals !== undefined && v !== c.equals) return false;
    if (c.notEquals !== undefined && v === c.notEquals) return false;
    if (c.oneOf && !c.oneOf.includes(v)) return false;
    return true;
  });
}

/** 'word': only for the whole word. 'letter': only for a single letter. Absent: both. */
export type ParamScope = 'word' | 'letter';

interface BaseParam {
  key: string;
  label: string;
  hint?: string;
  scope?: ParamScope;
  /**
   * Only shown when another parameter has a given value (e.g. gradient
   * colours). A list means "any of these".
   */
  showIf?: ShowIf | ShowIf[];
  /** Translation key, when it isn't `param.<key>` (see src/i18n). */
  i18n?: string;
}

export interface RangeParam extends BaseParam {
  kind: 'range';
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
  /** Not offered for animation: in-between values mean nothing (e.g. a random seed). */
  still?: boolean;
}

export interface ChoiceParam extends BaseParam {
  kind: 'choice';
  options: { value: string; label: string }[];
  default: string;
}

/** A colour as #rrggbb, or 'ink' to follow the theme's ink colour. */
export interface ColorParam extends BaseParam {
  kind: 'color';
  default: string;
}

/**
 * A gradient: colour stops along a direction. Stored as JSON text
 * (`GradientStop[]`, see render/look.ts) so it fits the parameter system.
 */
export interface GradientParam extends BaseParam {
  kind: 'gradient';
  default: string;
}

export type ParamDef = RangeParam | ChoiceParam | ColorParam | GradientParam;

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
  {
    kind: 'range', key: 'noisePhase', label: 'Distortion drift', min: 0, max: 360, step: 1, default: 0, unit: '°',
    hint: 'Slides the distortion pattern around a circle. Animate it with a ramp for a flowing, looping motion.',
  },
  { kind: 'range', key: 'seed', label: 'Seed', min: 1, max: 99, step: 1, default: 7, still: true },
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
  noisePhase: number;
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
    kind: 'range', key: 'spin', label: 'Spin', min: -180, max: 180, step: 1, default: 0, unit: '°', scope: 'word',
    hint: 'Turns the whole word around its vertical axis.',
  },
  {
    kind: 'choice', key: 'joins', label: 'Joins', default: 'keep', scope: 'word',
    hint: 'Keep connected letters attached when they move, or let them separate.',
    options: [
      { value: 'keep', label: 'Keep letters connected' },
      { value: 'free', label: 'Let letters separate' },
    ],
  },
  {
    kind: 'range', key: 'joinSoftness', label: 'Join softness', min: 20, max: 900, step: 5, default: 260, unit: '‰',
    scope: 'word', showIf: { key: 'joins', equals: 'keep' },
    hint: 'How long the stretch between two connected letters is. Small: letters stay rigid and the join bends sharply.',
  },
  {
    kind: 'range', key: 'push', label: 'Push', min: -1500, max: 1500, step: 5, default: 0, unit: '‰',
    hint: 'Moves forward (positive) or back (negative). On the word, every letter; best used per letter or animated with a delay.',
  },
  {
    kind: 'range', key: 'shift', label: 'Shift', min: -1000, max: 1000, step: 5, default: 0, unit: '‰',
    hint: 'Moves right (positive) or left (negative). Connected letters stay attached: the join stretches or tightens.',
  },
  {
    kind: 'range', key: 'lift', label: 'Lift', min: -1000, max: 1000, step: 5, default: 0, unit: '‰',
    hint: 'Moves up or down. Animated on the word with a delay between letters, it makes a wave.',
  },
  {
    kind: 'range', key: 'turn', label: 'Turn', min: -180, max: 180, step: 1, default: 0, unit: '°',
    hint: 'Rotates each letter around its own vertical axis.',
  },
  {
    kind: 'range', key: 'tilt', label: 'Tilt', min: -90, max: 90, step: 1, default: 0, unit: '°',
    hint: 'Leans each letter forward or back.',
  },
] as const satisfies readonly ParamDef[];

export interface SpaceParams {
  depth: number;
  bevel: number;
  stagger: number;
  twist: number;
  spin: number;
  joins: 'keep' | 'free';
  joinSoftness: number;
  push: number;
  shift: number;
  lift: number;
  turn: number;
  tilt: number;
}

export const MATERIALS = ['satin', 'clay', 'paper', 'metal', 'glass', 'outline'] as const;
export type MaterialId = (typeof MATERIALS)[number];

/** Colour and material. */
export const LOOK_PARAMS = [
  {
    kind: 'choice', key: 'material', label: 'Material', default: 'satin',
    options: [
      { value: 'satin', label: 'Satin relief' },
      { value: 'clay', label: 'Clay' },
      { value: 'paper', label: 'Paper grain' },
      { value: 'metal', label: 'Metal' },
      { value: 'glass', label: 'Glass' },
      { value: 'outline', label: 'Outline only' },
    ],
  },
  {
    kind: 'choice', key: 'fill', label: 'Colour mode', default: 'solid',
    hint: 'On a letter or a diacritic: its own colour mode. Diacritics follow their letter until given their own.',
    options: [
      { value: 'solid', label: 'Solid' },
      { value: 'gradient', label: 'Gradient' },
      { value: 'palette', label: 'One colour per letter' },
    ],
  },
  {
    kind: 'color', key: 'color', label: 'Colour', default: 'ink',
    showIf: { key: 'fill', equals: 'solid' },
  },
  {
    kind: 'gradient', key: 'gradient', label: 'Gradient',
    default: JSON.stringify([
      { pos: 0, color: '#c0412b' },
      { pos: 1, color: 'ink' },
    ]),
    hint: 'Drag a colour to move it. Click the bar to add a colour. On a letter or a diacritic, the gradient spans its own shape.',
    showIf: { key: 'fill', equals: 'gradient' },
  },
  {
    kind: 'range', key: 'gradientAngle', label: 'Gradient direction', min: -180, max: 180, step: 1, default: 0, unit: '°',
    showIf: { key: 'fill', equals: 'gradient' },
    hint: '0°: left to right. 90°: bottom to top. Can be animated.',
  },
  {
    kind: 'choice', key: 'palette', label: 'Palette', default: 'manuscript', scope: 'word',
    showIf: { key: 'fill', equals: 'palette' },
    options: [
      { value: 'manuscript', label: 'Manuscript' },
      { value: 'dusk', label: 'Dusk' },
      { value: 'lagoon', label: 'Lagoon' },
      { value: 'zellige', label: 'Zellige' },
    ],
  },
  {
    kind: 'choice', key: 'texture', label: 'Texture', default: 'none',
    hint: 'A surface pattern, combined with the material. Paper has paper grain unless you pick another texture.',
    options: [{ value: 'none', label: 'None' }, ...TEXTURES.map((t) => ({ value: t, label: TEXTURE_LABELS[t] }))],
  },
  {
    kind: 'range', key: 'textureScale', label: 'Texture size', min: 20, max: 400, step: 1, default: 100, unit: '%',
    showIf: [{ key: 'texture', notEquals: 'none' }, { key: 'material', equals: 'paper' }],
  },
  {
    kind: 'range', key: 'grain', label: 'Texture strength', min: 0, max: 100, step: 1, default: 60, unit: '%',
    showIf: [{ key: 'texture', notEquals: 'none' }, { key: 'material', equals: 'paper' }],
  },
  {
    kind: 'range', key: 'furLength', label: 'Fur length', min: 0, max: 300, step: 1, default: 70, unit: '‰',
    hint: 'In 3D, hairy textures grow real fur. 0 keeps it flat.',
    showIf: { key: 'texture', oneOf: [...HAIRY] },
  },
] as const satisfies readonly ParamDef[];

export interface LookParams {
  material: MaterialId;
  fill: 'solid' | 'gradient' | 'palette';
  color: string;
  /** JSON list of { pos, color } stops. */
  gradient: string;
  gradientAngle: number;
  palette: string;
  texture: 'none' | TextureId;
  textureScale: number;
  /** Texture strength, in % (kept as "grain" from the first version). */
  grain: number;
  furLength: number;
}

/** The artboard's background, also used by exports set to "Same as the artboard". */
export const BACKGROUND_PARAMS = [
  {
    kind: 'choice', key: 'background', label: 'Type', default: 'theme', scope: 'word',
    options: [
      { value: 'theme', label: 'Default' },
      { value: 'solid', label: 'Solid colour' },
      { value: 'linear', label: 'Linear gradient' },
      { value: 'radial', label: 'Radial gradient' },
    ],
  },
  {
    kind: 'color', key: 'backgroundColor', label: 'Background colour', default: '#1b1430', scope: 'word',
    showIf: { key: 'background', equals: 'solid' },
  },
  {
    kind: 'gradient', key: 'backgroundGradient', label: 'Background gradient', scope: 'word',
    default: JSON.stringify([
      { pos: 0, color: '#3a1670' },
      { pos: 1, color: '#07060b' },
    ]),
    hint: 'Drag a colour to move it. Click the bar to add a colour. Radial: from the centre outwards.',
    showIf: { key: 'background', oneOf: ['linear', 'radial'] },
  },
  {
    kind: 'range', key: 'backgroundAngle', label: 'Background direction', min: -180, max: 180, step: 1, default: 90,
    unit: '°', scope: 'word',
    showIf: { key: 'background', equals: 'linear' },
    hint: '0°: left to right. 90°: bottom to top. Can be animated.',
  },
] as const satisfies readonly ParamDef[];

export interface BackgroundParams {
  background: 'theme' | 'solid' | 'linear' | 'radial';
  backgroundColor: string;
  /** JSON list of { pos, color } stops. */
  backgroundGradient: string;
  backgroundAngle: number;
}

/** Every parameter, resolved for one letter (or for the whole word). */
export type Params = ShapeParams & SpaceParams & LookParams & BackgroundParams;

export const ALL_PARAMS: readonly ParamDef[] = [...SHAPE_PARAMS, ...SPACE_PARAMS, ...LOOK_PARAMS, ...BACKGROUND_PARAMS];

export function defaultsOf<T>(defs: readonly ParamDef[]): T {
  return Object.fromEntries(defs.map((d) => [d.key, d.default])) as T;
}

/** Can this parameter be edited at this level? */
export function inScope(def: ParamDef, level: ParamScope): boolean {
  return !def.scope || def.scope === level;
}
