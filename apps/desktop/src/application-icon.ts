/** Location of the Jan application artwork used by native windows and the About panel. */
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Resolve the 1024 px Windows application PNG for this run.
 * Packaged builds read the copy electron-builder places in `resources/icon.png`; source runs read
 * `apps/desktop/resources/icon-windows.png`, the same file.
 * @returns absolute path of the application icon PNG.
 */
export function applicationIconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'resources', 'icon-windows.png')
}
