import { cssFamily, FONT_CATALOG, loadFont, type FontId, type LoadedFont } from './core/fonts';
import { isMark } from './core/joining';
import type { Composition } from './core/types';
import { buildComposition } from './modifiers';
import {
  AnimationState,
  DEFAULT_ANIM,
  defaultAmount,
  isAnimatable,
  MOTION_PRESETS,
  WAVES,
  type AnimConfig,
} from './params/animation';
import {
  inScope,
  LOOK_PARAMS,
  SHAPE_PARAMS,
  SPACE_PARAMS,
  type ParamDef,
  type Params,
  type RangeParam,
} from './params/schema';
import { ParamState } from './params/state';
import { SvgRenderer } from './render/svg/SvgRenderer';
import { ThreeRenderer } from './render/three/ThreeRenderer';
import { buildControls } from './ui/controls';
import { buildKeyboard, mapPhysicalKeys } from './ui/keyboard';

/** Words that exercise joins, ligatures and diacritics. */
const SAMPLES = ['كَلِمَة', 'السَّلَامُ عَلَيْكُمْ', 'مُدَرِّسَة', 'لِلْأَطْفَالِ', 'مستشفى', 'محمد', 'لا', 'جـمـيـل'];

type Mode = '3d' | '2d';

const params = new ParamState();
const anim = new AnimationState();

/** Playback. Time is counted in loops: 0 → 1 is one full loop. */
const clock = { playing: false, t: 0, speed: 1, loop: 4 };

const state = {
  text: SAMPLES[0],
  fontId: 'amiri' as FontId,
  mode: '3d' as Mode,
  guides: true,
  inspect: false,
  /** Letter being edited (index in the text), or null for the whole word. */
  selected: null as number | null,
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const textInput = $<HTMLInputElement>('text');
const fontSelect = $<HTMLSelectElement>('font');
const samples = $<HTMLDivElement>('samples');
const status = $<HTMLParagraphElement>('status');

const renderers = { '3d': new ThreeRenderer(), '2d': new SvgRenderer() };
renderers['3d'].mount($('view-3d'));
renderers['2d'].mount($('view-2d'));
for (const r of Object.values(renderers)) r.onPick = select;

let font: LoadedFont | null = null;

/** Reading-order position of each letter (used by motion delays and palettes). */
let orderOf = new Map<number, number>();

/** Values of a letter (or the word, -1) right now, motion included. */
function resolveNow(i: number): Params {
  const base = i < 0 ? params.word : params.resolve(i);
  return anim.apply(base, i < 0 ? null : i, orderOf.get(i) ?? 0, clock.t);
}

const SHAPE_KEYS = SHAPE_PARAMS.map((d) => d.key);
const VOLUME_KEYS = ['depth', 'bevel'] as const;
let cached: { key: string; composition: Composition } | null = null;

function update() {
  if (!font) return;
  try {
    const letters = lettersOf(state.text);
    orderOf = new Map(letters.map((l, order) => [l.index, order]));
    const resolved = new Map(letters.map((l) => [l.index, resolveNow(l.index)]));
    const resolve = (i: number) => resolved.get(i) ?? resolveNow(i);
    const word = resolveNow(-1);

    // Shaping is only redone when something that changes the outlines changes
    // (so animating placement or colour stays cheap).
    const pick = (p: Params, keys: readonly string[]) => keys.map((k) => p[k as keyof Params]);
    const shapeKey = JSON.stringify([state.fontId, state.text, pick(word, SHAPE_KEYS), letters.map((l) => pick(resolve(l.index), SHAPE_KEYS))]);
    if (cached?.key !== shapeKey) cached = { key: shapeKey, composition: buildComposition(font, state.text, resolve) };
    const composition = cached.composition;
    const geometryKey = shapeKey + JSON.stringify(letters.map((l) => pick(resolve(l.index), VOLUME_KEYS)));

    renderers[state.mode].render({
      composition,
      word,
      letter: resolve,
      selected: state.selected,
      guides: state.guides,
      inspect: state.inspect,
      referenceFontFamily: cssFamily(state.fontId),
      geometryKey,
    });
    if (!clock.playing) {
      const help = state.mode === '3d' ? ' · drag to orbit, scroll to zoom, right-drag to pan, click a letter to edit it' : '';
      status.textContent = `${font.name} · ${composition.glyphs.length} glyphs${help}`;
    }
  } catch (err) {
    console.error(err);
    status.textContent = `Error: ${(err as Error).message}`;
  }
  for (const chip of samples.children) {
    chip.setAttribute('aria-pressed', String((chip as HTMLElement).dataset.text === state.text));
  }
}

async function useFont(id: FontId) {
  state.fontId = id;
  font = await loadFont(id);
  cached = null;
  updateAndFrame();
}

/** New text or font: the word changes size, so re-frame the 3D camera. */
function updateAndFrame() {
  renderers['3d'].frameNextRender();
  update();
}

function setMode(mode: Mode) {
  state.mode = mode;
  $('view-3d').hidden = mode !== '3d';
  $('view-2d').hidden = mode !== '2d';
  for (const section of document.querySelectorAll<HTMLElement>('[data-mode]')) {
    section.hidden = section.dataset.mode !== mode;
  }
  update();
}

// ── Letter selection ─────────────────────────────────────

/** Base letters of the text (diacritics are edited with their letter). */
function lettersOf(text: string): { index: number; label: string }[] {
  const letters: { index: number; label: string }[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (/\s/.test(text[i])) continue;
    if (isMark(code) && letters.length) {
      letters[letters.length - 1].label += text[i];
      continue;
    }
    letters.push({ index: i, label: text[i] });
  }
  return letters;
}

const refreshers: (() => void)[] = [];

function select(letter: number | null) {
  state.selected = letter;
  refreshScope();
  update();
}

function refreshScope() {
  const letters = lettersOf(state.text);
  const strip = $('letters');
  strip.replaceChildren(
    ...letters.map(({ index, label }) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'letter-chip';
      chip.lang = 'ar';
      chip.textContent = label;
      chip.title = `Edit this letter (${index + 1})`;
      chip.setAttribute('aria-pressed', String(state.selected === index));
      chip.classList.toggle('has-overrides', params.hasOverrides(index));
      chip.addEventListener('click', () => select(state.selected === index ? null : index));
      return chip;
    }),
  );
  $('pick-word').setAttribute('aria-pressed', String(state.selected === null));

  const target = $('scope-target');
  const current = letters.find((l) => l.index === state.selected);
  if (current) {
    target.innerHTML = '';
    const ar = document.createElement('span');
    ar.className = 'ar';
    ar.lang = 'ar';
    ar.textContent = current.label;
    target.append('Letter ', ar);
  } else {
    target.textContent = 'Whole word';
  }
  $('reset-letter').hidden = !current || !params.hasOverrides(current.index);
  refreshers.forEach((r) => r());
}

