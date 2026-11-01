import { defineConfig } from 'vite';

export default defineConfig({
  // Where the site is served from. GitHub Pages serves project sites from a
  // sub-folder (https://<user>.github.io/<repo>/): the deploy workflow sets
  // BASE_PATH to "/<repo>/". Locally it stays at the root.
  base: process.env.BASE_PATH ?? '/',
  // harfbuzzjs uses top-level await to load its WebAssembly module.
  build: { target: 'esnext' },
  // Pre-bundling would break the `new URL('harfbuzz.wasm', import.meta.url)` lookup.
  optimizeDeps: { exclude: ['harfbuzzjs'], esbuildOptions: { target: 'esnext' } },
});
