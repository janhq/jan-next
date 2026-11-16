import { randomUUID } from 'node:crypto'
import { registerApi } from '../native/api.mjs'
import { events, DownloadEvent, AppEvent } from '../native/runtime.mjs'

export const name = 'ow-download'
export const inject = ['owNative', 'webServer', 'connection']

const active = new Set(['preparing', 'downloading', 'validating', 'importing', 'pausing', 'cancelling'])
const message = error => error instanceof Error ? error.message : String(error)

export function apply(ctx) {
  const tasks = new Map()
  const byModel = new Map()
  const listeners = new Set()
  let engine
  let disposed = false
  const engineOrThrow = () => {
    if (!engine) throw new Error('The local model engine is unavailable.')
    return engine
  }
  const snapshot = task => ({
    taskId: task.taskId, modelId: task.modelId, status: task.status,
    transferred: task.transferred, total: task.total,
    createdAt: task.createdAt, updatedAt: task.updatedAt,
    error: task.error, actionError: task.actionError,
    canPause: !!engine && task.status === 'downloading',
    canResume: !!engine && !!task.options && !task.promise && !task.operation && ['paused', 'error'].includes(task.status),
    resumeUnavailableReason: !engine ? 'The local model engine is unavailable.' : !task.options ? 'The original import arguments were not saved for this task.' : task.promise || task.operation ? 'Waiting for the previous import to stop.' : undefined,
    canCancel: !!engine && !task.operation && ['downloading', 'validating', 'paused', 'error'].includes(task.status),
  })
  const notify = () => { if (!disposed) for (const listener of listeners) listener() }
  const patch = (task, fields) => {
    Object.assign(task, fields, { updatedAt: new Date().toISOString() })
    notify()
  }
  const create = (modelId, options) => {
    const now = new Date().toISOString()
    const task = { taskId: randomUUID(), modelId, options, status: 'preparing', transferred: 0, total: 0, createdAt: now, updatedAt: now }
    tasks.set(task.taskId, task)
    byModel.set(modelId, task)
    notify()
    return task
  }
  const get = taskId => {
    if (typeof taskId !== 'string' || !tasks.has(taskId)) throw new Error('This download task does not exist.')
    return tasks.get(taskId)
  }
  const start = task => {
    const hooks = engineOrThrow()
    task.intent = undefined
    patch(task, { status: 'preparing', error: undefined, actionError: undefined })
    // The API returns the task before the import finishes; the rejection is kept on that task.
    task.promise = Promise.resolve().then(() => hooks.import(task.modelId, structuredClone(task.options))).then(() => {
      if (task.intent || ['paused', 'cancelled', 'error'].includes(task.status)) return
      patch(task, { status: 'completed' })
    }, error => {
      if (!task.intent) patch(task, { status: 'error', error: message(error) })
    }).finally(() => {
      task.promise = undefined
      notify()
    })
  }
  const operate = async (taskId, kind) => {
    const task = get(taskId)
    const hooks = engineOrThrow()
    if (task.operation) throw new Error('A download action is already in progress.')
    const allowed = kind === 'pause' ? snapshot(task).canPause : snapshot(task).canCancel
    if (!allowed) throw new Error(`This task cannot be ${kind === 'pause' ? 'paused' : 'cancelled'} in its current state.`)
    const previous = task.status
    task.operation = kind
    task.intent = kind
    patch(task, { status: kind === 'pause' ? 'pausing' : 'cancelling', actionError: undefined })
    try {
      await (kind === 'pause' ? hooks.pauseImport(task.modelId) : hooks.abortImport(task.modelId))
      // Engine.import joins an in-flight import, so do not offer Resume until it has unwound.
      await task.promise
      patch(task, { status: kind === 'pause' ? 'paused' : 'cancelled' })
    } catch (error) {
      task.intent = undefined
      patch(task, { status: previous, actionError: message(error) })
      throw error
    } finally {
      task.operation = undefined
      notify()
    }
    return snapshot(task)
  }
  const service = {
    registerEngine(hooks) {
      if (!hooks || ['import', 'pauseImport', 'abortImport'].some(key => typeof hooks[key] !== 'function')) throw new Error('The download engine must provide import, pauseImport and abortImport.')
      if (engine) throw new Error('A download engine is already registered.')
      engine = hooks
      notify()
      return () => { if (engine === hooks) { engine = undefined; notify() } }
    },
    trackImport(id, options) {
      engineOrThrow()
      if (typeof id !== 'string' || !id.trim()) throw new Error('Choose a model id.')
      if (!options || typeof options.modelPath !== 'string' || !options.modelPath.trim()) throw new Error('Choose a model file or download URL.')
      const existing = byModel.get(id)
      if (existing && active.has(existing.status)) return { taskId: existing.taskId }
      if (existing && ['paused', 'error'].includes(existing.status)) throw new Error('Resume or cancel the existing download before importing this model again.')
      const task = create(id, structuredClone(options))
      start(task)
      return { taskId: task.taskId }
    },
    list: () => [...tasks.values()].map(snapshot).reverse(),
    pause: taskId => operate(taskId, 'pause'),
    cancel: taskId => operate(taskId, 'cancel'),
    resume(taskId) {
      const task = get(taskId)
      if (!snapshot(task).canResume) throw new Error('This download cannot be resumed. Its original import arguments must be available and the previous import must have stopped.')
      start(task)
      return { taskId: task.taskId }
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
  }
  ctx.provide('owDownload', service)

  const observe = (name, update) => events.on(name, payload => {
    if (!payload || typeof payload.modelId !== 'string') return
    let task = byModel.get(payload.modelId)
    // Do not invent resume arguments for imports initiated outside this service.
    if (!task) task = create(payload.modelId)
    if (task.intent || ['cancelled', 'completed'].includes(task.status)) return
    update(task, payload)
  })
  const disposers = [
    observe(DownloadEvent.onFileDownloadUpdate, (task, payload) => patch(task, {
      status: 'downloading',
      transferred: Number.isFinite(payload.size?.transferred) ? payload.size.transferred : task.transferred,
      total: Number.isFinite(payload.size?.total) ? payload.size.total : task.total,
    })),
    observe(DownloadEvent.onFileDownloadSuccess, task => patch(task, { status: 'validating' })),
    observe(DownloadEvent.onModelValidationStarted, task => patch(task, { status: 'validating' })),
    observe(DownloadEvent.onFileDownloadStopped, task => patch(task, { status: 'paused' })),
    observe(DownloadEvent.onFileDownloadError, (task, payload) => patch(task, { status: 'error', error: message(payload.error ?? 'The download failed.') })),
    observe(DownloadEvent.onModelValidationFailed, (task, payload) => patch(task, { status: 'error', error: message(payload.error ?? 'Model validation failed.') })),
    observe(DownloadEvent.onFileDownloadAndVerificationSuccess, task => patch(task, { status: task.promise ? 'importing' : 'completed' })),
    observe(AppEvent.onModelImported, task => patch(task, { status: task.promise ? 'importing' : 'completed' })),
  ]
  ctx.effect(() => registerApi(ctx, 'download', {
    list: () => service.list(),
    pause: ({ taskId }) => service.pause(taskId),
    cancel: ({ taskId }) => service.cancel(taskId),
    resume: ({ taskId }) => service.resume(taskId),
  }), 'ow-download: management API')
  ctx.effect(() => () => {
    disposed = true
    for (const dispose of disposers) dispose()
    listeners.clear()
  }, 'ow-download: lifecycle events')
}
