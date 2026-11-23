window.__ModuleLoader__.load({
  id: '@janhq/jan-onboarding',
  chunk: 'client.view.js',
  factory(require) {
    const { createElement: h, Fragment, useEffect, useRef, useState } = require('react')
    const {
      Button, Checkbox, Input,
      IconCheckOutlineRegular, IconChevronRightOutlineRegular, IconGoalOutlineRegular,
      IconPluginPinwheelOutlineRegular, IconSlidersTwoOutlineRegular, IconUserOutlineRegular,
    } = require('@janhq/jan-client-ui-primitives')

    // The flow wears the main window's shell: a floating sidebar card listing the steps as nav
    // rows, and a content column on the base surface with composer-card material for choices.
    // Motion uses the app's own curves and durations (--ds-ease-*, 150-320 ms).
    const css = `
.jan-onboarding {
  --ob-ease: var(--ds-ease-emphasized, cubic-bezier(0.22, 1, 0.36, 1));
  --ob-ease-out: var(--ds-ease-out, cubic-bezier(0.23, 1, 0.32, 1));
  --ob-enter: 320ms;
  --ob-exit: 120ms;
  --ob-select: 150ms;
  --ob-rise: 6px;
  --ob-gap: var(--jt-sidebar-gap, 11px);
  --ob-row: 32px;
  --ob-row-pitch: 36px;
  --ob-accent: var(--dsw-alias-state-business-primary);
  --jan-onboarding-heading-font: 'StudioFeixenSans', 'Inter', sans-serif;
  display: grid;
  grid-template-columns: 229px minmax(0, 1fr);
  flex: 1;
  min-height: 100%;
  box-sizing: border-box;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 20px;
  background: var(--dsw-alias-bg-base);
}
.jan-onboarding button { -webkit-app-region: no-drag; }
.jan-onboarding-rail {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  margin: var(--ob-gap) 0 var(--ob-gap) var(--ob-gap);
  padding: 52px 9px 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--jt-sidebar-radius, 20px);
  background: var(--dsw-alias-bg-base);
  animation: jan-onboarding-fade var(--ob-enter) var(--ob-ease) both;
}
/* The mark shares the title-bar row with the traffic lights (centred on them at y 38, past their
 * right edge at x 90), so the steps start where the main window's nav rows do. */
.jan-onboarding-brand { position: absolute; top: 16px; left: 88px; display: flex; align-items: center; gap: 6px; height: 20px; }
.jan-onboarding-brand img { width: 18px; height: 18px; flex: none; }
.jan-onboarding-brand span { font-family: var(--jan-onboarding-heading-font); font-size: 15px; line-height: 20px; font-weight: 500; }
.jan-onboarding-rail-label { margin: 0 0 6px; padding: 0 8px; font-size: 12px; line-height: 18px; font-weight: 500; color: color-mix(in srgb, var(--dsw-alias-label-primary) 70%, transparent); font-variant-numeric: tabular-nums; }
.jan-onboarding-steps { position: relative; display: grid; gap: calc(var(--ob-row-pitch) - var(--ob-row)); margin: 0; padding: 0; list-style: none; }
.jan-onboarding-steps-indicator {
  position: absolute; inset: 0 0 auto; height: var(--ob-row); border-radius: 8px;
  background: var(--dsw-specific-sidebar-nav-item-active, rgb(0 0 0 / 6%));
  transform: translateY(calc(var(--at) * var(--ob-row-pitch)));
  transition: transform var(--ob-enter) var(--ob-ease);
}
.jan-onboarding-nav {
  position: relative; display: flex; align-items: center; gap: 8px; width: 100%; height: var(--ob-row); padding: 0 10px 0 8px; box-sizing: border-box;
  border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; text-align: start; cursor: pointer;
  transition: background-color var(--ob-select) var(--ob-ease-out), color var(--ob-select) var(--ob-ease-out);
}
.jan-onboarding-nav > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jan-onboarding-nav > svg { flex: none; color: color-mix(in srgb, currentColor 70%, transparent); }
.jan-onboarding-nav[data-state='done'] > svg { color: var(--ob-accent); animation: jan-onboarding-pop 240ms var(--ob-ease) both; }
.jan-onboarding-nav[data-state='next'] { color: var(--dsw-alias-label-tertiary); cursor: default; }
.jan-onboarding-nav[data-state='current'] { cursor: default; }
.jan-onboarding-nav:disabled { cursor: default; }
@media (hover: hover) {
  .jan-onboarding-nav:not(:disabled):hover { background: var(--dsw-specific-sidebar-nav-item-hover, rgb(0 0 0 / 4%)); }
}
.jan-onboarding-nav:focus-visible, .jan-onboarding-chip:focus-visible, .jan-onboarding-default:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--ob-accent)); outline-offset: 1px; }
.jan-onboarding-rail-note { margin: 12px 0 0; padding: 0 8px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.jan-onboarding-skip { margin-top: auto; }
.jan-onboarding-main {
  position: relative; display: grid; place-items: center; min-width: 0; min-height: 0; overflow: auto; box-sizing: border-box;
  padding: calc(var(--jan-frame-top-clearance, 0px) + 16px) clamp(24px, 6vw, 72px) 32px;
  background: radial-gradient(70% 55% at 50% 0%, color-mix(in srgb, var(--ob-accent) 9%, transparent), transparent 70%),
    radial-gradient(50% 40% at 85% 100%, color-mix(in srgb, #FFC928 6%, transparent), transparent 70%);
}
.jan-onboarding-step { position: relative; display: grid; gap: 20px; width: min(100%, 600px); }
.jan-onboarding-step[data-exit] { animation: jan-onboarding-out var(--ob-exit) var(--ob-ease-out) both; }
.jan-onboarding-hero { display: grid; justify-items: start; gap: 12px; margin-bottom: 4px; }
.jan-onboarding-hero img { width: 56px; height: 56px; transform-origin: 30% 85%; animation: jan-onboarding-wave 1.1s var(--ds-ease-in-out, ease-in-out) 280ms both; }
.jan-onboarding-eyebrow { margin: 0; font-size: 13px; line-height: 18px; font-weight: 500; color: var(--ob-accent); }
.jan-onboarding-heading h1 { margin: 0; font-family: var(--jan-onboarding-heading-font); font-size: 24px; line-height: 32px; font-weight: 500; letter-spacing: -0.2px; outline: none; }
.jan-onboarding-heading p { margin: 6px 0 0; color: var(--dsw-alias-label-secondary); }
.jan-onboarding-name { display: grid; gap: 8px; }
.jan-onboarding fieldset { min-width: 0; border: 0; margin: 0; padding: 0; }
.jan-onboarding legend, .jan-onboarding-name > span { margin: 0 0 8px; padding: 0; font-size: 13px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.jan-onboarding-name > span { margin: 0; }
.jan-onboarding-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.jan-onboarding-chip {
  min-height: 32px; padding: 5px 14px; box-sizing: border-box; border: 0; border-radius: 999px;
  background: var(--dsw-specific-input-major); box-shadow: inset 0 0 0 0.5px var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary); font: inherit; text-align: center; cursor: pointer;
  transition: background-color var(--ob-select) var(--ob-ease-out), box-shadow var(--ob-select) var(--ob-ease-out);
}
@media (hover: hover) {
  .jan-onboarding-chip:not(:disabled):hover { background: linear-gradient(var(--dsw-alias-interactive-bg-hover), var(--dsw-alias-interactive-bg-hover)), var(--dsw-specific-input-major); }
}
.jan-onboarding-chip[aria-pressed='true'] {
  background: color-mix(in srgb, var(--ob-accent) 10%, var(--dsw-specific-input-major));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ob-accent) 60%, transparent);
}
.jan-onboarding-chip:disabled { opacity: 0.45; cursor: default; }
.jan-onboarding-group { overflow: hidden; border-radius: var(--dsw-radius-lg, 16px); background: var(--dsw-specific-input-major); box-shadow: var(--dsw-elevation-soft); }
.jan-onboarding-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 2px 12px; padding: 12px 14px; }
.jan-onboarding-row + .jan-onboarding-row { border-top: 0.5px solid var(--dsw-alias-border-l1); }
.jan-onboarding-row > :first-child { grid-column: 1; }
.jan-onboarding-row p { grid-column: 1; margin: 0; padding-inline-start: 26px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 18px; }
.jan-onboarding-row .jan-onboarding-default { grid-column: 2; grid-row: 1 / span 2; }
.jan-onboarding-default {
  height: 26px; padding: 0 10px; border: 0; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12px; line-height: 18px; white-space: nowrap; cursor: pointer;
  transition: background-color var(--ob-select) var(--ob-ease-out), color var(--ob-select) var(--ob-ease-out);
}
@media (hover: hover) {
  .jan-onboarding-default:not(:disabled):hover { background: var(--dsw-alias-interactive-bg-hover); }
}
.jan-onboarding-default[aria-pressed='true'] { background: color-mix(in srgb, var(--ob-accent) 12%, transparent); color: var(--ob-accent); cursor: default; }
.jan-onboarding-hint, .jan-onboarding-status { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 18px; }
.jan-onboarding-list { display: grid; gap: 16px; }
.jan-onboarding-actions { display: flex; align-items: center; gap: 8px; }
.jan-onboarding-primary { margin-inline-start: auto; min-width: 120px; }
.jan-onboarding-step[data-step='2'] .jan-onboarding-actions { position: absolute; inset: auto auto 0 0; }
.jan-onboarding-alert { position: absolute; inset: auto 0 24px; display: flex; justify-content: center; align-items: center; gap: 8px; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.jan-onboarding [data-back] { --ob-rise: -6px; }
.jan-onboarding :is([data-enter], [data-onboarding-entrance]) { animation: jan-onboarding-in var(--ob-enter) var(--ob-ease) both; }
.jan-onboarding :is([data-enter='description'], [data-onboarding-entrance='description']) { animation-delay: 40ms; }
.jan-onboarding :is([data-enter='body'], [data-onboarding-entrance='body']) { animation-delay: 80ms; }
.jan-onboarding [data-enter='item'] { animation-delay: calc(80ms + min(var(--i) * 20ms, 120ms)); }
.jan-onboarding :is([data-enter='action'], [data-onboarding-entrance='action']) { animation-delay: 120ms; }
@keyframes jan-onboarding-in { from { opacity: 0; transform: translateY(var(--ob-rise)); } }
@keyframes jan-onboarding-out { to { opacity: 0; } }
@keyframes jan-onboarding-fade { from { opacity: 0; } }
@keyframes jan-onboarding-pop { from { transform: scale(0.6); opacity: 0; } }
@keyframes jan-onboarding-wave { 0%, 100% { transform: rotate(0); } 15% { transform: rotate(14deg); } 30% { transform: rotate(-8deg); } 45% { transform: rotate(14deg); } 60% { transform: rotate(-4deg); } 75% { transform: rotate(10deg); } }
@media (max-width: 720px) {
  .jan-onboarding { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .jan-onboarding-rail { flex-direction: row; align-items: center; justify-content: space-between; margin: var(--ob-gap); padding: calc(var(--jan-frame-top-clearance, 0px) + 4px) 9px 4px; }
  .jan-onboarding-steps, .jan-onboarding-rail-note { display: none; }
  .jan-onboarding-rail-label { margin: 0; }
  .jan-onboarding-brand { position: static; }
  .jan-onboarding-skip { width: auto; margin: 0; }
  .jan-onboarding-main { padding-top: 16px; }
}
@media (prefers-reduced-motion: reduce) {
  .jan-onboarding :is(.jan-onboarding-rail, [data-enter], [data-onboarding-entrance], .jan-onboarding-hero img, .jan-onboarding-nav > svg), .jan-onboarding-step[data-exit] { animation: none; }
  .jan-onboarding :is(.jan-onboarding-steps-indicator, .jan-onboarding-nav, .jan-onboarding-chip, .jan-onboarding-default) { transition: none; }
}
`

    const steps = ['about', 'goals', 'detail', 'setup']
    const stepIcons = [IconUserOutlineRegular, IconGoalOutlineRegular, IconSlidersTwoOutlineRegular, IconPluginPinwheelOutlineRegular]
    // Jan's waving-hand mark, served by jan-theme; hidden if that plugin is absent.
    const LOGO = '/jan-theme/assets/jan-original.png'

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
        // The rail follows a click at once, while the old step is still fading out.
        const shown = leaving ? leaving.step : page.step
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

        // Back sits left and the step's primary action right, as one row under every step.
        const actions = primary => h('div', { className: 'jan-onboarding-actions', 'data-enter': 'action' },
          page.step > 0 && h(Button, { variant: 'ghost', disabled, onClick: () => { move(page.step - 1) } }, t('back')),
          primary && h(Button, { className: 'jan-onboarding-primary', variant: 'primary', disabled: disabled || primary.unavailable, onClick: primary.action }, t(primary.label)))
        const title = (titleKey, subtitle) => h('header', { className: 'jan-onboarding-heading' },
          h('h1', { id: 'jan-onboarding-title', ref: heading, tabIndex: -1, 'data-enter': '' }, t(titleKey)),
          h('p', { 'data-enter': 'description' }, t(subtitle)))
        const chips = (label, choices, prefix, picked, toggle, limit = choices.length) => h('fieldset', { 'data-enter': 'body' },
          h('legend', null, t(label)), h('div', { className: 'jan-onboarding-chips' }, choices.map((choice, i) => {
            const selected = picked.includes(choice)
            return h('button', {
              key: choice, type: 'button', className: 'jan-onboarding-chip', 'data-enter': 'item', style: { '--i': i },
              'aria-pressed': selected, disabled: disabled || (!selected && picked.length >= limit), onClick: () => { toggle(choice) },
            }, t(`${prefix}.${choice}`))
          })))
        const rows = (kind, items) => h('fieldset', { 'data-enter': 'body' },
          h('legend', null, t(kind)),
          h('div', { className: 'jan-onboarding-group' }, items.map(({ id, copy }) => h('div', { key: id, className: 'jan-onboarding-row' },
            h(Checkbox, { label: t(`item.${copy}`), checked: checked[kind].includes(id), disabled, onChange: value => {
              const next = value ? [...checked[kind], id] : checked[kind].filter(item => item !== id)
              setSetup({ ...checked, [kind]: next, defaultMode: kind === 'modes' && !next.includes(defaultMode) ? next[0] ?? '' : defaultMode ?? '' })
            } }),
            h('p', null, t(`why.${copy}`)),
            kind === 'modes' && checked.modes.includes(id) && h('button', {
              type: 'button', className: 'jan-onboarding-default', disabled, 'aria-pressed': defaultMode === id,
              'aria-label': `${t('makeDefault')}: ${t(`item.${copy}`)}`,
              onClick: () => { setSetup({ ...checked, defaultMode: id }) },
            }, t(defaultMode === id ? 'isDefault' : 'makeDefault'))))))

        let content
        if (page.step === 0) content = h(Fragment, null,
          h('div', { className: 'jan-onboarding-hero', 'data-enter': '' },
            h('img', { src: LOGO, alt: '', draggable: false, onError: event => { event.currentTarget.hidden = true } }),
            h('p', { className: 'jan-onboarding-eyebrow' }, t('welcome'))),
          title('about', 'aboutHint'),
          h('label', { className: 'jan-onboarding-name', 'data-enter': 'body' }, h('span', null, t('name')),
            h(Input, { value: name, autoComplete: 'given-name', disabled, onChange: event => { setName(event.target.value) } })),
          chips('roles', roles, 'role', selectedRoles, toggleRole, 3),
          actions({ label: 'continue', action: () => { move(1) }, unavailable: selectedRoles.length === 0 }))
        else if (page.step === 1) content = h(Fragment, null,
          title('goals', 'goalsHint'), chips('goalOptions', goals, 'goal', selectedGoals, goal => {
            setGoals(selectedGoals.includes(goal) ? selectedGoals.filter(item => item !== goal) : [...selectedGoals, goal])
          }), actions({ label: 'continue', action: () => { move(2) } }))
        // The shared detail selector brings its own Continue; Back is laid over its action row.
        else if (page.step === 2) content = h(Fragment, null, renderFactorySlot('settings.onboarding.detail', {
          busy: disabled, process: detail, continueLabel: t('continue'), onSelect: setDetail, onContinue: () => { move(3) },
        }), actions(null))
        else content = h(Fragment, null, title('setup', 'setupHint'),
          options === null ? catalogError ? h('div', { className: 'jan-onboarding-status', role: 'alert' }, t('catalogError'), ' ',
            h(Button, { size: 'sm', disabled, onClick: () => { void readCatalog() } }, t('retry')))
            : h('p', { role: 'status', className: 'jan-onboarding-status' }, t('loading')) : h('div', { className: 'jan-onboarding-list' },
            options.modes.length > 0 && rows('modes', options.modes),
            options.plugins.length > 0 && rows('plugins', options.plugins),
            options.plugins.length === 0 && h('p', { className: 'jan-onboarding-hint', 'data-enter': 'body' }, t('noPlugins'))),
          actions({ label: working && finalize === null ? 'working' : 'start', action: () => { void submit(false) }, unavailable: options === null }))

        return h('div', { className: 'jan-onboarding', 'aria-busy': busy || working }, h('style', null, css),
          h('nav', { className: 'jan-onboarding-rail', 'aria-labelledby': 'jan-onboarding-counter' },
            h('div', { className: 'jan-onboarding-brand' },
              h('img', { src: LOGO, alt: '', draggable: false, onError: event => { event.currentTarget.hidden = true } }), h('span', null, 'Jan')),
            h('p', { id: 'jan-onboarding-counter', className: 'jan-onboarding-rail-label', 'aria-live': 'polite', 'aria-atomic': true },
              t('stepCounter', { step: shown + 1, total: steps.length })),
            h('ol', { className: 'jan-onboarding-steps', style: { '--at': shown } },
              h('span', { className: 'jan-onboarding-steps-indicator', 'aria-hidden': true }),
              steps.map((key, i) => {
                const state = i < shown ? 'done' : i === shown ? 'current' : 'next'
                const Icon = state === 'done' ? IconCheckOutlineRegular : stepIcons[i]
                return h('li', { key }, h('button', {
                  type: 'button', className: 'jan-onboarding-nav', 'data-state': state, 'aria-current': state === 'current' ? 'step' : undefined,
                  disabled: disabled || state !== 'done', onClick: () => { move(i) },
                }, h(Icon, { size: 16 }), h('span', null, t(`rail.${key}`))))
              })),
            h('p', { className: 'jan-onboarding-rail-note' }, t(`progress.${steps[shown]}`)),
            h('button', { type: 'button', className: 'jan-onboarding-nav jan-onboarding-skip', disabled, onClick: () => { void submit(true) } },
              h(IconChevronRightOutlineRegular, { size: 16 }), h('span', null, t('skip')))),
          h('main', { className: 'jan-onboarding-main' },
            h('section', { key: page.step, ref: section, className: 'jan-onboarding-step', 'data-step': page.step,
              'aria-labelledby': page.step === 2 ? 'desktop-onboarding-title' : 'jan-onboarding-title',
              'data-back': page.back || undefined, 'data-exit': leaving ? true : undefined }, content),
            (applyError || settingsError) && h('div', { role: 'alert', className: 'jan-onboarding-alert' }, t('saveError'),
              h(Button, { size: 'sm', disabled: busy || working, onClick: () => {
                if (finalize !== null || applyError) void submit(false)
                else void retry()
              } }, t('retry')))))
      }
    }
    return { createFlow }
  },
})
