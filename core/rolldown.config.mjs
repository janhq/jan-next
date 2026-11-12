import { defineConfig } from 'rolldown'

export default defineConfig([
  {
    input: 'src/index.ts',
    output: {
      format: 'esm',
      file: 'dist/index.js',
      sourcemap: true,
    },
    platform: 'browser',
    // The API package is a real dependency so that core and every extension
    // share one copy of its classes (DisposableStore, Emitter).
    external: ['path', 'react', 'react-dom', 'react/jsx-runtime', '@janhq/extension-api'],
  }
])
