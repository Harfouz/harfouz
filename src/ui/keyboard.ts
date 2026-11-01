/**
 * Arabic keyboard, so anyone can type Arabic whatever their own keyboard.
 *
 * Two ways in:
 * - an on-screen keyboard (click or tap the keys),
 * - typing on the physical keyboard: each key types the Arabic character
 *   found at the same place on a standard Arabic (101) keyboard. Keys are
 *   read by physical position (`KeyboardEvent.code`), so it works the same
 *   with QWERTY, AZERTY or any other layout.
 */

/** [character, character with Shift] for each physical key, by row. */
export const ARABIC_LAYOUT: [code: string, base: string, shift: string][][] = [
  [
    ['Backquote', 'ذ', 'ّ'],
    ['Digit1', '١', '!'],
    ['Digit2', '٢', '@'],
    ['Digit3', '٣', '#'],
    ['Digit4', '٤', '$'],
    ['Digit5', '٥', '%'],
    ['Digit6', '٦', '^'],
    ['Digit7', '٧', '&'],
    ['Digit8', '٨', '*'],
    ['Digit9', '٩', ')'],
    ['Digit0', '٠', '('],
    ['Minus', '-', '_'],
    ['Equal', '=', '+'],
  ],
  [
    ['KeyQ', 'ض', 'َ'],
    ['KeyW', 'ص', 'ً'],
    ['KeyE', 'ث', 'ُ'],
    ['KeyR', 'ق', 'ٌ'],
    ['KeyT', 'ف', 'لإ'],
    ['KeyY', 'غ', 'إ'],
    ['KeyU', 'ع', '‘'],
    ['KeyI', 'ه', '÷'],
    ['KeyO', 'خ', '×'],
    ['KeyP', 'ح', '؛'],
    ['BracketLeft', 'ج', '<'],
    ['BracketRight', 'د', '>'],
  ],
  [
    ['KeyA', 'ش', 'ِ'],
    ['KeyS', 'س', 'ٍ'],
    ['KeyD', 'ي', ']'],
    ['KeyF', 'ب', '['],
    ['KeyG', 'ل', 'لأ'],
    ['KeyH', 'ا', 'أ'],
    ['KeyJ', 'ت', 'ـ'],
    ['KeyK', 'ن', '،'],
    ['KeyL', 'م', '/'],
    ['Semicolon', 'ك', ':'],
    ['Quote', 'ط', '"'],
  ],
  [
    ['KeyZ', 'ئ', '~'],
    ['KeyX', 'ء', 'ْ'],
    ['KeyC', 'ؤ', '}'],
    ['KeyV', 'ر', '{'],
    ['KeyB', 'لا', 'لآ'],
    ['KeyN', 'ى', 'آ'],
    ['KeyM', 'ة', '’'],
    ['Comma', 'و', '،'],
    ['Period', 'ز', '.'],
    ['Slash', 'ظ', '؟'],
  ],
];

/** Diacritics and special letters, always one tap away. */
export const HARAKAT: [char: string, name: string][] = [
  ['َ', 'Fatha'],
  ['ُ', 'Damma'],
  ['ِ', 'Kasra'],
  ['ْ', 'Sukun'],
  ['ّ', 'Shadda'],
  ['ً', 'Fathatan'],
  ['ٌ', 'Dammatan'],
  ['ٍ', 'Kasratan'],
  ['ٰ', 'Dagger alef'],
  ['ٔ', 'Hamza above'],
  ['ـ', 'Tatweel (kashida)'],
  ['ٱ', 'Alef wasla'],
];

const KEYMAP = new Map(ARABIC_LAYOUT.flat().map(([code, base, shift]) => [code, { base, shift }]));

/** The Arabic character(s) a physical key should type, or undefined. */
export function arabicFor(code: string, shift: boolean): string | undefined {
  const key = KEYMAP.get(code);
  return key && (shift ? key.shift : key.base);
}

/** Is this character a combining mark (shown on a dotted circle)? */
const isCombining = (s: string) => /^[ً-ٰٟ]$/.test(s);
const display = (s: string) => (isCombining(s) ? `◌${s}` : s);

/** Insert text at the caret (replacing any selection) and notify listeners. */
export function insertAtCaret(input: HTMLInputElement, text: string) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  const caret = start + text.length;
  input.setSelectionRange(caret, caret);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function deleteBeforeCaret(input: HTMLInputElement) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  if (start !== end) {
    input.value = input.value.slice(0, start) + input.value.slice(end);
    input.setSelectionRange(start, start);
  } else if (start > 0) {
    // Remove a whole character (Arabic letters are single UTF-16 units).
    input.value = input.value.slice(0, start - 1) + input.value.slice(end);
    input.setSelectionRange(start - 1, start - 1);
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Make the physical keyboard type Arabic in `input` while `enabled()` is
 * true. Shortcuts (Ctrl, Cmd, Alt) and input methods keep working.
 */
export function mapPhysicalKeys(input: HTMLInputElement, enabled: () => boolean) {
  input.addEventListener('keydown', (e) => {
    if (!enabled() || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    const text = arabicFor(e.code, e.shiftKey);
    if (!text) return;
    e.preventDefault();
    insertAtCaret(input, text);
  });
}

/** Build the on-screen keyboard inside `container`, typing into `input`. */
export function buildKeyboard(container: HTMLElement, input: HTMLInputElement) {
  let shift = false;
  const keyButtons: { button: HTMLButtonElement; base: string; shift: string }[] = [];

  const key = (label: string, onPress: () => void, className = '', title = '') => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `kb-key ${className}`;
    button.textContent = label;
    if (title) button.title = title;
    // Keep the caret in the text field.
    button.addEventListener('pointerdown', (e) => e.preventDefault());
    button.addEventListener('click', onPress);
    return button;
  };

  const harakat = document.createElement('div');
  harakat.className = 'kb-row kb-row--harakat';
  harakat.dir = 'rtl';
  for (const [char, name] of HARAKAT) {
    harakat.appendChild(key(display(char), () => insertAtCaret(input, char), 'kb-key--mark', name));
  }
  container.appendChild(harakat);

  ARABIC_LAYOUT.forEach((row, r) => {
    const line = document.createElement('div');
    line.className = `kb-row kb-row--${r}`;
    if (r === 3) {
      line.appendChild(
        key('⇧', () => {
          shift = !shift;
          shiftButton.setAttribute('aria-pressed', String(shift));
          for (const k of keyButtons) k.button.textContent = display(shift ? k.shift : k.base);
        }, 'kb-key--wide', 'Shift: harakat and punctuation'),
      );
    }
    for (const [, base, shifted] of row) {
      const button = key(display(base), () => insertAtCaret(input, shift ? shifted : base));
      button.lang = 'ar';
      keyButtons.push({ button, base, shift: shifted });
      line.appendChild(button);
    }
    container.appendChild(line);
  });
  const shiftButton = container.querySelector<HTMLButtonElement>('.kb-row--3 .kb-key--wide')!;

  const bottom = document.createElement('div');
  bottom.className = 'kb-row kb-row--bottom';
  bottom.append(
    key('Clear', () => {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, 'kb-key--wide'),
    key('مسافة', () => insertAtCaret(input, ' '), 'kb-key--space', 'Space'),
    key('⌫', () => deleteBeforeCaret(input), 'kb-key--wide', 'Delete'),
  );
  container.appendChild(bottom);
}
