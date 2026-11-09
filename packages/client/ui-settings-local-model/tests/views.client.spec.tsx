// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { LlamaCppState } from '@deepseek-ai/dsh-api-llama-cpp-controller'
import { LocalModelCard, type LocalModelCardProps } from '../src/client/LocalModelCard.tsx'
import { LocalSetup, type LocalSetupProps } from '../src/client/LocalSetup.tsx'
import { en } from '../src/client/locales.ts'
import { formatBytes, type LocalModelMirror } from '../src/client/state.ts'

afterEach(cleanup)

const model = { id: 'jan-v3.5-4b', name: 'Jan v3.5 4B', modelBytes: 2_716_066_656, engineBytes: 23_109_987, backend: 'cpu' as const, engineVersion: 'b12211' }

function t(key: keyof typeof en, params?: Record<string, string>): string {
  let text: string = en[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replace(`{${name}}`, value)
  return text
}

function fixture(state: Partial<LlamaCppState> & Pick<LlamaCppState, 'phase'>) {
  const store = createSnapshotStore<LocalModelMirror>({ state: { provider: 'local', model, ...state }, connected: true })
  const actions = { install: vi.fn(), cancel: vi.fn(), start: vi.fn(), stop: vi.fn(), uninstall: vi.fn() }
  const set = (next: Partial<LlamaCppState> & Pick<LlamaCppState, 'phase'>): void => {
    store.set({ state: { provider: 'local', model, ...next }, connected: true })
  }
  return { store, actions, set, useLocalModel: bindSnapshotSelector(store) }
}

function card(f: ReturnType<typeof fixture>) {
  return render(<LocalModelCard {...{ useLocalModel: f.useLocalModel, actions: f.actions, t } as never as LocalModelCardProps} />)
}

it('formats sizes for people', () => {
  expect(formatBytes(2_716_066_656)).toBe('2.7 GB')
  expect(formatBytes(23_109_987)).toBe('23 MB')
  expect(formatBytes(512)).toBe('1 KB')
  expect(formatBytes(0)).toBe('0 MB')
})

it('offers the download with its total size, then shows byte progress and cancel', () => {
  const f = fixture({ phase: 'missing' })
  const view = card(f)
  fireEvent.click(screen.getByRole('button', { name: 'Download (2.7 GB)' }))
  expect(f.actions.install).toHaveBeenCalledOnce()
  view.unmount()
  f.set({ phase: 'downloading', progress: { phase: 'model', receivedBytes: 1_000_000_000, totalBytes: 2_716_066_656 } })
  card(f)
  expect(screen.getByTestId('local-model-progress').textContent).toBe('Model: 1.0 GB of 2.7 GB')
  fireEvent.click(screen.getByRole('button', { name: en.cancel }))
  expect(f.actions.cancel).toHaveBeenCalledOnce()
  expect(screen.queryByTestId('local-model-remove')).toBeNull()
})

it('starts, stops and removes an installed model', () => {
  const f = fixture({ phase: 'stopped' })
  const view = card(f)
  fireEvent.click(screen.getByTestId('local-model-start'))
  fireEvent.click(screen.getByTestId('local-model-remove'))
  expect(f.actions.start).toHaveBeenCalledOnce()
  expect(f.actions.uninstall).toHaveBeenCalledOnce()
  view.unmount()
  f.set({ phase: 'running' })
  card(f)
  expect(screen.getByTestId('local-model-status').dataset.phase).toBe('running')
  fireEvent.click(screen.getByTestId('local-model-stop'))
  expect(f.actions.stop).toHaveBeenCalledOnce()
})

it('shows a failure with the engine log and offers a retry', () => {
  const f = fixture({ phase: 'failed', error: 'the local model server exited (code 3)', logTail: 'failed to load model' })
  card(f)
  expect(screen.getByRole('alert').textContent).toContain('exited (code 3)')
  expect(screen.getByText('failed to load model')).toBeTruthy()
  fireEvent.click(screen.getByTestId('local-model-retry'))
  expect(f.actions.install).toHaveBeenCalledOnce()
})

function setup(f: ReturnType<typeof fixture>, owner: Partial<LocalSetupProps> = {}) {
  const props = {
    expanded: false, expand: vi.fn(), collapse: vi.fn(), complete: vi.fn(),
    useLocalModel: f.useLocalModel, actions: f.actions, t, ...owner,
  }
  return { props, view: render(<LocalSetup {...props as never as LocalSetupProps} />) }
}

it('first run: the offer starts the download and takes over the step', () => {
  const f = fixture({ phase: 'missing' })
  const { props } = setup(f)
  expect(screen.getByTestId('onboarding-choice-local').textContent).toContain('Jan v3.5 4B · 2.7 GB download')
  fireEvent.click(screen.getByTestId('onboarding-choice-local'))
  expect(f.actions.install).toHaveBeenCalledOnce()
  expect(props.expand).toHaveBeenCalledOnce()
})

it('first run: an installed model is started instead of downloaded again', () => {
  const f = fixture({ phase: 'stopped' })
  setup(f)
  fireEvent.click(screen.getByTestId('onboarding-choice-local'))
  expect(f.actions.start).toHaveBeenCalledOnce()
  expect(f.actions.install).not.toHaveBeenCalled()
})

it('first run: reopening during a download goes straight to its progress', () => {
  const f = fixture({ phase: 'downloading', progress: { phase: 'engine', receivedBytes: 1, totalBytes: 2 } })
  const { props } = setup(f)
  expect(props.expand).toHaveBeenCalledOnce()
})

it('first run: continues in the background while busy and finishes once running', () => {
  const f = fixture({ phase: 'downloading', progress: { phase: 'model', receivedBytes: 5, totalBytes: 10 } })
  const { props, view } = setup(f, { expanded: true })
  fireEvent.click(screen.getByTestId('local-setup-background'))
  expect(props.complete).toHaveBeenCalledOnce()
  view.unmount()
  f.set({ phase: 'running' })
  const again = setup(f, { expanded: true })
  expect(screen.getByText('Jan v3.5 4B is ready. Pick it in the model menu at any time.')).toBeTruthy()
  fireEvent.click(screen.getByTestId('local-setup-done'))
  expect(again.props.complete).toHaveBeenCalledOnce()
})
