import { FONT_CATALOG, loadFont, type FontId, type LoadedFont } from './core/fonts';
import { isMark } from './core/joining';
import type { Composition } from './core/types';
import { buildComposition } from './modifiers';
import {
  AnimationState,
  DEFAULT_ANIM,
  defaultAmount,
  isAnimatable,
  MOTION_PRESETS,
  type AnimConfig,
} from './params/animation';
import {
  BACKGROUND_PARAMS,
  inScope,
  isShown,
  LOOK_PARAMS,
  SHAPE_PARAMS,
  SPACE_PARAMS,
  type ParamDef,
  type Params,
  type RangeParam,
} from './params/schema';
import { ParamState } from './params/state';
import { backdropCss, backdropOf, backdropTone, paintBackdrop } from './render/backdrop';
import { ThreeRenderer } from './render/three/ThreeRenderer';
import { animDefs, CLOCK_PARAMS } from './params/motionControls';
import { getLanguage, LANGUAGES, onLanguageChange, savedLanguage, setLanguage, t, type Lang } from './i18n';
import { buildControls } from './ui/controls';
import { buildKeyboard, mapPhysicalKeys } from './ui/keyboard';
import { canExportVideo, download, runExport, type FrameSource } from './export/exporter';
import { finalSize, FORMATS, SIZES, type ExportKind } from './export/formats';

/** Words that exercise joins, ligatures and diacritics. */
const SAMPLES = ['كَلِمَة', 'السَّلَامُ عَلَيْكُمْ', 'مُدَرِّسَة', 'لِلْأَطْفَالِ', 'مستشفى', 'محمد', 'لا', 'جـمـيـل'];

const params = new ParamState();
const anim = new AnimationState();

/** Playback. Time is counted in loops: 0 → 1 is one full loop. */
const clock = { playing: false, t: 0, speed: 1, loop: 4 };

const state = {
  text: SAMPLES[0],
  fontId: 'amiri' as FontId,
  /** Letter being edited (index in the text), or null for the whole word. */
  selected: null as number | null,
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const textInput = $<HTMLInputElement>('text');
const fontSelect = $<HTMLSelectElement>('font');
const samples = $<HTMLDivElement>('samples');
const status = $<HTMLParagraphElement>('status');

const renderer = new ThreeRenderer();
renderer.mount($('view-3d'));
renderer.onPick = select;

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

/** Draw the current frame. For exports, the selection frame is left out. */
function update(forExport = false) {
  if (!font) return;
  try {
    const letters = lettersOf(state.text);
    const structure = structureOf(letters);
    params.setParents(structure.parents);
    anim.setParents(structure.parents);
    orderOf = structure.order;
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

    const backdrop = backdropOf(word);
    $('artboard').style.background = backdrop ? backdropCss(backdrop) : '';

    renderer.render({
      composition,
      word,
      letter: resolve,
      order: (i) => orderOf.get(i) ?? 0,
      gradientOwner: (i) => params.gradientOwner(i),
      selected: forExport ? null : state.selected,
      geometryKey,
    });
    if (!clock.playing) {
      status.textContent = t(
        'status.ready',
        '{font} · {n} glyphs · drag to orbit, scroll to zoom, right-drag to pan, click a letter to edit it',
        { font: font.name, n: composition.glyphs.length },
      );
    }
  } catch (err) {
    console.error(err);
    status.textContent = t('status.error', 'Error: {message}', { message: (err as Error).message });
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
  renderer.frameNextRender();
  update();
}

// ── Letter selection ─────────────────────────────────────

/** A letter, or a diacritic on a letter, that can be edited on its own. */
interface Editable {
  index: number;
  label: string;
  /** For a diacritic, the index of its letter. */
  base?: number;
}

/**
 * Letters and diacritics of the text, in reading order. Diacritics come
 * right after their letter. When the font draws several diacritics as one
 * glyph (shadda + kasra), they are listed, and edited, together.
 */
function lettersOf(text: string): Editable[] {
  const drawn = new Set(cached?.composition.glyphs.map((g) => g.letter));
  const items: Editable[] = [];
  let base: number | undefined;
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      base = undefined;
      continue;
    }
    if (isMark(text.charCodeAt(i)) && base !== undefined) {
      const previous = items[items.length - 1];
      if (cached && !drawn.has(i) && previous.base !== undefined) previous.label += text[i];
      else items.push({ index: i, label: text[i], base });
      continue;
    }
    base = i;
    items.push({ index: i, label: text[i] });
  }
  return items;
}

