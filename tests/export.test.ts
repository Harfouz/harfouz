import { describe, expect, it } from 'vitest';
import { finalSize, FORMATS } from '../src/export/formats';

const format = (id: string) => FORMATS.find((f) => f.id === id)!;

describe('export formats', () => {
  it('offers images and animations for both views', () => {
    for (const mode of ['2d', '3d'] as const) {
      expect(FORMATS.some((f) => f.kind === 'image' && f.modes.includes(mode))).toBe(true);
      expect(FORMATS.some((f) => f.kind === 'animation' && f.modes.includes(mode))).toBe(true);
    }
  });

  it('only offers SVG from the 2D view and GLB from the 3D view', () => {
    expect(format('svg').modes).toEqual(['2d']);
    expect(format('glb').modes).toEqual(['3d']);
  });

  it('knows which formats keep transparency', () => {
    expect(FORMATS.filter((f) => f.alpha).map((f) => f.id)).toEqual(['png', 'webp', 'svg', 'glb', 'png-sequence']);
  });

  it('gives video encoders even dimensions', () => {
    expect(finalSize(format('mp4'), 1277, 601)).toEqual([1276, 600]);
    expect(finalSize(format('png'), 1277, 601)).toEqual([1277, 601]);
  });

  it('keeps GIFs under 720 px, preserving proportions', () => {
    expect(finalSize(format('gif'), 1920, 1080)).toEqual([720, 404]);
    expect(finalSize(format('gif'), 500, 500)).toEqual([500, 500]);
  });
});
