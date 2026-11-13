import '@/lib/zodCsp'
import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { invoke } from '@tauri-apps/api/core'
import {
  pruneLocalStorageByFlags,
  type WebdataResetFlags,
} from '@/services/app/reset-localstorage'
import { installConsoleLogForwarding } from '@/services/app/console-logger'

import './index.css'

// Prevent browser from opening dropped files
const preventDefaultFileDrop = () => {
  document.addEventListener('dragover', (e) => {
    e.preventDefault()
  })
  document.addEventListener('drop', (e) => {
    e.preventDefault()
  })
}

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>
  }
}

// Consume a pending factory-reset sentinel and prune persisted UI state BEFORE
// any store module loads (Zustand persist hydrates synchronously at import).
// This is the only race-free, cross-platform way to clear webview localStorage.
const consumePendingWebdataReset = async () => {
  try {
    const flags = await invoke<WebdataResetFlags | null>(
      'take_pending_webdata_reset'
    )
    if (flags) pruneLocalStorageByFlags(flags)
  } catch {
    // Non-Tauri (web) build or no sentinel — nothing to do.
  }
}

const boot = async () => {
  installConsoleLogForwarding()
  preventDefaultFileDrop()

  await consumePendingWebdataReset()

  // Dynamic imports keep store hydration AFTER the localStorage prune above.
  const { routeTree } = await import('./routeTree.gen')
  await import('./i18n')

  const router = createRouter({ routeTree })

  const rootElement = document.getElementById('root')!
  if (!rootElement.innerHTML) {
    const root = ReactDOM.createRoot(rootElement)
    root.render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>
    )
  }
}

const BOOT_RETRY_KEY = 'boot-retried'

// A failed boot leaves only the static splash, which no React code will ever
// dismiss. On a cold dev server the route bundle can 404 while Vite is still
// compiling, so retry once by itself, then show the error with a way out
// instead of an endless "Booting up".
const showBootFailure = (e: unknown) => {
  if (!sessionStorage.getItem(BOOT_RETRY_KEY)) {
    sessionStorage.setItem(BOOT_RETRY_KEY, '1')
    location.reload()
    return
  }
  const caption = document.getElementById('initial-loader-caption')
  if (!caption) return
  caption.textContent = `Jan could not start: ${e instanceof Error ? e.message : String(e)}`
  caption.style.lineHeight = '1.4'
  caption.style.maxWidth = '32rem'
  const retry = document.createElement('button')
  retry.textContent = 'Reload'
  retry.className =
    'rounded-md border border-current px-3 py-1 text-sm opacity-80 hover:opacity-100'
  retry.onclick = () => location.reload()
  caption.after(retry)
  document.querySelector('#initial-loader img')?.setAttribute('style', 'animation:none')
}

boot()
  .then(() => sessionStorage.removeItem(BOOT_RETRY_KEY))
  .catch((e) => {
    console.error('Failed to boot app:', e)
    showBootFailure(e)
  })
