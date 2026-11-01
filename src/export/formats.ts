/**
 * Every export format, with what it can do. The export panel is built from
 * this list.
 */

export type ExportKind = 'image' | 'animation';
export type ViewMode = '2d' | '3d';

export interface ExportFormat {
  id: string;
  label: string;
  kind: ExportKind;
  extension: string;
  /** Views it can be made from. */
  modes: ViewMode[];
  /** Can keep a transparent background. */
  alpha: boolean;
  /** Short explanation shown under the format menu. */
  note: string;
}

export const FORMATS: ExportFormat[] = [
  { id: 'png', label: 'PNG', kind: 'image', extension: 'png', modes: ['2d', '3d'], alpha: true,
    note: 'Sharp image, keeps transparency.' },
  { id: 'jpg', label: 'JPG', kind: 'image', extension: 'jpg', modes: ['2d', '3d'], alpha: false,
    note: 'Light image for sharing; no transparency.' },
  { id: 'webp', label: 'WebP', kind: 'image', extension: 'webp', modes: ['2d', '3d'], alpha: true,
    note: 'Light image for the web, keeps transparency.' },
  { id: 'svg', label: 'SVG (vector)', kind: 'image', extension: 'svg', modes: ['2d'], alpha: true,
    note: 'Vector file for Illustrator, Figma, Inkscape or print. Letters are outlines.' },
  { id: 'glb', label: 'GLB (3D model)', kind: 'image', extension: 'glb', modes: ['3d'], alpha: true,
    note: 'The 3D word as a model, with its materials, for Blender, Cinema 4D, After Effects, three.js…' },
  { id: 'mp4', label: 'MP4 video', kind: 'animation', extension: 'mp4', modes: ['2d', '3d'], alpha: false,
    note: 'Plays everywhere (phones, social networks, editing software).' },
  { id: 'webm', label: 'WebM video', kind: 'animation', extension: 'webm', modes: ['2d', '3d'], alpha: false,
    note: 'Open video format for the web.' },
  { id: 'gif', label: 'Animated GIF', kind: 'animation', extension: 'gif', modes: ['2d', '3d'], alpha: false,
    note: 'Loops everywhere; limited to 256 colours and kept under 720 px for a reasonable file size.' },
  { id: 'png-sequence', label: 'PNG sequence (ZIP)', kind: 'animation', extension: 'zip', modes: ['2d', '3d'], alpha: true,
    note: 'One PNG per frame, with transparency: for compositing in After Effects, Premiere, DaVinci, Blender…' },
];

export interface ExportSize {
  id: string;
  label: string;
  /** null: use the artwork's current size (× 2 for sharpness). */
  width: number | null;
  height: number | null;
}

export const SIZES: ExportSize[] = [
  { id: 'view', label: 'Same as the view (×2)', width: null, height: null },
  { id: 'square', label: 'Square 1080 × 1080', width: 1080, height: 1080 },
  { id: 'landscape', label: 'Landscape 1920 × 1080 (HD)', width: 1920, height: 1080 },
  { id: 'portrait', label: 'Portrait 1080 × 1920 (stories)', width: 1080, height: 1920 },
  { id: '4k', label: 'Landscape 3840 × 2160 (4K)', width: 3840, height: 2160 },
];

/** Video encoders want even dimensions; GIFs are kept small. */
export function finalSize(format: ExportFormat, width: number, height: number): [number, number] {
  let w = width;
  let h = height;
  if (format.id === 'gif') {
    const scale = Math.min(1, 720 / Math.max(w, h));
    w *= scale;
    h *= scale;
  }
  w = Math.max(2, Math.round(w));
  h = Math.max(2, Math.round(h));
  if (format.kind === 'animation') {
    w -= w % 2;
    h -= h % 2;
  }
  return [w, h];
}