$('pick-word').addEventListener('click', () => select(null));
$('reset-letter').addEventListener('click', () => {
  if (state.selected !== null) params.clearLetter(state.selected);
  refreshScope();
  update();
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.selected !== null) select(null);
});

/**
 * Bind a slider section to the parameters. While a letter is selected,
 * sliders show and edit that letter's values; otherwise the word's.
 */
function bindParams(containerId: string, resetId: string, defs: readonly ParamDef[]) {
  const level = () => (state.selected === null ? 'word' : 'letter');
  const refresh = buildControls($(containerId), defs, {
    get: (key) => params.get(state.selected, key as keyof Params),
    set: (key, value) => {
      params.set(state.selected, key as keyof Params, value);
      refreshScope();
      update();
    },
    reset: (key) => {
      params.reset(state.selected, key as keyof Params);
      refreshScope();
      update();
    },
    isModified: (key) => params.isModified(state.selected, key as keyof Params),
    isAvailable: (def) =>
      inScope(def, level()) && (!def.showIf || params.get(state.selected, def.showIf.key as keyof Params) === def.showIf.equals),
    decorate: (def, row) => (isAnimatable(def.key) ? addAnimToggle(def as RangeParam, row) : () => {}),
  });
  refreshers.push(refresh);
  $(resetId).addEventListener('click', () => {
    for (const def of defs) params.reset(state.selected, def.key as keyof Params);
    refreshScope();
    update();
  });
}

// ── Motion ───────────────────────────────────────────────

