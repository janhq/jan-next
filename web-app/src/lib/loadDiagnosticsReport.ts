import { formatLoadDiagnostics } from '@/lib/engineError'
import { isPlatformTauri } from '@/lib/platform'
import { localHomeDir } from '@/lib/localHome'

/**
 * The paste-ready report for a failed engine load, with this app's version and
 * OS filled in. Undefined when the error carries no diagnostics, which is the
 * caller's cue not to offer the action.
 */
export async function buildLoadDiagnosticsReport(
  error: unknown
): Promise<string | undefined> {
  const [env, home] = await Promise.all([gatherEnvironment(), localHomeDir()])
  return formatLoadDiagnostics(error, {
    appVersion: env.appVersion,
    os: [env.os, env.arch].filter(Boolean).join(' ') || undefined,
    home,
  })
}

/** OS and app version, gathered once: neither changes within a process. */
let staticEnv:
  | Promise<{ os?: string; arch?: string; appVersion?: string }>
  | undefined

function gatherEnvironment() {
  staticEnv ??= (async () => {
    if (!isPlatformTauri()) return {}
    try {
      const osApi = await import('@tauri-apps/plugin-os')
      const { getVersion } = await import('@tauri-apps/api/app')
      return {
        os: osApi.platform(),
        arch: osApi.arch(),
        appVersion: await getVersion(),
      }
    } catch {
      // Web build or a missing plugin: the report simply omits these lines.
      return {}
    }
  })()
  return staticEnv
}
