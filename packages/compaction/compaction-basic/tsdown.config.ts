import { defineConfig } from 'tsdown'

/** Build self-contained Loader entries so the package needs no private chunks. */
export default defineConfig([
  { entry: ['lib/types/index.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false },
  { entry: ['lib/types/settings.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false },
])
