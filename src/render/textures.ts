/**
 * Procedural surface textures, generated in code (no image files).
 *
 * Every texture is a seamless square tile made of:
 * - `height`: a grey relief map (white = raised), used as a bump map in 3D,
 * - `albedo`: colour variations, multiplied with the letter's colour,
 * - `shade`: albedo × lighting of the relief, for flat (2D / SVG) rendering.
 *
 * Tiles wrap at their edges, so they repeat without visible seams.
 */

export const TEXTURES = [
  'grain',
  'fibres',
  'linen',
  'marble',
  'brushed',
  'hammered',
  'stone',
  'terrazzo',
  'zellige',
  'khatam',
  'rock',
  'fur',
  'hair',
  'wool',
  'leopard',
  'zebra',
  'scales',
] as const;
export type TextureId = (typeof TEXTURES)[number];

export const TEXTURE_LABELS: Record<TextureId, string> = {
  grain: 'Paper grain',
  fibres: 'Paper fibres',
  linen: 'Linen (woven canvas)',
  marble: 'Marble veins',
  brushed: 'Brushed metal',
  hammered: 'Hammered metal',
  stone: 'Stone',
  terrazzo: 'Terrazzo',
  zellige: 'Zellige tiles',
  khatam: 'Khatam (8-pointed stars)',
  rock: 'Rough rock',
  fur: 'Short fur',
  hair: 'Long hair',
  wool: 'Wool (curls)',
  leopard: 'Leopard coat',
  zebra: 'Zebra coat',
  scales: 'Reptile scales',
};

/** Textures made of hairs: in 3D they can grow real fur (see `furLength`). */
export const HAIRY: ReadonlySet<TextureId> = new Set(['fur', 'hair', 'wool', 'leopard', 'zebra']);

/** Size of one tile on the letters at 100 %, in thousandths of an em. */
export const TILE_SIZE: Record<TextureId, number> = {
  grain: 180,
  fibres: 420,
  linen: 140,
  marble: 900,
  brushed: 600,
  hammered: 320,
  stone: 520,
  terrazzo: 700,
  zellige: 520,
  khatam: 600,
  rock: 700,
  fur: 260,
  hair: 700,
  wool: 300,
  leopard: 900,
  zebra: 1100,
  scales: 260,
};

export interface TextureTile {
  size: number;
  height: HTMLCanvasElement;
  albedo: HTMLCanvasElement;
  shade: HTMLCanvasElement;
  /**
   * Hairy textures only: one dot per hair, its grey level the hair's length
   * (white = longest). Used to grow fur in 3D.
   */
  hairs?: HTMLCanvasElement;
}

// ── Seamless noise ───────────────────────────────────────

