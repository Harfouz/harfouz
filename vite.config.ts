import { defineConfig } from 'vite';

export default defineConfig({
  // harfbuzzjs uses top-level await to load its WebAssembly module.
  build: { target: 'esnext' },
  // Pre-bundling would break the `new URL('harfbuzz.wasm', import.meta.url)` lookup.
  optimizeDeps: { exclude: ['harfbuzzjs'], esbuildOptions: { target: 'esnext' } },
});
