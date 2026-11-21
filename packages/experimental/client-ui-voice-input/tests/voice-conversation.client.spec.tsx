// @vitest-environment jsdom
import type { ComponentType } from 'react'
import * as React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import * as primitives from '@janhq/jan-client-ui-primitives'
import { afterEach, expect, it, vi } from 'vitest'

type VoiceProps = {
  sessionId: string
  t: (key: string) => string
  append: () => void
  locked: boolean
  onActiveChange: (active: boolean) => void
}
type VoicePlugin = { apply: (ctx: object) => void }
type Loader = ((id: string) => object) & { async: (id: string) => Promise<object> }

const labels: Record<string, string> = {
  voiceOptions: 'Voice options', talk: 'Talk to Jan', dismiss: 'Dismiss',
  voiceBlocked: 'Voice conversations are turned off for your organization. Ask an admin to allow voice in its guardrail settings.',
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('closes the voice menu before showing the guardrail refusal as a dismissible application toast', async () => {
  const requireModule = Object.assign((id: string) => id === 'react' ? React : primitives,
    { async: async () => ({ dictionaries: {} }) }) as Loader
  // The shipped entry registers with the installed loader as soon as its module executes.
  let plugin: VoicePlugin | undefined
  vi.stubGlobal('__ModuleLoader__', { load: ({ factory }: { factory: (load: Loader) => VoicePlugin }) => { plugin = factory(requireModule) } })
  // @ts-expect-error The loader-owned script intentionally exports no ESM types.
  await import('../../../../plugins/tokamak/client.js')
  let Voice: ComponentType<VoiceProps> | undefined
  const dispose: (() => void)[] = []
  plugin!.apply({
    effect: (use: () => (() => void) | undefined) => { const stop = use(); if (stop) dispose.push(stop) },
    conversation: { appendDraft: vi.fn() }, locale: { register: vi.fn() },
    slots: {
      inject: (_slot: string, register: () => void) => register(),
      register: ({ name }: { name: string }, component: ComponentType<VoiceProps>) => { if (name === 'voice-input.options') Voice = component },
    },
  })
  await waitFor(() => { expect(Voice).toBeDefined() })
  const track = { stop: vi.fn() }
  const device = { getUserMedia: vi.fn(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] })) }
  const previousMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: device })
  vi.stubGlobal('RTCPeerConnection', class {
    localDescription = { sdp: 'offer' }
    addTrack() {}
    createDataChannel() { return {} }
    async createOffer() { return this.localDescription }
    async setLocalDescription() {}
    close() {}
  })
  const refusal = Promise.withResolvers<Response>()
  const fetchRequest = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ result: { token: 'test', callsUrl: 'https://example.invalid/calls' } }))
    .mockReturnValueOnce(refusal.promise)
  vi.stubGlobal('fetch', fetchRequest)
  const append = vi.fn(), onActiveChange = vi.fn()
  try {
    const Component = Voice!
    const { container } = render(<div data-composer-card><Component sessionId="test" t={key => labels[key] ?? key}
      append={append} locked={false} onActiveChange={onActiveChange} /></div>)
    fireEvent.click(screen.getByRole('button', { name: 'Voice options' }))
    const menu = screen.getByRole('menu')
    fireEvent.click(within(menu).getByText('Talk to Jan'))
    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => { expect(fetchRequest).toHaveBeenCalledTimes(2) })
    refusal.resolve(Response.json({ error: { code: 'guardrail_policy_unsupported' } }, { status: 403 }))
    const toast = await screen.findByRole('alert')
    expect(toast.textContent).toContain(labels.voiceBlocked)
    expect(container.contains(toast)).toBe(false)
    expect(screen.getByRole('button', { name: 'Voice options' }).getAttribute('aria-expanded')).toBe('false')
    expect(track.stop).toHaveBeenCalledOnce()
    expect(append).not.toHaveBeenCalled()
    fireEvent.click(within(toast).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  } finally {
    for (const stop of dispose.reverse()) stop()
    if (previousMediaDevices) Object.defineProperty(navigator, 'mediaDevices', previousMediaDevices)
    else Reflect.deleteProperty(navigator, 'mediaDevices')
  }
})
