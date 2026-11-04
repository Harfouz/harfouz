import type { BackgroundParams } from '../params/schema';
import { parseGradient, type GradientStop } from './look';

/**
 * The artboard's background: the theme colour, one colour, or a linear or
 * radial gradient. The same description paints the live artboard (as CSS)
 * and exported pictures and videos (on a canvas), so they match.
 *
 * Angles follow the letters' gradients: 0° runs left to right, 90° bottom
 * to top.
 */
export type Backdrop =
  | { kind: 'solid'; color: string }
  | { kind: 'linear'; stops: GradientStop[]; angle: number }
  | { kind: 'radial'; stops: GradientStop[] };

/** The backdrop chosen in the settings, or null for the theme's own colour. */
export function backdropOf(p: BackgroundParams): Backdrop | null {
  switch (p.background) {
    case 'solid':
      return { kind: 'solid', color: p.backgroundColor };
    case 'linear':
      return { kind: 'linear', stops: parseGradient(p.backgroundGradient), angle: p.backgroundAngle };
    case 'radial':
      return { kind: 'radial', stops: parseGradient(p.backgroundGradient) };
    default:
      return null;
  }
}

const cssStops = (stops: GradientStop[]) => stops.map((s) => `${s.color} ${(s.pos * 100).toFixed(2)}%`).join(', ');

/** CSS `background` value for the artboard. */
export function backdropCss(b: Backdrop): string {
  switch (b.kind) {
    case 'solid':
      return b.color;
    case 'linear':
      // CSS measures from "to top", clockwise.
      return `linear-gradient(${90 - b.angle}deg, ${cssStops(b.stops)})`;
    case 'radial':
      return `radial-gradient(circle farthest-corner at 50% 50%, ${cssStops(b.stops)})`;
  }
}

/** Paint the backdrop over a whole canvas, exactly like the CSS version. */
export function paintBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number, b: Backdrop) {
  let fill: string | CanvasGradient;
  if (b.kind === 'solid') {
    fill = b.color;
  } else {
    const cx = width / 2;
    const cy = height / 2;
    let gradient: CanvasGradient;
    if (b.kind === 'linear') {
      const a = (b.angle * Math.PI) / 180;
      const dx = Math.cos(a);
      const dy = -Math.sin(a); // canvas y points down
      // Same gradient line length as CSS: the corners land on the end colours.
      const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
      gradient = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
    } else {
      gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(cx, cy));
    }
    for (const s of b.stops) gradient.addColorStop(s.pos, s.color);
    fill = gradient;
  }
  ctx.save();
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/** One colour standing for the backdrop (its middle), e.g. to pick a readable mark colour. */
export function backdropTone(b: Backdrop): string {
  if (b.kind === 'solid') return b.color;
  const middle = b.stops.reduce((best, s) => (Math.abs(s.pos - 0.5) < Math.abs(best.pos - 0.5) ? s : best));
  return middle.color;
}
