import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { getServiceHub } from '@/hooks/useServiceHub'
import { backendStorage } from '@/lib/backendStorage'
import { modelSettings } from '@/lib/predefined'
import { isLocalProvider } from '@/lib/utils'
import { API_KEY_FALLBACKS_SETTING_KEY } from '@/lib/provider-api-keys'

const API_KEY_SETTING_KEY = 'api-key'

// Built-in remote providers that no longer exist; saved copies are dropped by
// the store migration.
const REMOVED_BUILTIN_PROVIDERS = new Set([
  'openai',
  'azure',
  'anthropic',
  'openrouter',
  'mistral',
  'groq',
  'xai',
  'gemini',
  'minimax',
  'huggingface',
  'nvidia',
  'cohere',
])

// Secrets live only in the OS keyring (see register_provider_config), never in
// persisted settings storage. Strip the key chain from every provider before it
// is written to disk; the in-memory object keeps the keys (re-seeded from the
// keyring at boot in DataProvider) so synchronous consumers still work.
export function stripProviderSecrets(provider: ModelProvider): ModelProvider {
  const settings = provider.settings?.map((s) =>
    s.key === API_KEY_SETTING_KEY || s.key === API_KEY_FALLBACKS_SETTING_KEY
      ? { ...s, controller_props: { ...s.controller_props, value: '' } }
      : s
  )
  return {
    ...provider,
    api_key: undefined,
    api_key_fallbacks: undefined,
    ...(settings ? { settings } : {}),
  }
}

type ModelProviderState = {
  providers: ModelProvider[]
  selectedProvider: string
  selectedModel: Model | null
  deletedModels: string[]
  getModelBy: (modelId: string) => Model | undefined
  setProviders: (providers: ModelProvider[]) => void
  getProviderByName: (providerName: string) => ModelProvider | undefined
  updateProvider: (providerName: string, data: Partial<ModelProvider>) => void
  selectModelProvider: (
    providerName: string,
    modelName: string
  ) => Model | undefined
  addProvider: (provider: ModelProvider) => void
  deleteProvider: (providerName: string) => void
  deleteModel: (modelId: string) => void
  addDeletedModels: (modelIds: string[]) => void
}

