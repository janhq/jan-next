import type { DownloadProgress, DownloadProgressHandler, Unsubscribe } from '@/lib/native'
import { getServiceHub } from '@/hooks/useServiceHub'
import { isPlatformTauri } from '@/lib/platform'
import type { InvokeArgs } from '@/services/core/types'
import { openExternalUrl } from '@/lib/externalLink'

// Routes the web-app reaches as Tauri commands (camelCase name -> snake_case command).
const CoreRoutes = [
  'getAppConfigurations',
  'updateAppConfiguration',
  'joinPath',
  'dirName',
  'isSubdirectory',
  'baseName',
  'log',
  'showToast',
  'settingsGet',
  'settingsSet',
  'settingsRemove',
  'appendFileSync',
  'unlinkSync',
  'existsSync',
  'readdirSync',
  'rm',
  'mv',
  'mkdir',
  'readFileSync',
  'writeFileSync',
  'readYaml',
  'writeYaml',
  'decompress',
  'copyFile',
  'getJanDataFolderPath',
  'getResourcePath',
  'getUserHomePath',
  'fileStat',
  'writeBlob',
  'getGgufFiles',
  'downloadFiles',
  'cancelDownloadTask',
  'pauseDownloadTask',
  'writeEnvFileToConfig',
  'openFileExplorer',
  'startServer',
  'stopServer',
]

const AppRoutes = [
  'getTools',
  'callTool',
  'cancelToolCall',
  'listThreads',
  'createThread',
  'modifyThread',
  'deleteThread',
  'listMessages',
  'createMessage',
  'modifyMessage',
  'deleteMessage',
  'getThreadAssistant',
  'createThreadAssistant',
  'modifyThreadAssistant',
  'saveMcpConfigs',
  'getMcpConfigs',
  'restartMcpServers',
  'getConnectedServers',
  'readLogs',
  'changeAppDataFolder',
]
// Define API routes based on different route types
export const Routes = [...CoreRoutes, ...AppRoutes].map((r) => ({
  path: `app`,
  route: r,
}))

// Re-exported for callers that open links through the route table.
export { openExternalUrl }

// Events are not request/response, so this cannot be a mapped route: the host
// emits progress for a task on its own `download-<taskId>` channel.
export async function onDownloadProgress(
  taskId: string,
  handler: DownloadProgressHandler
): Promise<Unsubscribe> {
  return getServiceHub()
    .events()
    .listen<DownloadProgress>(`download-${taskId}`, (event) => handler(event.payload))
}

export const APIs: Record<string, (...args: any[]) => any> & {
  openExternalUrl: typeof openExternalUrl
  onDownloadProgress: typeof onDownloadProgress
} = {
  ...Object.values(Routes).reduce((acc, proxy) => {
    return {
      ...acc,
      [proxy.route]: (args?: InvokeArgs) => {
        if (isPlatformTauri()) {
          // For Tauri platform, use the service hub to invoke commands
          const command = proxy.route.replace(/([A-Z])/g, '_$1').toLowerCase()

          // Backward-compatible shim for start_server: wrap args into { config }
          if (command === 'start_server') {
            // If already using new shape, pass through
            if (args && 'config' in args) {
              return getServiceHub().core().invoke(command, args)
            }

            const raw: Record<string, unknown> = (args || {}) as Record<string, unknown>

            const pickString = (obj: Record<string, unknown>, keys: string[]): string | undefined => {
              for (const key of keys) {
                const value = obj[key]
                if (typeof value === 'string') return value
              }
              return undefined
            }

            const pickNumber = (obj: Record<string, unknown>, keys: string[]): number | undefined => {
              for (const key of keys) {
                const value = obj[key]
                if (typeof value === 'number') return value
              }
              return undefined
            }

            const pickStringArray = (obj: Record<string, unknown>, keys: string[]): string[] | undefined => {
              for (const key of keys) {
                const value = obj[key]
                if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
                  return value as string[]
                }
              }
              return undefined
            }

            const pickBoolean = (
              obj: Record<string, unknown>,
              keys: string[]
            ): boolean | undefined => {
              for (const key of keys) {
                const value = obj[key]
                if (typeof value === 'boolean') return value
              }
              return undefined
            }

            const config = {
              host: pickString(raw, ['host']),
              port: pickNumber(raw, ['port']),
              prefix: pickString(raw, ['prefix']),
              api_key: pickString(raw, ['api_key', 'apiKey']),
              trusted_hosts: pickStringArray(raw, ['trusted_hosts', 'trustedHosts']),
              proxy_timeout: pickNumber(raw, ['proxy_timeout', 'proxyTimeout']),
              cors_enabled: pickBoolean(raw, [
                'cors_enabled',
                'isCorsEnabled',
                'corsEnabled',
              ]),
            }
            return getServiceHub().core().invoke(command, { config })
          }

          return getServiceHub().core().invoke(command, args)
        } else {
          // For Web platform, provide fallback implementations
          console.warn(`API call '${proxy.route}' not supported in web environment`, args)
          return Promise.resolve(null)
        }
      },
    }
  }, {}),
  openExternalUrl,
  onDownloadProgress,
}
