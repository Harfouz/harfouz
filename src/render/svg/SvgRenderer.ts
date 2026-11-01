import type { Composition } from '../../core/types';
import type { Params } from '../../params/schema';
import { grainOf, inkOf, letterFill, resolveColor } from '../look';
import type { Renderer, RenderInput } from '../Renderer';
import { flatLook, lookFilter } from './looks';
import { toSvgPathData } from './pathData';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ERODE_FILTER_ID = 'harfouz-erode';
const GRADIENT_ID = 'harfouz-gradient';

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

  render({ composition: comp, word, letter, selected, guides, inspect, referenceFontFamily }: RenderInput) {
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

    const inkColor = inkOf(this.svg);
    if (word.fill === 'gradient') {
      // From the right edge (start of the Arabic word) to the left edge.
      const gradient = el('linearGradient', {
        id: GRADIENT_ID,
        gradientUnits: 'userSpaceOnUse',
        x1: comp.width,
        y1: 0,
        x2: 0,
        y2: 0,
      });
      gradient.append(
        el('stop', { offset: 0, 'stop-color': resolveColor(word.color, inkColor) }),
        el('stop', { offset: 1, 'stop-color': resolveColor(word.color2, inkColor) }),
      );
      defs.appendChild(gradient);
    }

    const ink = el('g', { class: 'ink' });
    const letters = new Map<number, SVGGElement>();
    // Each letter: an outer group for colour and material look, an inner one
    // for erosion (an element can only carry one filter).
    const inner = new Map<number, SVGGElement>();
    for (const g of comp.glyphs) {
      let group = inner.get(g.letter);
      if (!group) {
        const p = letter(g.letter);
        const fill = letterFill(word, p, letters.size, inkColor);
        const paint = fill === 'gradient' ? `url(#${GRADIENT_ID})` : fill;
        const outer = el('g', { 'data-letter': g.letter, class: 'letter' });
        this.applyLook(outer, p.material, paint, grainOf(p), em, defs);
        group = el('g');
        this.applyWeight(outer, group, weightOf(g.letter), paint, defs);
        outer.appendChild(group);
        letters.set(g.letter, outer);
        inner.set(g.letter, group);
        ink.appendChild(outer);
      }
      group.appendChild(el('path', { d: toSvgPathData(g.commands) }));
    }
    this.svg.appendChild(ink);

    const chosen = selected === null ? undefined : letters.get(selected);
    if (chosen) this.svg.appendChild(this.selection(chosen, em));

    if (inspect) this.svg.appendChild(this.inspector(comp, referenceFontFamily));
  }

  /** Colour, see-through and material filter (relief, grain, shadow). */
  private applyLook(group: SVGGElement, material: Params['material'], paint: string, grain: number, em: number, defs: SVGDefsElement) {
    if (material === 'outline') {
      group.setAttribute('fill', 'none');
      group.setAttribute('stroke', paint);
      group.setAttribute('stroke-width', String(em * 0.008));
      group.setAttribute('stroke-linejoin', 'round');
      return;
    }
    group.setAttribute('fill', paint);
    const { opacity } = flatLook(material);
    if (opacity < 1) group.setAttribute('fill-opacity', String(opacity));
    const id = `harfouz-look-${material}-${Math.round(grain * 100)}`;
    if (!defs.querySelector(`#${id}`)) {
      const filter = lookFilter(id, material, grain, em);
      if (!filter) return;
      defs.appendChild(filter);
    }
    group.setAttribute('filter', `url(#${id})`);
  }

  /** Positive weight: a stroke centred on the outline. Negative: erosion. */
  private applyWeight(outer: SVGGElement, inner: SVGGElement, weight: number, paint: string, defs: SVGDefsElement) {
    if (weight > 0) {
      // Outline letters keep their thin line and get it thicker instead.
      if (outer.getAttribute('fill') !== 'none') outer.setAttribute('stroke', paint);
      outer.setAttribute('stroke-width', String(weight * 2));
      outer.setAttribute('stroke-linejoin', 'round');
    } else if (weight < 0) {
      const id = `${ERODE_FILTER_ID}-${Math.round(-weight * 10)}`;
      if (!defs.querySelector(`#${id}`)) defs.appendChild(this.erodeFilter(id, -weight));
      inner.setAttribute('filter', `url(#${id})`);
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

  /**
   * The current drawing as a standalone SVG document, without guides or
   * selection (call render() with those off first).
   */
  svgString(background: string | null, width?: number, height?: number): string {
    const copy = this.svg.cloneNode(true) as SVGSVGElement;
    copy.setAttribute('xmlns', SVG_NS);
    copy.removeAttribute('role');
    for (const helper of copy.querySelectorAll('.guides, .selection, .inspect')) helper.remove();
    if (width && height) {
      copy.setAttribute('width', String(width));
      copy.setAttribute('height', String(height));
    }
    if (background) {
      const [x, y, w, h] = (copy.getAttribute('viewBox') ?? '0 0 0 0').split(' ').map(Number);
      const rect = el('rect', { x, y, width: w, height: h, fill: background });
      copy.insertBefore(rect, copy.firstChild);
    }
    return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(copy)}`;
  }

  /** Rasterise the current drawing into a canvas of the given size (centred, contained). */
  async snapshot(width: number, height: number, background: string | null): Promise<HTMLCanvasElement> {
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(this.svgString(null, width, height))}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(image, 0, 0, width, height);
    return canvas;
  }

  destroy() {
    this.svg.remove();
  }
}
