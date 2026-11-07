import {
  CanvasTexture,
  Color,
  LineBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NearestFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Material,
} from 'three';
import type { MaterialId } from '../../params/schema';
import type { TextureChoice } from '../look';
import { textureTile, TILE_SIZE, type TextureId } from '../textures';

/**
 * Number of stacked layers used to draw fur of this length (font units):
 * enough for the layers to blend into hairs, without wasting work on short fur.
 */
export function furLayers(length: number): number {
  return Math.round(Math.min(36, Math.max(12, length / 4)));
}

/**
 * Builds and caches materials. A material depends on its preset, colour
 * (null = the geometry's vertex colours, for gradients) and texture.
 */
export class MaterialLibrary {
  private cache = new Map<string, Material>();
  private maps = new Map<string, CanvasTexture>();

  /**
   * A texture map, tiled at the texture's natural size × `scale`.
   * Extruded letters use font units as UV coordinates, hence `unitsPerEm`.
   */
  private map(id: TextureId, kind: 'albedo' | 'height' | 'hairs', scale: number, unitsPerEm: number, strength = 1) {
    const key = `${id}|${kind}|${scale}|${unitsPerEm}|${strength}`;
    let texture = this.maps.get(key);
    if (!texture) {
      const tile = textureTile(id);
      let source = tile[kind] ?? tile.height;
      if (kind === 'albedo' && strength < 1) {
        // Weaker texture: fade the colour pattern towards white.
        const faded = document.createElement('canvas');
        faded.width = faded.height = source.width;
        const ctx = faded.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, faded.width, faded.height);
        ctx.globalAlpha = strength;
        ctx.drawImage(source, 0, 0);
        source = faded;
      }
      texture = new CanvasTexture(source);
      texture.wrapS = texture.wrapT = RepeatWrapping;
      // Hairs keep the same fine density whatever the size of the coat
      // pattern (a leopard's spots are large, its hairs are not).
      const tileUnits = ((kind === 'hairs' ? TILE_SIZE.fur : TILE_SIZE[id]) * unitsPerEm * scale) / 1000;
      texture.repeat.set(1 / tileUnits, 1 / tileUnits);
      if (kind === 'albedo') texture.colorSpace = SRGBColorSpace;
      if (kind === 'hairs') {
        // One pixel per hair: keep them crisp, never averaged away.
        texture.magFilter = texture.minFilter = NearestFilter;
        texture.generateMipmaps = false;
      }
      this.maps.set(key, texture);
    }
    return texture;
  }

  get(id: MaterialId, color: string | null, texture: TextureChoice | null, unitsPerEm: number): Material {
    const key = `${id}|${color}|${texture ? `${texture.id}|${texture.strength}|${texture.scale}` : '-'}|${unitsPerEm}`;
    let material = this.cache.get(key);
    if (!material) {
      material = this.create(id, color, texture, unitsPerEm);
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

  /**
   * One layer of fur. Layers are copies of the letter pushed outwards along
   * the surface; each keeps only the hairs long enough to reach it, so hairs
   * thin out towards their tips. Long hair also droops under gravity.
   *
   * `layer` goes from 0 (skin) to 1 (tips); `length` is in font units.
   */
  fur(color: string | null, texture: TextureChoice, layer: number, length: number, unitsPerEm: number): Material {
    const offset = Math.round(length * layer);
    const key = `fur|${color}|${texture.id}|${texture.scale}|${texture.strength}|${layer.toFixed(3)}|${offset}|${unitsPerEm}`;
    let material = this.cache.get(key);
    if (!material) {
      // Darker at the roots, where less light gets in.
      const shade = 0.5 + 0.5 * layer;
      const m = new MeshStandardMaterial({
        color: new Color(color ?? 0xffffff).multiplyScalar(shade),
        vertexColors: color === null,
        roughness: 0.85,
        metalness: 0,
        map: this.map(texture.id, 'albedo', texture.scale, unitsPerEm, texture.strength),
        alphaMap: this.map(texture.id, 'hairs', texture.scale, unitsPerEm),
        // Hairs shorter than this layer are cut away.
        alphaTest: Math.max(0.02, layer),
      });
      const droop = (texture.id === 'hair' ? 0.7 : 0.15) * length * layer * layer;
      m.onBeforeCompile = (shader) => {
        shader.uniforms.furOffset = { value: offset };
        shader.uniforms.furDroop = { value: droop };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float furOffset;\nuniform float furDroop;')
          .replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\ntransformed += normalize(objectNormal) * furOffset + vec3(0.0, -furDroop, 0.0);',
          );
      };
      // All layers share one compiled shader; only the uniforms differ.
      m.customProgramCacheKey = () => 'harfouz-fur';
      material = m;
      this.cache.set(key, material);
    }
    return material;
  }

  private create(id: MaterialId, color: string | null, texture: TextureChoice | null, unitsPerEm: number): Material {
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
        // A metal's colour is what it reflects: pure black would reflect
        // nothing and hide its shape and texture. Every real metal reflects
        // some light, so dark colours keep a floor, like black chrome.
        material = new MeshStandardMaterial({
          ...base,
          color: base.color.clone().multiplyScalar(1 - METAL_FLOOR).addScalar(METAL_FLOOR),
          roughness: 0.24,
          metalness: 1,
          envMapIntensity: 2.2,
        });
        break;
      case 'glass':
        material = glass(base);
        break;
      case 'satin':
      case 'outline':
      default:
        material = new MeshStandardMaterial({ ...base, roughness: 0.42, metalness: 0 });
    }
    if (texture) {
      const { id: tex, strength, scale } = texture;
      material.map = this.map(tex, 'albedo', scale, unitsPerEm, strength);
      material.bumpMap = this.map(tex, 'height', scale, unitsPerEm);
      material.bumpScale = strength * (tex === 'grain' || tex === 'fibres' ? 6 : 10);
      // Rough surfaces get rougher in the hollows; shiny ones stay shiny.
      if (id !== 'metal' && id !== 'glass') material.roughnessMap = material.bumpMap;
    }
    return material;
  }

  dispose() {
    for (const m of this.cache.values()) m.dispose();
    for (const t of this.maps.values()) t.dispose();
    this.cache.clear();
    this.maps.clear();
  }
}

