import { useModelProvider } from '@/hooks/useModelProvider'
import { APIs } from '@/lib/service'

import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useEffect } from 'react'
import { useMCPServers } from '@/hooks/useMCPServers'
import { useAssistant } from '@/hooks/useAssistant'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useThreads } from '@/hooks/useThreads'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useAppState } from '@/hooks/useAppState'
import { HUGGINGFACE_TOKEN_SECRET_KEY } from '@/lib/native'
import { AppEvent, events } from '@/lib/native'
import { SystemEvent } from '@/types/events'
import { invoke } from '@tauri-apps/api/core'
import { providerHasRemoteApiKeys, providerRemoteApiKeyChain } from '@/lib/provider-api-keys'

type ProviderCustomHeader = {
  header: string
  value: string
}

type RegisterProviderRequest = {
  provider: string
  api_key?: string
  api_keys?: string[]
  base_url?: string
  custom_headers: ProviderCustomHeader[]
  models: string[]
}

async function registerRemoteProvider(provider: ModelProvider) {
  // Skip llamacpp - those are local models
  if (provider.provider === 'llamacpp') return

  const chain = providerRemoteApiKeyChain(provider)
  if (chain.length === 0) {
    console.log(`Provider ${provider.provider} has no API key, skipping registration`)
    return
  }

  const request: RegisterProviderRequest = {
    provider: provider.provider,
    api_key: chain[0],
    api_keys: chain.slice(1),
    base_url: provider.base_url,
    custom_headers: (provider.custom_header || []).map((h) => ({
      header: h.header,
      value: h.value,
    })),
    models: provider.models.map(e => e.id)
  }

  try {
    await invoke('register_provider_config', { request })
    console.debug(`Registered remote provider: ${provider.provider}`)
  } catch (error) {
    console.error(`Failed to register provider ${provider.provider}:`, error)
  }
}

// Re-seed in-memory provider keys from the OS keyring. Keys are no longer
// persisted to settings storage (stripped by useModelProvider.partialize), so
// after a reload the store has none; synchronous consumers (model-factory,
// presence checks) read provider.api_key, so we repopulate the runtime objects.
async function seedProviderKeysFromKeyring(
  providers: ModelProvider[]
): Promise<ModelProvider[]> {
  return Promise.all(
    providers.map(async (provider) => {
      if (provider.provider === 'llamacpp') return provider
      try {
        const keys = await invoke<string[]>('get_provider_keys', {
          provider: provider.provider,
        })
        if (!keys || keys.length === 0) return provider
        return {
          ...provider,
          api_key: keys[0],
          api_key_fallbacks: keys.slice(1),
        }
      } catch (error) {
        console.warn(
          `Failed to load keyring keys for ${provider.provider}:`,
          error
        )
        return provider
      }
    })
  )
}

// Re-seed keyring keys into the store for EVERY provider, including
// user-added custom ones (getProviders() only returns predefined + engine
// providers, so custom providers would otherwise stay keyless after a reload).
// Applies via updateProvider so it merges over the already-hydrated state.
async function applyKeyringKeys(): Promise<void> {
  const store = useModelProvider.getState()
  const seeded = await seedProviderKeysFromKeyring(store.providers)
  for (const p of seeded) {
    const current = store.providers.find((x) => x.provider === p.provider)
    if (p.api_key && p.api_key !== current?.api_key) {
      store.updateProvider(p.provider, {
        api_key: p.api_key,
        api_key_fallbacks: p.api_key_fallbacks,
      })
    }
  }
}

// Track which providers have been registered so we can unregister stale ones
let registeredProviderNames = new Set<string>()

// Effect to sync remote providers when providers change
const syncRemoteProviders = () => {
  const providers = useModelProvider.getState().providers
  const currentActive = new Set<string>()

  providers.forEach((provider) => {
    if (
      provider.active &&
      provider.provider !== 'llamacpp' &&
      providerHasRemoteApiKeys(provider)
    ) {
      registerRemoteProvider(provider)
      currentActive.add(provider.provider)
    }
  })

  // Unregister providers that were previously registered but are now inactive/removed
  for (const name of registeredProviderNames) {
    if (!currentActive.has(name)) {
      invoke('unregister_provider_config', { provider: name }).catch(() => {})
    }
  }

  registeredProviderNames = currentActive
}

