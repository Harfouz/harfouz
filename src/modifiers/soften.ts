import type { Composition, GlyphShape } from '../core/types';
import { area, clean, difference, tidy, intersect, offset, SCALE, toCommands, toPaths, union, type Path } from './clipper';
import { letterSpans } from './joins';

/**
 * Soften: rounds the corners of the letters, like a worn stamp or a felt
 * pen. `softOf` gives each letter's value in percent; at 100 % a corner is
 * rounded with a radius of `SOFT_EM` of an em, enough to give most strokes
 * round ends.
 *
 * Outer corners are rounded by shrinking the outline and growing it back
 * (a morphological opening). On its own that would also wipe out every
 * stroke thinner than the rounding, so those strokes are rounded again
 * with a smaller radius, and the finest ones are kept as they are: a
 * letter never loses a stroke. Inner corners get a matching fillet.
 *
 * Joined letters are softened together and then cut back to their own
 * outline, so the seam between them isn't rounded off.
 */
export function applySoften(comp: Composition, softOf: (letter: number) => number): Composition {
  const values = new Map<number, number>();
  const soft = (letter: number) => {
    if (!values.has(letter)) values.set(letter, softOf(letter));
    return values.get(letter)!;
  };
  if (comp.glyphs.every((g) => soft(g.letter) <= 0)) return comp;

  const em = comp.unitsPerEm;
  const polygons = new Map<GlyphShape, Path[]>();
  const polysOf = (g: GlyphShape) => {
    if (!polygons.has(g)) polygons.set(g, union(toPaths(g.commands, em / 120)));
    return polygons.get(g)!;
  };

  // Chains of joined letters (a word can have several).
  const chainOf = new Map<number, number>();
  const spans = letterSpans(comp);
  spans.forEach((span, i) => {
    const previous = i > 0 && spans[i - 1].joinsNext ? chainOf.get(spans[i - 1].letter) : undefined;
    chainOf.set(span.letter, previous ?? span.letter);
  });
  const chains = new Map<number, GlyphShape[]>();
  for (const g of comp.glyphs) {
    if (g.isMark || !chainOf.has(g.letter)) continue;
    const c = chainOf.get(g.letter)!;
    chains.set(c, [...(chains.get(c) ?? []), g]);
  }

  // Each chain is rounded once per radius, then shared out between its letters.
  const gap = (em / 100) * SCALE;
  const roundedChains = new Map<string, Path[]>();
  const roundedChain = (chain: number, r: number) => {
    const key = `${chain}:${r}`;
    if (!roundedChains.has(key)) {
      // Letters that only just touch are closed up into one shape first.
      const whole = union(chains.get(chain)!.flatMap(polysOf));
      roundedChains.set(key, rounded(offset(offset(whole, gap, em), -gap, em), r, em));
    }
    return roundedChains.get(key)!;
  };

  return {
    ...comp,
    glyphs: comp.glyphs.map((g) => {
      const s = Math.min(soft(g.letter), 100);
      if (s <= 0 || !g.commands.length) return g;
      const r = Math.round((s / 100) * SOFT_EM * em * SCALE);
      const own = polysOf(g);
      const chain = g.isMark ? undefined : chainOf.get(g.letter);
      const others = chain === undefined ? [] : chains.get(chain)!.filter((o) => o !== g);
      if (!others.length) return { ...g, commands: toCommands(tidy(rounded(own, r, em), em)) };
      const shape = roundedChain(chain!, r);
      // This letter's share: what lies on its side of the seam, inner
      // fillets included (they sit just outside its outline).
      const share = difference(offset(own, r, em), union(others.flatMap(polysOf)));
      return { ...g, commands: toCommands(tidy(intersect(shape, union([...own, ...share])), em)) };
    }),
  };
}

/** How far 100 % softer rounds a corner, in ems. */
export const SOFT_EM = 0.12;

/** Each pass rounds with this fraction of the previous radius. */
const STEP = 0.45;
/** A leftover piece larger than this many squared radii is a stroke, not a corner. */
const STROKE = 6;
/** An inner fillet is smaller than this many squared radii (larger: a gap being filled). */
const FILLET = 1.5;

/**
 * Round the corners of a shape with radius `r` (scaled units), or with
 * the largest radius that fits where the strokes are thinner.
 */
function rounded(input: Path[], r: number, em: number): Path[] {
  const fine = em / 800; // arc precision
  // Fewer points (thinned outlines are dense): much quicker, same shape.
  const shape = clean(input, (em / 5000) * SCALE);
  const open = (radius: number) => offset(offset(shape, -radius, em, fine), radius, em, fine);
  // Outer corners: shrink then grow back. Strokes too thin for that
  // radius vanish; they come back from the next, smaller pass, and so on.
  // Only pieces the size of a stroke come back: the slivers cut off the
  // corners stay off.
  let result = open(r);
  const smallest = (em / 500) * SCALE;
  const strokes = (paths: Path[], size: number) => paths.filter((p) => Math.abs(area(p)) > STROKE * size * size);
  let missing = strokes(difference(shape, result), smallest);
  for (let radius = r * STEP; missing.length; radius *= STEP) {
    const last = radius < smallest;
    const size = Math.max(radius, smallest);
    const lost = strokes(last ? missing : intersect(open(radius), missing), size);
    if (lost.length) {
      result = union([...result, ...lost]);
      missing = strokes(difference(missing, lost), smallest);
    }
    if (last) break;
  }
  // Inner corners: grow then shrink back, keeping only the small fillets
  // (not whole gaps between strokes that happen to be close).
  const f = r / 3;
  const closed = offset(offset(result, f, em, fine), -f, em, fine);
  // (Crumbs along straight edges, from rounding, are left out.)
  const crumb = smallest * smallest;
  const fillets = difference(closed, result).filter((p) => {
    const a = Math.abs(area(p));
    return a > crumb && a < FILLET * f * f;
  });
  if (!fillets.length) return result;
  const outers = result.filter((p) => area(p) > 0).map(bounds);
  const all = union([...result, ...fillets]);
  if (all.filter((p) => area(p) > 0).length === outers.length) return all;
  // Some fillet bridges two separate shapes (two dots side by side, say):
  // that's not an inner corner. Leave out every fillet that reaches more
  // than one shape.
  const kept = fillets.filter((p) => {
    const b = bounds(p);
    return outers.filter((o) => o.x0 <= b.x1 + 2 && b.x0 <= o.x1 + 2 && o.y0 <= b.y1 + 2 && b.y0 <= o.y1 + 2).length < 2;
  });
  return kept.length ? union([...result, ...kept]) : result;
}

function bounds(path: Path) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of path) (x0 = Math.min(x0, p.X)), (y0 = Math.min(y0, p.Y)), (x1 = Math.max(x1, p.X)), (y1 = Math.max(y1, p.Y));
  return { x0, y0, x1, y1 };
}
