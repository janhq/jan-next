window.__ModuleLoader__.load({
  id: '@janhq/jan-onboarding',
  chunk: 'client.view.js',
  factory(require) {
    const { createElement: h, Fragment, useEffect, useRef, useState } = require('react')
    const { Button, Checkbox, Input } = require('@janhq/jan-client-ui-primitives')

    const css = `
.jan-onboarding {
  --onboard-motion-enter: 0.45s;
  --onboard-motion-exit: 0.15s;
  --onboard-motion-select: 0.16s;
  --onboard-ease: cubic-bezier(0.23, 1, 0.32, 1);
  --onboard-rise: 8px;
  color: var(--dsw-alias-label-primary);
  font: 400 14px/20px var(--dsw-font-family);
  letter-spacing: -0.28px;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 100%;
  box-sizing: border-box;
  background: radial-gradient(ellipse at 50% 28%, color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, transparent), transparent 65%), var(--dsw-alias-bg-base);
  padding: calc(var(--jan-frame-top-clearance, 0px) + 24px) clamp(16px, 6vw, 72px) 24px;
}
.jan-onboarding-progress { width: min(100%, 648px); margin: 0 auto 16px; }
.jan-onboarding-progress p { display: flex; justify-content: space-between; gap: 8px; margin: 0 0 8px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 18px; letter-spacing: -0.13px; }
.jan-onboarding-progress strong { color: var(--dsw-alias-label-primary); font-weight: 500; }
.jan-onboarding-track { overflow: hidden; height: 4px; border-radius: 4px; background: var(--dsw-alias-border-l2); }
.jan-onboarding-track span { display: block; height: 100%; transform: scaleX(var(--progress)); transform-origin: left; background: var(--dsw-alias-state-business-primary); transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1); }
.jan-onboarding:dir(rtl) .jan-onboarding-track span { transform-origin: right; }
.jan-onboarding [data-back] { --onboard-rise: -8px; }
.jan-onboarding-step { flex: 1; display: grid; place-items: center; }
.jan-onboarding-step[data-exit] { animation: jan-onboarding-out var(--onboard-motion-exit) var(--onboard-ease) both; }
.jan-onboarding-content { display: grid; gap: 16px; width: min(100%, 648px); }
.jan-onboarding-heading { text-align: center; }
.jan-onboarding-heading h1 { margin: 0; font: 500 24px/32px var(--dsw-font-family-brand); letter-spacing: -0.72px; }
.jan-onboarding-heading p { margin: 8px 0 0; color: var(--dsw-alias-label-secondary); }
.jan-onboarding [data-enter] { animation: jan-onboarding-in var(--onboard-motion-enter) var(--onboard-ease) both; }
.jan-onboarding [data-enter='description'] { animation-delay: 60ms; }
.jan-onboarding [data-enter='body'] { animation-delay: 120ms; }
.jan-onboarding [data-onboarding-entrance='heading'] { animation: jan-onboarding-in var(--onboard-motion-enter) var(--onboard-ease) both; }
.jan-onboarding [data-onboarding-entrance='description'] { animation: jan-onboarding-in var(--onboard-motion-enter) var(--onboard-ease) 60ms both; }
.jan-onboarding [data-onboarding-entrance='body'] { animation: jan-onboarding-in var(--onboard-motion-enter) var(--onboard-ease) 120ms both; }
.jan-onboarding [data-onboarding-entrance='action'] { animation: jan-onboarding-in var(--onboard-motion-enter) var(--onboard-ease) 180ms both; }
.jan-onboarding [data-enter='item'] { animation-delay: calc(120ms + min(var(--i) * 30ms, 240ms)); }
.jan-onboarding [data-enter='action'] { animation-delay: 180ms; }
.jan-onboarding [data-step='3'] [data-enter='action'] { animation-delay: calc(180ms + min(var(--i) * 30ms, 240ms)); }
@keyframes jan-onboarding-in { from { opacity: 0; transform: translateY(var(--onboard-rise)); } to { opacity: 1; transform: none; } }
@keyframes jan-onboarding-out { to { opacity: 0; } }
@keyframes jan-onboarding-pop { from { transform: scale(0.98); } to { transform: none; } }
.jan-onboarding-name { display: grid; gap: 6px; }
.jan-onboarding fieldset { min-width: 0; border: 0; margin: 0; padding: 0; }
.jan-onboarding legend { margin-bottom: 8px; padding: 0; font-weight: 500; }
.jan-onboarding-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.jan-onboarding-chips button { white-space: normal; height: auto; min-height: 36px; }
.jan-onboarding-chips [aria-pressed='true'] { --jan-button-outline-color: var(--dsw-alias-state-business-primary); }
.jan-onboarding :is([aria-pressed='true'], .jan-onboarding-row:has(input:checked)) { animation: jan-onboarding-pop var(--onboard-motion-select) var(--onboard-ease); }
.jan-onboarding :is(.jan-onboarding-row, button) { transition: background-color var(--onboard-motion-select) var(--onboard-ease), box-shadow var(--onboard-motion-select) var(--onboard-ease); }
.jan-onboarding input[type='checkbox'] { accent-color: var(--dsw-alias-state-business-primary); }
.jan-onboarding-action { justify-self: center; }
.jan-onboarding-action button { min-width: 160px; }
.jan-onboarding-action button:not(:disabled) { background-image: linear-gradient(155deg, color-mix(in srgb, var(--dsw-alias-label-primary) 15%, transparent), transparent 62%); }
.jan-onboarding-footer { display: flex; justify-content: space-between; min-height: 36px; gap: 8px; margin-top: 16px; }
.jan-onboarding-footer button:last-child { margin-inline-start: auto; }
.jan-onboarding-row { display: grid; gap: 4px; padding: 8px 12px; border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.jan-onboarding-row:has(input:checked) { box-shadow: inset 0 0 0 1px var(--dsw-alias-state-business-primary); }
.jan-onboarding-row p, .jan-onboarding-hint { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 18px; letter-spacing: -0.13px; }
.jan-onboarding-row p { padding-inline-start: 26px; }
.jan-onboarding-list { display: grid; gap: 6px; }
.jan-onboarding-status { margin: 0; text-align: center; }
@media (prefers-reduced-motion: reduce) {
  .jan-onboarding [data-enter], .jan-onboarding [data-onboarding-entrance], .jan-onboarding-step[data-exit], .jan-onboarding :is([aria-pressed='true'], .jan-onboarding-row:has(input:checked)) { animation: none; }
  .jan-onboarding :is(.jan-onboarding-row, button, .jan-onboarding-track span) { transition: none; }
}
`

    const steps = ['about', 'goals', 'detail', 'setup']

    function createFlow({ roles, goalsFor, recommend, applySetup }, operations) {
      return function OnboardingFlow({ t, busy, finish, retry, settingsError, renderFactorySlot }) {
        const [page, setPage] = useState({ step: 0, back: false })
        const [leaving, setLeaving] = useState(false)
        const [name, setName] = useState('')
        const [selectedRoles, setRoles] = useState([])
        const [selectedGoals, setGoals] = useState([])
        const [detail, setDetail] = useState(null)
        const [catalog, setCatalog] = useState(null)
        const [catalogError, setCatalogError] = useState(false)
        const [setup, setSetup] = useState(null)
        const [working, setWorking] = useState(false)
        const [applyError, setApplyError] = useState(false)
        const [finalize, setFinalize] = useState(null)
        const heading = useRef(null)
        const section = useRef(null)
        const writing = useRef(false)
        const disabled = busy || working || Boolean(leaving) || finalize !== null || settingsError
        useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [page])

        useEffect(() => {
          if (!leaving) return
          const animation = section.current.getAnimations().find(item => item.animationName === 'jan-onboarding-out')
          let live = true
          function finishIfHidden() {
            if (document.visibilityState === 'visible') return
            swap()
          }
          function swap() {
            if (!live) return
            live = false
            setPage(leaving)
            setLeaving(false)
          }
          const document = section.current.ownerDocument
          document.addEventListener('visibilitychange', finishIfHidden)
          if (document.visibilityState === 'hidden') swap()
          else void (animation?.finished ?? Promise.resolve()).then(swap, swap)
          return () => {
            live = false
            document.removeEventListener('visibilitychange', finishIfHidden)
          }
        }, [leaving])

        function move(step) {
          const next = { step, back: step < page.step }
          if (document.visibilityState === 'hidden' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPage(next)
          else setLeaving(next)
        }

        async function readCatalog() {
          setCatalogError(false)
          try { setCatalog(await operations.catalog()) }
          catch { setCatalogError(true) }
        }

        useEffect(() => {
          if (page.step === 3 && catalog === null && !catalogError) void readCatalog()
        }, [page.step])

        const goals = goalsFor(selectedRoles)
        const options = catalog === null ? null : recommend(selectedRoles, catalog)
        const checked = setup ?? (options === null ? null : {
          modes: options.modes.map(option => option.id), plugins: options.plugins.map(option => option.id),
          defaultMode: options.modes[0]?.id ?? '',
        })
        const defaultMode = checked?.modes.includes(checked.defaultMode) ? checked.defaultMode : checked?.modes[0]

        function toggleRole(role) {
          const next = selectedRoles.includes(role) ? selectedRoles.filter(item => item !== role) : [...selectedRoles, role]
          const available = goalsFor(next)
          setRoles(next)
          setGoals(selectedGoals.filter(goal => available.includes(goal)))
          setSetup(null)
        }

        async function submit(skip) {
          if (writing.current) return
          writing.current = true
          setWorking(true)
          setApplyError(false)
          try {
            if (finalize !== null) {
              if (!await retry()) setApplyError(true)
              return
            }
            if (!skip) await applySetup(operations, { name, roles: selectedRoles, goals: selectedGoals }, options, checked)
            setFinalize(skip ? 'skip' : 'finish')
            if (!await finish(skip ? null : detail)) setApplyError(true)
          } catch {
            setApplyError(true)
          } finally {
            writing.current = false
            setWorking(false)
          }
        }

        const primary = (label, action, unavailable = false, index = 0) => h('div', { className: 'jan-onboarding-action', 'data-enter': 'action', style: { '--i': index } },
          h(Button, { variant: 'primary', disabled: disabled || unavailable, onClick: action }, t(label)))
        const title = (titleKey, subtitle) => h('header', { className: 'jan-onboarding-heading' },
          h('h1', { id: 'jan-onboarding-title', ref: heading, tabIndex: -1, 'data-enter': '' }, t(titleKey)),
          h('p', { 'data-enter': 'description' }, t(subtitle)))
        const chips = (label, choices, prefix, picked, toggle, limit = choices.length) => h('fieldset', { 'data-enter': 'body' },
          h('legend', null, t(label)), h('div', { className: 'jan-onboarding-chips' }, choices.map((choice, i) => {
            const selected = picked.includes(choice)
            return h('span', { key: choice, 'data-enter': 'item', style: { '--i': i } },
              h(Button, { variant: 'outline', 'aria-pressed': selected, disabled: disabled || (!selected && picked.length >= limit),
                onClick: () => { toggle(choice) } }, t(`${prefix}.${choice}`)))
          })))
        const rows = (kind, items, offset) => h('fieldset', null,
          h('legend', { 'data-enter': 'body' }, t(kind)),
          h('div', { className: 'jan-onboarding-list' }, items.map(({ id, copy }, i) => h('div', {
            key: id, 'data-enter': 'item', style: { '--i': offset + i },
          }, h('div', { className: 'jan-onboarding-row' },
            h(Checkbox, { label: t(`item.${copy}`), checked: checked[kind].includes(id), disabled, onChange: value => {
              const next = value ? [...checked[kind], id] : checked[kind].filter(item => item !== id)
              setSetup({ ...checked, [kind]: next, defaultMode: kind === 'modes' && !next.includes(defaultMode) ? next[0] ?? '' : defaultMode ?? '' })
            } }),
            h('p', null, t(`why.${copy}`)),
            kind === 'modes' && checked.modes.includes(id) && h('div', null, h(Button, {
              size: 'sm', variant: 'ghost', disabled, 'aria-pressed': defaultMode === id,
              'aria-label': `${t('makeDefault')}: ${t(`item.${copy}`)}`,
              onClick: () => { setSetup({ ...checked, defaultMode: id }) },
            }, t(defaultMode === id ? 'isDefault' : 'makeDefault'))))))))

        let content
        if (page.step === 0) content = h('div', { className: 'jan-onboarding-content' },
          title('about', 'aboutHint'),
          h('label', { className: 'jan-onboarding-name', 'data-enter': 'body' }, t('name'),
            h(Input, { value: name, autoComplete: 'given-name', disabled, onChange: event => { setName(event.target.value) } })),
          chips('roles', roles, 'role', selectedRoles, toggleRole, 3), primary('continue', () => { move(1) }, selectedRoles.length === 0))
        else if (page.step === 1) content = h('div', { className: 'jan-onboarding-content' },
          title('goals', 'goalsHint'), chips('goalOptions', goals, 'goal', selectedGoals, goal => {
            setGoals(selectedGoals.includes(goal) ? selectedGoals.filter(item => item !== goal) : [...selectedGoals, goal])
          }), primary('continue', () => { move(2) }))
        else if (page.step === 2) content = renderFactorySlot('settings.onboarding.detail', {
          busy: disabled, process: detail, continueLabel: t('continue'), onSelect: setDetail, onContinue: () => { move(3) },
        })
        else content = h('div', { className: 'jan-onboarding-content' }, title('setup', 'setupHint'),
          options === null ? catalogError ? h('div', { className: 'jan-onboarding-status', role: 'alert' }, t('catalogError'), ' ',
            h(Button, { disabled, onClick: () => { void readCatalog() } }, t('retry')))
            : h('p', { role: 'status', className: 'jan-onboarding-status' }, t('loading')) : h(Fragment, null,
            options.modes.length > 0 && rows('modes', options.modes, 0),
            options.plugins.length > 0 && rows('plugins', options.plugins, options.modes.length),
            options.plugins.length === 0 && h('p', { className: 'jan-onboarding-hint', 'data-enter': 'body' }, t('noPlugins')),
            primary(working && finalize === null ? 'working' : 'start', () => { void submit(false) }, false,
              options.modes.length + options.plugins.length)))

        return h('div', { className: 'jan-onboarding', 'aria-busy': busy || working }, h('style', null, css),
          h('header', { className: 'jan-onboarding-progress' },
            h('p', { 'aria-live': 'polite', 'aria-atomic': true },
              h('strong', null, t('stepCounter', { step: page.step + 1, total: steps.length })),
              h('span', null, t(`progress.${steps[page.step]}`))),
            h('div', { className: 'jan-onboarding-track', 'aria-hidden': true }, h('span', { style: { '--progress': (page.step + 1) / steps.length } }))),
          h('main', { key: page.step, ref: section, className: 'jan-onboarding-step', 'data-step': page.step,
            'data-back': page.back || undefined, 'data-exit': leaving ? true : undefined }, content),
          (applyError || settingsError) && h('div', { role: 'alert', className: 'jan-onboarding-status' }, t('saveError'), ' ',
            h(Button, { disabled: busy || working, onClick: () => {
              if (finalize !== null || applyError) void submit(false)
              else void retry()
            } }, t('retry'))),
          h('footer', { className: 'jan-onboarding-footer', key: `footer-${page.step}` },
            page.step > 0 && h(Button, { disabled, 'data-enter': 'action', onClick: () => { move(page.step - 1) } }, t('back')),
            h(Button, { disabled, 'data-enter': 'action', onClick: () => { void submit(true) } }, t('skip'))))
      }
    }
    return { createFlow }
  },
})