/** Diacritic → letter links, and reading order (diacritics share their letter's). */
function structureOf(items: Editable[]) {
  const parents = new Map<number, number>();
  const order = new Map<number, number>();
  let n = -1;
  for (const item of items) {
    if (item.base === undefined) order.set(item.index, ++n);
    else {
      parents.set(item.index, item.base);
      order.set(item.index, Math.max(0, n));
    }
  }
  return { parents, order };
}

/** Show a diacritic on a dotted circle, as in type specimens. */
const markLabel = (label: string) => `◌${label}`;

const refreshers: (() => void)[] = [];

function select(letter: number | null) {
  state.selected = letter;
  refreshScope();
  update();
}

function refreshScope() {
  const letters = lettersOf(state.text);
  const strip = $('letters');
  // One group per letter: the letter, then its diacritics as smaller chips.
  const groups: HTMLElement[] = [];
  for (const { index, label, base } of letters) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = base === undefined ? 'letter-chip' : 'letter-chip letter-chip--mark';
    chip.lang = 'ar';
    chip.textContent = base === undefined ? label : markLabel(label);
    chip.title = base === undefined ? t('letters.editLetter', 'Edit this letter') : t('letters.editMark', 'Edit this diacritic on its own');
    chip.setAttribute('aria-pressed', String(state.selected === index));
    chip.classList.toggle('has-overrides', params.hasOverrides(index));
    chip.addEventListener('click', () => select(state.selected === index ? null : index));
    if (base === undefined) {
      const group = document.createElement('div');
      group.className = 'letter-group';
      groups.push(group);
    }
    groups[groups.length - 1]?.appendChild(chip);
  }
  strip.replaceChildren(...groups);
  $('pick-word').setAttribute('aria-pressed', String(state.selected === null));
  // The background belongs to the artboard, not to a letter.
  $('background-block').hidden = state.selected !== null;

  const target = $('scope-target');
  const current = letters.find((l) => l.index === state.selected);
  if (current) {
    target.innerHTML = '';
    const ar = document.createElement('span');
    ar.className = 'ar';
    ar.lang = 'ar';
    if (current.base === undefined) {
      ar.textContent = current.label;
      target.append(t('scope.letter', 'Letter'), ' ', ar);
    } else {
      // "Diacritic ◌َ on ك"
      const on = document.createElement('span');
      on.className = 'ar';
      on.lang = 'ar';
      on.textContent = state.text[current.base];
      ar.textContent = markLabel(current.label);
      // "Diacritic ◌َ on ك": the order of the parts can change between languages.
      const [before, middle] = t('scope.markOn', 'Diacritic {mark} on {letter}').split(/\{mark\}|\{letter\}/);
      target.append(before, ar, middle, on);
    }
  } else {
    target.textContent = t('scope.word', 'Whole word');
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
      inScope(def, level()) && isShown(def, (k) => params.get(state.selected, k as keyof Params), level()),
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
      ? t('anim.moving', 'Moving. Click to stop.')
      : inherited
        ? t('anim.inherited', 'Moving with the whole word. Click to give this letter its own motion.')
        : state.selected === null
          ? t('anim.make', 'Make this move')
          : t('anim.makeLetter', 'Make this move, for this letter only');
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
  playButton.setAttribute('aria-label', playing ? t('transport.pause', 'Pause') : t('transport.play', 'Play'));
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

buildControls($('clock-controls'), CLOCK_PARAMS, {
  get: (k) => clock[k as 'speed' | 'loop'],
  set: (k, v) => (clock[k as 'speed' | 'loop'] = Number(v)),
  reset: (k) => (clock[k as 'speed' | 'loop'] = Number(CLOCK_PARAMS.find((d) => d.key === k)!.default)),
  isModified: (k) => clock[k as 'speed' | 'loop'] !== CLOCK_PARAMS.find((d) => d.key === k)!.default,
  isAvailable: () => true,
});

const presetSelect = $<HTMLSelectElement>('motion-preset');
function fillPresets() {
  presetSelect.replaceChildren(new Option(t('motion.choose', 'Choose a motion…'), ''));
  for (const [id, preset] of Object.entries(MOTION_PRESETS)) presetSelect.add(new Option(t(`preset.${id}`, preset.label), id));
}
fillPresets();
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

// ── Export ───────────────────────────────────────────────

const exportSource: FrameSource = {
  async frame(t, width, height, background) {
    clock.t = t;
    update(true);
    // "Same as the artboard" with a gradient: paint it under the letters
    // (at this frame's time, so an animated direction moves in the video).
    const backdrop = exportBackground.value === 'sheet' ? backdropOf(resolveNow(-1)) : null;
    if (!backdrop) return renderer.snapshot(width, height, background);
    const letters = await renderer.snapshot(width, height, null);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    paintBackdrop(ctx, width, height, backdrop);
    ctx.drawImage(letters, 0, 0);
    return canvas;
  },
  glb() {
    update(true);
    return renderer.glb();
  },
};

const exportFormat = $<HTMLSelectElement>('export-format');
const exportSize = $<HTMLSelectElement>('export-size');
const exportBackground = $<HTMLSelectElement>('export-background');
const exportColor = $<HTMLInputElement>('export-color');
const exportStatus = $('export-status');
let exportKind: ExportKind = 'image';
/** Video formats this browser can't encode. */
const unsupported = new Set<string>();

function fillSizes() {
  const previous = exportSize.value;
  exportSize.replaceChildren(...SIZES.map((size) => new Option(t(`size.${size.id}`, size.label), size.id)));
  if (previous) exportSize.value = previous;
}
fillSizes();

function currentFormat() {
  return FORMATS.find((f) => f.id === exportFormat.value) ?? FORMATS[0];
}

/** Formats offered for the current kind (image / animation). */
function refreshExportFormats() {
  const previous = exportFormat.value;
  exportFormat.replaceChildren();
  for (const f of FORMATS.filter((x) => x.kind === exportKind)) {
    const label = t(`format.${f.id}`, f.label);
    const option = new Option(
      unsupported.has(f.id) ? t('export.unsupported', '{format} (not supported by this browser)', { format: label }) : label,
      f.id,
    );
    option.disabled = unsupported.has(f.id);
    exportFormat.add(option);
  }
  if ([...exportFormat.options].some((o) => o.value === previous && !o.disabled)) exportFormat.value = previous;
  else exportFormat.value = [...exportFormat.options].find((o) => !o.disabled)?.value ?? '';
  refreshExportOptions();
}

function refreshExportOptions() {
  const format = currentFormat();
  exportStatus.textContent = '';
  $('export-note').textContent = t(`format.${format.id}.note`, format.note);
  const transparent = exportBackground.querySelector<HTMLOptionElement>('option[value="transparent"]')!;
  transparent.disabled = !format.alpha;
  if (!format.alpha && exportBackground.value === 'transparent') exportBackground.value = 'sheet';
  exportColor.hidden = exportBackground.value !== 'custom';
  // A 3D model has no picture size or background.
  const isModel = format.id === 'glb';
  exportSize.closest('.field')!.toggleAttribute('hidden', isModel);
  exportBackground.closest('.field')!.toggleAttribute('hidden', isModel);
  $('export-mark-row').hidden = isModel;
  for (const el of document.querySelectorAll<HTMLElement>('[data-export="animation"]')) el.hidden = exportKind !== 'animation';
}

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="export-kind"]')) {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    exportKind = radio.value as ExportKind;
    refreshExportFormats();
  });
}
exportFormat.addEventListener('change', refreshExportOptions);
exportBackground.addEventListener('change', refreshExportOptions);

