/** The primary application frame can request camera or microphone access from the operating system. */
import { systemPreferences, type Session, type WebContents } from 'electron'

function applicationFrame(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'jan-app:' && parsed.hostname === 'app'
  } catch { return false /* Invalid frame URLs cannot request media access. */ }
}

/**
 * Handle media requests from the owned application window; other permissions retain Electron's defaults.
 * @param session - application's browser session.
 * @param primary - current primary window contents, absent while no window is open.
 */
export function installMediaPermissions(session: Pick<Session, 'setPermissionCheckHandler' | 'setPermissionRequestHandler'>, primary: () => WebContents | undefined): void {
  session.setPermissionCheckHandler((contents, permission, origin, details) => {
    if (permission !== 'media') return true
    const device = details.mediaType === 'audio' ? 'microphone' : details.mediaType === 'video' ? 'camera' : undefined
    return contents != null && contents === primary() && details.isMainFrame && applicationFrame(origin) && device !== undefined
      && (process.platform !== 'darwin' || systemPreferences.getMediaAccessStatus(device) === 'granted')
  })
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (permission !== 'media') { callback(true); return }
    const type = 'mediaTypes' in details && details.mediaTypes.length === 1 ? details.mediaTypes[0] : undefined
    const device = type === 'audio' ? 'microphone' : type === 'video' ? 'camera' : undefined
    if (contents !== primary() || !details.isMainFrame || !applicationFrame(details.requestingUrl) || device === undefined) {
      callback(false)
      return
    }
    if (process.platform !== 'darwin') { callback(true); return }
    void systemPreferences.askForMediaAccess(device).then(callback, () => { callback(false) })
  })
}
