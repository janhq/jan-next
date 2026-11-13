import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Each project ships its own vitest config.
    projects: ['./core', './web-app'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        '**/*/dist',
        'node_modules',
        '**/src/**/*.test.ts',
        '**/src/**/*.test.tsx',
        '**/src/test/**/*',
        'src-tauri',
      ],
    },
  },
})
