import {
  CanvasTexture,
  Color,
  LineBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  type Material,
} from 'three';
import type { MaterialId } from '../../params/schema';

/**
 * Seamless value-noise texture used as a bump map for paper and grain.
 * Generated once, no image file needed.
 */
function createGrainTexture(size = 256): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  let seed = 1234567;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Two octaves: fine fibres plus a few softer blotches.
  const coarse = Array.from({ length: 32 * 32 }, random);
  const at = (x: number, y: number) => coarse[((y + 32) % 32) * 32 + ((x + 32) % 32)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = (x / size) * 32;
      const cy = (y / size) * 32;
      const ix = Math.floor(cx);
      const iy = Math.floor(cy);
      const fx = cx - ix;
      const fy = cy - iy;
      const blotch =
        at(ix, iy) * (1 - fx) * (1 - fy) + at(ix + 1, iy) * fx * (1 - fy) + at(ix, iy + 1) * (1 - fx) * fy + at(ix + 1, iy + 1) * fx * fy;
      const v = Math.round((random() * 0.65 + blotch * 0.35) * 255);
      const i = (y * size + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  // Extruded geometry uses font units as UVs: one tile every ~180 units.
  texture.repeat.set(1 / 180, 1 / 180);
  return texture;
}

/**
 * Builds and caches one material per (preset, colour, grain) combination.
 * `color` null means "use the geometry's vertex colours" (gradient mode).
 */
export class MaterialLibrary {
  private cache = new Map<string, Material>();
  private grain?: CanvasTexture;

  get(id: MaterialId, color: string | null, grain: number): Material {
    const key = `${id}|${color}|${grain.toFixed(2)}`;
    let material = this.cache.get(key);
    if (!material) {
      material = this.create(id, color, grain);
      this.cache.set(key, material);
    }
    return material;
  }

  /** Line material for the "outline only" preset. */
  line(color: string | null): LineBasicMaterial {
    const key = `line|${color}`;
    let material = this.cache.get(key) as LineBasicMaterial | undefined;
    if (!material) {
      material = new LineBasicMaterial({ color: color ?? 0xffffff, vertexColors: color === null });
      this.cache.set(key, material);
    }
    return material;
  }

  private create(id: MaterialId, color: string | null, grain: number): Material {
    const base = {
      color: new Color(color ?? 0xffffff),
      vertexColors: color === null,
    };
    let material: MeshStandardMaterial;
    switch (id) {
      case 'clay':
        material = new MeshStandardMaterial({ ...base, roughness: 0.95, metalness: 0 });
        break;
      case 'paper':
        material = new MeshStandardMaterial({ ...base, roughness: 1, metalness: 0 });
        break;
      case 'metal':
        material = new MeshStandardMaterial({ ...base, roughness: 0.24, metalness: 1, envMapIntensity: 2.2 });
        break;
      case 'glass':
        // Physical transmission only refracts other objects, and the scene behind
        // the word is empty, so a classic transparent glass with a clear coat
        // reads much better here.
        material = new MeshPhysicalMaterial({
          ...base,
          roughness: 0.05,
          metalness: 0,
          transparent: true,
          opacity: 0.38,
          depthWrite: false,
          clearcoat: 1,
          clearcoatRoughness: 0.04,
          specularIntensity: 1,
          envMapIntensity: 2.4,
        });
        break;
      case 'satin':
      case 'outline':
      default:
        material = new MeshStandardMaterial({ ...base, roughness: 0.42, metalness: 0 });
    }
    if (grain > 0) {
      this.grain ??= createGrainTexture();
      material.bumpMap = this.grain;
      material.bumpScale = grain * 6;
      if (id !== 'metal' && id !== 'glass') material.roughnessMap = this.grain;
    }
    return material;
  }

  dispose() {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
    this.grain?.dispose();
  }
}