/** Settings of one parameter's motion, shown under its slider. */
function animDefs(def: RangeParam): ParamDef[] {
  const span = def.max - def.min;
  const defs: ParamDef[] = [
    { kind: 'range', key: `anim-${def.key}-amount`, label: 'Amount', min: -span, max: span, step: def.step, default: 0, unit: def.unit },
    {
      kind: 'choice',
      key: `anim-${def.key}-wave`,
      label: 'Wave',
      default: 'sine',
      options: [
        { value: 'sine', label: 'Sine (smooth back and forth)' },
        { value: 'triangle', label: 'Triangle (even speed)' },
        { value: 'bounce', label: 'Bounce (hops)' },
        { value: 'ramp', label: 'Ramp (keeps going: spins, drifts)' },
        { value: 'noise', label: 'Noise (organic)' },
      ].filter((o) => (WAVES as readonly string[]).includes(o.value)),
    },
    { kind: 'range', key: `anim-${def.key}-cycles`, label: 'Repeats per loop', min: 1, max: 8, step: 1, default: 1, unit: '×' },
  ];
  if (def.scope !== 'word') {
    defs.push({
      kind: 'range',
      key: `anim-${def.key}-spread`,
      label: 'Delay between letters',
      min: 0,
      max: 0.5,
      step: 0.01,
      default: 0,
      hint: 'Each letter starts a little after the previous one: a ripple through the word.',
    });
  }
  return defs;
}

/**
 * The ∿ button on a slider row, plus its settings panel. On the word it
 * animates the whole word; on a selected letter, only that letter.
 */
function addAnimToggle(def: RangeParam, row: HTMLElement): () => void {
  const key = def.key as keyof Params;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'anim-toggle';
  button.textContent = '∿';
  row.querySelector('.control__value')?.after(button);

  const panel = document.createElement('div');
  panel.className = 'anim-panel';
  row.appendChild(panel);

  const field = (k: string) => k.slice(`anim-${def.key}-`.length) as keyof AnimConfig;
  const refreshPanel = buildControls(panel, animDefs(def), {
    get: (k) => (anim.own(state.selected, key) ?? DEFAULT_ANIM)[field(k)] as number | string,
    set: (k, value) => {
      const current = anim.own(state.selected, key) ?? { ...DEFAULT_ANIM };
      anim.set(state.selected, key, { ...current, [field(k)]: value });
      ensureMotionVisible();
      update();
    },
    reset: (k) => {
      const current = anim.own(state.selected, key);
      if (current) anim.set(state.selected, key, { ...current, [field(k)]: (DEFAULT_ANIM as unknown as Record<string, number | string>)[field(k)] });
      update();
    },
    isModified: () => false,
    // A delay between letters only means something for the whole word.
    isAvailable: (d) => !(d.key.endsWith('-spread') && state.selected !== null),
  });

  button.addEventListener('click', () => {
    if (anim.own(state.selected, key)) {
      anim.clear(state.selected, key);
    } else {
      // Start from the word's motion when editing a letter, else from a sensible amount.
      const inherited = state.selected === null ? undefined : anim.config(null, key);
      anim.set(state.selected, key, inherited ? { ...inherited } : { ...DEFAULT_ANIM, amount: defaultAmount(key) });
      ensureMotionVisible();
    }
    refreshScope();
    update();
  });

  return () => {
    const own = anim.own(state.selected, key);
    const inherited = !own && anim.config(state.selected, key);
    button.setAttribute('aria-pressed', String(Boolean(own)));
    button.classList.toggle('is-inherited', Boolean(inherited));
    button.title = own
      ? 'Moving. Click to stop.'
      : inherited
        ? 'Moving with the whole word. Click to give this letter its own motion.'
        : state.selected === null
          ? 'Make this move'
          : 'Make this move, for this letter only';
    panel.hidden = !own;
    if (own) refreshPanel();
  };
}

/** Start playing the first time something is made to move. */
function ensureMotionVisible() {
  if (!clock.playing && anim.active) setPlaying(true);
}

const playButton = $<HTMLButtonElement>('play');
const progress = $('progress');

function setPlaying(playing: boolean) {
  clock.playing = playing;
  playButton.setAttribute('aria-pressed', String(playing));
  playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  if (!playing) update();
}

let lastFrame = performance.now();
function tick(now: number) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (clock.playing) {
    clock.t = (clock.t + (dt * clock.speed) / clock.loop) % 1;
    progress.style.width = `${clock.t * 100}%`;
    update();
  }
  requestAnimationFrame(tick);
}

playButton.addEventListener('click', () => setPlaying(!clock.playing));
addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLInputElement && e.target.type === 'text';
  if (e.code === 'Space' && !typing && !(e.target instanceof HTMLSelectElement)) {
    e.preventDefault();
    setPlaying(!clock.playing);
  }
});

