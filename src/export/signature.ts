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
 * Draw "MADE WITH حرفوز HARFOUZ" in the bottom corner of a frame, like the
 * site's logo: the Arabic name in metallic violet with a little extrusion,
 * the Latin words in spaced monospace capitals, light or dark to suit the
 * background. Call prepareMark() once before, so the logo's face is loaded.
 */
export function drawMark(canvas: HTMLCanvasElement, background: string | null) {
  const ctx = canvas.getContext('2d')!;
  const arabic = Math.max(18, Math.round(Math.min(canvas.width, canvas.height) * 0.05));
  const mono = Math.max(8, Math.round(arabic * 0.36));
  const spacing = mono * 0.18;
  const gap = arabic * 0.32;
  const margin = Math.round(arabic * 0.7);
  const light = background ? isLight(background) : false;
  const latin = light ? 'rgba(26, 22, 18, 0.78)' : 'rgba(236, 231, 247, 0.88)';

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.direction = 'ltr';
  const baseline = canvas.height - margin;

  // Measure the three parts, laid out from the right edge.
  ctx.font = `500 ${mono}px ${MARK_MONO}`;
  const made = 'MADE WITH';
  const name = 'HARFOUZ';
  const madeW = spacedWidth(ctx, made, spacing);
  const nameW = spacedWidth(ctx, name, spacing);
  ctx.font = `${arabic}px ${MARK_ARABIC}`;
  const ar = ctx.measureText('حرفوز');
  const nameX = canvas.width - margin - nameW;
  const arX = nameX - gap - ar.width;
  const madeX = arX - gap - madeW;

  // حرفوز: extrusion (three violet layers, deepest first), shadow and glow, then the chrome face.
  const depth = Math.max(1, arabic * 0.035);
  const layers = ['#2f0f68', '#44198f', '#5a24b8'];
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = arabic * 0.12;
  ctx.shadowOffsetY = depth * 2;
  layers.forEach((color, k) => {
    ctx.fillStyle = color;
    ctx.fillText('حرفوز', arX, baseline + depth * (layers.length - k));
    ctx.shadowColor = 'transparent';
  });
  ctx.shadowColor = 'rgba(166, 107, 255, 0.35)';
  ctx.shadowBlur = arabic * 0.3;
  ctx.shadowOffsetY = 0;
  const top = baseline - ar.actualBoundingBoxAscent;
  const bottom = baseline + ar.actualBoundingBoxDescent;
  const chrome = ctx.createLinearGradient(0, top, 0, bottom);
  for (const [pos, color] of [
    [0, '#faf5ff'], [0.24, '#d9bcff'], [0.47, '#9a5cff'], [0.52, '#3d1585'], [0.66, '#b98aff'], [0.84, '#efe2ff'], [1, '#8a4df0'],
  ] as const) chrome.addColorStop(pos, color);
  ctx.fillStyle = chrome;
  ctx.fillText('حرفوز', arX, baseline);

  // The Latin words, on the same baseline.
  ctx.shadowColor = 'transparent';
  ctx.font = `500 ${mono}px ${MARK_MONO}`;
  ctx.fillStyle = latin;
  drawSpaced(ctx, made, madeX, baseline, spacing);
  drawSpaced(ctx, name, nameX, baseline, spacing);
  ctx.restore();
}
