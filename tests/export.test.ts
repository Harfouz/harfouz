import { describe, expect, it } from 'vitest';
import { finalSize, FORMATS } from '../src/export/formats';

const format = (id: string) => FORMATS.find((f) => f.id === id)!;

describe('export formats', () => {
  it('offers images, a 3D model and animations', () => {
    expect(FORMATS.filter((f) => f.kind === 'image').map((f) => f.id)).toEqual(['png', 'jpg', 'webp', 'glb']);
    expect(FORMATS.filter((f) => f.kind === 'animation').map((f) => f.id)).toEqual(['mp4', 'webm', 'gif', 'png-sequence']);
  });

  it('knows which formats keep transparency', () => {
    expect(FORMATS.filter((f) => f.alpha).map((f) => f.id)).toEqual(['png', 'webp', 'glb', 'png-sequence']);
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
