# Harfouz · حرفوز

**An open-source playground for parametric Arabic typography.**
**Try it: [harfouz.github.io/harfouz](https://harfouz.github.io/harfouz/)**. It runs in the browser, nothing to install.
Type a word or a sentence in Arabic, then shape it, colour it, put it in 3D and animate it, with sliders. Export the result as an image, a vector file, a 3D model or a video.

Harfouz is made for designers, animators and type lovers. Its one rule: **the Arabic must stay correct.** Letters take their proper joined forms, ligatures and diacritics are placed by a real shaping engine, and every deformation is applied *after* shaping, so connected letters stay connected.

---

## What you can do

**Interface in English, French, Arabic (right to left) and Russian.** Your choice is remembered.

**Write**
- Type in Arabic with any keyboard: an on-screen Arabic keyboard (with all the harakat), or your own keys typing Arabic by position (Q → ض, A → ش…), whatever your layout.
- 12 open-source typefaces in five styles: Naskh, Kufi, Ruqaa, Sans and Display.

**Shape**: weight from hairline-thin to very bold (thinning takes the same share off every stroke, so the letter keeps its contrast and connected letters stay attached), softened corners (rounded stroke ends and angles, thin strokes never lost), slant, kashida (real tatweel insertion, reshaped, never splitting lam-alef), width, spacing that never breaks a join, and organic distortion.

**Colour, material and texture**: solid, gradient (as many colours as you like, positioned and oriented freely), or one colour per letter from curated palettes. Six materials: satin, clay, paper, metal, glass and outline only. 17 textures generated in code, to combine with any material:
- paper grain, paper fibres, linen;
- marble, stone, rough rock, terrazzo;
- brushed and hammered metal;
- zellige tiles and khatam (8-pointed stars);
- short fur, long hair, wool, leopard and zebra coats, reptile scales.

Hairy textures **grow real fur**.

**Artboard background**: the default dark tone, a solid colour, or a linear or radial gradient (as many colours as you like, and an animatable direction). Exports set to "Same as the artboard" use it, gradients included.

**Space (3D)**: extruded letters with depth and bevel, in a lit scene with soft shadows and an orbit camera. Stagger, twist, spin, and per-letter push, shift (left/right), lift, turn and tilt, enough to build calligraphic compositions. **Connected letters stay attached**: the joining stroke bends and stretches instead of breaking, and the further two letters are moved apart, the longer and smoother the sweep between them.

**Every setting works for the whole word, for a single letter, or for a single diacritic.** Click a letter, or a fatha, damma, kasra, shadda, sukun or tanwin, to give it its own values. Diacritics follow their letter until you change them, and in 3D they move with it.

**Motion**: any slider can move (sine, triangle, bounce, ramp or organic noise), with a delay between letters to make ripples. Every motion loops seamlessly. Ready-made presets: wave, hop, breathe, ribbon, turntable, liquid, kashida stretch.

**Export**

| Images | Animations |
|---|---|
| PNG, WebP (transparent background possible), JPG | MP4, WebM |
| GLB 3D model with materials | Animated GIF |
| | ZIP of PNG frames with transparency |

Animations are rendered frame by frame at exact moments of the loop, so they never drop frames.

Exported files carry a discreet "Made with Harfouz" note in their metadata (it never changes the picture, and your work stays yours). A small visible mark can be added as an option.

---

## Getting started

You need [Node.js](https://nodejs.org) **20.19 or later** (22 LTS recommended).

```bash
git clone https://github.com/Harfouz/harfouz.git
cd harfouz
npm install
npm run dev
```

Then open **http://localhost:5173**.

| Command | What it does |
|---|---|
| `npm run dev` | Starts the app with live reload |
| `npm test` | Runs the test suite |
| `npm run build` | Type-checks and builds a static site into `dist/` |
| `npm run preview` | Serves the built site locally |

The built site is fully static: `dist/` can be hosted anywhere (GitHub Pages, Netlify, any web server).

### Browser support

Harfouz works in recent versions of Chrome, Edge, Firefox and Safari. MP4 and WebM export use the browser's own video encoder (WebCodecs). Where a format isn't supported, the export menu says so. The PNG sequence works everywhere.

---

## How it works

Everything flows through one pipeline. Each stage knows nothing about the next: shaping and modifiers work on flat outlines, and only the renderer turns them into 3D volumes.

```
text ─▶ kashida ─▶ shaping ─▶ layout modifiers ─▶ geometry modifiers ─▶ renderer
        (tatweels)  HarfBuzz   width, spacing      slant, distortion      three.js (3D)
```

1. **Kashida** (`src/core/kashida.ts`) inserts tatweel characters between letters that connect, before shaping, so the font draws real elongations.
2. **Shaping** (`src/core/shaping.ts`): [HarfBuzz](https://harfbuzz.github.io) picks each letter's contextual form, applies ligatures and positions diacritics. Glyph outlines come from [opentype.js](https://opentype.js.org).
3. **Layout modifiers** (`src/modifiers/`) change positions letter by letter. Spacing only opens gaps where letters are *not* joined (`src/core/joining.ts` knows the Arabic joining rules).
4. **Geometry modifiers** change the outlines themselves: weight offsets them and soften rounds their corners with the [Clipper](https://www.angusj.com/clipper2/Docs/Overview.htm) polygon library (`src/modifiers/weight.ts`, `soften.ts`), shear makes the slant, and a seeded Perlin noise field the distortion, sampled in line space so joins move together.
5. **The renderer** (`src/render/three/ThreeRenderer.ts`) extrudes each letter and diacritic. `three/deform.ts` keeps connected letters attached: it finds where two letters meet (`src/modifiers/joins.ts`, also used for slant and distortion), blends their placements around that point, and keeps the rest of each letter rigid. It follows the `Renderer` interface (`src/render/Renderer.ts`), so another renderer could be plugged in later.

Parameters are described once in `src/params/schema.ts`. The panel, per-letter overrides (`params/state.ts`) and animation (`params/animation.ts`) are all built from that list.

### Project layout

```
public/fonts/        The 12 typefaces, each with its OFL licence
src/core/            Fonts, shaping, Arabic joining rules, kashida
src/modifiers/       Width, spacing, weight, soften, slant, distortion
src/params/          Parameter schema, per-letter state, animation
src/render/          three.js renderer, colours, materials, textures
src/export/          Export formats and encoders
src/ui/              Sliders, Arabic keyboard
src/main.ts          Wires everything together
tests/               Vitest suite (shaping, joins, 3D, animation, export…)
```

### Tests

The test suite runs every check against **all bundled typefaces** with words chosen to stress Arabic shaping: lam-alef, stacked diacritics (shadda + kasra), chains of teeth (مستشفى), vertical stacks (محمد), explicit kashida. Among other things, it checks that no glyph is missing, that diacritics stay on their letter, that spacing never opens a gap inside a join, and that connected letters still touch in 3D after strong moves.

---

## Contributing

Contributions are welcome: code, typefaces, materials, motion presets, translations of the interface, bug reports. Read [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

## Licence

- **Code**: [MIT](LICENSE).
- **Typefaces**: [SIL Open Font License 1.1](https://openfontlicense.org), each in its own folder under `public/fonts/` with its licence file.
- **Libraries**: see [CREDITS.md](CREDITS.md).

Harfouz (حرفوز) plays on *ḥarf* (حرف), "letter".