function random(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(x: number, y: number, seed: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise on a lattice that wraps every (px, py) cells: it tiles. */
function tileNoise(u: number, v: number, px: number, py: number, seed: number) {
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const w = (i: number, n: number) => ((i % n) + n) % n;
  const a = hash(w(x0, px), w(y0, py), seed);
  const b = hash(w(x0 + 1, px), w(y0, py), seed);
  const c = hash(w(x0, px), w(y0 + 1, py), seed);
  const d = hash(w(x0 + 1, px), w(y0 + 1, py), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Fractal noise in [0, 1] at tile position (x, y) ∈ [0, 1)², tiling. */
function fbm(x: number, y: number, base: number, octaves: number, seed: number, stretchX = 1, stretchY = 1) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const px = Math.max(1, Math.round(base * stretchX * 2 ** o));
    const py = Math.max(1, Math.round(base * stretchY * 2 ** o));
    sum += amp * tileNoise(x * px, y * py, px, py, seed + o * 31);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

// ── Canvas helpers ───────────────────────────────────────

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/** Draw something nine times so shapes crossing an edge reappear on the other side. */
function drawWrapped(ctx: CanvasRenderingContext2D, size: number, draw: () => void) {
  for (const dx of [-size, 0, size]) {
    for (const dy of [-size, 0, size]) {
      ctx.save();
      ctx.translate(dx, dy);
      draw();
      ctx.restore();
    }
  }
}

type Rgb = [number, number, number];

/**
 * Build a tile from per-pixel functions: height in [0, 1] and an optional
 * albedo colour (each channel in [0, 1]; white = keep the letter's colour).
 */
function build(
  size: number,
  height: (x: number, y: number, i: number) => number,
  albedo: (x: number, y: number, h: number, i: number) => Rgb = (_x, _y, h) => {
    const g = 0.78 + 0.22 * h;
    return [g, g, g];
  },
): TextureTile {
  const hData = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) hData[y * size + x] = height(x / size, y / size, y * size + x);

  const hCanvas = canvas(size);
  const aCanvas = canvas(size);
  const sCanvas = canvas(size);
  const hImg = hCanvas.getContext('2d')!.createImageData(size, size);
  const aImg = aCanvas.getContext('2d')!.createImageData(size, size);
  const sImg = sCanvas.getContext('2d')!.createImageData(size, size);

  // Light from the top left, as in the 3D scene.
  const L = [-0.5, 0.6, 0.62];
  const at = (x: number, y: number) => hData[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const h = hData[i];
      const [r, g, b] = albedo(x / size, y / size, h, i);
      // Normal from the slope of the relief (wrapped, so the tile still tiles).
      const k = 6;
      const nx = (at(x - 1, y) - at(x + 1, y)) * k;
      const ny = (at(x, y + 1) - at(x, y - 1)) * k;
      const len = Math.hypot(nx, ny, 1);
      const light = Math.max(0, (nx * L[0] + ny * L[1] + L[2]) / len) / L[2];
      const shade = Math.min(1.25, 0.35 + 0.65 * light);
      const p = i * 4;
      hImg.data[p] = hImg.data[p + 1] = hImg.data[p + 2] = Math.round(h * 255);
      aImg.data[p] = Math.round(r * 255);
      aImg.data[p + 1] = Math.round(g * 255);
      aImg.data[p + 2] = Math.round(b * 255);
      sImg.data[p] = Math.min(255, Math.round(r * shade * 255));
      sImg.data[p + 1] = Math.min(255, Math.round(g * shade * 255));
      sImg.data[p + 2] = Math.min(255, Math.round(b * shade * 255));
      hImg.data[p + 3] = aImg.data[p + 3] = sImg.data[p + 3] = 255;
    }
  }
  hCanvas.getContext('2d')!.putImageData(hImg, 0, 0);
  aCanvas.getContext('2d')!.putImageData(aImg, 0, 0);
  sCanvas.getContext('2d')!.putImageData(sImg, 0, 0);
  return { size, height: hCanvas, albedo: aCanvas, shade: sCanvas };
}

/** Grey values drawn with the canvas API (strokes, shapes), read back as a height field. */
function drawn(size: number, draw: (ctx: CanvasRenderingContext2D) => void): Float32Array {
  const c = canvas(size);
  const ctx = c.getContext('2d')!;
  draw(ctx);
  const data = ctx.getImageData(0, 0, size, size).data;
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4] / 255;
  return out;
}


// ── Hair, fur and animal coats ───────────────────────────

/**
 * Hairy surfaces: thousands of short strokes combed along a smooth flow
 * field, over a darker undercoat. Coats (leopard, zebra) add their pattern
 * to the colour. Also returns a hair map for growing fur in 3D.
 */
function hairy(id: TextureId, rnd: () => number): TextureTile {
  const long = id === 'hair';
  const curly = id === 'wool';
  const count = long ? 900 : curly ? 1400 : 5200;

  // Direction of the hair at each point: mostly one way, gently swirling.
  const flow = (x: number, y: number) => (long ? 0.15 : 1.2) + (fbm(x, y, 2, 2, 30) - 0.5) * (long ? 1.2 : 2.6);

  const strands = drawn(N, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, N, N);
    ctx.lineCap = 'round';
    for (let k = 0; k < count; k++) {
      const x = rnd() * N;
      const y = rnd() * N;
      const shade = 0.35 + rnd() * 0.65;
      ctx.strokeStyle = `rgba(255,255,255,${shade})`;
      ctx.lineWidth = long ? 0.6 + rnd() * 0.6 : 0.5 + rnd() * 0.8;
      drawWrapped(ctx, N, () => {
        ctx.beginPath();
        ctx.moveTo(x, y);
        if (curly) {
          // A small loop.
          const r = 2 + rnd() * 3;
          const start = rnd() * Math.PI * 2;
          ctx.arc(x, y, r, start, start + Math.PI * (1.2 + rnd()));
        } else {
          // Follow the flow field for a few steps.
          let px = x;
          let py = y;
          const steps = long ? 14 : 4;
          const step = long ? 4.5 : 2 + rnd() * 1.5;
          for (let s = 0; s < steps; s++) {
            const a = flow(px / N, py / N);
            px += Math.cos(a) * step;
            py += Math.sin(a) * step;
            ctx.lineTo(px, py);
          }
        }
        ctx.stroke();
      });
    }
  });

  // Coat patterns, as darkness in [0, 1].
  const coat = (x: number, y: number): number => {
    if (id === 'leopard') {
      // Rosettes: dark broken rings around slightly darker centres.
      const cells = 5;
      let best = Infinity;
      let cx = 0;
      let cy = 0;
      for (let j = -1; j <= cells; j++) {
        for (let i = -1; i <= cells; i++) {
          const wi = ((i % cells) + cells) % cells;
          const wj = ((j % cells) + cells) % cells;
          const px = (i + 0.2 + 0.6 * hash(wi, wj, 40)) / cells;
          const py = (j + 0.2 + 0.6 * hash(wi, wj, 41)) / cells;
          const d = Math.hypot(x - px, y - py) * cells;
          if (d < best) {
            best = d;
            cx = px;
            cy = py;
          }
        }
      }
      const wobble = 0.1 * (fbm(x, y, 8, 2, 42) - 0.5);
      const ring = Math.abs(best + wobble - 0.3);
      const broken = Math.sin(Math.atan2(y - cy, x - cx) * 3 + hash(Math.round(cx * 50), Math.round(cy * 50), 43) * 6) > -0.4;
      if (ring < 0.08 && broken) return 0.85;
      if (best + wobble < 0.24) return 0.35;
      return 0;
    }
    if (id === 'zebra') {
      // Wavy stripes across the coat.
      const v = Math.sin((y * 6 + (fbm(x, y, 2, 3, 44) - 0.5) * 1.6 + Math.sin(x * Math.PI * 2) * 0.15) * Math.PI * 2);
      return v > 0.15 ? 0.9 : 0;
    }
    return 0;
  };

  // One dot per hair, grey = length; a few longer guard hairs.
  const hairCanvas = canvas(N);
  const hctx = hairCanvas.getContext('2d')!;
  hctx.fillStyle = '#000';
  hctx.fillRect(0, 0, N, N);
  const dots = long ? 2600 : curly ? 3000 : 9000;
  for (let k = 0; k < dots; k++) {
    const len = curly ? 0.5 + rnd() * 0.4 : rnd() < 0.08 ? 1 : 0.35 + rnd() * 0.5;
    const g = Math.round(len * 255);
    hctx.fillStyle = `rgb(${g},${g},${g})`;
    hctx.fillRect(Math.floor(rnd() * N), Math.floor(rnd() * N), 1, 1);
  }

  const tile = build(
    N,
    (x, y, i) => 0.2 + 0.55 * strands[i] + 0.25 * fbm(x, y, 8, 2, 45),
    (x, y, h) => {
      const base = 0.62 + 0.38 * h;
      const dark = coat(x, y);
      const g = base * (1 - dark);
      // Coats are warm; plain fur keeps the letter's colour.
      return id === 'leopard' ? [g, g * 0.93, g * 0.82] : [g, g, g];
    },
  );
  tile.hairs = hairCanvas;
  return tile;
}