const CLOCK_PARAMS: ParamDef[] = [
  { kind: 'range', key: 'speed', label: 'Speed', min: 0.1, max: 3, step: 0.05, default: 1, unit: '×' },
  {
    kind: 'range', key: 'loop', label: 'Loop length', min: 1, max: 20, step: 0.5, default: 4, unit: ' s',
    hint: 'Every motion comes back to its start after one loop.',
  },
];
buildControls($('clock-controls'), CLOCK_PARAMS, {
  get: (k) => clock[k as 'speed' | 'loop'],
  set: (k, v) => (clock[k as 'speed' | 'loop'] = Number(v)),
  reset: (k) => (clock[k as 'speed' | 'loop'] = Number(CLOCK_PARAMS.find((d) => d.key === k)!.default)),
  isModified: (k) => clock[k as 'speed' | 'loop'] !== CLOCK_PARAMS.find((d) => d.key === k)!.default,
  isAvailable: () => true,
});

const presetSelect = $<HTMLSelectElement>('motion-preset');
presetSelect.add(new Option('Choose a motion…', ''));
for (const [id, preset] of Object.entries(MOTION_PRESETS)) presetSelect.add(new Option(preset.label, id));
presetSelect.addEventListener('change', () => {
  const preset = MOTION_PRESETS[presetSelect.value];
  presetSelect.value = '';
  if (!preset) return;
  for (const [key, config] of Object.entries(preset.anims)) {
    anim.set(null, key as keyof Params, { ...DEFAULT_ANIM, ...config });
  }
  for (const [key, value] of Object.entries(preset.base ?? {})) {
    const k = key as keyof Params;
    if (!params.isModified(null, k)) params.set(null, k, value as number);
  }
  setPlaying(true);
  refreshScope();
  update();
});

$('stop-all').addEventListener('click', () => {
  anim.clearAll();
  clock.t = 0;
  progress.style.width = '0';
  setPlaying(false);
  refreshScope();
  update();
});

// ── Wire the controls ────────────────────────────────────

function setText(text: string) {
  params.retarget(state.text, text);
  anim.retarget(state.text, text);
  state.text = text;
  if (state.selected !== null && !lettersOf(text).some((l) => l.index === state.selected)) state.selected = null;
  refreshScope();
  updateAndFrame();
}

textInput.value = state.text;
textInput.addEventListener('input', () => setText(textInput.value));

// Arabic keyboard: on screen, and physical keys typing Arabic.
const mapKeys = $<HTMLInputElement>('map-keys');
mapPhysicalKeys(textInput, () => mapKeys.checked);
buildKeyboard($('keyboard'), textInput);
$('toggle-keyboard').addEventListener('click', () => {
  const keyboard = $('keyboard');
  keyboard.hidden = !keyboard.hidden;
  $('toggle-keyboard').setAttribute('aria-pressed', String(!keyboard.hidden));
  if (!keyboard.hidden) textInput.focus();
  // The artwork area changes size: frame the word again once the layout settles.
  requestAnimationFrame(updateAndFrame);
});

for (const word of SAMPLES) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.lang = 'ar';
  chip.dataset.text = word;
  chip.textContent = word;
  chip.addEventListener('click', () => setText((textInput.value = word)));
  samples.appendChild(chip);
}

// Typefaces grouped by style.
for (const style of [...new Set(FONT_CATALOG.map((f) => f.style))]) {
  const group = document.createElement('optgroup');
  group.label = style;
  for (const f of FONT_CATALOG.filter((x) => x.style === style)) group.appendChild(new Option(f.name, f.id));
  fontSelect.appendChild(group);
}
fontSelect.value = state.fontId;
fontSelect.addEventListener('change', () => useFont(fontSelect.value as FontId));

bindParams('shape-controls', 'reset-shape', SHAPE_PARAMS);
bindParams('look-controls', 'reset-look', LOOK_PARAMS);
bindParams('space-controls', 'reset-space', SPACE_PARAMS);
$('recenter').addEventListener('click', updateAndFrame);

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
  radio.addEventListener('change', () => radio.checked && setMode(radio.value as Mode));
}

for (const key of ['guides', 'inspect'] as const) {
  const box = $<HTMLInputElement>(key);
  box.checked = state[key];
  box.addEventListener('change', () => {
    state[key] = box.checked;
    update();
  });
}

// 'ink' colours follow the theme.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  refreshScope();
  update();
});

refreshScope();
setMode(state.mode);
useFont(state.fontId);
requestAnimationFrame(tick);
