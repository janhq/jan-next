import { useEffect, useState } from 'react'
import { initializeServiceHub } from '@/services'
import { initializeServiceHubStore } from '@/hooks/useServiceHub'
import { hydrateBackendStores } from '@/lib/hydrateStores'
import { migrateLocalStorageToBackend } from '@/lib/migrateLocalStorageSettings'
import { openDshShell } from '@/lib/dsh-shell'
import { Button } from '@/components/ui/button'

interface ServiceHubProviderProps {
  children: React.ReactNode
}

export function ServiceHubProvider({ children }: ServiceHubProviderProps) {
  const [isReady, setIsReady] = useState(false)
  const [shellError, setShellError] = useState<string | null>(null)

  useEffect(() => {
    initializeServiceHub()
      .then(async (hub) => {
        console.log('Services initialized, initializing Zustand store')
        initializeServiceHubStore(hub)
        // One-time localStorage -> backend migration must run before hydration
        // so the backend store is populated before any store reads it.
        await migrateLocalStorageToBackend()
        // Settings stores use async backend storage; hydrate before rendering
        // children so no component reads pre-hydration defaults.
        await hydrateBackendStores()
        if (IS_TAURI) {
          await openDshShell()
          return
        }
        setIsReady(true)
      })
      .catch((error) => {
        console.error('Service initialization failed:', error)
        if (IS_TAURI) {
          setShellError(error instanceof Error ? error.message : String(error))
        } else {
          setIsReady(true)
        }
      })
  }, [])

  useEffect(() => {
    if (shellError) document.getElementById('initial-loader')?.remove()
  }, [shellError])

  if (shellError) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <section role="alert" className="w-full max-w-lg space-y-4">
          <h1 className="text-balance text-xl font-medium">Jan could not start</h1>
          <p className="text-pretty break-words text-sm text-muted-foreground">
            {shellError}
          </p>
          <Button onClick={() => window.location.reload()}>Retry</Button>
        </section>
      </main>
    )
  }

  return <>{isReady && children}</>
}
