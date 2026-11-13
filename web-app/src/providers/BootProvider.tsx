import { bridgeModelValidationStarted } from '@/lib/modelValidationBridge'
import { getServiceHub } from '@/hooks/useServiceHub'
import { startLlamacppEngine } from '@/lib/llamacpp'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { emit } from '@tauri-apps/api/event'
import { PropsWithChildren, useEffect, useState } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'

// Secondary windows (logs, system monitor) reuse the same React bundle but
// their Tauri capabilities do not grant hardware:*/llamacpp:*/etc. Starting
// the engine there triggers ACL-denied invokes and would double-spawn the
// llama-server router. Gate the engine on the main window.
function isMainWindow(): boolean {
  try {
    return getCurrentWebviewWindow().label === 'main'
  } catch {
    return true
  }
}

export function BootProvider({ children }: PropsWithChildren) {
  const { t } = useTranslation()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Watchdog: a stuck engine start must never leave the app on a blank
    // window. Startup still completes in the background.
    const watchdog = setTimeout(() => {
      console.warn('Engine setup exceeded timeout; rendering UI anyway.')
      setReady(true)
    }, 20000)

    const main = isMainWindow()
    if (main) {
      void startLlamacppEngine().finally(() => {
        clearTimeout(watchdog)
        setReady(true)
      })
    } else {
      clearTimeout(watchdog)
      setReady(true)
    }

    // Every window receives the backend event, but the toast belongs to the
    // window that started the download. A failed listen settles to
    // undefined so cleanup has nothing to stop.
    const validationBridge = main
      ? bridgeModelValidationStarted(getServiceHub().events()).catch(
          (error: unknown) => {
            console.error('Relaying model validation failed:', error)
            return undefined
          }
        )
      : undefined

    return () => {
      clearTimeout(watchdog)
      void validationBridge?.then((stop) => stop?.())
    }
  }, [])

  useEffect(() => {
    const caption = document.getElementById('initial-loader-caption')
    if (caption) caption.textContent = t('settingUpJan')
  }, [t])

  // Dismiss the loader only once the gated UI is ready, not on a fixed timer.
  useEffect(() => {
    if (!ready) return
    if (isMainWindow()) emit('app-ready').catch(() => {})
    let removeTimer: ReturnType<typeof setTimeout>
    const raf = requestAnimationFrame(() => {
      document.body.classList.add('loaded')
      removeTimer = setTimeout(() => {
        document.getElementById('initial-loader')?.remove()
      }, 300)
    })
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(removeTimer)
    }
  }, [ready])

  return <>{ready && children}</>
}
