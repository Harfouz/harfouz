import { FONT_CATALOG, loadFont, type FontId } from './core/fonts';
import { shapeLine } from './core/shaping';
import { SvgRenderer } from './render/svg/SvgRenderer';

/** Words that exercise joins, ligatures and diacritics. */
const SAMPLES = ['كَلِمَة', 'السَّلَامُ عَلَيْكُمْ', 'مُدَرِّسَة', 'لِلْأَطْفَالِ', 'مستشفى', 'محمد', 'لا', 'جـمـيـل'];

/** CSS font-family names declared in app.css, used by the inspector. */
const CSS_FAMILY: Record<FontId, string> = {
  amiri: 'Harfouz Amiri',
  'noto-naskh': 'Harfouz Noto Naskh',
};

const state = {
  text: SAMPLES[0],
  fontId: 'amiri' as FontId,
  guides: true,
  inspect: false,
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const textInput = $<HTMLInputElement>('text');
const fontSelect = $<HTMLSelectElement>('font');
const samples = $<HTMLDivElement>('samples');
const status = $<HTMLParagraphElement>('status');

const renderer = new SvgRenderer();
renderer.mount($('artboard'));

async function update() {
  try {
    const font = await loadFont(state.fontId);
    const line = shapeLine(font, state.text);
    renderer.render({
      line,
      guides: state.guides,
      inspect: state.inspect,
      referenceFontFamily: CSS_FAMILY[state.fontId],
    });
    status.textContent = `${font.name} · ${line.glyphs.length} glyphs`;
  } catch (err) {
    console.error(err);
    status.textContent = `Error: ${(err as Error).message}`;
  }
  for (const chip of samples.children) {
    chip.setAttribute('aria-pressed', String((chip as HTMLElement).dataset.text === state.text));
  }
}

// ── Wire the controls ────────────────────────────────────
textInput.value = state.text;
textInput.addEventListener('input', () => {
  state.text = textInput.value;
  update();
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
    update();
  });
  samples.appendChild(chip);
}

for (const f of FONT_CATALOG) fontSelect.add(new Option(f.name, f.id));
fontSelect.value = state.fontId;
fontSelect.addEventListener('change', () => {
  state.fontId = fontSelect.value as FontId;
  update();
});

for (const key of ['guides', 'inspect'] as const) {
  const box = $<HTMLInputElement>(key);
  box.checked = state[key];
  box.addEventListener('change', () => {
    state[key] = box.checked;
    update();
  });
}

update();
