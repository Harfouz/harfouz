/**
 * "Made with Harfouz": a credit added to exported files.
 *
 * - Invisible: written into each format's own metadata (PNG text chunk, JPEG
 *   and GIF comment, glTF asset info, video comment, ZIP file
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

// ── Visible mark on pictures ─────────────────────────────

const MARK_ARABIC = '"Harfouz Amiri", serif';
const MARK_MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** Load the logo's Arabic face so the mark never falls back to another font. */
export async function prepareMark() {
  try {
    await document.fonts.load(`40px ${MARK_ARABIC}`, 'حرفوز');
  } catch {
    // Fonts API unavailable: the mark still draws, in a fallback face.
  }
}

/** Is a CSS colour light? (measured from one pixel) */
function isLight(color: string): boolean {
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
}

/** Spaced capitals, like the top bar (drawn letter by letter: letterSpacing isn't everywhere). */
function spacedWidth(ctx: CanvasRenderingContext2D, text: string, spacing: number) {
  return [...text].reduce((w, c) => w + ctx.measureText(c).width + spacing, -spacing);
}
function drawSpaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number) {
  for (const c of text) {
    ctx.fillText(c, x, y);
    x += ctx.measureText(c).width + spacing;
  }
}

/**
 * Draw a small "MADE WITH حرفوز HARFOUZ" in the bottom corner of a frame,
 * as plain text in the logo's faces (Amiri for the Arabic, spaced
 * monospace capitals for the Latin), light or dark to suit the background.
 * Call prepareMark() once before, so the Arabic face is loaded.
 */
export function drawMark(canvas: HTMLCanvasElement, background: string | null) {
  const ctx = canvas.getContext('2d')!;
  const arabic = Math.max(13, Math.round(Math.min(canvas.width, canvas.height) * 0.026));
  const mono = Math.max(7, Math.round(arabic * 0.42));
  const spacing = mono * 0.18;
  const gap = arabic * 0.35;
  const margin = Math.round(arabic * 1.1);
  const light = background ? isLight(background) : false;

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.direction = 'ltr';
  ctx.fillStyle = light ? 'rgba(26, 22, 18, 0.7)' : 'rgba(236, 231, 247, 0.75)';
  const baseline = canvas.height - margin;

  // Laid out from the right edge: HARFOUZ, then حرفوز, then MADE WITH.
  ctx.font = `500 ${mono}px ${MARK_MONO}`;
  const nameX = canvas.width - margin - spacedWidth(ctx, 'HARFOUZ', spacing);
  drawSpaced(ctx, 'HARFOUZ', nameX, baseline, spacing);
  ctx.font = `${arabic}px ${MARK_ARABIC}`;
  const arX = nameX - gap - ctx.measureText('حرفوز').width;
  ctx.fillText('حرفوز', arX, baseline);
  ctx.font = `500 ${mono}px ${MARK_MONO}`;
  drawSpaced(ctx, 'MADE WITH', arX - gap - spacedWidth(ctx, 'MADE WITH', spacing), baseline, spacing);
  ctx.restore();
}
