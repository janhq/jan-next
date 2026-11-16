import '@/lib/zodCsp'
import ReactDOM from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { ServiceHubProvider } from '@/providers/ServiceHubProvider'
import {
  pruneLocalStorageByFlags,
  type WebdataResetFlags,
} from '@/services/app/reset-localstorage'
import { installConsoleLogForwarding } from '@/services/app/console-logger'
import './index.css'

installConsoleLogForwarding()
for (const event of ['dragover', 'drop']) {
  document.addEventListener(event, (e) => e.preventDefault())
}

async function boot() {
  const flags = await invoke<WebdataResetFlags | null>('take_pending_webdata_reset')
  if (flags) pruneLocalStorageByFlags(flags)
  // Backend stores skip automatic hydration; the provider hydrates after reset.
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <ServiceHubProvider>{null}</ServiceHubProvider>
  )
}

boot().catch((error: unknown) => {
  const caption = document.getElementById('initial-loader-caption')!
  caption.textContent = `Jan could not start: ${error instanceof Error ? error.message : String(error)}`
  const retry = document.createElement('button')
  retry.textContent = 'Retry'
  retry.onclick = () => window.location.reload()
  caption.after(retry)
})