export const useModelProvider = create<ModelProviderState>()(
  persist(
    (set, get) => ({
      providers: [],
      selectedProvider: 'llamacpp',
      selectedModel: null,
      deletedModels: [],
      getModelBy: (modelId: string) => {
        const provider = get().providers.find(
          (provider) => provider.provider === get().selectedProvider
        )
        if (!provider) return undefined
        return provider.models.find((model) => model.id === modelId)
      },
      setProviders: (providers) =>
        set((state) => {
          const existingProviders = state.providers
            // Filter out legacy llama.cpp provider for migration
            // Can remove after a couple of releases
            .filter((e) => e.provider !== 'llama.cpp')
            .map((provider) => {
              return {
                ...provider,
                models: provider.models.filter(
                  (e) =>
                    ('id' in e || 'model' in e) &&
                    typeof (e.id ?? e.model) === 'string'
                ),
              }
            })

          let legacyModels: Model[] | undefined = []
          /// Cortex Migration
          if (
            localStorage.getItem('cortex_model_settings_migrated') !== 'true'
          ) {
            legacyModels = state.providers.find(
              (e) => e.provider === 'llama.cpp'
            )?.models
            localStorage.setItem('cortex_model_settings_migrated', 'true')
          }
          // Ensure deletedModels is always an array
          const currentDeletedModels = Array.isArray(state.deletedModels)
            ? state.deletedModels
            : []

          // For local providers (llamacpp) the engine's list() is the
          // source of truth: a model only appears here if it is on disk. If
          // an id was previously soft-deleted but reappears in a fresh local
          // listing, the user has re-downloaded/re-imported it and the
          // tombstone must be cleared — otherwise the merge below filters it
          // out forever.
          const locallyPresentIds = new Set<string>()
          for (const p of providers) {
            if (!isLocalProvider(p.provider)) continue
            for (const m of p.models ?? []) {
              if (m?.id) locallyPresentIds.add(m.id)
            }
          }
          const effectiveDeletedModels =
            locallyPresentIds.size === 0
              ? currentDeletedModels
              : currentDeletedModels.filter((id) => !locallyPresentIds.has(id))

          const updatedProviders = providers.map((provider) => {
            const existingProvider = existingProviders.find(
              (x) => x.provider === provider.provider
            )
            const models = (existingProvider?.models || []).filter(
              (e) =>
                ('id' in e || 'model' in e) &&
                typeof (e.id ?? e.model) === 'string'
            )
            const mergedModels = [
              ...(provider?.models ?? []).filter(
                (e) =>
                  ('id' in e || 'model' in e) &&
                  typeof (e.id ?? e.model) === 'string' &&
                  !models.some((m) => m.id === e.id) &&
                  !effectiveDeletedModels.includes(e.id)
              ),
              ...models,
            ]
            const updatedModels = provider.models?.map((model) => {
              const settings =
                (legacyModels && legacyModels?.length > 0
                  ? legacyModels
                  : models
                ).find(
                  (m) =>
                    m.id
                      .split(':')
                      .slice(0, 2)
                      .join(getServiceHub().path().sep()) === model.id
                )?.settings || model.settings
              const existingModel = models.find((m) => m.id === model.id)
              const userConfiguredCapabilities =
                (
                  existingModel as Model & {
                    _userConfiguredCapabilities?: boolean
                  }
                )?._userConfiguredCapabilities === true

              const engineOwnedCaps = new Set(['vision', 'audio', 'embeddings'])
              const engineCaps = model.capabilities || []
              const existingCaps = existingModel?.capabilities || []
              const mergedCapabilities = userConfiguredCapabilities
                ? [
                    ...existingCaps.filter((c) => !engineOwnedCaps.has(c)),
                    ...engineCaps.filter((c) => engineOwnedCaps.has(c)),
                  ]
                : [
                    ...engineCaps,
                    ...existingCaps.filter((c) => !engineCaps.includes(c)),
                  ]
              return {
                ...model,
                settings: settings,
                capabilities:
                  mergedCapabilities.length > 0 ? mergedCapabilities : undefined,
                displayName: existingModel?.displayName || model.displayName,
                ...(userConfiguredCapabilities
                  ? { _userConfiguredCapabilities: true as const }
                  : {}),
              }
            })

            const mergedSettings = provider.settings.map((setting) => {
              const existingSetting = provider.persist
                ? undefined
                : existingProvider?.settings?.find(
                    (x) => x.key === setting.key
                  )
              // Only the user's `value` is carried over from existing state;
              // metadata like `recommended` / `options` must always reflect
              // the fresh extension fetch (otherwise stale recommendations
              // and stale option lists outlive the underlying setting).
              const existingValue = (
                existingSetting?.controller_props as
                  | { value?: string | number | boolean }
                  | undefined
              )?.value
              return {
                ...setting,
                controller_props: {
                  ...setting.controller_props,
                  ...(existingSetting && existingValue !== undefined
                    ? { value: existingValue }
                    : {}),
                },
              }
            })

            // API keys live only in the OS keyring, never in provider settings.
            // The in-memory chain is preserved from existing state or the
            // keyring-seeded incoming provider (DataProvider).
            return {
              ...provider,
              models: provider.persist ? updatedModels : mergedModels,
              settings: mergedSettings,
              api_key: existingProvider?.api_key || provider.api_key,
              api_key_fallbacks:
                existingProvider?.api_key_fallbacks ?? provider.api_key_fallbacks,
              base_url: existingProvider?.base_url || provider.base_url,
              active: existingProvider ? existingProvider?.active : true,
            }
          })
          const nextProviders = [
            ...updatedProviders,
            ...existingProviders.filter(
              (e) => !updatedProviders.some((p) => p.provider === e.provider)
            ),
          ]

          return effectiveDeletedModels === currentDeletedModels
            ? { providers: nextProviders }
            : {
                providers: nextProviders,
                deletedModels: effectiveDeletedModels,
              }
        }),
      updateProvider: (providerName, data) => {
        set((state) => {
          const providers = state.providers.map((provider) => {
            if (provider.provider === providerName) {
              return {
                ...provider,
                ...data,
              }
            }
            return provider
          })

          let selectedModel = state.selectedModel
          if (
            selectedModel &&
            state.selectedProvider === providerName &&
            Array.isArray(data.models)
          ) {
            selectedModel =
              data.models.find((model) => model.id === selectedModel?.id) ?? null
          }

          return {
            providers,
            selectedModel,
          }
        })
      },
      getProviderByName: (providerName: string) => {
        const provider = get().providers.find(
          (provider) => provider.provider === providerName
        )

        return provider
      },
      selectModelProvider: (providerName: string, modelName: string) => {
        // Find the model object
        const provider = get().providers.find(
          (provider) => provider.provider === providerName
        )

        let modelObject: Model | undefined = undefined

        if (provider && provider.models) {
          modelObject = provider.models.find((model) => model.id === modelName)
        }

        // Update state with provider name and model object
        set({
          selectedProvider: providerName,
          selectedModel: modelObject || null,
        })

        return modelObject
      },
      deleteModel: (modelId: string) => {
        set((state) => {
          // Ensure deletedModels is always an array
          const currentDeletedModels = Array.isArray(state.deletedModels)
            ? state.deletedModels
            : []

          return {
            providers: state.providers.map((provider) => {
              const models = provider.models.filter(
                (model) => model.id !== modelId
              )
              return {
                ...provider,
                models,
              }
            }),
            deletedModels: [...currentDeletedModels, modelId],
          }
        })
      },
      addDeletedModels: (modelIds: string[]) => {
        if (modelIds.length === 0) return
        set((state) => {
          const current = Array.isArray(state.deletedModels)
            ? state.deletedModels
            : []
          const next = new Set(current)
          modelIds.forEach((id) => next.add(id))
          if (next.size === current.length) return state
          return { deletedModels: Array.from(next) }
        })
      },
      addProvider: (provider: ModelProvider) => {
        set((state) => ({
          providers: [...state.providers, provider],
        }))
      },
      deleteProvider: (providerName: string) => {
        set((state) => ({
          providers: state.providers.filter(
            (provider) => provider.provider !== providerName
          ),
        }))
      },
    }),
    {
      name: localStorageKey.modelProvider,
      storage: createJSONStorage(() => backendStorage),
      // Async backend storage; hydrate explicitly after ServiceHub init.
      skipHydration: true,
      // Never persist API keys - they live in the OS keyring only - nor
      // extension providers, which exist only while their extension runs.
      partialize: (state) => ({
        ...state,
        providers: state.providers
          .filter((p) => !p.source)
          .map(stripProviderSecrets),
      }),
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as ModelProviderState & {
          providers: Array<
            ModelProvider & {
              models: Array<
                Model & {
                  settings?: Record<string, unknown> & {
                    chatTemplate?: string
                    chat_template?: string
                  }
                }
              >
            }
          >
        }

        if (version <= 1 && state?.providers) {
          state.providers.forEach((provider) => {
            // Update cont_batching description for llamacpp provider
            if (provider.provider === 'llamacpp' && provider.settings) {
              const contBatchingSetting = provider.settings.find(
                (s) => s.key === 'cont_batching'
              )
              if (contBatchingSetting) {
                contBatchingSetting.description =
                  'Enable continuous batching (a.k.a dynamic batching) for concurrent requests.'
              }
            }

            // Migrate model settings
            if (provider.models && provider.provider === 'llamacpp') {
              provider.models.forEach((model) => {
                if (!model.settings) model.settings = {}

                // Migrate chatTemplate key to chat_template
                if (model.settings.chatTemplate) {
                  model.settings.chat_template = model.settings.chatTemplate
                  delete model.settings.chatTemplate
                }

                // Add missing settings with defaults
                if (!model.settings.chat_template) {
                  model.settings.chat_template = {
                    ...modelSettings.chatTemplate,
                    controller_props: {
                      ...modelSettings.chatTemplate.controller_props,
                    },
                  }
                }

                if (!model.settings.override_tensor_buffer_t) {
                  model.settings.override_tensor_buffer_t = {
                    ...modelSettings.override_tensor_buffer_t,
                    controller_props: {
                      ...modelSettings.override_tensor_buffer_t
                        .controller_props,
                    },
                  }
                }

                if (!model.settings.no_kv_offload) {
                  model.settings.no_kv_offload = {
                    ...modelSettings.no_kv_offload,
                    controller_props: {
                      ...modelSettings.no_kv_offload.controller_props,
                    },
                  }
                }
              })
            }
          })
        }

        if (version <= 2 && state?.providers) {
          state.providers.forEach((provider) => {
            // Update cont_batching description for llamacpp provider
            if (provider.provider === 'llamacpp' && provider.settings) {
              const contBatchingSetting = provider.settings.find(
                (s) => s.key === 'cont_batching'
              )
              if (contBatchingSetting) {
                contBatchingSetting.description =
                  'Enable continuous batching (a.k.a dynamic batching) for concurrent requests.'
              }
            }

            // Migrate model settings
            if (provider.models && provider.provider === 'llamacpp') {
              provider.models.forEach((model) => {
                if (!model.settings) model.settings = {}

                if (!model.settings.batch_size) {
                  model.settings.batch_size = {
                    ...modelSettings.batch_size,
                    controller_props: {
                      ...modelSettings.batch_size.controller_props,
                    },
                  }
                }
              })
            }
          })
        }

        if (version <= 4 && state?.providers) {
          state.providers.forEach((provider) => {
            // Migrate model settings
            if (provider.models && provider.provider === 'llamacpp') {
              provider.models.forEach((model) => {
                if (!model.settings) model.settings = {}

                if (!model.settings.cpu_moe) {
                  model.settings.cpu_moe = {
                    ...modelSettings.cpu_moe,
                    controller_props: {
                      ...modelSettings.cpu_moe.controller_props,
                    },
                  }
                }

                if (!model.settings.n_cpu_moe) {
                  model.settings.n_cpu_moe = {
                    ...modelSettings.n_cpu_moe,
                    controller_props: {
                      ...modelSettings.n_cpu_moe.controller_props,
                    },
                  }
                }
              })
            }
          })
        }
        if (version <= 5 && state?.providers) {
          state.providers.forEach((provider) => {
            // Migrate flash_attn setting to dropdown for llamacpp provider
            if (provider.provider === 'llamacpp' && provider.settings) {
              const flashAttentionSetting = provider.settings.find(
                (s) => s.key === 'flash_attn'
              )
              if (flashAttentionSetting) {
                flashAttentionSetting.controller_type = 'dropdown'
                flashAttentionSetting.controller_props = {
                  ...flashAttentionSetting.controller_props,
                  options: [
                    { name: 'Auto', value: 'auto' },
                    { name: 'On', value: 'on' },
                    { name: 'Off', value: 'off' },
                  ],
                  value: 'auto',
                }
              }
            }
          })
        }
        if (version <= 7 && state?.providers) {
          // Remove 'proactive' capability from all models as it's now managed in MCP settings
          state.providers.forEach((provider) => {
            if (provider.models) {
              provider.models.forEach((model) => {
                if (model.capabilities) {
                  model.capabilities = model.capabilities.filter(
                    (cap) => cap !== 'proactive'
                  )
                }
              })
            }
          })
        }
        if (version <= 9 && state?.providers) {
          state.providers = state.providers.filter(
            (provider) => provider.provider !== 'cohere'
          )
        }

        // Migration v10 historically inserted `auto_increase_ctx_len`. The
        // setting was removed in v15, so v10 is now a no-op for any user
        // still passing through this point.

        if (version <= 11 && state?.providers) {
          state.providers.forEach((provider) => {
            if (provider.provider !== 'llamacpp') return

            // Reasoning moved from extension-level to per-model settings —
            // strip any stale entry from the provider settings panel.
            if (provider.settings) {
              provider.settings = provider.settings.filter(
                (s) => s.key !== 'reasoning'
              )
            }

            if (provider.models) {
              provider.models.forEach((model) => {
                if (!model.settings) model.settings = {}

                if (!model.settings.reasoning) {
                  model.settings.reasoning = {
                    ...modelSettings.reasoning,
                    controller_props: {
                      ...modelSettings.reasoning.controller_props,
                    },
                  }
                }
              })
            }
          })
        }

        if (version <= 12 && state?.providers) {
          // Reset ctx_len from the prior 8192 default to '' so llama.cpp picks
          // (auto-fit when enabled, model default otherwise). Preserve any
          // user-customised value.
          state.providers.forEach((provider) => {
            if (provider.provider !== 'llamacpp' || !provider.models) return
            provider.models.forEach((model) => {
              const ctx = model.settings?.ctx_len as
                | { controller_props?: { value?: unknown } }
                | undefined
              const controllerProps = ctx?.controller_props
              const ctxValue =
                typeof controllerProps?.value === 'string'
                  ? Number(controllerProps.value)
                  : controllerProps?.value
              if (ctxValue === 8192 && controllerProps) {
                controllerProps.value = ''
              }
            })
          })
        }

        if (version <= 13 && state?.providers) {
          // `defrag-thold` was deprecated upstream and the control was deleted
          // from settings.json. Strip the orphan entry from the persisted
          // provider settings array so localStorage doesn't carry it forever.
          state.providers.forEach((provider) => {
            if (provider.provider !== 'llamacpp' || !provider.settings) return
            provider.settings = provider.settings.filter(
              (s) => s.key !== 'defrag_thold'
            )
          })
        }

        if (version <= 14 && state?.providers) {
          // Auto-increase context was removed — the manual "Increase Context
          // Size" button in the error banner now owns this. Strip the per-model
          // setting entry from llamacpp models so the sidebar doesn't render a
          // dead control.
          state.providers.forEach((provider) => {
            if (provider.provider !== 'llamacpp' || !provider.models) return
            provider.models.forEach((model) => {
              if (model.settings?.auto_increase_ctx_len) {
                delete (model.settings as Record<string, unknown>)
                  .auto_increase_ctx_len
              }
            })
          })
        }
        if (version <= 16 && state?.providers) {
          // Auto-fit is now disabled by default, so seed empty/auto ctx_len
          // with the new 8192 default. Preserve any user-customised value.
          state.providers.forEach((provider) => {
            if (provider.provider !== 'llamacpp' || !provider.models) return
            provider.models.forEach((model) => {
              const ctx = model.settings?.ctx_len as
                | { controller_props?: { value?: unknown } }
                | undefined
              const controllerProps = ctx?.controller_props
              if (!controllerProps) return
              const value = controllerProps.value
              if (value === '' || value == null) {
                controllerProps.value = 8192
              }
            })
          })
        }

        if (version <= 17 && state?.providers) {
          // Grammar became a per-model setting; add the control to persisted
          // llamacpp models so the sidebar renders it.
          state.providers.forEach((provider) => {
            if (provider.provider !== 'llamacpp' || !provider.models) return
            provider.models.forEach((model) => {
              if (!model.settings) model.settings = {}
              if (!model.settings.grammar) {
                model.settings.grammar = {
                  ...modelSettings.grammar,
                  controller_props: {
                    ...modelSettings.grammar.controller_props,
                  },
                }
              }
            })
          })
        }

        if (version <= 18 && state?.providers) {
          // llama.cpp 0.4.0 added --n-cpu-ffn, the dense counterpart of
          // --n-cpu-moe; add the control to persisted llamacpp models so the
          // sidebar renders it.
          state.providers.forEach((provider) => {
            if (provider.provider !== 'llamacpp' || !provider.models) return
            provider.models.forEach((model) => {
              if (!model.settings) model.settings = {}
              if (!model.settings.n_cpu_ffn) {
                model.settings.n_cpu_ffn = {
                  ...modelSettings.n_cpu_ffn,
                  controller_props: {
                    ...modelSettings.n_cpu_ffn.controller_props,
                  },
                }
              }
            })
          })
        }

        if (version <= 19 && state?.providers) {
          // llama.cpp 0.7.0 added --moe-cache-mib. It is per-model because
          // llama.cpp refuses to load a dense model with it set; add the
          // control to persisted llamacpp models so the sidebar renders it.
          state.providers.forEach((provider) => {
            if (provider.provider !== 'llamacpp' || !provider.models) return
            provider.models.forEach((model) => {
              if (!model.settings) model.settings = {}
              if (!model.settings.moe_cache_mib) {
                model.settings.moe_cache_mib = {
                  ...modelSettings.moe_cache_mib,
                  controller_props: {
                    ...modelSettings.moe_cache_mib.controller_props,
                  },
                }
              }
            })
          })
        }

        if (version <= 20 && state?.providers) {
          // Auto-fit is on by default again (jan-internal#487), and fit leaves
          // a set context alone, so the 8192 the v16 migration seeded would
          // keep it from shrinking the context and would shadow the launched
          // n_ctx in every readout that prefers ctx_len. The seed carries no provenance, so
          // 8192 is taken to be it, as v12 did; a user who typed exactly 8192
          // loses it here and in model.yml (the extension's
          // migrateSeededCtxSize), which with fit off changes nothing.
          state.providers.forEach((provider) => {
            if (provider.provider !== 'llamacpp' || !provider.models) return
            provider.models.forEach((model) => {
              const controllerProps = (
                model.settings?.ctx_len as
                  | { controller_props?: { value?: unknown } }
                  | undefined
              )?.controller_props
              if (controllerProps && Number(controllerProps.value) === 8192) {
                controllerProps.value = ''
              }
            })
          })
        }

        if (version <= 21 && state?.providers) {
          // Only llamacpp and user-added OpenAI-compatible providers remain.
          // Drop the retired built-in remote providers (and anything saved
          // with the removed Anthropic `api_type`); strip the dead field.
          state.providers = state.providers.filter(
            (provider) =>
              !REMOVED_BUILTIN_PROVIDERS.has(provider.provider) &&
              (provider as { api_type?: string }).api_type !== 'anthropic'
          )
          state.providers.forEach((provider) => {
            delete (provider as { api_type?: string }).api_type
          })
          if (
            state.selectedProvider &&
            !state.providers.some((p) => p.provider === state.selectedProvider)
          ) {
            state.selectedProvider = 'llamacpp'
            state.selectedModel = null
          }
        }

        return state
      },
      version: 22,
    }
  )
)
