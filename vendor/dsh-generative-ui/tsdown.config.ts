import { createRequire } from 'node:module'
import { defineConfig, type UserConfig } from 'tsdown'

// The shell's frozen module table (packages/client/web/src/platform.ts), under the upstream names the
// sources import; Jan's client loader translates `@deepseek-ai/*` at materialization.
const PLATFORM_MODULES = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', 'zod',
  '@tanstack/react-virtual', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit']
// Injected client services, reached only through `/client` subpaths the shell answers.
const INJECTED = /^@deepseek-ai\/dsh-[a-z-]+\/client$/

// `react-dom/server` is not a platform module: bundle its browser build, never the Node one.
const reactDomServer = createRequire(import.meta.url).resolve('react-dom/server.browser')
const bundleReactDomServer = { name: 'bundle-react-dom-server',
  resolveId: (source: string) => source === 'react-dom/server' ? reactDomServer : undefined }

// Jan's workspace build runs this config in its Host and Client passes; both halves build in the Host pass,
// as for dsh-superagent. An empty entry removes the package from the Client pass.
export default defineConfig(({ env }): UserConfig[] => env?.JAN_BUILD_FACE === 'client' ? [{ entry: '' }] : [
  { entry: { index: 'src/index.ts' }, outDir: 'lib', format: 'esm', fixedExtension: false, platform: 'node', target: 'es2024',
    dts: true, clean: true, deps: { neverBundle: [/^@deepseek-ai\//, /^@esm\.sh\//] } },
  { name: '@janhq/dsh-generative-ui/client', entry: { client: 'src/client/index.ts' }, outDir: 'lib', format: 'cjs', platform: 'browser',
    dts: false, clean: false, plugins: [bundleReactDomServer],
    inputOptions: { resolve: { conditionNames: ['browser', 'import', 'default'] } },
    define: {
      // @esm.sh/tsx reads import.meta.url only when no wasm path is passed, and the client always passes one.
      'import.meta.url': JSON.stringify('https://dsh-generative-ui.invalid/'),
      // A shipped browser bundle is production: React's dev builds read internals the shell's React lacks.
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    deps: { neverBundle: [...PLATFORM_MODULES.map(name => new RegExp(`^${name.replace(/[/.]/g, '\\$&')}$`)), INJECTED],
      alwaysBundle: [/.*/] },
    // The shell materializes one factory per package, so dynamic imports cannot become sibling chunks.
    outputOptions: { codeSplitting: false, entryFileNames: 'client.js', banner: 'window.__ModuleLoader__.load({ id: "@janhq/dsh-generative-ui", factory: (require) => {', footer: 'return module.exports; } });', intro: 'var module = { exports: {} }; var exports = module.exports;' } },
])
