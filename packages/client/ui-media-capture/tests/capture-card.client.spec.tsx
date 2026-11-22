// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CaptureCard } from '../src/client/CaptureCard.tsx'
import en from '../locale/en.json'
import type { CaptureCardProps } from '../src/client/contract.ts'
import type { CaptureKey } from '../src/client/locales.ts'

// The framework's `t` also accepts the shared common keys; this card's own copy covers every key it renders.
const t: CaptureCardProps['t'] = key => en[key as CaptureKey]
const getUserMedia = vi.fn<MediaDevices['getUserMedia']>()
const enumerateDevices = vi.fn<MediaDevices['enumerateDevices']>()

beforeEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia, enumerateDevices } })
  enumerateDevices.mockResolvedValue([])
})
afterEach(() => { cleanup(); vi.resetAllMocks(); Reflect.deleteProperty(navigator, 'mediaDevices') })

function fixture(mode: 'photo' | 'audio' = 'photo') {
  const decline = vi.fn(async () => {})
  const confirmActive = vi.fn(async () => true)
  const send = vi.fn(async () => {})
  const card = render(<CaptureCard {...{ mode, reason: 'Identify this.', decline, confirmActive, send, t }} />)
  return { decline, confirmActive, send, ...card }
}

it('declines from the inline card without requesting a device', async () => {
  const f = fixture()
  expect(screen.getByText('Identify this.')).toBeTruthy()
  expect(getUserMedia).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
  await screen.findByText('Capture declined')
  expect(f.decline).toHaveBeenCalledOnce()
  expect(getUserMedia).not.toHaveBeenCalled()
})

it('opens only the requested microphone and stops its tracks when the card closes', async () => {
  const track = Object.assign(new EventTarget(), { stop: vi.fn() })
  getUserMedia.mockResolvedValue({ getTracks: () => [track] } as never)
  const f = fixture('audio')
  fireEvent.click(screen.getByRole('button', { name: 'Allow microphone' }))
  await screen.findByRole('button', { name: 'Record audio' })
  expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: true, video: false })
  f.unmount()
  expect(track.stop).toHaveBeenCalledOnce()
})

it('stops tracks if a permission prompt resolves after the card closes', async () => {
  const pending = Promise.withResolvers<MediaStream>()
  getUserMedia.mockReturnValueOnce(pending.promise)
  const f = fixture()
  fireEvent.click(screen.getByRole('button', { name: 'Allow camera' }))
  await waitFor(() => expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: false, video: true }))
  f.unmount()
  const stop = vi.fn()
  pending.resolve({ getTracks: () => [{ stop }] } as never)
  await waitFor(() => expect(stop).toHaveBeenCalledOnce())
})

it('offers a decline after the OS denies camera permission', async () => {
  getUserMedia.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
  const f = fixture()
  fireEvent.click(screen.getByRole('button', { name: 'Allow camera' }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
  await screen.findByText('Capture declined')
  expect(f.decline).toHaveBeenCalledOnce()
  expect(f.send).not.toHaveBeenCalled()
})

it('releases the active microphone before submitting a refusal', async () => {
  const track = Object.assign(new EventTarget(), { stop: vi.fn() })
  getUserMedia.mockResolvedValue({ getTracks: () => [track] } as never)
  const f = fixture('audio')
  f.decline.mockImplementationOnce(async () => { expect(track.stop).toHaveBeenCalledOnce() })
  fireEvent.click(screen.getByRole('button', { name: 'Allow microphone' }))
  await screen.findByRole('button', { name: 'Record audio' })
  fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
  await screen.findByText('Capture declined')
  expect(f.send).not.toHaveBeenCalled()
})