// ── The textures ─────────────────────────────────────────

const N = 256;

function generate(id: TextureId): TextureTile {
  const rnd = random(TEXTURES.indexOf(id) + 7);
  switch (id) {
    case 'grain':
      return build(N, (x, y) => 0.55 * fbm(x, y, 16, 3, 1) + 0.45 * hash(Math.floor(x * N), Math.floor(y * N), 9));

    case 'fibres': {
      // Soft pulp plus long thin fibres in every direction.
      const fibres = drawn(N, (ctx) => {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, N, N);
        ctx.lineCap = 'round';
        for (let f = 0; f < 220; f++) {
          const x = rnd() * N;
          const y = rnd() * N;
          const a = rnd() * Math.PI * 2;
          const len = 10 + rnd() * 40;
          const bend = (rnd() - 0.5) * 20;
          ctx.strokeStyle = `rgba(255,255,255,${0.25 + rnd() * 0.5})`;
          ctx.lineWidth = 0.6 + rnd() * 0.9;
          drawWrapped(ctx, N, () => {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.quadraticCurveTo(
              x + Math.cos(a) * len * 0.5 - Math.sin(a) * bend,
              y + Math.sin(a) * len * 0.5 + Math.cos(a) * bend,
              x + Math.cos(a) * len,
              y + Math.sin(a) * len,
            );
            ctx.stroke();
          });
        }
      });
      return build(N, (x, y, i) => 0.45 * fbm(x, y, 6, 4, 2) + 0.15 * hash(i, 3, 5) + 0.4 * fibres[i]);
    }

    case 'linen': {
      // Over-under weave: warp threads on even cells, weft on odd ones.
      const threads = 16;
      return build(N, (x, y) => {
        const u = x * threads;
        const v = y * threads;
        const iu = Math.floor(u);
        const iv = Math.floor(v);
        const warp = Math.sin(Math.PI * (u - iu)) ** 0.7;
        const weft = Math.sin(Math.PI * (v - iv)) ** 0.7;
        const over = (iu + iv) % 2 === 0;
        const thread = over ? 0.55 + 0.45 * warp * (0.6 + 0.4 * Math.sin(Math.PI * (v - iv))) : 0.55 + 0.45 * weft * (0.6 + 0.4 * Math.sin(Math.PI * (u - iu)));
        return 0.85 * thread + 0.15 * fbm(x, y, 32, 2, 4, 1, 0.25);
      });
    }

    case 'marble': {
      return build(
        N,
        (x, y) => {
          const turb = fbm(x, y, 3, 5, 6);
          const vein = Math.abs(Math.sin((x + y * 0.6 + turb * 1.8) * Math.PI * 4));
          return 0.75 + 0.25 * vein ** 0.25;
        },
        (x, y) => {
          const turb = fbm(x, y, 3, 5, 6);
          const vein = Math.abs(Math.sin((x + y * 0.6 + turb * 1.8) * Math.PI * 4));
          const v = 0.62 + 0.38 * vein ** 0.18;
          const cloud = 0.92 + 0.08 * fbm(x, y, 4, 3, 7);
          return [v * cloud, v * cloud, v * cloud * 0.99];
        },
      );
    }

    case 'brushed':
      // Long streaks running horizontally.
      return build(N, (x, y) => 0.5 * fbm(x, y, 2, 3, 8, 1, 48) + 0.5 * fbm(x, y, 4, 2, 9, 1, 128), (_x, _y, h) => {
        const g = 0.82 + 0.18 * h;
        return [g, g, g];
      });

    case 'hammered': {
      // Dimples: distance to the nearest of jittered points on a wrapped grid.
      const cells = 7;
      const points: [number, number][] = [];
      for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) points.push([(i + 0.15 + rnd() * 0.7) / cells, (j + 0.15 + rnd() * 0.7) / cells]);
      return build(N, (x, y) => {
        let best = Infinity;
        for (const [px, py] of points) {
          const dx = Math.min(Math.abs(x - px), 1 - Math.abs(x - px));
          const dy = Math.min(Math.abs(y - py), 1 - Math.abs(y - py));
          best = Math.min(best, dx * dx + dy * dy);
        }
        return Math.min(1, Math.sqrt(best) * cells * 1.3) ** 0.6 * 0.9 + 0.1 * fbm(x, y, 8, 2, 10);
      });
    }

    case 'stone':
      return build(
        N,
        (x, y, i) => {
          const speck = hash(i, 11, 12) > 0.985 ? -0.35 : 0;
          return Math.max(0, 0.65 * fbm(x, y, 5, 5, 13) + 0.35 * fbm(x, y, 40, 2, 14) + speck);
        },
        (x, y, h) => {
          const g = 0.7 + 0.3 * h * (0.9 + 0.1 * fbm(x, y, 3, 2, 15));
          return [g, g * 0.99, g * 0.97];
        },
      );

    case 'terrazzo': {
      // Coloured stone chips set in a pale base.
      const chipColors: Rgb[] = [
        [0.75, 0.25, 0.17],
        [0.12, 0.23, 0.37],
        [0.72, 0.54, 0.18],
        [0.18, 0.37, 0.31],
        [0.3, 0.28, 0.26],
        [0.95, 0.93, 0.9],
      ];
      const chipMap = new Int16Array(N * N).fill(-1);
      const chips = drawn(N, (ctx) => {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, N, N);
        for (let k = 0; k < 70; k++) {
          const cx = rnd() * N;
          const cy = rnd() * N;
          const r = 3 + rnd() * 10;
          const sides = 4 + Math.floor(rnd() * 4);
          const rot = rnd() * Math.PI;
          const color = Math.floor(rnd() * chipColors.length);
          ctx.fillStyle = `rgb(${color + 1},${color + 1},${color + 1})`;
          drawWrapped(ctx, N, () => {
            ctx.beginPath();
            for (let s = 0; s < sides; s++) {
              const a = rot + (s / sides) * Math.PI * 2;
              const rr = r * (0.6 + 0.4 * hash(k, s, 3));
              ctx[s ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
            }
            ctx.fill();
          });
        }
      });
      for (let i = 0; i < chips.length; i++) {
        const v = Math.round(chips[i] * 255);
        chipMap[i] = v > 0 && v <= chipColors.length ? v - 1 : -1;
      }
      return build(
        N,
        (x, y, i) => (chipMap[i] >= 0 ? 0.85 : 0.55) + 0.15 * fbm(x, y, 20, 2, 16),
        (_x, _y, _h, i) => {
          const c = chipMap[i];
          if (c < 0) return [0.96, 0.95, 0.92];
          return chipColors[c];
        },
      );
    }

    case 'zellige': {
      // Glazed square tiles with recessed grout; each tile slightly different.
      const tiles = 4;
      return build(
        N,
        (x, y) => {
          const u = (x * tiles) % 1;
          const v = (y * tiles) % 1;
          const edge = Math.min(u, 1 - u, v, 1 - v);
          const grout = edge < 0.04 ? 0 : Math.min(1, (edge - 0.04) * 9);
          const pillow = 0.85 + 0.15 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
          return grout * pillow + 0.05 * fbm(x, y, 12, 2, 17);
        },
        (x, y) => {
          const iu = Math.floor(x * tiles);
          const iv = Math.floor(y * tiles);
          const u = (x * tiles) % 1;
          const v = (y * tiles) % 1;
          if (Math.min(u, 1 - u, v, 1 - v) < 0.04) return [0.72, 0.7, 0.66];
          // Hand-made glaze: each tile a little lighter or darker, with pooling.
          const glaze = 0.78 + 0.22 * hash(iu, iv, 18) - 0.08 * fbm(x, y, 8, 3, 19);
          return [glaze, glaze, glaze];
        },
      );
    }

    case 'khatam': {
      // 8-pointed stars (two overlapping squares) engraved in a grid.
      const lines = drawn(N, (ctx) => {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, N, N);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = N / 64;
        ctx.lineJoin = 'miter';
        const cell = N / 2;
        const star = (cx: number, cy: number, r: number) => {
          for (const rot of [0, Math.PI / 4]) {
            ctx.beginPath();
            for (let s = 0; s < 4; s++) {
              const a = rot + Math.PI / 4 + (s * Math.PI) / 2;
              ctx[s ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
            }
            ctx.closePath();
            ctx.stroke();
          }
        };
        drawWrapped(ctx, N, () => {
          for (let j = 0; j <= 2; j++) {
            for (let i = 0; i <= 2; i++) {
              star(i * cell, j * cell, cell * 0.42);
              star((i + 0.5) * cell, (j + 0.5) * cell, cell * 0.3);
            }
          }
          // Connecting grid between the stars.
          ctx.beginPath();
          for (let k = 0; k <= 4; k++) {
            ctx.moveTo((k * cell) / 2, 0);
            ctx.lineTo((k * cell) / 2, N);
          }
          ctx.globalAlpha = 0.35;
          ctx.stroke();
          ctx.globalAlpha = 1;
        });
      });
      return build(
        N,
        (x, y, i) => 0.15 + 0.85 * lines[i] - 0.05 * fbm(x, y, 16, 2, 20),
        (_x, _y, h) => {
          const g = h < 0.5 ? 0.55 + 0.4 * h : 0.92 + 0.08 * h;
          return [g, g, g];
        },
      );
    }

    case 'rock': {
      // Ridged, craggy relief with dark cracks.
      return build(
        N,
        (x, y) => {
          const ridged = 1 - Math.abs(fbm(x, y, 4, 5, 21) * 2 - 1);
          const crack = Math.abs(fbm(x, y, 3, 4, 22) - 0.5) < 0.012 ? -0.5 : 0;
          return Math.max(0, 0.75 * ridged ** 1.5 + 0.25 * fbm(x, y, 32, 2, 23) + crack);
        },
        (x, y, h) => {
          const g = 0.55 + 0.45 * h * (0.85 + 0.15 * fbm(x, y, 2, 2, 24));
          return [g, g * 0.98, g * 0.95];
        },
      );
    }

    case 'fur':
    case 'hair':
    case 'wool':
    case 'leopard':
    case 'zebra':
      return hairy(id, rnd);

    case 'scales': {
      // Overlapping scales: raised rounded cells with dark seams, offset rows.
      const rows = 8;
      const cols = 6;
      const centres: [number, number][] = [];
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) centres.push([(i + (j % 2) * 0.5) / cols, (j + 0.5) / rows]);
      }
      const cell = (x: number, y: number) => {
        let best = Infinity;
        let second = Infinity;
        for (const [cx, cy] of centres) {
          // Scales are slightly taller than wide, and overlap downwards.
          const dx = Math.min(Math.abs(x - cx), 1 - Math.abs(x - cx)) * cols;
          let dy = (y - cy) * rows;
          dy -= Math.round(dy / rows) * rows;
          const d = Math.hypot(dx, dy * (dy > 0 ? 0.8 : 1.3));
          if (d < best) {
            second = best;
            best = d;
          } else if (d < second) second = d;
        }
        return { best, edge: second - best };
      };
      return build(
        N,
        (x, y) => {
          const { best, edge } = cell(x, y);
          return Math.min(1, edge * 4) * (1 - 0.6 * best) + 0.05 * fbm(x, y, 24, 2, 25);
        },
        (x, y) => {
          const { edge } = cell(x, y);
          const g = edge < 0.06 ? 0.35 : 0.8 + 0.2 * fbm(x, y, 6, 2, 26);
          return [g, g, g * 0.96];
        },
      );
    }
  }
}

const tiles = new Map<TextureId, TextureTile>();

/** The tile for a texture, generated once and then reused. */
export function textureTile(id: TextureId): TextureTile {
  let tile = tiles.get(id);
  if (!tile) {
    tile = generate(id);
    tiles.set(id, tile);
  }
  return tile;
}

const shadeUrls = new Map<TextureId, string>();

/** The flat (2D) version of a tile as a compact data URL, for SVG filters. */
export function shadeDataUrl(id: TextureId): string {
  let url = shadeUrls.get(id);
  if (!url) {
    url = textureTile(id).shade.toDataURL('image/jpeg', 0.88);
    shadeUrls.set(id, url);
  }
  return url;
}
