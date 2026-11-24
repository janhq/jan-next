/** Lazy, desktop-only replacement for the stock first-run questions. */
window.__ModuleLoader__.load({
  id: '@janhq/jan-onboarding',
  factory(require) {
    const { createElement: h, useEffect, useState } = require('react')
    const { Button } = require('@janhq/jan-client-ui-primitives')
    const id = 'jan-onboarding'

    return {
      inject: ['slots', 'locale', 'remote', 'remote.agentPresets', 'remote.pluginManager', 'remote.settings'],
      apply(ctx) {
        async function settings(namespace, patch) {
          const result = await ctx.remote.settings.update(namespace, patch, undefined)
          if (!result.ok) throw new Error(`Unable to update ${namespace}: ${result.error.message}`)
        }
        const operations = {
          async catalog() {
            const [modes, plugins] = await Promise.all([ctx.remote.agentPresets.list(), ctx.remote.pluginManager.listBundles()])
            if (!modes.ok || !plugins.ok) throw new Error('Setup catalog unavailable')
            return { presets: modes.value.presets.map(preset => preset.id), bundles: plugins.value }
          },
          async enable(name) {
            const result = await ctx.remote.pluginManager.setBundleEnabled(name, true)
            return result.ok ? result.value.application : 'failed'
          },
          setDefault: selectedDefault => settings('agent-preset-registry', { selectedDefault }),
          saveProfile: profile => settings(id, profile),
          // The first-run model choice, run once onboarding has closed. Each route uses the app's own
          // flow: a local model chat, the account sign-in dialog, or the Models settings page.
          // `model` is the local pick: a curated catalog entry or a Hugging Face file from the catalog.
          connect(route, model) {
            if (route === 'local') return void openLocalChat(model)
            if (route === 'account') return void ctx.get('accountSignIn')?.start().catch(() => {})
            if (route === 'api-key') ctx.get('settingsNavigation')?.open('models')
          },
          localAvailable: () => llama !== undefined,
          // The curated models the Host offers, with how each fits this machine.
          async localModels() {
            const state = await answer(llama.readState())
            const budget = memoryBudget(state.hardware)
            return { budget, models: state.catalog.map(entry => ({
              key: entry.id, id: entry.id, repo: entry.repo, name: entry.name, detail: entry.repo.split('/')[0], bytes: entry.bytes,
              installed: entry.installed, recommended: entry.recommended, fit: entry.fit,
            })) }
          },
          // Every model in Jan's public catalog, read once per session, for the search field.
          searchCatalog() {
            hub ??= fetch(CATALOG).then(response => {
              if (!response.ok) throw new Error(`HTTP ${response.status}`)
              return response.json()
            }).then(rows => (Array.isArray(rows) ? rows : []).map(row).filter(Boolean)
              .sort((a, b) => b.downloads - a.downloads))
            hub.catch(() => { hub = undefined })
            return hub
          },
        }
        const CATALOG = 'https://raw.githubusercontent.com/janhq/model-catalog/main/model_catalog_v2.json'
        let hub
        async function answer(call) {
          const result = await call
          if (!result.ok) throw new Error(result.error.message)
          return result.value
        }
        // Like the Hub page: 80% of the accelerator (or system) memory, the rest left for the runtime.
        function memoryBudget(hardware) {
          if (!hardware) return 0
          const accelerator = hardware.devices.reduce((sum, device) => sum + device.totalMiB * 1024 ** 2, 0)
          const capacity = hardware.backend === 'metal' && accelerator > 0 ? Math.min(accelerator, hardware.memoryBytes) : accelerator || hardware.memoryBytes
          return Math.floor(capacity * 0.8)
        }
        const sizeBytes = size => {
          const match = /^([\d.]+)\s*([KMGT]?)B?$/i.exec(String(size ?? '').trim())
          return match ? Number(match[1]) * 1000 ** ' KMGT'.indexOf(match[2].toUpperCase() || ' ') : 0
        }
        // One catalog row as a pickable model: its Q4_K_M file (the usual size and quality balance),
        // else another 4-bit file, else its first model file. Projectors, draft and multi-token-prediction
        // heads and split parts are not models on their own. Rows without a downloadable file are dropped.
        function row(entry) {
          const files = (Array.isArray(entry?.quants) ? entry.quants : []).flatMap(quant => {
            const match = typeof quant?.path === 'string' ? /huggingface\.co\/([^/]+\/[^/]+)\/(?:resolve|blob)\/[^/]+\/([^?#]+\.gguf)/i.exec(quant.path) : null
            const file = match && decodeURIComponent(match[2])
            return file && !/mmproj|imatrix|^(?:dflash|mtp)-|-draft|-\d{5}-of-\d{5}\.gguf$/i.test(file) ? [{ repo: match[1], file, bytes: sizeBytes(quant.file_size) }] : []
          })
          if (files.length === 0 || typeof entry.model_name !== 'string') return undefined
          const pick = files.find(file => /[-_.]Q4_K_M\.gguf$/i.test(file.file)) ?? files.find(file => /[-_.](?:UD-)?I?Q4_/i.test(file.file)) ?? files[0]
          const projectors = Array.isArray(entry.mmproj_models) ? entry.mmproj_models.map(projector => sizeBytes(projector.file_size)) : []
          return {
            key: `${pick.repo}/${pick.file}`, repo: pick.repo, file: pick.file, bytes: pick.bytes + Math.max(0, ...projectors),
            name: entry.model_name.replace(/[-_]gguf$/i, ''), detail: String(entry.developer ?? pick.repo.split('/')[0]),
            downloads: Number.isFinite(entry.downloads) ? entry.downloads : 0,
          }
        }
        // The Model Hub opens a new chat on the model and, while it downloads, shows the progress there
        // like for any chat waiting on a download. It takes the request synchronously from the event;
        // without the Hub the download still starts and stays visible in Settings -> Models.
        function openLocalChat(model) {
          if (model === undefined) return void answer(llama.beginInstall()).catch(() => {})
          sessionStorage.setItem('jan:local-model-chat', JSON.stringify(model))
          window.dispatchEvent(new Event('jan:local-model-chat'))
          if (sessionStorage.getItem('jan:local-model-chat') === null) return
          sessionStorage.removeItem('jan:local-model-chat')
          const started = model.file !== undefined ? llama.downloadRepoFile(model.repo, model.file)
            : llama[model.installed ? 'setDefaultModel' : 'downloadModel'](model.id)
          void answer(started).catch(() => {})
        }
        // The local model Remote exists only in builds that ship llama.cpp.
        let llama
        ctx.inject(['remote.llamaCpp'], scope => {
          llama = scope.remote.llamaCpp
          scope.effect(() => () => { llama = undefined })
        })
        let loaded
        let active = true
        ctx.effect(() => () => { active = false })
        const loadLocale = { getSnapshot: () => ctx.locale.getSnapshot().active, subscribe: callback => ctx.locale.subscribe(callback) }
        const translate = (key, values) => ctx.locale.bind(id)(key, values)
        function RenderFlow({ useLanguage, t, ...props }) {
          useLanguage(language => language)
          const [View, setView] = useState(null)
          const [failed, setFailed] = useState(false)
          const [attempt, setAttempt] = useState(0)
          useEffect(() => {
            let mounted = true
            loaded ??= Promise.all([require.async('./client.view.js'), require.async('./client.setup.js'), require.async('./client.locale.js')])
              .then(([{ createFlow }, setup, { dictionaries }]) => {
                if (!active) return null
                ctx.effect(() => ctx.locale.register(id, dictionaries))
                return createFlow(setup, operations)
              }).catch(error => { loaded = undefined; throw error })
            void loaded.then(value => { if (mounted) setView(() => value) }, () => { if (mounted) setFailed(true) })
            return () => { mounted = false }
          }, [attempt])
          if (View !== null) return h(View, { ...props, t: translate })
          return failed ? h('div', { role: 'alert' }, t('onboardingSaveFailed'), ' ',
            h(Button, { onClick: () => { setFailed(false); setAttempt(attempt + 1) } }, t('onboardingRetry')), ' ',
            h(Button, { disabled: props.busy, onClick: () => { void props.finish(null) } }, t('onboardingSkip')))
            : h('div', { role: 'status' }, t('onboardingLoading'))
        }
        ctx.slots.inject('settings.onboarding.flow', () => ctx.slots.register({
          name: 'settings.onboarding.flow', locale: 'settings.account', inject: () => ({ hooks: { language: loadLocale } }),
        }, RenderFlow))
      },
    }
  },
})
