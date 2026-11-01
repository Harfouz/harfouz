import type { Composition } from '../../core/types';
import type { Renderer, RenderInput } from '../Renderer';
import { toSvgPathData } from './pathData';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ERODE_FILTER_ID = 'harfouz-erode';

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Bounding box of every point of the composition (font units, y up). */
function bounds(comp: Composition) {
  let minX = 0;
  let maxX = comp.width;
  let minY = comp.descender;
  let maxY = comp.ascender;
  for (const g of comp.glyphs) {
    for (const c of g.commands) {
      if (c.type === 'Z') continue;
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y);
      maxY = Math.max(maxY, c.y);
    }
  }
  return { minX, maxX, minY, maxY };
}

/** Draws a composition as SVG paths, one <g> per letter. */
export class SvgRenderer implements Renderer {
  readonly svg: SVGSVGElement = el('svg', { role: 'img' });

  mount(container: HTMLElement) {
    container.appendChild(this.svg);
  }

  render({ composition: comp, weight, guides, inspect, referenceFontFamily }: RenderInput) {
    const em = comp.unitsPerEm;
    const b = bounds(comp);
    const pad = em * 0.2 + Math.max(0, weight);
    // Screen space is y down, so the top of the view is -maxY.
    this.svg.setAttribute(
      'viewBox',
      `${b.minX - pad} ${-b.maxY - pad} ${b.maxX - b.minX + pad * 2} ${b.maxY - b.minY + pad * 2}`,
    );
    this.svg.setAttribute('aria-label', comp.text);
    this.svg.replaceChildren();

    if (guides) this.svg.appendChild(this.guides(b.minX - pad, b.maxX + pad, comp.ascender, comp.descender));

    const ink = el('g', { class: 'ink', fill: 'currentColor' });
    if (weight > 0) {
      // A stroke centred on the outline adds `weight` on each side.
      ink.setAttribute('stroke', 'currentColor');
      ink.setAttribute('stroke-width', String(weight * 2));
      ink.setAttribute('stroke-linejoin', 'round');
    } else if (weight < 0) {
      this.svg.appendChild(this.erodeFilter(-weight));
      ink.setAttribute('filter', `url(#${ERODE_FILTER_ID})`);
    }

    const letters = new Map<number, SVGGElement>();
    for (const g of comp.glyphs) {
      let group = letters.get(g.letter);
      if (!group) {
        group = el('g', { 'data-letter': g.letter });
        letters.set(g.letter, group);
        ink.appendChild(group);
      }
      group.appendChild(el('path', { d: toSvgPathData(g.commands) }));
    }
    this.svg.appendChild(ink);

    if (inspect) this.svg.appendChild(this.inspector(comp, referenceFontFamily));
  }

  private erodeFilter(radius: number) {
    const defs = el('defs');
    const filter = el('filter', { id: ERODE_FILTER_ID, x: '-10%', y: '-10%', width: '120%', height: '120%' });
    filter.appendChild(el('feMorphology', { operator: 'erode', radius }));
    defs.appendChild(filter);
    return defs;
  }

  private guides(x0: number, x1: number, ascender: number, descender: number) {
    const group = el('g', { class: 'guides' });
    for (const [y, name] of [[0, 'baseline'], [-ascender, 'ascender'], [-descender, 'descender']] as const) {
      group.appendChild(el('line', { x1: x0, x2: x1, y1: y, y2: y, class: `guide guide--${name}` }));
    }
    return group;
  }

  /** Glyph advance boxes + the browser's native rendering for comparison. */
  private inspector(comp: Composition, fontFamily: string) {
    const group = el('g', { class: 'inspect' });
    const { ascender, descender, unitsPerEm } = comp;
    for (const g of comp.glyphs) {
      if (g.isMark) continue;
      group.appendChild(
        el('rect', { x: g.x, y: -ascender, width: g.advance, height: ascender - descender, class: 'inspect__box' }),
      );
    }
    // Native text, anchored on the right edge like the shaped line.
    const ref = el('text', {
      x: comp.width,
      y: 0,
      'font-size': unitsPerEm,
      'font-family': fontFamily,
      direction: 'rtl',
      class: 'inspect__reference',
    });
    ref.textContent = comp.text;
    group.appendChild(ref);
    return group;
  }

  destroy() {
    this.svg.remove();
  }
}
