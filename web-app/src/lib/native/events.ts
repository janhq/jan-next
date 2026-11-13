import { EventEmitter } from '@/services/events/EventEmitter'

// Process-wide bus for download/model/app events. It replaces the one the
// extension host used to keep on window.core.events (removed).
const bus = new EventEmitter()

export const events = {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  on: (eventName: string, handler: Function) => bus.on(eventName, handler),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  off: (eventName: string, handler: Function) => bus.off(eventName, handler),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emit: (eventName: string, object: any) => bus.emit(eventName, object),
}

export enum AppEvent {
  onAppUpdateNotAvailable = 'onAppUpdateNotAvailable',
  onAppUpdateAvailable = 'onAppUpdateAvailable',
  onAppUpdateDownloadUpdate = 'onAppUpdateDownloadUpdate',
  onAppUpdateDownloadError = 'onAppUpdateDownloadError',
  onAppUpdateDownloadSuccess = 'onAppUpdateDownloadSuccess',
  onModelImported = 'onModelImported',
  onDeepLink = 'onDeepLink',
  onBackendVerificationFailed = 'onBackendVerificationFailed',
  onBackendRollback = 'onBackendRollback',
  onBackendUpdateQueued = 'onBackendUpdateQueued',
}

export enum DownloadEvent {
  onFileDownloadUpdate = 'onFileDownloadUpdate',
  onFileDownloadError = 'onFileDownloadError',
  onFileDownloadSuccess = 'onFileDownloadSuccess',
  onFileDownloadStopped = 'onFileDownloadStopped',
  onFileDownloadStarted = 'onFileDownloadStarted',
  onModelValidationStarted = 'onModelValidationStarted',
  onModelValidationFailed = 'onModelValidationFailed',
  onFileDownloadAndVerificationSuccess = 'onFileDownloadAndVerificationSuccess',
}
