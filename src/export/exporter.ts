import { zipSync } from 'fflate';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import {
  BufferTarget,
  CanvasSource,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
  type VideoCodec,
} from 'mediabunny';
import type { ExportFormat } from './formats';

/** What the exporter needs from the app: pictures of the artwork. */
export interface FrameSource {
  /**
   * Draw the artwork at time `t` (in loops, 0 → 1) into a new canvas of
   * this size. `background` is a CSS colour, or null for transparent.
   */
  frame(t: number, width: number, height: number, background: string | null): Promise<HTMLCanvasElement>;
  /** The 2D artwork as an SVG document. */
  svg(background: string | null): string;
  /** The 3D word as a binary glTF model. */
  glb(): Promise<ArrayBuffer>;
}

export interface ExportJob {
  format: ExportFormat;
  width: number;
  height: number;
  background: string | null;
  /** Current time, used for still images. */
  t: number;
  /** Animation only. */
  fps: number;
  loops: number;
  loopSeconds: number;
  onProgress: (done: number) => void;
  signal: AbortSignal;
}

const VIDEO_CODECS: Record<string, VideoCodec[]> = {
  mp4: ['avc', 'hevc', 'av1'],
  webm: ['vp9', 'av1', 'vp8'],
};

/** Can this browser encode this video format at this size? */
export async function canExportVideo(formatId: string, width = 1920, height = 1080): Promise<boolean> {
  if (!(formatId in VIDEO_CODECS)) return true;
  if (typeof VideoEncoder === 'undefined') return false;
  return (await getFirstEncodableVideoCodec(VIDEO_CODECS[formatId], { width, height })) !== null;
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(`Could not encode ${type}`))), type, quality),
  );
}

const checkCancel = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
};

/** Make the file. */
export async function runExport(source: FrameSource, job: ExportJob): Promise<Blob> {
  const { format, width, height, signal } = job;
  // Formats without transparency get a background no matter what.
  const background = format.alpha ? job.background : (job.background ?? '#ffffff');

  switch (format.id) {
    case 'png':
    case 'jpg':
    case 'webp': {
      const canvas = await source.frame(job.t, width, height, background);
      const type = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[format.id]!;
      return canvasBlob(canvas, type, 0.95);
    }
    case 'svg':
      return new Blob([source.svg(background)], { type: 'image/svg+xml' });
    case 'glb':
      return new Blob([await source.glb()], { type: 'model/gltf-binary' });
  }

  // Animations: one frame at each exact moment of the loop(s).
  const total = Math.max(1, Math.round(job.loopSeconds * job.loops * job.fps));
  const timeAt = (i: number) => ((i / job.fps / job.loopSeconds) % 1 + 1) % 1;

  if (format.id === 'gif') {
    const gif = GIFEncoder();
    const delay = Math.round(1000 / job.fps);
    for (let i = 0; i < total; i++) {
      checkCancel(signal);
      const canvas = await source.frame(timeAt(i), width, height, background);
      const { data } = canvas.getContext('2d')!.getImageData(0, 0, width, height);
      const palette = quantize(data, 256);
      gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay, repeat: 0 });
      job.onProgress((i + 1) / total);
    }
    gif.finish();
    return new Blob([gif.bytes().slice()], { type: 'image/gif' });
  }

  if (format.id === 'png-sequence') {
    const files: Record<string, Uint8Array> = {};
    const digits = String(total).length;
    for (let i = 0; i < total; i++) {
      checkCancel(signal);
      const canvas = await source.frame(timeAt(i), width, height, background);
      const png = new Uint8Array(await (await canvasBlob(canvas, 'image/png')).arrayBuffer());
      files[`frame_${String(i + 1).padStart(Math.max(4, digits), '0')}.png`] = png;
      job.onProgress((i + 1) / total);
    }
    // PNGs are already compressed: store them as they are.
    return new Blob([zipSync(files, { level: 0 }).slice()], { type: 'application/zip' });
  }

  // MP4 / WebM with the browser's own video encoder (WebCodecs).
  const codec = await getFirstEncodableVideoCodec(VIDEO_CODECS[format.id], { width, height });
  if (!codec) throw new Error(`This browser cannot encode ${format.label}. Try Chrome, Edge or Safari 17+, or export a PNG sequence.`);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const output = new Output({
    format: format.id === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const video = new CanvasSource(canvas, { codec, quality: QUALITY_HIGH });
  output.addVideoTrack(video, { frameRate: job.fps });
  await output.start();
  try {
    for (let i = 0; i < total; i++) {
      checkCancel(signal);
      const frame = await source.frame(timeAt(i), width, height, background);
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(frame, 0, 0);
      await video.add(i / job.fps, 1 / job.fps);
      job.onProgress((i + 1) / total);
    }
    await output.finalize();
  } catch (err) {
    await output.cancel();
    throw err;
  }
  return new Blob([output.target.buffer!], { type: format.id === 'mp4' ? 'video/mp4' : 'video/webm' });
}

/** Hand a file to the user. */
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
