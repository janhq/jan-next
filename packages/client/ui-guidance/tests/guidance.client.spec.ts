// @vitest-environment jsdom
import { Context } from '@janhq/cordis'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import type { GuidanceStep, GuidanceTour } from '../src/client/index.ts'
import { apply as applyHost } from '../src/index.ts'

const first = { target: 'sidebar.first', title: () => 'First', body: () => 'First body' }
const next = { target: 'sidebar.next', title: () => '<strong>Second</strong>', body: () => '<img src=x onerror=alert(1)>' }
const missing = { target: 'sidebar.missing', title: () => 'Missing', body: () => 'Not mounted' }
const tour = (steps: readonly GuidanceStep[]): GuidanceTour => ({ id: 'sidebar.introduction', steps })
const add = (id: string) => {
  const target = document.createElement('button')
  target.dataset.guide = id
  target.textContent = id
  document.body.appendChild(target)
  return target
}
const find = (selector: string) => document.querySelector<HTMLElement>(selector)!
const button = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!
const pressEscape = () => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape' }))
const nextButton = () => button('.driver-popover-next-btn')
const backButton = () => button('.driver-popover-prev-btn')
const currentTitle = () => find('.driver-popover-title').textContent
const lifetimes: (() => Promise<void>)[] = []

async function load() {
  const ctx = new Context()
  const messages: Record<string, string> = { next: 'Continue', previous: 'Back', done: 'Finish', close: 'Dismiss tour' }
  const disposeLocale = ctx.provide('locale', {
    register: vi.fn(() => () => {}),
    bind: () => (key: string, values: { current: number; total: number }) =>
      key === 'progress' ? `${values.current} / ${values.total}` : messages[key],
  } as never)
  const fiber = ctx.plugin({ apply, inject })
  await fiber.await()
  lifetimes.push(async () => { await fiber.dispose(); disposeLocale() })
  return ctx
}

beforeEach(() => {
  window.localStorage.clear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
})

afterEach(async () => {
  for (const dispose of lifetimes.splice(0).reverse()) await dispose()
  document.body.replaceChildren()
  Reflect.deleteProperty(document, 'startViewTransition')
  vi.unstubAllGlobals()
})

it('persists seen ids across client launches and resets only guidance', async () => {
  applyHost()
  const ctx = await load()
  const id = 'composer.model-tip'
  expect(ctx.uiGuidance.hasSeen(id)).toBe(false)
  ctx.uiGuidance.markSeen(id)
  ctx.uiGuidance.markSeen(id)
  expect(ctx.uiGuidance.hasSeen(id)).toBe(true)
  expect(JSON.parse(localStorage.getItem('jan.ui-guidance')!)).toEqual({ seen: [id] })
  await lifetimes.pop()!()
  const reopened = await load()
  expect(reopened.uiGuidance.hasSeen(id)).toBe(true)
  localStorage.setItem('jan.unrelated', 'saved')
  reopened.uiGuidance.resetSeen()
  expect(reopened.uiGuidance.hasSeen(id)).toBe(false)
  expect(localStorage.getItem('jan.unrelated')).toBe('saved')
})

it('treats registration as a Cordis effect and does not mark unseen tours on unload', async () => {
  const ctx = await load()
  const spec = tour([first])
  add(first.target)
  const plugin = ctx.plugin({ inject: ['uiGuidance'], apply: (child: Context) => {
    child.effect(() => child.uiGuidance.register(spec))
  } })
  await plugin.await()
  expect(() => ctx.uiGuidance.register(spec)).toThrow(spec.id)
  expect(() => ctx.uiGuidance.register({ id: 'sidebar.invalid', steps: [{ ...first, target: 'not dotted' }] })).toThrow('not dotted')
  expect(ctx.uiGuidance.start(spec.id)).toBe(true)
  expect(currentTitle()).toBe(first.title())
  await plugin.dispose()
  expect(document.querySelector('.driver-popover')).toBeNull()
  expect(ctx.uiGuidance.start(spec.id)).toBe(false)
  expect(ctx.uiGuidance.hasSeen(spec.id)).toBe(false)
})

