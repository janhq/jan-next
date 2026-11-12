import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      // Core package - use its own vitest config
      './core',

      // Web-app package - use its own vitest config
      './web-app',

      // Workspace packages - each ships its own vitest config
      './packages/extension-api',
      './packages/extension-runtime',

      // Extensions - each ships its own vitest config
      './extensions/assistant-extension',
      './extensions/download-extension',
      './extensions/llamacpp-extension',
      './extensions/rag-extension',
      './extensions/vector-db-extension',
      // Repo-wide guards over every extension. Inline rather than inside one
      // extension so it runs on every OS.
      {
        test: {
          name: '@janhq/extensions',
          root: './extensions',
          include: ['*.test.ts'],
          environment: 'node',
        },
      },
    ],
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
