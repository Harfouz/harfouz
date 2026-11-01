import type { MaterialId } from '../../params/schema';
import { shadeDataUrl, TILE_SIZE, type TextureId } from '../textures';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag: string, attrs: Record<string, string | number> = {}, children: Element[] = []): SVGElement {
  const node = document.createElementNS(SVG_NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  node.append(...children);
  return node;
}

/**
 * How each 3D material translates to a flat SVG look:
 * - `relief`: strength of the light catching the edges (0 = none),
 * - `shadow`: a soft drop shadow under the letter,
 * - `opacity`: fill opacity (glass is see-through).
 * Outline is handled separately: no fill, only a stroke.
 */
const FLAT_LOOKS: Record<MaterialId, { relief: number; shadow: boolean; opacity: number }> = {
  satin: { relief: 0.55, shadow: true, opacity: 1 },
  clay: { relief: 0.18, shadow: true, opacity: 1 },
  paper: { relief: 0.12, shadow: true, opacity: 1 },
  metal: { relief: 1.3, shadow: true, opacity: 1 },
  glass: { relief: 0.9, shadow: false, opacity: 0.45 },
  outline: { relief: 0, shadow: false, opacity: 0 },
};

export function flatLook(material: MaterialId) {
  return FLAT_LOOKS[material] ?? FLAT_LOOKS.satin;
}

/**
 * A repeating pattern of a texture, for filling letters (font units).
 * Textures are laid over the letter's colour in "multiply" mode, which
 * works for letters of any size and in other software opening the SVG.
 */
export function texturePattern(id: string, texture: TextureId, scale: number, em: number): SVGElement {
  const tile = (TILE_SIZE[texture] * em * scale) / 1000;
  return el('pattern', { id, patternUnits: 'userSpaceOnUse', width: tile, height: tile }, [
    el('image', { href: shadeDataUrl(texture), width: tile, height: tile, preserveAspectRatio: 'none' }),
  ]);
}

/**
 * An SVG filter for a material, sized in font units. Returns null when the
 * look needs no filter.
 *
 * Pipeline: light the edges (specular lighting on a blurred alpha), then lay
 * everything over a soft drop shadow.
 */
export function lookFilter(id: string, material: MaterialId, em: number): SVGElement | null {
  const look = flatLook(material);
  if (material === 'outline' || (look.relief === 0 && !look.shadow)) return null;
  const steps: Element[] = [];
  let current = 'SourceGraphic';

  if (look.relief > 0) {
    steps.push(
      el('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: em * 0.012, result: 'bump' }),
      el(
        'feSpecularLighting',
        {
          in: 'bump',
          surfaceScale: em * 0.006,
          specularConstant: look.relief,
          specularExponent: 22,
          'lighting-color': '#ffffff',
          result: 'shine',
        },
        [el('feDistantLight', { azimuth: 225, elevation: 48 })],
      ),
      el('feComposite', { in: 'shine', in2: 'SourceAlpha', operator: 'in', result: 'shineIn' }),
      el('feComposite', { in: current, in2: 'shineIn', operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result: 'lit' }),
    );
    current = 'lit';
  }

  if (look.shadow) {
    steps.push(
      el('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: em * 0.018, result: 'shadowBlur' }),
      el('feOffset', { in: 'shadowBlur', dx: em * 0.025, dy: em * 0.035, result: 'shadowOffset' }),
      el('feFlood', { 'flood-color': '#000000', 'flood-opacity': 0.3 }),
      el('feComposite', { in2: 'shadowOffset', operator: 'in', result: 'shadow' }),
      el('feMerge', {}, [el('feMergeNode', { in: 'shadow' }), el('feMergeNode', { in: current })]),
    );
  }

  return el(
    'filter',
    { id, x: '-20%', y: '-20%', width: '140%', height: '140%', 'color-interpolation-filters': 'sRGB' },
    steps,
  );
}
