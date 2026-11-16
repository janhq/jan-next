import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import packageJson from './package.json'
const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig(() => {
  return {
    plugins: [
      {
        name: 'desktop-bootstrap-entry',
        transformIndexHtml(html) {
          return process.env.IS_TAURI && process.env.IS_TAURI !== 'false'
            ? html.replace('/src/main.tsx', '/src/main-desktop.tsx')
            : html
        },
      },
      TanStackRouterVite({
        target: 'react',
        autoCodeSplitting: true,
        routeFileIgnorePattern: '.((test).ts)|test-page',
      }),
      react(),
      tailwindcss(),
      nodePolyfills({
        include: ['path'],
      }),
    ],
    optimizeDeps: {
      entries:
        process.env.IS_TAURI && process.env.IS_TAURI !== 'false'
          ? ['src/main-desktop.tsx']
          : ['index.html'],
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    define: {
      IS_TAURI: JSON.stringify(process.env.IS_TAURI),
      IS_DEV: JSON.stringify(process.env.IS_DEV),
      IS_WEB_APP: JSON.stringify(false),
      IS_MACOS: JSON.stringify(
        process.env.TAURI_ENV_PLATFORM?.includes('darwin') ?? false
      ),
      IS_WINDOWS: JSON.stringify(
        process.env.TAURI_ENV_PLATFORM?.includes('windows') ?? false
      ),
      PLATFORM: JSON.stringify(process.env.TAURI_ENV_PLATFORM),

      VERSION: JSON.stringify(packageJson.version),

      MODEL_CATALOG_URL: JSON.stringify(
        'https://raw.githubusercontent.com/janhq/model-catalog/main/model_catalog_v2.json'
      ),
      LATEST_JAN_MODEL_URL: JSON.stringify(
        'https://raw.githubusercontent.com/janhq/model-catalog/main/latest_jan_model.json'
      ),
    },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: 'ws',
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        // 3. tell vite to ignore watching `src-tauri`
        ignored: ['**/src-tauri/**'],
        usePolling: true
      },
    },
  }
})