// Find out once which video formats the browser can encode.
Promise.all(
  ['mp4', 'webm'].map(async (id) => {
    if (!(await canExportVideo(id))) unsupported.add(id);
  }),
).then(() => refreshExportFormats());

function exportBackgroundColor(): string | null {
  switch (exportBackground.value) {
    case 'transparent':
      return null;
    case 'custom':
      return exportColor.value;
    default: {
      const backdrop = backdropOf(resolveNow(-1));
      return backdrop ? backdropTone(backdrop) : getComputedStyle($('artboard')).backgroundColor;
    }
  }
}

let exportAbort: AbortController | null = null;

$('export-go').addEventListener('click', async () => {
  const format = currentFormat();
  const size = SIZES.find((s) => s.id === exportSize.value) ?? SIZES[0];
  const artboard = $('artboard');
  const [width, height] = finalSize(
    format,
    size.width ?? artboard.clientWidth * 2,
    size.height ?? artboard.clientHeight * 2,
  );

  const wasPlaying = clock.playing;
  const startTime = clock.t;
  setPlaying(false);
  exportAbort = new AbortController();
  const button = $<HTMLButtonElement>('export-go');
  button.disabled = true;
  $('export-progress').hidden = format.kind !== 'animation';
  $('export-bar').style.width = '0';
  exportStatus.textContent =
    format.kind === 'animation' ? t('export.rendering', 'Rendering frames…') : t('export.exporting', 'Exporting…');
  try {
    const blob = await runExport(exportSource, {
      format,
      width,
      height,
      background: exportBackgroundColor(),
      t: startTime,
      fps: Number($<HTMLSelectElement>('export-fps').value),
      loops: Number($<HTMLSelectElement>('export-loops').value),
      loopSeconds: clock.loop,
      mark: $<HTMLInputElement>('export-mark').checked,
      onProgress: (done) => ($('export-bar').style.width = `${done * 100}%`),
      signal: exportAbort.signal,
    });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    download(blob, `harfouz-${state.fontId}-${stamp}.${format.extension}`);
    const kb = blob.size / 1024;
    const weight = kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`;
    const name = t(`format.${format.id}`, format.label);
    const what = format.id === 'glb' ? `${name}, ${weight}` : `${name}, ${width} × ${height}, ${weight}`;
    exportStatus.textContent = t('export.done', 'Done: {what}. Sharing it? Tag #harfouz so others can find the tool.', { what });
  } catch (err) {
    exportStatus.textContent =
      (err as Error).name === 'AbortError'
        ? t('export.cancelled', 'Export cancelled.')
        : t('export.failed', 'Export failed: {message}', { message: (err as Error).message });
    console.error(err);
  } finally {
    button.disabled = false;
    $('export-progress').hidden = true;
    exportAbort = null;
    clock.t = startTime;
    update();
    if (wasPlaying) setPlaying(true);
  }
});
$('export-cancel').addEventListener('click', () => exportAbort?.abort());

// ── Wire the controls ────────────────────────────────────

function setText(text: string) {
  params.retarget(state.text, text);
  anim.retarget(state.text, text);
  state.text = text;
  if (state.selected !== null && !lettersOf(text).some((l) => l.index === state.selected)) state.selected = null;
  // Shape first: the letter bar needs to know how diacritics were drawn.
  updateAndFrame();
  refreshScope();
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
function fillFonts() {
  fontSelect.replaceChildren();
  for (const style of [...new Set(FONT_CATALOG.map((f) => f.style))]) {
    const group = document.createElement('optgroup');
    group.label = t(`style.${style}`, style);
    for (const f of FONT_CATALOG.filter((x) => x.style === style)) group.appendChild(new Option(f.name, f.id));
    fontSelect.appendChild(group);
  }
  fontSelect.value = state.fontId;
}
fillFonts();
fontSelect.addEventListener('change', () => useFont(fontSelect.value as FontId));

bindParams('shape-controls', 'reset-shape', SHAPE_PARAMS);
bindParams('look-controls', 'reset-look', LOOK_PARAMS);
bindParams('space-controls', 'reset-space', SPACE_PARAMS);
bindParams('background-controls', 'reset-background', BACKGROUND_PARAMS);
$('recenter').addEventListener('click', updateAndFrame);

// 'ink' colours follow the theme.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  refreshScope();
  update();
});

// ── Interface language ───────────────────────────────────

const languageSelect = $<HTMLSelectElement>('language');
for (const lang of LANGUAGES) languageSelect.add(new Option(lang.name, lang.id));
languageSelect.addEventListener('change', () => setLanguage(languageSelect.value as Lang));

onLanguageChange(() => {
  languageSelect.value = getLanguage();
  buildKeyboard($('keyboard'), textInput);
  fillFonts();
  fillPresets();
  fillSizes();
  refreshExportFormats();
  refreshScope();
  setPlaying(clock.playing);
  update();
});

setLanguage(savedLanguage());
refreshScope();
refreshExportFormats();
useFont(state.fontId);
requestAnimationFrame(tick);
