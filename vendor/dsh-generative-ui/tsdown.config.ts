import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
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

// The `$dsh/ui` kit's files import `@openuidev/react-components`; only the parts the shim names are
// bundled (see src/client/kit/react-components.ts), and a name it lacks fails the build. The
// typecheck reads the package itself; vitest.config.ts aliases it like this.
const reactComponents = { '@openuidev/react-components': fileURLToPath(new URL('./src/client/kit/react-components.ts', import.meta.url)) }

// Jan's workspace build runs this config in its Host and Client passes; both halves build in the Host pass,
// as for dsh-superagent. An empty entry removes the package from the Client pass.
export default defineConfig(({ env }): UserConfig[] => env?.JAN_BUILD_FACE === 'client' ? [{ entry: '' }] : [
  { entry: { index: 'src/index.ts' }, outDir: 'lib', format: 'esm', fixedExtension: false, platform: 'node', target: 'es2024',
    dts: true, clean: true, deps: { neverBundle: [/^@deepseek-ai\//, /^@esm\.sh\//] } },
  { name: '@janhq/dsh-generative-ui/client', entry: { client: 'src/client/index.ts' }, outDir: 'lib', format: 'cjs', platform: 'browser',
    dts: false, clean: false, plugins: [bundleReactDomServer],
    inputOptions: { resolve: { conditionNames: ['browser', 'import', 'default'], alias: reactComponents } },
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
  // `$dsh/ui` on its own, for the canvas tools: `types/importmap.json` checks cards against its
  // declarations and `types/standalone/importmap.json` builds exported pages with it. React stays a
  // bare import, as in the other standalone modules.
  { name: '@janhq/dsh-generative-ui/ui', entry: { ui: 'src/client/kit/index.ts' }, outDir: 'lib', format: 'esm', fixedExtension: false,
    platform: 'browser', dts: true, clean: false,
    inputOptions: { resolve: { conditionNames: ['browser', 'import', 'default'], alias: reactComponents } },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    deps: { neverBundle: [/^react(-dom)?(\/.*)?$/], alwaysBundle: [/.*/] }, outputOptions: { codeSplitting: false } },
])
