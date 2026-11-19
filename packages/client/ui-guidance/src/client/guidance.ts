/** Adapt Driver's DOM and lifetime to the injected guidance contract. */
import { defineStore } from '@janhq/jan-client-store'
import type { TranslateNS } from '@janhq/jan-client-ui-slots'
import { driver, type Driver, type DriveStep } from 'driver.js'
import 'driver.js/dist/driver.css'
import type { GuidanceService, GuidanceStep } from './contract.ts'
import css from './Guidance.module.css'

const targetName = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/
const waitForActionTargetMs = 400

function createSeenStore() {
  return defineStore({
    init: (): { seen: string[] } => ({ seen: [] }),
    persist: 'jan.ui-guidance',
    actions: {
      markSeen(state, id: string) {
        if (!state.seen.includes(id)) state.seen.push(id)
      },
      resetSeen(state) { state.seen = [] },
    },
  })
}

interface ActiveTour {
  id: string
  driver: Driver
  opener: Element | null
  revision: number
  transition: ViewTransition | undefined
}

/**
 * Create a registry and its single local seen store.
 * @param t - locale binding for tour navigation copy.
 * @returns the service and its plugin lifetime disposer.
 */
export function createGuidance(t: TranslateNS<'guidance'>): { service: GuidanceService; dispose: () => void } {
  const tours = new Map<string, Array<DriveStep & { element: string }>>()
  const seen = createSeenStore().create()
  let active: ActiveTour | undefined

  const close = (acknowledge: boolean) => {
    if (!active) return
    const { id, driver: current, opener, transition } = active
    active = undefined
    transition?.skipTransition()
    current.destroy()
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
    if (acknowledge) seen.actions.markSeen(id)
  }

  const move = (current: Driver, index: number, waitForTarget: boolean) => {
    const run = active
    if (!run) return
    const revision = ++run.revision
    const update = () => {
      if (active !== run || revision !== run.revision) return
      // Only action steps wait for a target mounted by the activated control.
      current.setConfig({ ...current.getConfig(), waitForElement: waitForTarget ? waitForActionTargetMs : 0 })
      current.moveTo(index)
    }
    run.transition?.skipTransition()
    if (!waitForTarget && 'startViewTransition' in document && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      run.transition = document.startViewTransition({ update, types: ['jan-guidance-step'] })
    } else update()
  }

  const makeStep = ({ target, title, body, advanceOn }: GuidanceStep, position: number, total: number): DriveStep & { element: string } => {
    if (!targetName.test(target)) throw new Error(`Invalid guidance target: ${target}`)
    const action = advanceOn === 'click'
    return {
      element: `[data-guide="${target}"]:not([hidden], [hidden] *, [inert], [inert] *)`,
      advanceOnClick: action,
      popover: {
        title: ' ', description: ' ',
        showButtons: action ? ['previous', 'close'] : ['next', 'previous', 'close'],
        onPopoverRender(popover, { driver: current }) {
          // Driver expects HTML strings. Put every feature and locale string into text nodes instead.
          popover.title.textContent = title()
          popover.description.textContent = body()
          popover.progress.textContent = t('progress', { current: position + 1, total })
          popover.previousButton.textContent = t('previous')
          popover.nextButton.textContent = t(current.isLastStep() ? 'done' : 'next')
          popover.closeButton.setAttribute('aria-label', t('close'))
        },
        onNextClick(_target, _step, { driver: current }) {
          if (action ? position + 1 === total : current.isLastStep()) close(true)
          else move(current, position + 1, action && !current.hasNextStep())
        },
        onPrevClick(_target, _step, { driver: current }) { move(current, position - 1, false) },
      },
    }
  }

  return {
    service: {
      register({ id, steps }) {
        if (tours.has(id)) throw new Error(`Guidance tour already registered: ${id}`)
        const entries = steps.map((step, index) => makeStep(step, index, steps.length))
        tours.set(id, entries)
        return () => {
          if (tours.get(id) !== entries) return
          tours.delete(id)
          if (active?.id === id) close(false)
        }
      },
      start(id) {
        const steps = tours.get(id)
        if (!steps) return false
        const first = steps.findIndex(step => document.querySelector(step.element) !== null)
        if (first < 0) return false
        close(true)
        const current = driver({
          steps, skipMissingElement: true, animate: false, showProgress: true,
          popoverClass: css.popover ?? '', popoverOffset: 10, overlayOpacity: 0.34, stagePadding: 4, stageRadius: 12,
          onDestroyStarted: () => { close(true) },
        })
        active = { id, driver: current, opener: document.activeElement, revision: 0, transition: undefined }
        current.drive(first)
        return true
      },
      hasSeen: id => seen.getSnapshot().seen.includes(id),
      markSeen: seen.actions.markSeen,
      resetSeen: seen.actions.resetSeen,
    },
    dispose() {
      close(false)
      tours.clear()
    },
  }
}
