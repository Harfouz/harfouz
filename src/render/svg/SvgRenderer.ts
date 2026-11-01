import type { Renderer, RenderInput } from '../Renderer';
import { toSvgPathData } from './pathData';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Draws a shaped line as SVG paths, one <g> per letter cluster. */
export class SvgRenderer implements Renderer {
  readonly svg: SVGSVGElement = el('svg', { role: 'img' });
  mount(container: HTMLElement) {
    container.appendChild(this.svg);
  }

  render({ line, guides, inspect, referenceFontFamily }: RenderInput) {
    const { unitsPerEm: em, ascender, descender, width } = line;
    const pad = em * 0.35;
    // Screen space: y down, baseline at y = 0.
    const top = -ascender - pad * 0.5;
    const height = ascender - descender + pad;
    this.svg.setAttribute('viewBox', `${-pad} ${top} ${width + pad * 2} ${height}`);
    this.svg.setAttribute('aria-label', line.text);
    this.svg.replaceChildren();

    if (guides) this.svg.appendChild(this.guides(-pad, width + pad, ascender, descender));

    const ink = el('g', { class: 'ink', fill: 'currentColor' });
    const clusters = new Map<number, SVGGElement>();
    for (const g of line.glyphs) {
      let group = clusters.get(g.cluster);
      if (!group) {
        group = el('g', { 'data-cluster': g.cluster });
        clusters.set(g.cluster, group);
        ink.appendChild(group);
      }
      group.appendChild(el('path', { d: toSvgPathData(g.commands, g.x, g.y), 'data-glyph': g.glyphId }));
    }
    this.svg.appendChild(ink);

    if (inspect) this.svg.appendChild(this.inspector(line, referenceFontFamily));
  }

  private guides(x0: number, x1: number, ascender: number, descender: number) {
    const group = el('g', { class: 'guides' });
    for (const [y, name] of [[0, 'baseline'], [-ascender, 'ascender'], [-descender, 'descender']] as const) {
      group.appendChild(el('line', { x1: x0, x2: x1, y1: y, y2: y, class: `guide guide--${name}` }));
    }
    return group;
  }

  /** Glyph advance boxes + the browser's native rendering for comparison. */
  private inspector(line: RenderInput['line'], fontFamily: string) {
    const group = el('g', { class: 'inspect' });
    const { ascender, descender, unitsPerEm } = line;
    for (const g of line.glyphs) {
      if (g.isMark) {
        group.appendChild(el('circle', { cx: g.x, cy: -g.y, r: unitsPerEm * 0.012, class: 'inspect__mark' }));
        continue;
      }
      group.appendChild(
        el('rect', { x: g.x, y: -ascender, width: g.advance, height: ascender - descender, class: 'inspect__box' }),
      );
    }
    // Native text, anchored on the right edge like the shaped line.
    const ref = el('text', {
      x: line.width,
      y: 0,
      'font-size': unitsPerEm,
      'font-family': fontFamily,
      direction: 'rtl',
      class: 'inspect__reference',
    });
    ref.textContent = line.text;
    group.appendChild(ref);
    return group;
  }

  destroy() {
    this.svg.remove();
  }
}
