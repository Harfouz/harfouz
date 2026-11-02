import { describe, expect, it } from 'vitest';
import { SIGNATURE, signGif, signGlb, signJpeg, signPng } from '../src/export/signature';

const fromBase64 = (b64: string) => Uint8Array.from(Buffer.from(b64, 'base64'));
const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

// Tiny but complete files: a 1×1 PNG, JPEG and GIF.
const PNG = fromBase64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
const JPEG = fromBase64(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
);
const GIF = fromBase64('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUQAOw==');

/** Walk the PNG chunks, checking each CRC. */
function pngChunks(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset);
  const chunks: { type: string; data: string }[] = [];
  let at = 8;
  while (at < png.length) {
    const length = view.getUint32(at);
    const type = text(png.subarray(at + 4, at + 8));
    chunks.push({ type, data: text(png.subarray(at + 8, at + 8 + length)) });
    at += 12 + length;
  }
  return chunks;
}

describe('invisible "Made with Harfouz" credit', () => {
  it('PNG: text chunks right after the header, file structure intact', () => {
    const signed = signPng(PNG);
    const chunks = pngChunks(signed);
    expect(chunks[0].type).toBe('IHDR');
    expect(chunks[1]).toEqual({ type: 'tEXt', data: 'Software\0Harfouz' });
    expect(chunks[2].data).toBe(`Comment\0${SIGNATURE}`);
    expect(chunks.at(-1)!.type).toBe('IEND');
    // The original chunks are all still there.
    expect(chunks.map((c) => c.type).filter((t) => t !== 'tEXt')).toEqual(pngChunks(PNG).map((c) => c.type));
  });

  it('JPEG: a comment segment, after the JFIF header', () => {
    const signed = signJpeg(JPEG);
    expect([signed[0], signed[1]]).toEqual([0xff, 0xd8]);
    expect([signed[2], signed[3]]).toEqual([0xff, 0xe0]);
    expect(text(signed)).toContain(SIGNATURE);
    expect(signed.length).toBe(JPEG.length + 4 + SIGNATURE.length);
    expect([signed.at(-2), signed.at(-1)]).toEqual([0xff, 0xd9]);
  });

  it('GIF: a comment extension, still ending with the trailer', () => {
    const signed = signGif(GIF);
    expect(text(signed.subarray(0, 6))).toBe('GIF89a');
    expect(text(signed)).toContain(SIGNATURE.slice(0, 100));
    expect(signed.at(-1)).toBe(0x3b);
  });

  it('GLB: credit in the asset information, binary data untouched', () => {
    const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0', generator: 'THREE.GLTFExporter' } }) + '  ');
    const bin = new Uint8Array([1, 2, 3, 4]);
    const glb = new Uint8Array(12 + 8 + json.length + 8 + bin.length);
    const view = new DataView(glb.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, glb.length, true);
    view.setUint32(12, json.length, true);
    view.setUint32(16, 0x4e4f534a, true);
    glb.set(json, 20);
    view.setUint32(20 + json.length, bin.length, true);
    view.setUint32(24 + json.length, 0x004e4942, true);
    glb.set(bin, 28 + json.length);

    const signed = new DataView(signGlb(glb.buffer));
    const jsonLength = signed.getUint32(12, true);
    expect(jsonLength % 4).toBe(0);
    expect(signed.getUint32(8, true)).toBe(signed.byteLength);
    const asset = JSON.parse(new TextDecoder().decode(new Uint8Array(signed.buffer, 20, jsonLength))).asset;
    expect(asset.version).toBe('2.0');
    expect(asset.generator).toBe('Harfouz (THREE.GLTFExporter)');
    expect(asset.extras.madeWith).toBe('Harfouz');
    // The binary chunk follows, unchanged.
    expect([...new Uint8Array(signed.buffer, 20 + jsonLength + 8, 4)]).toEqual([1, 2, 3, 4]);
  });

});
