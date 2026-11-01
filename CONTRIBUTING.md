# Contributing to Harfouz

Thank you for helping. Harfouz is for designers, animators and developers alike: you don't need to be a programmer to contribute. A bug report, a typeface suggestion or a motion preset idea is as welcome as code.

## Ways to help

- **Report a problem.** Open an issue with the word you typed, the typeface, the settings, and a screenshot. For shaping problems (a letter in the wrong form, a misplaced diacritic), switch to the 2D view and turn on *Inspect shaping*: it overlays the browser's own rendering in red, which helps tell a Harfouz bug from a font quirk.
- **Suggest or add a typeface** (see below).
- **Add a material, a palette or a motion preset.**
- **Translate the interface.** It is in English today. Arabic, French and other languages would be great.
- **Improve the code**, the tests or this documentation.

## Setting up

You need [Node.js](https://nodejs.org) 20.19 or later.

```bash
npm install
npm run dev     # the app at http://localhost:5173, with live reload
npm test        # the test suite
npm run build   # type-check and production build
```

Please run `npm test` and `npm run build` before opening a pull request. Both must pass.

## The golden rule: Arabic first

Every change must keep the Arabic correct. In practice:

1. **Shaping comes first.** Never change outlines before HarfBuzz has shaped the text. Text-level effects (like kashida) happen before shaping. Everything else happens after, on positioned glyphs.
2. **Joins are sacred.** Anything that moves letters must keep connected letters connected: spacing only opens gaps between unjoined letters (`src/core/joining.ts`), and in 3D the junction blend (`src/render/three/deform.ts`) keeps both sides of a join together.
3. **Diacritics belong to their letter.** A letter and its harakat share a cluster and a `letter` index. Move, colour and animate them together.
4. **Test with real, difficult words**, in every bundled typeface. The fixtures in `tests/fixtures.ts` include lam-alef, shadda + kasra, chains of teeth, vertical stacks and explicit tatweel. Add words there when you find a new tricky case.

## Where things live

| You want to… | Look at |
|---|---|
| Change how text is shaped | `src/core/shaping.ts`, `src/core/kashida.ts`, `src/core/joining.ts` |
| Add or change a slider | `src/params/schema.ts` (the panel, per-letter editing and animation are built from it) |
| Add a deformation | `src/modifiers/` (and register it in `src/modifiers/index.ts`) |
| Add a 3D material | `src/render/three/materials.ts`, its 2D look in `src/render/svg/looks.ts`, its name in `LOOK_PARAMS` |
| Add a texture | `src/render/textures.ts` (a generator, a label and a tile size); it appears in the menu automatically |
| Add a colour palette | `PALETTES` in `src/render/look.ts` and the `palette` options in `src/params/schema.ts` |
| Add a motion preset | `MOTION_PRESETS` in `src/params/animation.ts` |
| Add an export format | `src/export/formats.ts` and `src/export/exporter.ts` |
| Write a new renderer (e.g. WebGPU, shaders) | Implement the `Renderer` interface in `src/render/Renderer.ts` |

Lengths in parameters are in **thousandths of an em** (‰), so they behave the same in every typeface. Renderers convert them with the font's `unitsPerEm`.

## Adding a typeface

Only fonts under the **SIL Open Font License** (or another licence that allows redistribution) can be bundled.

1. Create a folder in `public/fonts/` named after the typeface, in lowercase with dashes (e.g. `public/fonts/noto-kufi-arabic/`).
2. Put the `.ttf` file in it (a variable font is fine; the default instance is used), **together with its `OFL.txt`**. Avoid brackets in file names (`Font[wght].ttf` → `Font-Variable.ttf`).
3. Add an entry to `FONT_CATALOG` in `src/core/fonts.ts` with an `id`, a `name`, a `style` (Naskh, Kufi, Ruqaa, Sans, Display, or a new one) and the `url`.
4. Add a row to the typeface table in `CREDITS.md`.
5. Run `npm test`. Every test now runs on the new typeface too. If one fails, look at why before changing the test: it may be a real bug (adding fonts has revealed several) or a documented quirk of the font, in which case explain it in a comment in the test.

## Code style

- TypeScript, strict mode, no framework. Code, comments and documentation are in **English**.
- Write comments for the next person: explain *why*, especially anything specific to Arabic script or to a font's behaviour.
- Keep modules small and focused, and follow the style of the file you are editing.
- Interface text stays short and plain. Many users are designers, not developers.

## Commits and pull requests

- One topic per pull request, with a short description of what changes for the user, plus screenshots for visual changes.
- Commit messages: a short summary line, then the details if useful.
- New behaviour comes with tests.

## Licence

By contributing, you agree that your code is released under the project's [MIT licence](LICENSE). Typefaces keep their own licences.
