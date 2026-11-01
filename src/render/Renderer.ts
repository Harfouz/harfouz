import type { Composition } from '../core/types';
import type { Params } from '../params/schema';

/** Everything a renderer needs to draw one frame. */
export interface RenderInput {
  composition: Composition;
  /** Word-level values (lengths in ‰ em). */
  word: Params;
  /** Effective values for one letter: the word's, plus that letter's overrides. */
  letter: (index: number) => Params;
  /**
   * Position of a letter in reading order (diacritics share their letter's),
   * used by palettes and by motion delays.
   */
  order: (index: number) => number;
  /** Letter currently being edited, or null when editing the whole word. */
  selected: number | null;
  /** Draw baseline and ascender/descender guides (2D only). */
  guides: boolean;
  /** Debug view: glyph boxes plus the browser's own rendering as a reference (2D only). */
  inspect: boolean;
  /** CSS font-family used for the inspect reference overlay. */
  referenceFontFamily: string;
  /**
   * Changes whenever something that shapes the letters changes. While it
   * stays the same (e.g. only placement is animated), a renderer may reuse
   * work from the previous frame. Leave undefined to always rebuild.
   */
  geometryKey?: string;
}

/**
 * The contract every renderer follows. SvgRenderer draws flat vector
 * letters, ThreeRenderer draws them as volumes in a 3D scene. Shaping and
 * modifiers don't know which one is used.
 */
export interface Renderer {
  mount(container: HTMLElement): void;
  render(input: RenderInput): void;
  /** Called when the user clicks a letter (its index) or empty space (null). */
  onPick?: (letter: number | null) => void;
  destroy(): void;
}