it('skips unavailable targets, uses plain localized text, and marks completion or Escape', async () => {
  const ctx = await load()
  add(first.target)
  add(next.target)
  const spec = tour([missing, first, missing, next, missing])
  const dispose = ctx.uiGuidance.register(spec)
  expect(ctx.uiGuidance.start(spec.id)).toBe(true)
  expect(currentTitle()).toBe(first.title())
  expect(find('.driver-popover-progress-text').textContent).toBe('2 / 5')
  expect(nextButton().textContent).toBe('Continue')
  const go = nextButton()
  go.click()
  expect(currentTitle()).toBe(next.title())
  expect(find('.driver-popover-description').textContent).toBe(next.body())
  expect(find('.driver-popover-description').querySelector('img')).toBeNull()
  expect(nextButton().textContent).toBe('Finish')
  expect(backButton().textContent).toBe('Back')
  backButton().click()
  expect(currentTitle()).toBe(first.title())
  nextButton().click()
  nextButton().click()
  expect(ctx.uiGuidance.hasSeen(spec.id)).toBe(true)
  expect(document.querySelector('.driver-popover')).toBeNull()
  ctx.uiGuidance.resetSeen()
  expect(ctx.uiGuidance.start(spec.id)).toBe(true)
  pressEscape()
  expect(ctx.uiGuidance.hasSeen(spec.id)).toBe(true)
  expect(document.querySelector('.driver-popover')).toBeNull()
  dispose()
  dispose()
})

it('advances an action step only from the real target and notices the next target mounting', async () => {
  const ctx = await load()
  const target = add(first.target)
  const spec = tour([{ ...first, advanceOn: 'click' }, next])
  ctx.uiGuidance.register(spec)
  expect(ctx.uiGuidance.start(spec.id)).toBe(true)
  expect(nextButton().style.display).toBe('none')
  // Driver opens the first card immediately but ignores target clicks until its first animation frame.
  await new Promise(resolve => window.requestAnimationFrame(resolve))
  const action = vi.fn(() => { queueMicrotask(() => { add(next.target) }) })
  target.addEventListener('click', action)
  target.click()
  expect(action).toHaveBeenCalledOnce()
  await vi.waitFor(() => { expect(currentTitle()).toBe(next.title()) })
  find('.driver-popover-close-btn').click()
  expect(ctx.uiGuidance.hasSeen(spec.id)).toBe(true)
})

it('acknowledges a final action and returns focus to the opener', async () => {
  const ctx = await load()
  const opener = add('sidebar.opener')
  const target = add(first.target)
  const spec = tour([{ ...first, advanceOn: 'click' }])
  ctx.uiGuidance.register(spec)
  opener.focus()
  ctx.uiGuidance.start(spec.id)
  await new Promise(resolve => window.requestAnimationFrame(resolve))
  target.click()
  expect(document.querySelector('.driver-popover')).toBeNull()
  expect(document.activeElement).toBe(opener)
  expect(ctx.uiGuidance.hasSeen(spec.id)).toBe(true)
})

it('returns false without dismissing the active tour if no eligible target exists', async () => {
  const ctx = await load()
  const target = add(first.target)
  target.hidden = true
  const spec = tour([first])
  ctx.uiGuidance.register(spec)
  expect(ctx.uiGuidance.start(spec.id)).toBe(false)
  expect(ctx.uiGuidance.hasSeen(spec.id)).toBe(false)
  target.hidden = false
  expect(ctx.uiGuidance.start(spec.id)).toBe(true)
  expect(ctx.uiGuidance.start('sidebar.unknown')).toBe(false)
  expect(currentTitle()).toBe(first.title())
  ctx.uiGuidance.register({ id: 'sidebar.empty', steps: [] })
  expect(ctx.uiGuidance.start('sidebar.empty')).toBe(false)
  expect(ctx.uiGuidance.start(spec.id)).toBe(true)
  expect(ctx.uiGuidance.hasSeen(spec.id)).toBe(true)
})

it('transitions only between steps when supported and motion is allowed', async () => {
  const ctx = await load()
  add(first.target)
  add(next.target)
  const spec = tour([first, next])
  const updateOptions: StartViewTransitionOptions[] = []
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: (options: StartViewTransitionOptions) => {
    updateOptions.push(options)
    return { skipTransition: vi.fn() }
  } })
  ctx.uiGuidance.register(spec)
  ctx.uiGuidance.start(spec.id)
  expect(updateOptions).toHaveLength(0)
  nextButton().click()
  expect(updateOptions).toHaveLength(1)
  expect(updateOptions[0]!.types).toEqual(['jan-guidance-step'])
  expect(currentTitle()).toBe(first.title())
  updateOptions[0]!.update!()
  expect(currentTitle()).toBe(next.title())
  vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList)
  backButton().click()
  expect(updateOptions).toHaveLength(1)
  expect(currentTitle()).toBe(first.title())
  vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList)
  nextButton().click()
  pressEscape()
  updateOptions[1]!.update!()
  expect(document.querySelector('.driver-popover')).toBeNull()
})
