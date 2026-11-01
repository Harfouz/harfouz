import { readFileSync } from 'node:fs';
import { createFont, FONT_CATALOG } from '../src/core/fonts';

/** Words chosen to stress joins, ligatures and stacked diacritics. */
export const TEST_WORDS = [
  'السَّلَامُ عَلَيْكُمْ', // lam-alef, shadda, several harakat
  'مُدَرِّسَة', // shadda + kasra on the same letter
  'لِلْأَطْفَالِ', // lam-lam-alef with hamza and harakat
  'مستشفى', // chain of teeth (seen-sheen)
  'محمد', // vertical stacking in Amiri
  'لا', // lam-alef ligature on its own
  'جـمـيـل', // explicit kashida (tatweel)
];

/** Bundled fonts, read from disk. */
export const fonts = FONT_CATALOG.map((entry) => {
  const file = readFileSync(new URL(`../public/${entry.url}`, import.meta.url));
  const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  return createFont(entry.id, entry.name, bytes as ArrayBuffer);
});
