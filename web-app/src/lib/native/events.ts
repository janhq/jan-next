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
  onModelImported = 'onModelImported',
  onBackendVerificationFailed = 'onBackendVerificationFailed',
}

export enum DownloadEvent {
  onFileDownloadUpdate = 'onFileDownloadUpdate',
  onFileDownloadError = 'onFileDownloadError',
  onFileDownloadSuccess = 'onFileDownloadSuccess',
  onFileDownloadStopped = 'onFileDownloadStopped',
  onModelValidationStarted = 'onModelValidationStarted',
  onModelValidationFailed = 'onModelValidationFailed',
  onFileDownloadAndVerificationSuccess = 'onFileDownloadAndVerificationSuccess',
}