/** Least a metal reflects (linear), so black metal still shows its shape and texture. */
const METAL_FLOOR = 0.14;

/**
 * Glass. Physical transmission only refracts other objects, and there is
 * nothing behind the word but the page, so glass is drawn see-through
 * instead, the way glass actually reads: almost clear where you look
 * straight through it, more and more reflective towards the edges, where
 * light grazes it (the Fresnel effect), and as bright as its reflections
 * wherever it catches a light. Each letter keeps one clean surface (no
 * stacked inner faces), so joins and overlaps don't show as cloudy patches.
 */
function glass(base: { color: Color; vertexColors: boolean }): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial({
    ...base,
    roughness: 0.03,
    metalness: 0,
    transparent: true,
    opacity: GLASS_CLEAR,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    specularIntensity: 1,
    ior: 1.5,
    envMapIntensity: 3.2,
  });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
      float glassFacing = abs(dot(normalize(normal), normalize(vViewPosition)));
      float glassEdge = pow(1.0 - glassFacing, 3.0);
      vec3 glassSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
      float glassShine = max(max(glassSpecular.r, glassSpecular.g), glassSpecular.b);
      gl_FragColor.a = clamp(opacity + glassEdge * 0.3 + glassShine * 1.3, 0.0, 1.0);`,
    );
  };
  m.customProgramCacheKey = () => 'harfouz-glass';
  return m;
}

/** How opaque glass is where you look straight through it. */
const GLASS_CLEAR = 0.08;
