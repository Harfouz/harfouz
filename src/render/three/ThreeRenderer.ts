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
  Sphere,
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
import type { Composition } from '../../core/types';
import { grainOf, inkOf, letterFill, resolveColor } from '../look';
import type { Renderer, RenderInput } from '../Renderer';
import { outlinesToShapes } from './contours';
import { MaterialLibrary } from './materials';

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

/**
 * Gradient along the word: colour each vertex by its horizontal position,
 * from `start` at the right edge (where Arabic reading begins) to `end` at
 * the left. `offsetX` brings the letter's local x back to line coordinates.
 */
function paintGradient(geometry: BufferGeometry, offsetX: number, width: number, start: Color, end: Color) {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const c = new Color();
  for (let i = 0; i < position.count; i++) {
    const t = Math.min(1, Math.max(0, 1 - (position.getX(i) + offsetX) / Math.max(width, 1)));
    c.lerpColors(start, end, t).toArray(colors, i * 3);
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
  private materials = new MaterialLibrary();
  private ground = new Mesh(new PlaneGeometry(1, 1), new ShadowMaterial({ opacity: 0.18 }));
  private key = new DirectionalLight(0xffffff, 2.4);
  private container?: HTMLElement;
  private resizeObserver = new ResizeObserver(() => this.resize());
  private needsFraming = true;
  private selection = new Box3Helper(new Box3(), 0xc0412b);
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
    this.scene.add(this.ground, this.word, this.selection);
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

  render({ composition: comp, word, letter, selected }: RenderInput) {
    const em = comp.unitsPerEm;
    const perMille = em / 1000;
    const rad = Math.PI / 180;

    const ink = inkOf(this.container ?? document.body);
    const gradient = [new Color(resolveColor(word.color, ink)), new Color(resolveColor(word.color2, ink))];
    this.clearWord();

    const letters = shapesByLetter(comp);
    const middle = (letters.length - 1) / 2;
    letters.forEach(({ letter: index, shapes }, order) => {
      if (!shapes.length) return;
      const p = letter(index);
      const depth = Math.max(1, p.depth * perMille);
      const bevel = Math.min(p.bevel * perMille, depth / 2);
      const weight = p.weight * perMille;
      const geometry = new ExtrudeGeometry(shapes, {
        depth,
        curveSegments: 10,
        bevelEnabled: bevel > 0 || weight !== 0,
        bevelThickness: bevel,
        bevelSize: bevel,
        // Shrink the cap by the bevel so the silhouette keeps its drawn size,
        // then grow or shrink it by the weight.
        bevelOffset: weight - bevel,
        bevelSegments: bevel > 0 ? 4 : 1,
      });
      geometry.computeBoundingBox();
      const center = geometry.boundingBox!.getCenter(new Vector3());
      // Pivot every letter around its own centre so it turns in place.
      geometry.translate(-center.x, -center.y, -center.z);

      // Colour: a solid colour, or per-vertex colours blending along the word.
      const fill = letterFill(word, p, order, ink);
      if (fill === 'gradient') paintGradient(geometry, center.x, comp.width, gradient[0], gradient[1]);
      const color = fill === 'gradient' ? null : fill;

      // One group per letter: it carries the placement, and holds the volume
      // (and its edges for the outline preset).
      const group = new Group();
      group.userData.letter = index;
      const mesh = new Mesh(geometry, this.materials.get(p.material, color, grainOf(p)));
      mesh.userData.letter = index;
      mesh.receiveShadow = true;
      // Glass and outlines would cast a solid black shadow, which looks wrong.
      mesh.castShadow = p.material !== 'glass' && p.material !== 'outline';
      group.add(mesh);
      if (p.material === 'outline') {
        // Keep the mesh for picking, but only draw its edges.
        mesh.visible = false;
        const edges = new LineSegments(new EdgesGeometry(geometry, 20), this.materials.line(color));
        if (color === null) paintGradient(edges.geometry, center.x, comp.width, gradient[0], gradient[1]);
        edges.userData.letter = index;
        group.add(edges);
      }

      // Stagger and twist are measured from the middle letter so the word stays centred;
      // push, lift, turn and tilt are this letter's own placement.
      const rank = order - middle;
      group.position.set(
        center.x,
        center.y + p.lift * perMille,
        -rank * word.stagger * perMille + p.push * perMille,
      );
      group.rotation.set(p.tilt * rad, (rank * word.twist + p.turn) * rad, 0);
      this.word.add(group);
    });

    // Centre the word on the origin, 1 em = 1 unit.
    this.word.scale.setScalar(1 / em);
    this.word.position.set(-comp.width / 2 / em, -(comp.ascender + comp.descender) / 2 / em, 0);
    this.word.updateMatrixWorld(true);

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
    const sphere = box.getBoundingSphere(new Sphere());
    // Fit the bounding sphere in whichever field of view is narrower.
    const vHalf = (this.camera.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    // The sphere is generous for a wide word seen in a wide view, so come a bit
    // closer than a strict fit; in a narrow (portrait) view the width is what
    // matters, so keep the strict fit.
    const tightness = hHalf < vHalf ? 1 : 0.82;
    const distance = (sphere.radius / Math.sin(Math.min(vHalf, hHalf))) * tightness;
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(DEFAULT_VIEW, distance);
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

  /** The canvas, for PNG export later. */
  get canvas() {
    return this.renderer.domElement;
  }

  destroy() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.clearWord();
    this.materials.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
