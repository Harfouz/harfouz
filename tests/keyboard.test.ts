import { describe, expect, it } from 'vitest';
import { ARABIC_LAYOUT, arabicFor, HARAKAT } from '../src/ui/keyboard';

describe('Arabic keyboard layout', () => {
  it('maps physical keys to the standard Arabic layout', () => {
    // U G N on any keyboard → ع ل ى
    expect(['KeyU', 'KeyG', 'KeyN'].map((c) => arabicFor(c, false)).join('')).toBe('على');
    expect(arabicFor('KeyQ', false)).toBe('ض');
    expect(arabicFor('KeyB', false)).toBe('لا');
  });

  it('gives the harakat with Shift', () => {
    expect(arabicFor('KeyQ', true)).toBe('َ'); // fatha
    expect(arabicFor('KeyE', true)).toBe('ُ'); // damma
    expect(arabicFor('KeyA', true)).toBe('ِ'); // kasra
    expect(arabicFor('KeyX', true)).toBe('ْ'); // sukun
    expect(arabicFor('Backquote', true)).toBe('ّ'); // shadda
  });

  it('leaves keys it does not know alone (Enter, arrows, F-keys…)', () => {
    expect(arabicFor('Enter', false)).toBeUndefined();
    expect(arabicFor('ArrowLeft', false)).toBeUndefined();
  });

  it('covers all 28 letters of the alphabet', () => {
    const typed = ARABIC_LAYOUT.flat().flatMap(([, base, shift]) => [base, shift]).join('');
    for (const letter of 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي') expect(typed).toContain(letter);
  });

  it('offers every common diacritic', () => {
    const marks = HARAKAT.map(([c]) => c).join('');
    for (const mark of 'ًٌٍَُِّْ') expect(marks).toContain(mark);
  });
});