export function DataProvider() {
  const { setProviders, getProviderByName } =
    useModelProvider()

  const { setServers } = useMCPServers()
  const { setAssistants } = useAssistant()
  const { setThreads } = useThreads()
  const setThreadsLoading = useThreads((s) => s.setThreadsLoading)
  // The thread fetch re-runs whenever its effect does (StrictMode remount,
  // a new service hub); the sandbox sweep should run once per session.
  const navigate = useNavigate()
  const serviceHub = useServiceHub()

  // Local API Server hooks
  const {
    enableOnStartup,
    serverHost,
    serverPort,
    setServerPort,
    apiPrefix,
    apiKey,
    trustedHosts,
    corsEnabled,
    verboseLogs,
    proxyTimeout,
    lastServerModels,
    setLastServerModels,
    defaultModelLocalApiServer,
    runInBackground,
  } = useLocalApiServer()
  const setServerStatus = useAppState((state) => state.setServerStatus)

  useEffect(() => {
    console.log('Initializing DataProvider...')
    serviceHub.providers().getProviders().then(async (fetched) => {
      setProviders(fetched)
      // Seed keyring keys into the merged store (predefined + engine + custom).
      await applyKeyringKeys()
      // Register active remote providers with the backend, keys now in place.
      useModelProvider.getState().providers.forEach((provider) => {
        if (provider.active) {
          registerRemoteProvider(provider)
          registeredProviderNames.add(provider.provider)
        }
      })
    })
    // Re-seed the Hugging Face token from the keyring (no longer persisted to
    // settings storage) into the store for this session.
    invoke<string | null>('get_secret', {
      key: HUGGINGFACE_TOKEN_SECRET_KEY,
    })
      .then((token) => {
        if (token) useGeneralSetting.getState().setHuggingfaceToken(token)
      })
      .catch(() => {})
    serviceHub
      .mcp()
      .getMCPConfig()
      .then((data) => {
        setServers(data.mcpServers ?? {})
      })
    serviceHub
      .assistants()
      .getAssistants()
      .then((data) => {
        // Only update assistants if we have valid data
        if (data && Array.isArray(data) && data.length > 0) {
          setAssistants(data as unknown as Assistant[])
        } else {
          setAssistants(null)
        }
      })
      .catch((error) => {
        console.warn('Failed to load assistants, keeping default:', error)
      })
    serviceHub.deeplink().getCurrent().then(handleDeepLink)

    let unsubscribeOpenUrl = () => {}
    serviceHub
      .deeplink()
      .onOpenUrl(handleDeepLink)
      .then((unsub) => {
        unsubscribeOpenUrl = unsub
      })

    // Listen for deep link events
    let unsubscribe = () => {}
    serviceHub
      .events()
      .listen(SystemEvent.DEEP_LINK, (event) => {
        const deep_link = event.payload as string
        handleDeepLink([deep_link])
      })
      .then((unsub) => {
        unsubscribe = unsub
      })
    return () => {
      unsubscribeOpenUrl()
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceHub])

  useEffect(() => {
    // fetchThreads throws while the backend is not ready yet (startup race,
    // e.g. reload mid-stream). Retry with backoff instead of letting a single
    // failed fetch leave the thread list permanently empty.
    let cancelled = false
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () => {
      serviceHub
        .threads()
        .fetchThreads()
        .then((threads) => {
          if (cancelled) return
          // Never overwrite a populated list with an empty fetch result: an
          // empty array here is more likely a transient not-ready state than
          // the user having zero threads.
          if (
            threads.length === 0 &&
            Object.keys(useThreads.getState().threads).length > 0
          ) {
            return
          }
          setThreads(threads)
          setThreadsLoading(false)
        })
        .catch(() => {
          if (cancelled) return
          if (attempt >= 20) {
            setThreadsLoading(false)
            return
          }
          attempt += 1
          timer = setTimeout(load, Math.min(1000, 150 * attempt))
        })
    }
    load()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [serviceHub, setThreads, setThreadsLoading])

  // Sync remote providers with backend when providers change
  const providers = useModelProvider((s) => s.providers)
  useEffect(() => {
    syncRemoteProviders()
  }, [providers])

  useEffect(() => {
    const handler = () => {
      serviceHub.providers().getProviders().then(async (fetched) => {
        setProviders(fetched)
        await applyKeyringKeys()
        syncRemoteProviders()
          })
    }
    events.on(AppEvent.onModelImported, handler)
    return () => {
      events.off(AppEvent.onModelImported, handler)
    }
  }, [serviceHub, setProviders])

  // Keep the backend's hide-to-tray-on-close flag in sync with the setting
  useEffect(() => {
    serviceHub
      .app()
      .setServerRunInBackground(runInBackground)
      .catch((error) =>
        console.error('Failed to sync run-in-background setting:', error)
      )
  }, [serviceHub, runInBackground])

  // Reconcile the UI with the backend server on every webview boot (the Rust
  // server outlives the webview, e.g. across a hide-to-tray reload), then
  // auto-start it only if enabled and not already running.
  useEffect(() => {
    // Only a start this effect began may be rolled back to 'stopped': a failed
    // status query must not clobber a start the user began elsewhere.
    let startedPending = false
    serviceHub
      .app()
      .getServerStatus()
      .then(async (isRunning) => {
        if (isRunning) {
          console.log('Local API Server is already running')
          setServerStatus('running')
          return
        }

        if (!enableOnStartup) return

        setServerStatus('pending')
        startedPending = true

        // Start model(s): prefer user-configured default, fall back to last session's models
        const modelsToStart = (() => {
          if (defaultModelLocalApiServer) {
            return [defaultModelLocalApiServer]
          }
          return lastServerModels
        })()

        if (modelsToStart.length > 0) {
          await Promise.allSettled(
            modelsToStart.map(async ({ model, provider: providerName }) => {
              const provider = getProviderByName(providerName)
              if (!provider) return
              try {
                await serviceHub.models().startModel(provider, model, true)
                console.log(`Auto-started server model: ${model}`)
              } catch (err) {
                console.warn(`Failed to auto-start server model ${model}:`, err)
              }
            })
          )
        }

        return APIs
          ?.startServer({
            host: serverHost,
            port: serverPort,
            prefix: apiPrefix,
            apiKey,
            trustedHosts,
            isCorsEnabled: corsEnabled,
            isVerboseEnabled: verboseLogs,
            proxyTimeout: proxyTimeout,
          })
          .then(async (actualPort: number) => {
            // Store the port the server actually bound to
            if (actualPort && actualPort !== serverPort) {
              setServerPort(actualPort)
            }
            setServerStatus('running')
            // Persist whichever models are actually running so next startup can restore them
            const activeModels = await serviceHub.models().getActiveModels().catch(() => [] as string[])
            if (activeModels.length > 0) {
              const allProviders = useModelProvider.getState().providers
              const serverModels = activeModels.flatMap((id) => {
                const p = allProviders.find((p) => p?.models?.some((m: { id: string }) => m.id === id))
                return p ? [{ model: id, provider: p.provider }] : []
              })
              if (serverModels.length > 0) setLastServerModels(serverModels)
            }
          })
      })
      .catch((error: unknown) => {
        console.error('Failed to sync or start Local API Server on startup:', error)
        if (startedPending) setServerStatus('stopped')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceHub])

  const handleDeepLink = (urls: string[] | null) => {
    if (!urls) return
    console.log('Received deeplink:', urls)
    const deeplink = urls[0]
    if (deeplink) {
      const url = new URL(deeplink)
      const params = url.pathname.split('/').filter((str) => str.length > 0)

      if (params.length < 3) return undefined
      // const action = params[0]
      // const provider = params[1]
      const resource = params.slice(1).join('/')
      // return { action, provider, resource }
      navigate({
        to: route.hub.model,
        search: {
          repo: resource,
        },
      })
    }
  }

  return null
}
