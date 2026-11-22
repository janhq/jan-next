import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Bundle-faithful: the kit's `@openuidev/react-components` resolves to the shim, as in tsdown.config.ts.
export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: { '@openuidev/react-components': fileURLToPath(new URL('./src/client/kit/react-components.ts', import.meta.url)) },
  },
  test: { include: ['test/**/*.test.{ts,tsx}'], environment: 'jsdom' },
})
