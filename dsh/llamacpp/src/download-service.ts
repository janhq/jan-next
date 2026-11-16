import { HUGGINGFACE_TOKEN_SECRET_KEY, type DownloadItem } from '@/lib/native'
import { downloads } from '@/lib/native'
import { getServiceHub } from '@/hooks/useServiceHub'

export interface DownloadService {
  downloadFile(
    url: string,
    savePath: string,
    taskId: string,
    proxyConfig?: DownloadItem['proxy'],
    onProgress?: (transferred: number, total: number) => void
  ): Promise<void>
  downloadFiles(
    items: DownloadItem[],
    taskId: string,
    onProgress?: (transferred: number, total: number) => void
  ): Promise<void>
  cancelDownload(taskId: string): Promise<void>
  pauseDownload(taskId: string): Promise<void>
}

// Read per download rather than cached: the token can change in Settings at any
// time and the keyring is the only copy. An unreadable keyring must not block
// public downloads, so it degrades to no token.
const headers = async (): Promise<Record<string, string>> => {
  const token = await getServiceHub()
    .core()
    .invoke<string | null>('get_secret', { key: HUGGINGFACE_TOKEN_SECRET_KEY })
    .catch((error: unknown) => {
      console.warn('Could not read the Hugging Face token:', error)
      return null
    })
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const downloadFiles: DownloadService['downloadFiles'] = async (
  items,
  taskId,
  onProgress
) => {
  const unsubscribe = await downloads.onDownloadProgress(taskId, (progress) =>
    onProgress?.(progress.transferred, progress.total)
  )
  try {
    await downloads.downloadFiles(items, taskId, await headers())
  } catch (error) {
    console.error('Error downloading task', taskId, error)
    throw error
  } finally {
    unsubscribe()
  }
}

export const downloadService: DownloadService = {
  downloadFiles,
  downloadFile: (url, savePath, taskId, proxyConfig = {}, onProgress) =>
    downloadFiles(
      [{ url, save_path: savePath, proxy: proxyConfig }],
      taskId,
      onProgress
    ),
  cancelDownload: async (taskId) => {
    try {
      await downloads.cancelDownload(taskId)
    } catch (error) {
      console.error('Error cancelling download:', error)
      throw error
    }
  },
  pauseDownload: async (taskId) => {
    try {
      await downloads.pauseDownload(taskId)
    } catch (error) {
      console.error('Error pausing download:', error)
      throw error
    }
  },
}
