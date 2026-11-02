/**
 * "Made with Harfouz": a credit added to exported files.
 *
 * - Invisible: written into each format's own metadata (PNG text chunk, JPEG
 *   and GIF comment, SVG metadata, glTF asset info, video comment, ZIP file
 *   comments). It never changes the picture and claims no rights over it:
 *   the work belongs to whoever made it.
 * - Visible (optional, off by default): a small mark in a corner.
 */

export const SITE_URL = 'https://harfouz.github.io/harfouz/';
export const SIGNATURE = `Made with Harfouz, parametric Arabic typography: ${SITE_URL}`;

const utf8 = new TextEncoder();
const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// ── PNG: tEXt chunks after the header ────────────────────

let crcTable: Uint32Array | undefined;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(latin1(type), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/** Add "Software" and "Comment" text chunks right after the PNG header. */
export function signPng(png: Uint8Array): Uint8Array {
  const ihdrEnd = 8 + 12 + new DataView(png.buffer, png.byteOffset).getUint32(8);
  const text = (key: string, value: string) => pngChunk('tEXt', concat([latin1(key), new Uint8Array([0]), latin1(value)]));
  return concat([png.subarray(0, ihdrEnd), text('Software', 'Harfouz'), text('Comment', SIGNATURE), png.subarray(ihdrEnd)]);
}

// ── JPEG: a comment segment after the JFIF header ────────

export function signJpeg(jpeg: Uint8Array): Uint8Array {
  const text = utf8.encode(SIGNATURE);
  const segment = new Uint8Array(4 + text.length);
  segment.set([0xff, 0xfe, (text.length + 2) >> 8, (text.length + 2) & 0xff]);
  segment.set(text, 4);
  // Keep the APP0 (JFIF) segment first, as viewers expect.
  let at = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + ((jpeg[4] << 8) | jpeg[5]);
  return concat([jpeg.subarray(0, at), segment, jpeg.subarray(at)]);
}

// ── GIF: a comment extension before the end ──────────────

export function signGif(gif: Uint8Array): Uint8Array {
  const text = latin1(SIGNATURE);
  const blocks: number[] = [0x21, 0xfe];
  for (let i = 0; i < text.length; i += 255) {
    const part = text.subarray(i, i + 255);
    blocks.push(part.length, ...part);
  }
  blocks.push(0);
  // The last byte of a GIF is its trailer (0x3B).
  return concat([gif.subarray(0, gif.length - 1), new Uint8Array(blocks), gif.subarray(gif.length - 1)]);
}

// ── glTF binary: asset information ───────────────────────

export function signGlb(glb: ArrayBuffer): ArrayBuffer {
  const view = new DataView(glb);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength)));
  json.asset = {
    ...json.asset,
    generator: `Harfouz (${json.asset?.generator ?? 'three.js'})`,
    extras: { ...json.asset?.extras, madeWith: 'Harfouz', url: SITE_URL },
  };
  let text = utf8.encode(JSON.stringify(json));
  // Chunks are aligned on 4 bytes; JSON is padded with spaces.
  const padded = new Uint8Array(Math.ceil(text.length / 4) * 4).fill(0x20);
  padded.set(text);
  text = padded;
  const rest = new Uint8Array(glb, 20 + jsonLength);
  const out = new Uint8Array(12 + 8 + text.length + rest.length);
  const outView = new DataView(out.buffer);
  out.set(new Uint8Array(glb, 0, 12));
  outView.setUint32(8, out.length, true);
  outView.setUint32(12, text.length, true);
  outView.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(text, 20);
  out.set(rest, 20 + text.length);
  return out.buffer;
}

// ── SVG: metadata, and the visible mark ──────────────────

/** Add the credit as SVG metadata (and, if asked, a small visible mark). */
export function signSvg(svg: string, visible: boolean): string {
  const metadata = `<metadata>${SIGNATURE}</metadata>`;
  let out = svg.replace(/(<svg[^>]*>)/, `$1${metadata}`);
  if (visible) {
    const [x, y, w, h] = (out.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 100 100').split(/[ ,]+/).map(Number);
    const size = Math.min(w, h) * 0.035;
    const mark =
      `<text x="${x + w - size}" y="${y + h - size}" text-anchor="end" font-size="${size}" ` +
      `font-family="system-ui, sans-serif" fill="#808080" fill-opacity="0.75">Made with Harfouz</text>`;
    out = out.replace(/<\/svg>\s*$/, `${mark}</svg>`);
  }
  return out;
}

// ── Visible mark on pictures ─────────────────────────────

/**
 * Draw a discreet "حرفوز · Harfouz" in the bottom corner of a frame, light
 * or dark depending on the background.
 */
export function drawMark(canvas: HTMLCanvasElement, background: string | null) {
  const ctx = canvas.getContext('2d')!;
  const size = Math.max(11, Math.round(Math.min(canvas.width, canvas.height) * 0.026));
  const margin = Math.round(size * 1.1);
  let color = 'rgba(128, 128, 128, 0.8)';
  if (background) {
    // Measure the background's brightness from a pixel of a 1×1 canvas.
    const probe = document.createElement('canvas').getContext('2d')!;
    probe.fillStyle = background;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
    color = 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.55)';
  }
  ctx.save();
  ctx.font = `${size}px "Harfouz amiri", "Harfouz Amiri", system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('حرفوز · Harfouz', canvas.width - margin, canvas.height - margin);
  ctx.restore();
}
