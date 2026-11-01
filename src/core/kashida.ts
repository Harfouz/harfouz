import { isLamAlef, isMark, joinsNext, joinsPrev, nextLetterIndex, TATWEEL_CHAR } from './joining';

export type KashidaPlacement = 'last' | 'all';

export interface ElongatedText {
  text: string;
  /** For every UTF-16 index of `text`, the index of the source character it comes from. */
  sourceIndex: number[];
}

/**
 * Typographic kashida: insert tatweel characters (ـ) between letters that
 * connect, then let HarfBuzz reshape. Unlike a geometric stretch, the joins
 * stay calligraphically correct.
 *
 * - `count`: how many tatweels per elongated join.
 * - `placement`: 'last' elongates the last join of each word (closest to the
 *   classical habit), 'all' elongates every join.
 *
 * Lam-alef is never split, and diacritics stay with their letter.
 */
export function insertKashida(source: string, count: number, placement: KashidaPlacement): ElongatedText {
  const joins: number[] = []; // positions where tatweels go (before index j)
  let lastInWord = -1;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (isMark(code)) continue;
    const j = nextLetterIndex(source, i);
    const joined = j >= 0 && joinsNext(code) && joinsPrev(source.charCodeAt(j)) && !isLamAlef(source, i, j);
    if (joined) {
      if (placement === 'all') joins.push(j);
      else lastInWord = j;
    }
    const wordEnds = j < 0 || /\s/.test(source[j]);
    if (placement === 'last' && wordEnds && lastInWord >= 0) {
      joins.push(lastInWord);
      lastInWord = -1;
    }
  }

  const n = Math.max(0, Math.round(count));
  if (n === 0 || joins.length === 0) {
    return { text: source, sourceIndex: [...source].map((_, i) => i) };
  }

  const insertAt = new Set(joins);
  let text = '';
  const sourceIndex: number[] = [];
  let previousLetter = 0;
  for (let i = 0; i < source.length; i++) {
    if (insertAt.has(i)) {
      // Tatweels belong to the letter they extend (the one before them).
      text += TATWEEL_CHAR.repeat(n);
      for (let k = 0; k < n; k++) sourceIndex.push(previousLetter);
    }
    text += source[i];
    sourceIndex.push(i);
    if (!isMark(source.charCodeAt(i))) previousLetter = i;
  }
  return { text, sourceIndex };
}
