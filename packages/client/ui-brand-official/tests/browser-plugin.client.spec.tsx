// @vitest-environment jsdom
import { Context } from '@janhq/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@janhq/jan-client-ui-renderer/client'
import { LocaleRuntime } from '@janhq/jan-client-locale/client'
import { en } from '../src/client/locales.ts'
import { apply, inject } from '../src/client/index.ts'
import { OfficialBrandMark, OfficialBrandName } from '../src/client/Brand.tsx'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'conversation.hero.brand.mark',
] as const

const FRAME_HOLE = 'conversation.hero.frame'

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  ctx.provide('locale', new LocaleRuntime(ctx))
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries([...HOLES, FRAME_HOLE].map(name => [name, {
      kind: name === FRAME_HOLE ? 'hoc' : 'single',
      scope: 'root',
    }])),
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, declareHoles, disposeHoles }
}

describe('official browser-brand plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('names the product in local builds too, replacing the build-number label', async () => {
    vi.stubEnv('JAN_CLIENT_BUILD_PROFILE', 'local')
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(1)
  })

  it('fills declarations before or after apply and removes every occupant on teardown', async () => {
    vi.stubEnv('JAN_CLIENT_BUILD_PROFILE', 'official')
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    before.disposeHoles?.()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    await fiber.dispose()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)

    const after = await bench(false)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('no longer frames the home with the whale decoration', async () => {
    vi.stubEnv('JAN_CLIENT_BUILD_PROFILE', 'official')
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    expect(subject.slots.entries(FRAME_HOLE)).toHaveLength(0)
  })

  it('renders the Jan name with its stage, and the logo at each requested size', () => {
    const name = render(<OfficialBrandName t={((key: keyof typeof en) => en[key]) as never} />)
    expect(name.container.textContent).toBe('JanAlpha')
    name.unmount()

    const mark = render(<OfficialBrandMark size={34} className="hero" />)
    const img = () => mark.container.querySelector('img')
    expect(img()?.getAttribute('width')).toBe('34')
    expect(img()?.getAttribute('alt')).toBe('')
    expect(img()?.className).toBe('hero')
    mark.rerender(<OfficialBrandMark size={24} />)
    expect(img()?.getAttribute('width')).toBe('24')
  })
})
