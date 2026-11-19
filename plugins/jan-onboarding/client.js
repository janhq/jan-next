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
          if (!result.ok) throw new Error(`Unable to update ${namespace}`)
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
        }
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
