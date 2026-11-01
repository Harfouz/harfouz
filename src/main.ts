import { FONT_CATALOG, loadFont, type FontId } from './core/fonts';
import { buildComposition } from './modifiers';
import {
  defaultsOf,
  SHAPE_PARAMS,
  SPACE_PARAMS,
  type ParamDef,
  type ShapeParams,
  type SpaceParams,
} from './params/schema';
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

const state = {
  text: SAMPLES[0],
  fontId: 'amiri' as FontId,
  mode: '3d' as Mode,
  guides: true,
  inspect: false,
  shape: defaultsOf<ShapeParams>(SHAPE_PARAMS),
  space: defaultsOf<SpaceParams>(SPACE_PARAMS),
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const textInput = $<HTMLInputElement>('text');
const fontSelect = $<HTMLSelectElement>('font');
const samples = $<HTMLDivElement>('samples');
const status = $<HTMLParagraphElement>('status');

const renderers = { '3d': new ThreeRenderer(), '2d': new SvgRenderer() };
renderers['3d'].mount($('view-3d'));
renderers['2d'].mount($('view-2d'));

async function update() {
  try {
    const font = await loadFont(state.fontId);
    const composition = buildComposition(font, state.text, state.shape);
    renderers[state.mode].render({
      composition,
      weight: (state.shape.weight * font.unitsPerEm) / 1000,
      space: state.space,
      guides: state.guides,
      inspect: state.inspect,
      referenceFontFamily: CSS_FAMILY[state.fontId],
    });
    const help = state.mode === '3d' ? ' · drag to orbit, scroll to zoom, right-drag to pan' : '';
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

/** Build a slider section bound to one parameter group, with its Reset link. */
function bindParams<T extends object>(containerId: string, resetId: string, defs: readonly ParamDef[], values: T) {
  const record = values as unknown as Record<string, number | string>;
  const refresh = buildControls($(containerId), defs, record, (key, value) => {
    record[key] = value;
    update();
  });
  $(resetId).addEventListener('click', () => {
    Object.assign(values, defaultsOf<T>(defs));
    refresh();
    update();
  });
}

// ── Wire the controls ────────────────────────────────────
textInput.value = state.text;
textInput.addEventListener('input', () => {
  state.text = textInput.value;
  updateAndFrame();
});

for (const word of SAMPLES) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.lang = 'ar';
  chip.dataset.text = word;
  chip.textContent = word;
  chip.addEventListener('click', () => {
    state.text = textInput.value = word;
    updateAndFrame();
  });
  samples.appendChild(chip);
}

for (const f of FONT_CATALOG) fontSelect.add(new Option(f.name, f.id));
fontSelect.value = state.fontId;
fontSelect.addEventListener('change', () => {
  state.fontId = fontSelect.value as FontId;
  updateAndFrame();
});

bindParams('shape-controls', 'reset-shape', SHAPE_PARAMS, state.shape);
bindParams('space-controls', 'reset-space', SPACE_PARAMS, state.space);
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

setMode(state.mode);
