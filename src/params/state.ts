import { ALL_PARAMS, defaultsOf, type Params } from './schema';

type Value = number | string;

/**
 * Word-level values plus per-letter overrides.
 *
 * A letter uses the word's value for every parameter it hasn't overridden,
 * so changing the word still affects that letter's other parameters.
 * Diacritics work the same way, one level down: they follow their letter.
 * Letters and diacritics are identified by their index in the typed text.
 */
export class ParamState {
  word: Params = defaultsOf<Params>(ALL_PARAMS);
  private overrides = new Map<number, Partial<Record<keyof Params, Value>>>();
  /** Diacritic → the letter it sits on. */
  private parents = new Map<number, number>();

  /**
   * Tell which letter each diacritic sits on. A diacritic uses its own
   * values first, then its letter's, then the word's.
   */
  setParents(parents: Map<number, number>) {
    this.parents = parents;
  }

  /** Effective values for one letter (or diacritic). */
  resolve(letter: number): Params {
    const own = this.overrides.get(letter);
    const parent = this.parents.get(letter);
    const inherited = parent === undefined ? undefined : this.overrides.get(parent);
    if (!own && !inherited) return this.word;
    return { ...this.word, ...inherited, ...own } as Params;
  }

  get(letter: number | null, key: keyof Params): Value {
    return letter === null ? this.word[key] : this.resolve(letter)[key];
  }

  set(letter: number | null, key: keyof Params, value: Value) {
    if (letter === null) {
      (this.word as unknown as Record<string, Value>)[key] = value;
      return;
    }
    const own = this.overrides.get(letter) ?? {};
    own[key] = value;
    this.overrides.set(letter, own);
  }

  /** Back to the default (word) or back to the word's value (letter). */
  reset(letter: number | null, key: keyof Params) {
    if (letter === null) {
      const def = ALL_PARAMS.find((d) => d.key === key);
      if (def) (this.word as unknown as Record<string, Value>)[key] = def.default;
      return;
    }
    const own = this.overrides.get(letter);
    if (!own) return;
    delete own[key];
    if (Object.keys(own).length === 0) this.overrides.delete(letter);
  }

  /** Word: differs from the default. Letter: has its own value. */
  isModified(letter: number | null, key: keyof Params): boolean {
    if (letter === null) return this.word[key] !== ALL_PARAMS.find((d) => d.key === key)?.default;
    return this.overrides.get(letter)?.[key] !== undefined;
  }

  /** The letter a diacritic sits on, if any. */
  parentOf(index: number): number | undefined {
    return this.parents.get(index);
  }

  /**
   * Whose gradient colours this element: the diacritic or letter itself if
   * it has its own colour mode or gradient, else its letter's, else the
   * word's (null). The gradient spans the shape of that owner.
   */
  gradientOwner(index: number): number | null {
    const keys: (keyof Params)[] = ['fill', 'gradient', 'gradientAngle'];
    const owns = (i: number) => keys.some((k) => this.overrides.get(i)?.[k] !== undefined);
    if (owns(index)) return index;
    const parent = this.parents.get(index);
    if (parent !== undefined && owns(parent)) return parent;
    return null;
  }

  hasOverrides(letter: number): boolean {
    return this.overrides.has(letter);
  }

  clearLetter(letter: number) {
    this.overrides.delete(letter);
  }

  /**
   * The text changed: keep a letter's overrides only if the same character
   * is still at the same position.
   */
  retarget(oldText: string, newText: string) {
    for (const index of [...this.overrides.keys()]) {
      if (oldText[index] !== newText[index]) this.overrides.delete(index);
    }
  }
}
