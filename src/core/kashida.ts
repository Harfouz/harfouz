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
 * - `count`: how many tatweels per elongated join (a number, or one per
 *   letter: the join after letter i gets count(i)).
 * - `placement`: 'last' elongates the last join of each word (closest to the
 *   classical habit), 'all' elongates every join.
 * - `forced`: letters whose join is elongated whatever the placement (a
 *   letter given its own kashida value).
 *
 * Lam-alef is never split, and diacritics stay with their letter.
 */
export function insertKashida(
  source: string,
  count: number | ((letter: number) => number),
  placement: KashidaPlacement,
  forced: (letter: number) => boolean = () => false,
): ElongatedText {
  const countAfter = typeof count === 'number' ? () => count : count;
  // Insertion position (before index j) → letter the tatweels extend.
  const joins = new Map<number, number>();
  let lastInWord = -1;
  let lastLetter = -1;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (isMark(code)) continue;
    const j = nextLetterIndex(source, i);
    const joined = j >= 0 && joinsNext(code) && joinsPrev(source.charCodeAt(j)) && !isLamAlef(source, i, j);
    if (joined) {
      lastInWord = j;
      lastLetter = i;
      if (placement === 'all' || forced(i)) joins.set(j, i);
    }
    const wordEnds = j < 0 || /\s/.test(source[j]);
    if (placement === 'last' && wordEnds && lastInWord >= 0) {
      joins.set(lastInWord, lastLetter);
      lastInWord = -1;
    }
  }

  let text = '';
  const sourceIndex: number[] = [];
  for (let i = 0; i < source.length; i++) {
    const letter = joins.get(i);
    if (letter !== undefined) {
      // Tatweels belong to the letter they extend (the one before them).
      const n = Math.max(0, Math.round(countAfter(letter)));
      text += TATWEEL_CHAR.repeat(n);
      for (let k = 0; k < n; k++) sourceIndex.push(letter);
    }
    text += source[i];
    sourceIndex.push(i);
  }
  return { text, sourceIndex };
}
