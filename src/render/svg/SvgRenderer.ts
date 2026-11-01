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

  onPick?: (letter: number | null) => void;

  mount(container: HTMLElement) {
    container.appendChild(this.svg);
    this.svg.addEventListener('click', (event) => {
      const group = (event.target as Element).closest('[data-letter]');
      this.onPick?.(group ? Number(group.getAttribute('data-letter')) : null);
    });
  }

  render({ composition: comp, letter, selected, guides, inspect, referenceFontFamily }: RenderInput) {
    const em = comp.unitsPerEm;
    const perMille = em / 1000;
    const weightOf = (index: number) => letter(index).weight * perMille;
    const b = bounds(comp);
    const maxWeight = Math.max(0, ...comp.glyphs.map((g) => weightOf(g.letter)));
    const pad = em * 0.2 + maxWeight;
    // Screen space is y down, so the top of the view is -maxY.
    this.svg.setAttribute(
      'viewBox',
      `${b.minX - pad} ${-b.maxY - pad} ${b.maxX - b.minX + pad * 2} ${b.maxY - b.minY + pad * 2}`,
    );
    this.svg.setAttribute('aria-label', comp.text);
    this.svg.replaceChildren();
    const defs = el('defs');
    this.svg.appendChild(defs);

    if (guides) this.svg.appendChild(this.guides(b.minX - pad, b.maxX + pad, comp.ascender, comp.descender));

    const ink = el('g', { class: 'ink', fill: 'currentColor' });
    const letters = new Map<number, SVGGElement>();
    for (const g of comp.glyphs) {
      let group = letters.get(g.letter);
      if (!group) {
        group = el('g', { 'data-letter': g.letter, class: 'letter' });
        this.applyWeight(group, weightOf(g.letter), defs);
        letters.set(g.letter, group);
        ink.appendChild(group);
      }
      group.appendChild(el('path', { d: toSvgPathData(g.commands) }));
    }
    this.svg.appendChild(ink);

    const chosen = selected === null ? undefined : letters.get(selected);
    if (chosen) this.svg.appendChild(this.selection(chosen, em));

    if (inspect) this.svg.appendChild(this.inspector(comp, referenceFontFamily));
  }

  /** Positive weight: a stroke centred on the outline. Negative: erosion. */
  private applyWeight(group: SVGGElement, weight: number, defs: SVGDefsElement) {
    if (weight > 0) {
      group.setAttribute('stroke', 'currentColor');
      group.setAttribute('stroke-width', String(weight * 2));
      group.setAttribute('stroke-linejoin', 'round');
    } else if (weight < 0) {
      const id = `${ERODE_FILTER_ID}-${Math.round(-weight * 10)}`;
      if (!defs.querySelector(`#${id}`)) defs.appendChild(this.erodeFilter(id, -weight));
      group.setAttribute('filter', `url(#${id})`);
    }
  }

  /** Dashed frame around the letter being edited. */
  private selection(group: SVGGElement, em: number) {
    const box = group.getBBox();
    const m = em * 0.04;
    return el('rect', {
      x: box.x - m,
      y: box.y - m,
      width: box.width + m * 2,
      height: box.height + m * 2,
      class: 'selection',
    });
  }

  private erodeFilter(id: string, radius: number) {
    const filter = el('filter', { id, x: '-10%', y: '-10%', width: '120%', height: '120%' });
    filter.appendChild(el('feMorphology', { operator: 'erode', radius }));
    return filter;
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
