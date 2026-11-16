import { EventEmitter } from 'node:events'

const bus = new EventEmitter()
bus.setMaxListeners(100)
let connection
let streamReady

export async function invoke(command, args = {}) {
  const url = process.env.OW_NATIVE_URL
  const token = process.env.OW_NATIVE_TOKEN
  if (!url || !token) throw new Error('The native desktop bridge is unavailable. Start this plugin from open-waifu.')
  const response = await fetch(`${url}/invoke`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ command, args }),
  })
  const body = await response.json()
  if (!response.ok || Object.hasOwn(body, 'error')) throw new Error(body.error ?? `Native request failed (${response.status})`)
  return body.result
}

async function consumeEvents(signal, ready) {
  const response = await fetch(`${process.env.OW_NATIVE_URL}/events`, {
    headers: { authorization: `Bearer ${process.env.OW_NATIVE_TOKEN}` }, signal,
  })
  if (!response.ok || !response.body) throw new Error(`Native event stream failed (${response.status})`)
  ready()
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true }).replaceAll('\r\n', '\n')
    let end
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
      if (!data) continue
      const item = JSON.parse(data)
      bus.emit(item.event, item.payload)
    }
  }
  if (!signal.aborted) throw new Error('The native event stream disconnected.')
}

export async function connectEvents() {
  if (streamReady) return streamReady
  connection = new AbortController()
  let resolve, reject
  streamReady = new Promise((yes, no) => { resolve = yes; reject = no })
  consumeEvents(connection.signal, resolve).catch(error => {
    if (!connection?.signal.aborted) {
      reject(error)
      bus.emit('ow-native-error', error.message)
      console.error('Native event stream:', error.message)
    }
  }).finally(() => { streamReady = undefined })
  return streamReady
}

export function disconnectEvents() {
  connection?.abort()
  connection = undefined
  streamReady = undefined
}

export const events = {
  on(name, handler) { bus.on(name, handler); return () => bus.off(name, handler) },
  off(name, handler) { bus.off(name, handler) },
  emit(name, payload) { bus.emit(name, payload) },
}
export async function listen(name, handler) {
  await connectEvents()
  return events.on(name, payload => handler({ event: name, payload }))
}

export const AppEvent = { onModelImported: 'onModelImported', onBackendVerificationFailed: 'onBackendVerificationFailed' }
export const DownloadEvent = Object.fromEntries([
  'onFileDownloadUpdate', 'onFileDownloadError', 'onFileDownloadSuccess', 'onFileDownloadStopped',
  'onModelValidationStarted', 'onModelValidationFailed', 'onFileDownloadAndVerificationSuccess',
].map(name => [name, name]))
export const logger = console
export const HUGGINGFACE_TOKEN_SECRET_KEY = 'huggingface'
export const getJanDataFolderPath = () => invoke('get_jan_data_folder_path')
export const joinPath = args => invoke('join_path', { args })
export const fs = Object.fromEntries([
  ['writeFileSync', 'write_file_sync'], ['readFileSync', 'read_file_sync'],
  ['existsSync', 'exists_sync'], ['readdirSync', 'readdir_sync'],
  ['mkdir', 'mkdir'], ['rm', 'rm'], ['mv', 'mv'],
].map(([name, command]) => [name, (...args) => invoke(command, { args })]))
fs.fileStat = path => invoke('file_stat', { args: path })
fs.readYaml = path => invoke('read_yaml', { path })
fs.writeYaml = (savePath, data) => invoke('write_yaml', { savePath, data })
fs.decompress = (path, outputDir) => invoke('decompress', { path, outputDir })
export const appSettings = {
  get: key => invoke('settings_get', { key }),
  set: (key, value) => invoke('settings_set', { key, value }),
  remove: key => invoke('settings_remove', { key }),
}
export const downloads = {
  downloadFiles: (items, taskId, headers) => invoke('download_files', { items, taskId, headers }),
  cancelDownload: taskId => invoke('cancel_download_task', { taskId }),
  pauseDownload: taskId => invoke('pause_download_task', { taskId }),
  async onDownloadProgress(taskId, handler) {
    await connectEvents()
    return events.on(`download-${taskId}`, handler)
  },
}
