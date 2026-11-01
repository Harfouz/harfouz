import type { Composition } from '../core/types';

/** Everything a renderer needs to draw one frame. */
export interface RenderInput {
  composition: Composition;
  /**
   * Outline weight in font units: positive thickens the letters,
   * negative erodes them.
   */
  weight: number;
  /** Draw baseline and ascender/descender guides. */
  guides: boolean;
  /** Debug view: glyph boxes plus the browser's own rendering as a reference. */
  inspect: boolean;
  /** CSS font-family used for the inspect reference overlay. */
  referenceFontFamily: string;
}

/**
 * The contract every renderer follows. The SVG renderer is the first one;
 * a WebGL renderer (Three.js or raw shaders) can implement the same
 * interface later without touching shaping or modifiers.
 */
export interface Renderer {
  mount(container: HTMLElement): void;
  render(input: RenderInput): void;
  destroy(): void;
}
