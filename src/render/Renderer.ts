import type { Composition } from '../core/types';
import type { SpaceParams } from '../params/schema';

/** Everything a renderer needs to draw one frame. */
export interface RenderInput {
  composition: Composition;
  /**
   * Outline weight in font units: positive thickens the letters,
   * negative erodes them.
   */
  weight: number;
  /** 3D placement and volume, in thousandths of an em (ignored in 2D). */
  space: SpaceParams;
  /** Draw baseline and ascender/descender guides (2D only). */
  guides: boolean;
  /** Debug view: glyph boxes plus the browser's own rendering as a reference (2D only). */
  inspect: boolean;
  /** CSS font-family used for the inspect reference overlay. */
  referenceFontFamily: string;
}

/**
 * The contract every renderer follows. SvgRenderer draws flat vector
 * letters, ThreeRenderer draws them as volumes in a 3D scene. Shaping and
 * modifiers don't know which one is used.
 */
export interface Renderer {
  mount(container: HTMLElement): void;
  render(input: RenderInput): void;
  destroy(): void;
}
