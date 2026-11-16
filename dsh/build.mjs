import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const native = path.join(root, 'dsh/native')
const nativeAliases = new Map([
  ['@/lib/native', 'runtime.mjs'],
  ['@/lib/loopback-fetch', 'fetch.mjs'],
  ['@/hooks/useServiceHub', 'service-hub.mjs'],
  ['@tauri-apps/api/core', 'tauri.mjs'],
  ['@tauri-apps/api/event', 'tauri.mjs'],
])

async function bundle(entry, output) {
  const outfile = path.join(root, output)
  const externalNative = (file) => {
    const relative = path.relative(path.dirname(outfile), file).replaceAll('\\', '/')
    return { path: relative.startsWith('.') ? relative : `./${relative}`, external: true }
  }

  await build({
    absWorkingDir: root,
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: path.join(root, 'web-app/tsconfig.app.json'),
    define: { IS_MACOS: 'owIsMacOS' },
    banner: { js: "const owIsMacOS = process.platform === 'darwin'" },
    alias: {
      'zod': path.join(root, 'web-app/node_modules/zod/index.js'),
      '@janhq/tauri-plugin-llamacpp-api': path.join(root, 'src-tauri/plugins/tauri-plugin-llamacpp/guest-js/index.ts'),
      '@janhq/tauri-plugin-hardware-api': path.join(root, 'src-tauri/plugins/tauri-plugin-hardware/guest-js/index.ts'),
    },
    plugins: [{
      name: 'open-waifu-native-host',
      setup(builder) {
        builder.onResolve({ filter: /^(@\/|@tauri-apps\/api\/)/ }, (args) => {
          const file = nativeAliases.get(args.path)
          return file ? externalNative(path.join(native, file)) : undefined
        })
        builder.onResolve({ filter: /native\/[^/]+\.mjs$/ }, (args) =>
          externalNative(path.resolve(args.resolveDir, args.path))
        )
      },
    }],
    logLevel: 'info',
  })
}

await Promise.all([
  bundle('dsh/llamacpp/src/host.ts', 'dsh/llamacpp/runtime.mjs'),
  bundle('dsh/assistant/host.ts', 'dsh/assistant/index.mjs'),
  bundle('dsh/preset-square/host.mjs', 'dsh/preset-square/index.mjs'),
])
