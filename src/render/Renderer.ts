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
  /**
   * Which element's gradient colours this one: itself or its letter (the
   * gradient then spans that element's shape), or null for the word's.
   */
  gradientOwner: (index: number) => number | null;
  /** Letter currently being edited, or null when editing the whole word. */
  selected: number | null;
  /**
   * Changes whenever something that shapes the letters changes. While it
   * stays the same (e.g. only placement is animated), a renderer may reuse
   * work from the previous frame. Leave undefined to always rebuild.
   */
  geometryKey?: string;
}

/**
 * The contract a renderer follows. ThreeRenderer draws the letters as
 * volumes in a 3D scene; shaping and modifiers don't depend on it, so
 * another renderer (WebGPU, custom shaders…) could implement the same
 * interface.
 */
export interface Renderer {
  mount(container: HTMLElement): void;
  render(input: RenderInput): void;
  /** Called when the user clicks a letter (its index) or empty space (null). */
  onPick?: (letter: number | null) => void;
  destroy(): void;
}
