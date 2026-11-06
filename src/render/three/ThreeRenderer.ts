import {
  ACESFilmicToneMapping,
  Box3,
  Box3Helper,
  BufferAttribute,
  Color,
  DirectionalLight,
  EdgesGeometry,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  LineSegments,
  Mesh,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Raycaster,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Object3D,
  type Shape,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { TATWEEL_CHAR } from '../../core/joining';
import type { Composition } from '../../core/types';
import { inkOf, letterFill, parseGradient, resolveColor, textureOf } from '../look';
import { HAIRY } from '../textures';
import type { Params } from '../../params/schema';
import type { Renderer, RenderInput } from '../Renderer';
import { outlinesToShapes } from './contours';
import { bridgeConnectors, deformGeometry, findJunctions, fitJoins, frameMatrix, letterSpans, type LetterFrame } from './deform';
import { furLayers, MaterialLibrary } from './materials';

/** Where the camera looks from by default: a little to the left and above. */
const DEFAULT_VIEW = new Vector3(-0.38, 0.22, 1).normalize();

/** Glyph shapes grouped by the letter they belong to, in reading order. */
export function shapesByLetter(comp: Composition): { letter: number; shapes: Shape[] }[] {
  const byLetter = new Map<number, Shape[]>();
  for (const g of comp.glyphs) {
    const shapes = outlinesToShapes(g.commands, comp.unitsPerEm);
    byLetter.set(g.letter, [...(byLetter.get(g.letter) ?? []), ...shapes]);
  }
  return [...byLetter.entries()].sort(([a], [b]) => a - b).map(([letter, shapes]) => ({ letter, shapes }));
}

/** A box in the plane of the letters (font units, y up). */
interface Box2 {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** A gradient ready to paint: stops as three.js colours, and a direction. */
interface PaintableGradient {
  stops: { pos: number; color: Color }[];
  /** Unit direction in the plane of the letters (font units, y up). */
  dx: number;
  dy: number;
  /** Range of `x·dx + y·dy` over the owner's box, mapped to 0 → 1. */
  min: number;
  max: number;
  /** Optional limits on the position (0 → 1), e.g. a diacritic kept within its letter's colours. */
  clamp?: [number, number];
}

const corners = (b: Box2) => [
  [b.minX, b.minY],
  [b.maxX, b.minY],
  [b.minX, b.maxY],
  [b.maxX, b.maxY],
];

function prepareGradient(box: Box2, value: string, angleDeg: number, ink: string): PaintableGradient {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  // Project the corners of the box: the gradient spans exactly that box.
  const projected = corners(box).map(([x, y]) => x * dx + y * dy);
  return {
    stops: parseGradient(value).map((s) => ({ pos: s.pos, color: new Color(resolveColor(s.color, ink)) })),
    dx,
    dy,
    min: Math.min(...projected),
    max: Math.max(...projected),
  };
}

/** The same gradient, limited to the part of it that falls on `box`. */
function clampedTo(g: PaintableGradient, box: Box2): PaintableGradient {
  const span = Math.max(g.max - g.min, 1e-6);
  const ts = corners(box).map(([x, y]) => (x * g.dx + y * g.dy - g.min) / span);
  return { ...g, clamp: [Math.min(...ts), Math.max(...ts)] };
}

/**
 * Colour each vertex by its position along the gradient's direction,
 * blending between the two stops around it. Painted before letters are
 * moved in 3D, so a letter keeps the colour of its place in the word.
 */
function paintGradient(geometry: BufferGeometry, g: PaintableGradient) {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const c = new Color();
  const span = Math.max(g.max - g.min, 1e-6);
  const last = g.stops[g.stops.length - 1];
  for (let i = 0; i < position.count; i++) {
    let t = (position.getX(i) * g.dx + position.getY(i) * g.dy - g.min) / span;
    if (g.clamp) t = Math.min(g.clamp[1], Math.max(g.clamp[0], t));
    if (t <= g.stops[0].pos) c.copy(g.stops[0].color);
    else if (t >= last.pos) c.copy(last.color);
    else {
      let k = 1;
      while (g.stops[k].pos < t) k++;
      const from = g.stops[k - 1];
      const to = g.stops[k];
      c.lerpColors(from.color, to.color, to.pos === from.pos ? 0 : (t - from.pos) / (to.pos - from.pos));
    }
    c.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
}

/**
 * Draws the composition as extruded volumes in a 3D scene.
 *
 * Units: the whole word is scaled so that 1 em = 1 world unit.
 * Each letter is its own mesh, so it can later get its own material,
 * colour or motion.
 */
export class ThreeRenderer implements Renderer {
  private renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  private scene = new Scene();
  private camera = new PerspectiveCamera(32, 1, 0.01, 100);
  private controls = new OrbitControls(this.camera, this.renderer.domElement);
  private word = new Group();
  /** Parent of the word, turned by the Spin setting. */
  private turntable = new Group();
  /** Extruded volumes from the previous frame, reused while their shape is unchanged. */
  private volumes = new Map<number, { geometry: ExtrudeGeometry; pivotY: number }>();
  private volumesKey = '';
  private junctionCache: ReturnType<typeof findJunctions> = [];
  private materials = new MaterialLibrary();
  private ground = new Mesh(new PlaneGeometry(1, 1), new ShadowMaterial({ opacity: 0.18 }));
  private key = new DirectionalLight(0xffffff, 2.4);
  private container?: HTMLElement;
  private resizeObserver = new ResizeObserver(() => this.resize());
  private needsFraming = true;
  private selection = new Box3Helper(new Box3(), 0xa66bff);
  private raycaster = new Raycaster();
  onPick?: (letter: number | null) => void;

  constructor() {
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.outputColorSpace = SRGBColorSpace;
    r.toneMapping = ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = PCFSoftShadowMap;
    r.setClearColor(0x000000, 0);
    r.domElement.className = 'three-canvas';

    // Soft studio reflections, useful for the material presets.
    const pmrem = new PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;

    this.scene.add(new HemisphereLight(0xffffff, 0x444444, 0.6));
    this.key.position.set(-2, 4, 3);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0005;
    this.key.shadow.radius = 6;
    this.scene.add(this.key, this.key.target);

    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.turntable.add(this.word);
    this.scene.add(this.ground, this.turntable, this.selection);
    this.selection.visible = false;

    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 30;
  }

  mount(container: HTMLElement) {
    this.container = container;
    container.appendChild(this.renderer.domElement);
    this.resizeObserver.observe(container);
    this.resize();
    this.listenForPicks(this.renderer.domElement);
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** A click (not a drag) on a letter selects it; on empty space, the whole word. */
  private listenForPicks(canvas: HTMLCanvasElement) {
    let down: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const rect = canvas.getBoundingClientRect();
      const ndc = new Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this.raycaster.setFromCamera(ndc, this.camera);
      const hit = this.raycaster.intersectObjects(this.word.children, true)[0];
      this.onPick?.(hit ? (hit.object.userData.letter as number) : null);
    });
  }

  /** Re-centre the camera on the word at the next render (new text or font). */
  frameNextRender() {
    this.needsFraming = true;
  }

  render({ composition: comp, word, letter, order: readingOrder, gradientOwner, selected, geometryKey }: RenderInput) {
    const em = comp.unitsPerEm;
    const perMille = em / 1000;
    const rad = Math.PI / 180;

    const ink = inkOf(this.container ?? document.body);
    // Gradients span the shape of the element that defines them: the word,
    // a letter, or a diacritic. A diacritic following a gradient defined by
    // its letter or the word keeps to its letter's part of it.
    const wordBox: Box2 = { minX: 0, maxX: comp.width, minY: comp.descender, maxY: comp.ascender };
    const boxOf = (index: number | null): Box2 => {
      const b = index === null ? null : this.volumes.get(index)?.geometry.boundingBox;
      return b ? { minX: b.min.x, maxX: b.max.x, minY: b.min.y, maxY: b.max.y } : wordBox;
    };
    const baseOfGlyph = new Map(comp.glyphs.map((g) => [g.letter, g.base]));
    const gradientFor = (index: number, p: Params): PaintableGradient => {
      const owner = gradientOwner(index);
      const g = prepareGradient(boxOf(owner), p.gradient, p.gradientAngle, ink);
      const base = baseOfGlyph.get(index) ?? index;
      return base !== index && owner !== index ? clampedTo(g, boxOf(base)) : g;
    };
    this.clearWord();

    // 1. Every letter's volume. Extruding is the slow part, so volumes are
    //    kept between frames while nothing that shapes them has changed
    //    (e.g. while only placement settings are animated).
    const reuse = geometryKey !== undefined && geometryKey === this.volumesKey;
    if (!reuse) {
      for (const v of this.volumes.values()) v.geometry.dispose();
      this.volumes.clear();
      for (const { letter: index, shapes } of shapesByLetter(comp)) {
        if (!shapes.length) continue;
        const p = letter(index);
        const depth = Math.max(1, p.depth * perMille);
        // Thinner strokes get a proportionally smaller bevel, or it would
        // fold over strokes narrower than itself.
        const thinning = p.weight < 0 ? 1 + p.weight / 100 : 1;
        const bevel = Math.min(p.bevel * perMille * thinning, depth / 2);
        // Weight is already in the outlines (modifiers/weight.ts).
        const geometry = new ExtrudeGeometry(shapes, {
          depth,
          curveSegments: 10,
          bevelEnabled: bevel > 0,
          bevelThickness: bevel,
          bevelSize: bevel,
          // Shrink the cap by the bevel so the silhouette keeps its drawn size.
          bevelOffset: -bevel,
          bevelSegments: bevel > 0 ? 4 : 1,
        });
        // Centre the thickness on z = 0 so letters of different depths line up.
        geometry.translate(0, 0, -depth / 2);
        geometry.computeBoundingBox();
        this.volumes.set(index, { geometry, pivotY: geometry.boundingBox!.getCenter(new Vector3()).y });
      }
      this.junctionCache = findJunctions(comp);
      this.volumesKey = geometryKey ?? '';
    }

    // Each letter's own placement (a rigid transform).
    const spans = letterSpans(comp);
    const middle = (spans.length - 1) / 2;
    const built = new Map<number, BufferGeometry>();
    const frames = new Map<number, LetterFrame>();
    spans.forEach((span, order) => {
      const index = span.letter;
      const p = letter(index);
      const volume = this.volumes.get(index);
      const pivot = new Vector3((span.start + span.end) / 2, volume?.pivotY ?? (comp.ascender + comp.descender) / 2, 0);
      if (volume) built.set(index, volume.geometry.clone());
      // Stagger and twist are measured from the middle letter so the word stays centred;
      // push, shift, lift, turn and tilt are this letter's own placement.
      const rank = order - middle;
      frames.set(index, {
        letter: index,
        pivot,
        offset: new Vector3(p.shift * perMille, p.lift * perMille, -rank * word.stagger * perMille + p.push * perMille),
        turn: (rank * word.twist + p.turn) * rad,
        tilt: p.tilt * rad,
      });
    });

    // Typed tatweels are connecting strokes: they sit between their neighbours.
    const glyphsOf = new Map<number, string[]>();
    for (const g of comp.glyphs) glyphsOf.set(g.letter, [...(glyphsOf.get(g.letter) ?? []), comp.text[g.cluster]]);
    bridgeConnectors(
      spans.map((s) => s.letter),
      frames,
      (index) => glyphsOf.get(index)?.every((c) => c === TATWEEL_CHAR) ?? false,
      (index) => {
        const p = letter(index);
        return {
          offset: new Vector3(p.shift - word.shift, p.lift - word.lift, p.push - word.push).multiplyScalar(perMille),
          turn: (p.turn - word.turn) * rad,
          tilt: (p.tilt - word.tilt) * rad,
        };
      },
    );

    // Diacritics have their own volume. They move with their letter, plus
    // their own extra placement (shift, lift, push, turn, tilt) around their centre.
    const baseOf = new Map(comp.glyphs.map((g) => [g.letter, g.base]));
    for (const [index, volume] of this.volumes) {
      if (frames.has(index)) continue;
      const baseIndex = baseOf.get(index) ?? index;
      const baseFrame = frames.get(baseIndex);
      if (!baseFrame) continue;
      const p = letter(index);
      const pb = letter(baseIndex);
      const geometry = volume.geometry.clone();
      geometry.computeBoundingBox();
      geometry.applyMatrix4(
        frameMatrix({
          pivot: geometry.boundingBox!.getCenter(new Vector3()),
          offset: new Vector3((p.shift - pb.shift) * perMille, (p.lift - pb.lift) * perMille, (p.push - pb.push) * perMille),
          turn: (p.turn - pb.turn) * rad,
          tilt: (p.tilt - pb.tilt) * rad,
        }),
      );
      frames.set(index, { ...baseFrame, letter: index });
      built.set(index, geometry);
    }

    // 2. Move each letter; around each junction with a connected neighbour the
    //    placements blend, so joins bend instead of breaking.
    const softness = word.joinSoftness * perMille;
    // The further apart two letters are moved, the longer their join sweeps.
    const widths = new Map(spans.map((s) => [s.letter, s.end - s.start]));
    const junctions =
      word.joins === 'keep' ? fitJoins(this.junctionCache, frames, softness, comp.unitsPerEm * 1.2, widths) : [];
    for (const [index, geometry] of built) {
      const p = letter(index);

      // Colour first: the gradient follows the letter's place on the line.
      const fill = letterFill(word, p, readingOrder(index), ink);
      const gradient = fill === 'gradient' ? gradientFor(index, p) : null;
      if (gradient) paintGradient(geometry, gradient);
      const color = fill === 'gradient' ? null : fill;

      deformGeometry(geometry, index, frames, junctions, softness);

      // One group per letter, holding the volume (and its edges for the outline preset).
      const group = new Group();
      group.userData.letter = index;
      const texture = textureOf(p);
      const mesh = new Mesh(geometry, this.materials.get(p.material, color, texture, em));
      mesh.userData.letter = index;
      mesh.receiveShadow = true;
      // Glass and outlines would cast a solid black shadow, which looks wrong.
      mesh.castShadow = p.material !== 'glass' && p.material !== 'outline';
      group.add(mesh);

      // Hairy textures grow fur: layers of the same volume pushed outwards
      // in the shader, each keeping only the hairs that reach it.
      const furLength = p.furLength * perMille;
      if (texture && HAIRY.has(texture.id) && furLength > 0 && p.material !== 'outline' && p.material !== 'glass') {
        const layers = furLayers(furLength);
        for (let i = 1; i <= layers; i++) {
          const layer = new Mesh(geometry, this.materials.fur(color, texture, i / layers, furLength, em));
          layer.userData.letter = index;
          layer.userData.fur = true;
          layer.receiveShadow = true;
          group.add(layer);
        }
      }
      if (p.material === 'outline') {
        // Keep the mesh for picking, but only draw its edges.
        mesh.visible = false;
        const edgeGeometry = new EdgesGeometry(geometry, 20);
        if (gradient) paintGradient(edgeGeometry, gradient);
        const edges = new LineSegments(edgeGeometry, this.materials.line(color));
        edges.userData.letter = index;
        group.add(edges);
      }
      this.word.add(group);
    }

    // Centre the word on the origin, 1 em = 1 unit.
    this.word.scale.setScalar(1 / em);
    this.word.position.set(-comp.width / 2 / em, -(comp.ascender + comp.descender) / 2 / em, 0);
    this.turntable.rotation.y = word.spin * rad;
    this.turntable.updateMatrixWorld(true);

    const box = new Box3().setFromObject(this.word);
    if (box.isEmpty()) return;
    this.placeGroundAndLight(box);
    if (this.needsFraming) {
      this.frame(box);
      this.needsFraming = false;
    }

    const chosen = this.word.children.find((m) => m.userData.letter === selected);
    if (chosen) {
      this.selection.box.setFromObject(chosen);
      this.selection.visible = true;
    } else {
      this.selection.visible = false;
    }
  }

  private placeGroundAndLight(box: Box3) {
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const extent = Math.max(size.x, size.z, 1) * 4;
    this.ground.position.set(center.x, box.min.y - 0.002, center.z);
    this.ground.scale.set(extent, extent, 1);

    this.key.target.position.copy(center);
    this.key.position.copy(center).add(new Vector3(-1.5, 3, 2.5));
    const cam = this.key.shadow.camera;
    const r = Math.max(size.x, size.y, size.z) * 1.2;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.1;
    cam.far = 10 + r * 4;
    cam.updateProjectionMatrix();
  }

  private frame(box: Box3) {
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    // Distance at which the word's width fits the horizontal field of view
    // and its height the vertical one; keep the larger, plus a margin.
    const vHalf = (this.camera.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const distance =
      Math.max(size.x / 2 / Math.tan(hHalf), size.y / 2 / Math.tan(vHalf)) * 1.3 + size.z / 2;
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(DEFAULT_VIEW, distance);
    this.camera.near = distance / 100;
    this.camera.far = distance * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private resize() {
    if (!this.container) return;
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private clearWord() {
    for (const child of [...this.word.children]) {
      child.traverse((o: Object3D) => (o as Mesh).geometry?.dispose());
      this.word.remove(child);
    }
  }

  /**
   * Render the current scene into a new canvas of the given size, seen from
   * the current camera. If the picture is narrower than the view, the camera
   * steps back so the word still fits.
   */
  async snapshot(width: number, height: number, background: string | null): Promise<HTMLCanvasElement> {
    const r = this.renderer;
    const previous = { size: r.getSize(new Vector2()), ratio: r.getPixelRatio(), aspect: this.camera.aspect };
    const position = this.camera.position.clone();
    const aspect = width / height;
    if (aspect < previous.aspect) {
      const away = position.clone().sub(this.controls.target);
      this.camera.position.copy(this.controls.target).addScaledVector(away, previous.aspect / aspect);
    }
    r.setPixelRatio(1);
    r.setSize(width, height, false);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    if (background) r.setClearColor(new Color(background), 1);
    r.render(this.scene, this.camera);

    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    out.getContext('2d')!.drawImage(r.domElement, 0, 0, width, height);

    // Back to the live view.
    r.setClearColor(0x000000, 0);
    r.setPixelRatio(previous.ratio);
    r.setSize(previous.size.x, previous.size.y, false);
    this.camera.aspect = previous.aspect;
    this.camera.position.copy(position);
    this.camera.updateProjectionMatrix();
    return out;
  }

  /** The word as a binary glTF (.glb) model, with its materials. */
  async glb(): Promise<ArrayBuffer> {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    // Export a copy without editor helpers, at a real-world-ish scale (1 em = 1 unit).
    const copy = this.turntable.clone(true);
    // Invisible picking meshes (outline preset) are not part of the artwork.
    // Fur layers are shaped in the shader, which a model file can't carry.
    const hidden: Object3D[] = [];
    copy.traverse((o) => (!o.visible || o.userData.fur) && hidden.push(o));
    for (const o of hidden) o.removeFromParent();
    const result = await new GLTFExporter().parseAsync(copy, { binary: true });
    return result as ArrayBuffer;
  }

  destroy() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.clearWord();
    for (const v of this.volumes.values()) v.geometry.dispose();
    this.materials.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
