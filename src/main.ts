import { FONT_CATALOG, loadFont, type FontId } from './core/fonts';
import { isMark } from './core/joining';
import { buildComposition } from './modifiers';
import { inScope, SHAPE_PARAMS, SPACE_PARAMS, type ParamDef, type Params } from './params/schema';
import { ParamState } from './params/state';
import { SvgRenderer } from './render/svg/SvgRenderer';
import { ThreeRenderer } from './render/three/ThreeRenderer';
import { buildControls } from './ui/controls';

/** Words that exercise joins, ligatures and diacritics. */
const SAMPLES = ['كَلِمَة', 'السَّلَامُ عَلَيْكُمْ', 'مُدَرِّسَة', 'لِلْأَطْفَالِ', 'مستشفى', 'محمد', 'لا', 'جـمـيـل'];

/** CSS font-family names declared in app.css, used by the inspector. */
const CSS_FAMILY: Record<FontId, string> = {
  amiri: 'Harfouz Amiri',
  'noto-naskh': 'Harfouz Noto Naskh',
};

type Mode = '3d' | '2d';

const params = new ParamState();
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

async function update() {
  try {
    const font = await loadFont(state.fontId);
    const resolve = (i: number) => params.resolve(i);
    const composition = buildComposition(font, state.text, resolve);
    renderers[state.mode].render({
      composition,
      word: params.word,
      letter: resolve,
      selected: state.selected,
      guides: state.guides,
      inspect: state.inspect,
      referenceFontFamily: CSS_FAMILY[state.fontId],
    });
    const help = state.mode === '3d' ? ' · drag to orbit, scroll to zoom, right-drag to pan, click a letter to edit it' : '';
    status.textContent = `${font.name} · ${composition.glyphs.length} glyphs${help}`;
  } catch (err) {
    console.error(err);
    status.textContent = `Error: ${(err as Error).message}`;
  }
  for (const chip of samples.children) {
    chip.setAttribute('aria-pressed', String((chip as HTMLElement).dataset.text === state.text));
  }
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
    isAvailable: (def) => inScope(def, level()),
  });
  refreshers.push(refresh);
  $(resetId).addEventListener('click', () => {
    for (const def of defs) params.reset(state.selected, def.key as keyof Params);
    refreshScope();
    update();
  });
}

// ── Wire the controls ────────────────────────────────────

function setText(text: string) {
  params.retarget(state.text, text);
  state.text = text;
  if (state.selected !== null && !lettersOf(text).some((l) => l.index === state.selected)) state.selected = null;
  refreshScope();
  updateAndFrame();
}

textInput.value = state.text;
textInput.addEventListener('input', () => setText(textInput.value));

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

for (const f of FONT_CATALOG) fontSelect.add(new Option(f.name, f.id));
fontSelect.value = state.fontId;
fontSelect.addEventListener('change', () => {
  state.fontId = fontSelect.value as FontId;
  updateAndFrame();
});

bindParams('shape-controls', 'reset-shape', SHAPE_PARAMS);
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

// The 3D material follows the theme's ink colour.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', update);

refreshScope();
setMode(state.mode);
