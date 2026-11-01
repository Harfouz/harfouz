/**
 * Minimal Arabic joining rules, enough to know where two letters connect.
 *
 * - Dual-joining letters (ب، س، م…) connect on both sides.
 * - Right-joining letters (ا، د، ر، و، ة…) connect only to the letter before
 *   them, never to the one after.
 * - Hamza (ء) never connects.
 * - Diacritics are transparent: they sit on a letter but don't break joins.
 */

const TATWEEL = 0x0640;

const RIGHT_JOINING = new Set([
  0x0622, 0x0623, 0x0624, 0x0625, 0x0627, 0x0629, 0x062f, 0x0630, 0x0631, 0x0632, 0x0648, 0x0671, 0x0672,
  0x0673, 0x0675, 0x0676, 0x0677, 0x06c0, 0x06c3, 0x06c4, 0x06c5, 0x06c6, 0x06c7, 0x06c8, 0x06c9, 0x06ca,
  0x06cb, 0x06cd, 0x06cf, 0x06d2, 0x06d3, 0x06d5, 0x06ee, 0x06ef,
]);
for (let c = 0x0688; c <= 0x0699; c++) RIGHT_JOINING.add(c);

const ALEFS = new Set([0x0622, 0x0623, 0x0625, 0x0627, 0x0671, 0x0672, 0x0673, 0x0675]);
const LAM = 0x0644;

export function isMark(code: number): boolean {
  return (
    (code >= 0x064b && code <= 0x065f) ||
    code === 0x0670 ||
    (code >= 0x06d6 && code <= 0x06dc) ||
    (code >= 0x06df && code <= 0x06e4) ||
    (code >= 0x06e7 && code <= 0x06e8) ||
    (code >= 0x06ea && code <= 0x06ed)
  );
}

function isArabicLetter(code: number): boolean {
  return (
    (code >= 0x0620 && code <= 0x064a) ||
    (code >= 0x066e && code <= 0x06d3) ||
    code === 0x06d5 ||
    code === 0x06ee ||
    code === 0x06ef ||
    (code >= 0x06fa && code <= 0x06fc) ||
    code === 0x06ff
  );
}

/** Does this character connect to the character that follows it? */
export function joinsNext(code: number): boolean {
  if (code === TATWEEL) return true;
  if (!isArabicLetter(code) || isMark(code) || code === 0x0621) return false;
  return !RIGHT_JOINING.has(code);
}

/** Does this character connect to the character before it? */
export function joinsPrev(code: number): boolean {
  if (code === TATWEEL) return true;
  return isArabicLetter(code) && !isMark(code) && code !== 0x0621;
}

/** Index of the next non-mark character after `i`, or -1. */
export function nextLetterIndex(text: string, i: number): number {
  for (let j = i + 1; j < text.length; j++) if (!isMark(text.charCodeAt(j))) return j;
  return -1;
}

/**
 * For every UTF-16 index, true when the letter there is NOT connected to the
 * following letter (end of a word, a right-joining letter, a space…).
 * Marks inherit the value of their base letter.
 */
export function breaksAfter(text: string): boolean[] {
  const result: boolean[] = new Array(text.length).fill(true);
  let base = -1;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isMark(code) && base >= 0) {
      result[i] = result[base];
      continue;
    }
    base = i;
    const j = nextLetterIndex(text, i);
    result[i] = !(j >= 0 && joinsNext(code) && joinsPrev(text.charCodeAt(j)));
  }
  return result;
}

/** Lam followed by alef forms a mandatory ligature and must not be split. */
export function isLamAlef(text: string, i: number, j: number): boolean {
  return text.charCodeAt(i) === LAM && ALEFS.has(text.charCodeAt(j));
}

export const TATWEEL_CHAR = String.fromCharCode(TATWEEL);
