// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@janhq/jan-client-store'
import { bindSnapshotSelector } from '@janhq/jan-client-test-runtime'
import type { CatalogModelInfo, LlamaCppProgress, LlamaCppState, LocalModelEntry } from '@janhq/jan-api-llama-cpp-controller'
import { LocalModelCard, type LocalModelCardProps } from '../src/client/LocalModelCard.tsx'
import { LocalSetup, type LocalSetupProps } from '../src/client/LocalSetup.tsx'
import { en } from '../src/client/locales.ts'
import { estimateRemaining, formatBytes, type LocalModelMirror } from '../src/client/state.ts'
import type { LocalModelActions } from '../src/client/actions.ts'

afterEach(cleanup)

const model = { id: 'jan-v3.5-4b', name: 'Jan v3.5 4B', modelBytes: 2_716_066_656 }
const jan: LocalModelEntry = {
  id: 'jan-v3.5-4b', name: 'Jan v3.5 4B', bytes: 2_716_066_656, source: 'catalog', active: true, status: 'loaded', architecture: 'qwen3',
  vision: false, configuredContextSize: 32768, autoFit: false,
}
const catalog: CatalogModelInfo[] = [
  { id: 'jan-v3.5-4b', name: 'Jan v3.5 4B', bytes: 2_716_066_656, repo: 'janhq/Jan-v3.5-4B-gguf', recommended: true, installed: false, vision: false },
  { id: 'qwen3-8b', name: 'Qwen3 8B', bytes: 5_027_784_512, repo: 'unsloth/Qwen3-8B-GGUF', recommended: false, installed: false, vision: false },
  { id: 'qwen3-vl-2b', name: 'Qwen3 VL 2B Instruct', bytes: 1_900_000_000, repo: 'unsloth/Qwen3-VL-2B-Instruct-GGUF', recommended: false, installed: false, vision: true },
]

function t(key: keyof typeof en, params?: Record<string, string>): string {
  let text: string = en[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replace(`{${name}}`, value)
  return text
}

function progress(receivedBytes: number, totalBytes: number, extra: Partial<LlamaCppProgress> = {}): LlamaCppProgress {
  return { receivedBytes, totalBytes, bytesPerSecond: 0, ...extra }
}

type StateInput = Partial<LlamaCppState> & Pick<LlamaCppState, 'phase'>

const INSTALLED = new Set(['installed', 'stopped', 'starting', 'running'])

function full(state: StateInput): LlamaCppState {
  return { hostPlatform: 'linux', provider: 'local', model, models: INSTALLED.has(state.phase) ? [jan] : [], downloads: [], catalog, ...state }
}

function fixture(state: StateInput) {
  const store = createSnapshotStore<LocalModelMirror>({ state: full(state), connected: true })
  const actions = {
    install: vi.fn(), cancel: vi.fn(), start: vi.fn(), stop: vi.fn(), uninstall: vi.fn(),
    downloadModel: vi.fn(), cancelDownload: vi.fn(), retryDownload: vi.fn(), pauseDownload: vi.fn(),
    setDefaultModel: vi.fn<LocalModelActions['setDefaultModel']>(async () => ({ ok: true, value: undefined })),
    setModelContext: vi.fn<LocalModelActions['setModelContext']>(async () => ({ ok: true, value: undefined })),
    setModelFit: vi.fn<LocalModelActions['setModelFit']>(async () => ({ ok: true, value: undefined })),
    loadModel: vi.fn<LocalModelActions['loadModel']>(async () => ({ ok: true, value: undefined })),
    unloadModel: vi.fn<LocalModelActions['unloadModel']>(async () => ({ ok: true, value: undefined })),
    deleteModel: vi.fn<LocalModelActions['deleteModel']>(async () => ({ ok: true, value: undefined })),
    lookupRepo: vi.fn<LocalModelActions['lookupRepo']>(), downloadRepoFile: vi.fn<LocalModelActions['downloadRepoFile']>(),
    importModel: vi.fn<LocalModelActions['importModel']>(),
  }
  const set = (next: StateInput): void => { store.set({ state: full(next), connected: true }) }
  return { store, actions, set, useLocalModel: bindSnapshotSelector(store) }
}

function card(f: ReturnType<typeof fixture>) {
  return render(<LocalModelCard {...{ useLocalModel: f.useLocalModel, actions: f.actions, t } as never as LocalModelCardProps} />)
}

it('formats sizes and remaining time for people', () => {
  expect(formatBytes(2_716_066_656)).toBe('2.7 GB')
  expect(formatBytes(23_109_987)).toBe('23 MB')
  expect(formatBytes(512)).toBe('1 KB')
  expect(formatBytes(0)).toBe('0 MB')
  expect(estimateRemaining(1000, 0)).toBeUndefined()
  expect(estimateRemaining(30_000_000, 1_000_000)).toEqual({ key: 'etaSoon', params: {} })
  expect(estimateRemaining(150_000_000, 1_000_000)).toEqual({ key: 'etaMinutes', params: { minutes: '3' } })
  expect(estimateRemaining(4_000_000_000, 1_000_000)).toEqual({ key: 'etaHours', params: { hours: '1', minutes: '7' } })
})

it('offers the download with its total size, then shows percent, speed, time left and cancel', () => {
  const f = fixture({ phase: 'missing' })
  const view = card(f)
  fireEvent.click(screen.getByRole('button', { name: 'Download (2.7 GB)' }))
  expect(f.actions.install).toHaveBeenCalledOnce()
  view.unmount()
  const running = progress(1_000_000_000, 2_716_066_656, { bytesPerSecond: 20_000_000 })
  f.set({ phase: 'downloading', progress: running, downloads: [{ id: 'jan-v3.5-4b', name: 'Jan v3.5 4B', progress: running }] })
  card(f)
  expect(screen.getByTestId('local-model-progress').textContent)
    .toBe('Downloading Jan v3.5 4B: 36% · 1.0 GB of 2.7 GB · 20 MB/s · about 2 min left')
  fireEvent.click(screen.getByRole('button', { name: en.cancel }))
  expect(f.actions.cancel).toHaveBeenCalledOnce()
  expect(screen.queryByTestId('local-model-remove')).toBeNull()
  // The first download is shown once, by the card, not again in the downloads list.
  expect(screen.queryByTestId('local-model-downloads')).toBeNull()
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

it('shows a failure with the worker log and offers a retry', () => {
  const f = fixture({ phase: 'failed', error: 'the local model worker exited with code 4: it could not read its preset', logTail: 'failed to load model' })
  card(f)
  expect(screen.getByRole('alert').textContent).toContain('exited with code 4')
  expect(screen.getByText('failed to load model')).toBeTruthy()
  fireEvent.click(screen.getByTestId('local-model-retry'))
  expect(f.actions.install).toHaveBeenCalledOnce()
})

it('lists installed models with fit, context and residency, and loads, unloads, makes default and deletes them', async () => {
  const imported: LocalModelEntry = {
    id: 'mine', name: 'Mine', bytes: 1_000_000, source: 'import', active: false, status: 'unloaded', architecture: 'llama',
    contextLength: 8192, configuredContextSize: 8192, autoFit: false, fit: 'too-large', vision: true,
  }
  const f = fixture({ phase: 'running', models: [{ ...jan, contextSize: 32768, fit: 'fits' }, imported] })
  card(f)
  const rows = screen.getByTestId('local-model-installed').querySelectorAll('li')
  expect([...rows].map(row => row.textContent)).toEqual([
    'Jan v3.5 4BDefaultFits2.7 GB · qwen3 · 32,768-token context · CuratedContext lengthAuto-fitLoadedUnloadDelete',
    'MineVisionToo large1 MB · llama · trained on 8,192 tokens · Imported fileContext lengthMaximum: 8,192 tokensAuto-fitNot loadedLoadMake defaultDelete',
  ])
  expect(rows[1]?.querySelector('[data-fit]')?.getAttribute('title')).toBe(en.fitTooLargeHint)
  expect(rows[0]?.querySelector('[data-testid="local-model-vision"]')).toBeNull()
  expect(rows[1]?.querySelector('[data-testid="local-model-vision"]')?.getAttribute('title')).toBe(en.visionHint)
  fireEvent.click(screen.getByTestId('local-model-unload'))
  expect(f.actions.unloadModel).toHaveBeenCalledWith('jan-v3.5-4b')
  fireEvent.click(screen.getByTestId('local-model-load'))
  expect(f.actions.loadModel).toHaveBeenCalledWith('mine')
  // The row waits for its operation before offering another.
  expect(screen.getByTestId('local-model-make-default').hasAttribute('disabled')).toBe(true)
  await waitFor(() => { expect(screen.getByTestId('local-model-make-default').hasAttribute('disabled')).toBe(false) })
  fireEvent.click(screen.getByTestId('local-model-make-default'))
  expect(f.actions.setDefaultModel).toHaveBeenCalledWith('mine')
  f.actions.deleteModel.mockResolvedValueOnce({ ok: false, error: 'the model has requests in flight; retry once they finish' })
  await waitFor(() => { expect(screen.getAllByTestId('local-model-delete')[1]?.hasAttribute('disabled')).toBe(false) })
  fireEvent.click(screen.getAllByTestId('local-model-delete')[1]!)
  expect(screen.getByText('Remove Mine from the list? The file stays on disk.')).toBeTruthy()
  fireEvent.click(screen.getByTestId('local-model-confirm-delete'))
  expect(f.actions.deleteModel).toHaveBeenCalledWith('mine')
  // A refused removal keeps the row and says why on it.
  expect((await screen.findByRole('alert')).textContent).toBe('the model has requests in flight; retry once they finish')
  expect(screen.getByTestId('local-model-installed').querySelectorAll('li')).toHaveLength(2)
})

it('changes per-model context length and automatic fit while preserving the installed row', async () => {
  const f = fixture({ phase: 'running', models: [{ ...jan, configuredContextSize: 32768, autoFit: false, contextLength: 131072 }] })
  card(f)
  expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Context length' }).value).toBe('32768')
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Context length' }), { target: { value: '49152' } })
  fireEvent.blur(screen.getByRole('spinbutton', { name: 'Context length' }))
  await waitFor(() => { expect(f.actions.setModelContext).toHaveBeenCalledWith(jan.id, 49152) })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Auto-fit' }))
  await waitFor(() => { expect(f.actions.setModelFit).toHaveBeenCalledWith(jan.id, true) })
})

it('rejects an invalid context without changing the saved setting', () => {
  const f = fixture({ phase: 'running', models: [{ ...jan, configuredContextSize: 32768, contextLength: 65536 }] })
  card(f)
  const input = screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Context length' })
  fireEvent.change(input, { target: { value: '70000' } })
  fireEvent.blur(input)
  expect(f.actions.setModelContext).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toBe(en.invalidContext)
  expect(input.value).toBe('32768')
})

it('hides residency and load controls while the server is stopped, and summarizes the hardware', () => {
  const f = fixture({
    phase: 'stopped', models: [{ ...jan, status: 'unloaded' }],
    hardware: { backend: 'vulkan', devices: [{ id: 'Vulkan0', name: 'Radeon RX 7800 XT', totalMiB: 16_368, freeMiB: 15_000 }], memoryBytes: 32e9 },
  })
  card(f)
  expect(screen.queryByTestId('local-model-residency')).toBeNull()
  expect(screen.queryByTestId('local-model-load')).toBeNull()
  expect(screen.getByTestId('local-model-hardware').textContent).toBe('GPU: Radeon RX 7800 XT (17.2 GB) · Backend: vulkan · System memory: 32.0 GB')
  cleanup()
  f.set({ phase: 'stopped', hardware: { backend: 'cpu', devices: [], memoryBytes: 8e9 } })
  card(f)
  expect(screen.getByTestId('local-model-hardware').textContent).toBe('No GPU found; models run on the CPU · Backend: cpu · System memory: 8.0 GB')
})

it('downloads a curated model and shows it in the downloads list with its progress', () => {
  const f = fixture({ phase: 'running', models: [jan], catalog: catalog.map(entry => ({ ...entry, installed: entry.id === jan.id, fit: 'fits' as const })) })
  const view = card(f)
  const rows = screen.getByTestId('local-model-catalog').querySelectorAll('li')
  expect(rows[0]?.textContent).toContain('Installed')
  expect(rows[1]?.querySelector('[data-fit]')?.textContent).toBe(en.fitFits)
  expect([...rows].map(row => row.querySelector('[data-testid="local-model-vision"]')?.textContent)).toEqual([undefined, undefined, en.visionTag])
  fireEvent.change(screen.getByTestId('local-model-search'), { target: { value: 'qwen3 8b' } })
  expect(screen.getByTestId('local-model-catalog').querySelectorAll('li')).toHaveLength(1)
  fireEvent.click(screen.getByTestId('local-model-catalog-download'))
  expect(f.actions.downloadModel).toHaveBeenCalledWith('qwen3-8b')
  view.unmount()
  f.set({ phase: 'running', models: [jan], downloads: [
    { id: 'qwen3-8b', name: 'Qwen3 8B', progress: progress(2_500_000_000, 5_027_784_512) },
    { id: 'broken', name: 'Broken', error: 'Could not download model: HTTP 404' },
    { id: 'gemma', name: 'Gemma', paused: true, progress: progress(1_000_000_000, 4_000_000_000) },
  ] })
  card(f)
  const downloads = screen.getByTestId('local-model-downloads')
  expect(downloads.textContent).toContain('Downloading Qwen3 8B: 49% · 2.5 GB of 5.0 GB')
  expect(downloads.textContent).toContain('Could not download model: HTTP 404')
  expect(downloads.textContent).toContain('Paused at 25%')
  // Only the running download offers Pause; only the paused one offers Resume.
  expect(screen.getAllByTestId('local-model-pause-download')).toHaveLength(1)
  fireEvent.click(screen.getByTestId('local-model-pause-download'))
  expect(f.actions.pauseDownload).toHaveBeenCalledWith('qwen3-8b')
  fireEvent.click(screen.getByTestId('local-model-resume-download'))
  expect(f.actions.retryDownload).toHaveBeenCalledWith('gemma')
  fireEvent.click(screen.getByTestId('local-model-retry-download'))
  expect(f.actions.retryDownload).toHaveBeenCalledWith('broken')
  fireEvent.click(screen.getByRole('button', { name: en.dismiss }))
  expect(f.actions.cancelDownload).toHaveBeenCalledWith('broken')
})

it('looks up a pasted Hugging Face repository and downloads one of its files', async () => {
  const f = fixture({ phase: 'running', models: [jan] })
  f.actions.lookupRepo.mockResolvedValue({ ok: true, value: { repo: 'acme/tiny-GGUF', files: [
    { file: 'tiny-Q2_K.gguf', bytes: 1_000_000, quant: 'Q2_K', recommended: false, installed: true },
    { file: 'tiny-Q4_K_M.gguf', bytes: 2_000_000, quant: 'Q4_K_M', recommended: true, installed: false, fit: 'tight' },
  ] } })
  f.actions.downloadRepoFile.mockResolvedValue({ ok: true, value: 'tiny-q4_k_m' })
  card(f)
  fireEvent.change(screen.getByTestId('local-model-search'), { target: { value: 'acme/tiny-GGUF' } })
  expect(screen.queryByTestId('local-model-catalog')).toBeNull()
  await act(async () => { fireEvent.click(screen.getByTestId('local-model-lookup')) })
  expect(f.actions.lookupRepo).toHaveBeenCalledWith('acme/tiny-GGUF', expect.any(AbortSignal))
  const rows = screen.getByTestId('local-model-repo-files').querySelectorAll('li')
  expect(rows[0]?.textContent).toContain('Installed')
  expect(rows[1]?.textContent).toContain('2 MB · Q4_K_M')
  expect(rows[1]?.querySelector('[data-fit]')?.textContent).toBe(en.fitTight)
  expect(rows[0]?.querySelector('[data-fit]')).toBeNull()
  expect(screen.queryByTestId('local-model-repo-projector')).toBeNull()
  await act(async () => {
    fireEvent.click(screen.getByTestId('local-model-repo-download'))
    f.set({ phase: 'running', models: [jan], downloads: [{ id: 'tiny-q4_k_m', name: 'tiny-Q4_K_M' }] })
  })
  expect(f.actions.downloadRepoFile).toHaveBeenCalledWith('acme/tiny-GGUF', 'tiny-Q4_K_M.gguf')
  expect(screen.queryByTestId('local-model-repo-download')).toBeNull()
  // The row follows the live state: installed, then offered again once the model is deleted.
  const tiny: LocalModelEntry = { id: 'tiny-q4_k_m', name: 'tiny-Q4_K_M', bytes: 2_000_000, source: 'huggingface', active: false, status: 'unloaded', architecture: 'qwen3', vision: false, configuredContextSize: 8192, autoFit: false }
  await act(async () => { f.set({ phase: 'running', models: [jan, tiny] }) })
  expect(screen.getByTestId('local-model-repo-files').querySelectorAll('li')[1]?.textContent).toContain('Installed')
  await act(async () => { f.set({ phase: 'running', models: [jan] }) })
  expect(screen.getByTestId('local-model-repo-download')).toBeTruthy()
})

it('shows why a repository lookup failed', async () => {
  const f = fixture({ phase: 'running', models: [jan] })
  f.actions.lookupRepo.mockResolvedValue({ ok: false, error: 'No public repository acme/absent on Hugging Face' })
  card(f)
  fireEvent.change(screen.getByTestId('local-model-search'), { target: { value: 'acme/absent' } })
  await act(async () => { fireEvent.submit(screen.getByTestId('local-model-search').closest('form')!) })
  expect(screen.getByRole('alert').textContent).toBe('No public repository acme/absent on Hugging Face')
})

it('imports a file by path and reports a refusal', async () => {
  const f = fixture({ phase: 'running', models: [jan] })
  f.actions.importModel.mockResolvedValueOnce({ ok: false, error: 'notes.gguf is not a GGUF model file' })
  f.actions.importModel.mockResolvedValueOnce({ ok: true, value: 'mine' })
  card(f)
  const field = screen.getByTestId('local-model-import-path')
  expect(screen.getByTestId('local-model-import')).toHaveProperty('disabled', true)
  fireEvent.change(field, { target: { value: '/tmp/notes.gguf' } })
  await act(async () => { fireEvent.click(screen.getByTestId('local-model-import')) })
  expect(screen.getByRole('alert').textContent).toBe('notes.gguf is not a GGUF model file')
  fireEvent.change(field, { target: { value: '/tmp/Mine.gguf' } })
  await act(async () => { fireEvent.click(screen.getByTestId('local-model-import')) })
  expect(f.actions.importModel).toHaveBeenLastCalledWith('/tmp/Mine.gguf', undefined)
  expect(screen.getByText('Added Mine.gguf.')).toBeTruthy()
  expect((field as HTMLInputElement).value).toBe('')
})

it('imports a vision model with its projector file and clears both paths', async () => {
  const f = fixture({ phase: 'running', models: [jan] })
  f.actions.importModel.mockResolvedValue({ ok: true, value: 'vl' })
  card(f)
  const projector = screen.getByTestId('local-model-import-projector')
  expect(projector.getAttribute('aria-label')).toBe(en.importProjectorLabel)
  fireEvent.change(screen.getByTestId('local-model-import-path'), { target: { value: ' /tmp/VL.gguf ' } })
  fireEvent.change(projector, { target: { value: ' /tmp/mmproj-VL.gguf ' } })
  await act(async () => { fireEvent.click(screen.getByTestId('local-model-import')) })
  expect(f.actions.importModel).toHaveBeenLastCalledWith('/tmp/VL.gguf', '/tmp/mmproj-VL.gguf')
  expect((projector as HTMLInputElement).value).toBe('')
  // A blank projector field means a text-only model.
  fireEvent.change(screen.getByTestId('local-model-import-path'), { target: { value: '/tmp/Text.gguf' } })
  fireEvent.change(projector, { target: { value: '   ' } })
  await act(async () => { fireEvent.click(screen.getByTestId('local-model-import')) })
  expect(f.actions.importModel).toHaveBeenLastCalledWith('/tmp/Text.gguf', undefined)
})

it('says a looked-up repository downloads its vision projector with the model', async () => {
  const f = fixture({ phase: 'running', models: [jan] })
  f.actions.lookupRepo.mockResolvedValue({ ok: true, value: { repo: 'acme/vl-GGUF', projector: { file: 'mmproj-F16.gguf', bytes: 800_000_000 }, files: [
    { file: 'vl-Q4_K_M.gguf', bytes: 2_000_000_000, quant: 'Q4_K_M', recommended: true, installed: false },
  ] } })
  card(f)
  fireEvent.change(screen.getByTestId('local-model-search'), { target: { value: 'acme/vl-GGUF' } })
  await act(async () => { fireEvent.click(screen.getByTestId('local-model-lookup')) })
  expect(screen.getByTestId('local-model-repo-projector').textContent)
    .toBe(`${en.visionTag}Each download includes the vision projector mmproj-F16.gguf (800 MB).`)
})

it.each([
  ['linux', '/home/you/models/model.gguf', '/home/you/models/mmproj.gguf'],
  ['macos', '/Users/you/models/model.gguf', '/Users/you/models/mmproj.gguf'],
  ['windows', 'C:\\Users\\you\\models\\model.gguf', 'C:\\Users\\you\\models\\mmproj.gguf'],
] as const)('suggests import paths in the form a %s Host resolves', (hostPlatform, example, projectorExample) => {
  card(fixture({ phase: 'running', models: [jan], hostPlatform }))
  expect(screen.getByTestId('local-model-import-path').getAttribute('placeholder')).toBe(example)
  expect(screen.getByTestId('local-model-import-projector').getAttribute('placeholder')).toBe(`Vision projector (optional), e.g. ${projectorExample}`)
})

function setup(f: ReturnType<typeof fixture>, owner: Partial<LocalSetupProps> = {}) {
  const props = {
    expanded: false, expand: vi.fn(), collapse: vi.fn(), complete: vi.fn(),
    useLocalModel: f.useLocalModel, actions: f.actions, t, ...owner,
  }
  return { props, view: render(<LocalSetup {...props as never as LocalSetupProps} />) }
}

it('first run: the recommended offer starts the download and takes over the step', () => {
  const f = fixture({ phase: 'missing' })
  const { props } = setup(f)
  const offer = screen.getByTestId('onboarding-choice-local')
  expect(offer.textContent).toBe('Download a model to this computerRecommendedJan v3.5 4B · 2.7 GB download · free, private, works offline')
  fireEvent.click(offer)
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
  const f = fixture({ phase: 'downloading', progress: progress(1, 2) })
  const { props } = setup(f)
  expect(props.expand).toHaveBeenCalledOnce()
})

it('first run: continues in the background while busy and finishes once running', () => {
  const f = fixture({ phase: 'downloading', progress: progress(5, 10) })
  const { props, view } = setup(f, { expanded: true })
  expect(screen.getByTestId('local-model-progress').textContent).toBe('Downloading Jan v3.5 4B: 50% · 1 KB of 1 KB')
  expect(screen.getByText(en.moreModels)).toBeTruthy()
  fireEvent.click(screen.getByTestId('local-setup-background'))
  expect(props.complete).toHaveBeenCalledOnce()
  view.unmount()
  f.set({ phase: 'running' })
  const again = setup(f, { expanded: true })
  expect(screen.getByText('Jan v3.5 4B is ready. Pick it in the model menu at any time.')).toBeTruthy()
  fireEvent.click(screen.getByTestId('local-setup-done'))
  expect(again.props.complete).toHaveBeenCalledOnce()
})

it('first run: after Cancel the step stays collapsed while the host still reports the download', () => {
  const f = fixture({ phase: 'downloading', progress: progress(5, 10) })
  const { props, view } = setup(f)
  expect(props.expand).toHaveBeenCalledOnce()
  // The owner collapsed (Cancel); the next snapshot still says downloading.
  f.set({ phase: 'downloading', progress: progress(6, 10) })
  view.rerender(<LocalSetup {...{ ...props, expanded: false } as never as LocalSetupProps} />)
  expect(props.expand).toHaveBeenCalledOnce()
})

it('first run: the expanded step can start a download or an installed model', () => {
  const f = fixture({ phase: 'missing' })
  const view = setup(f, { expanded: true }).view
  fireEvent.click(screen.getByRole('button', { name: 'Download (2.7 GB)' }))
  expect(f.actions.install).toHaveBeenCalledOnce()
  view.unmount()
  f.set({ phase: 'stopped' })
  setup(f, { expanded: true })
  fireEvent.click(screen.getByRole('button', { name: en.start }))
  expect(f.actions.start).toHaveBeenCalledOnce()
})

it('shows the context the server settled on, and offers Stop while starting', () => {
  const f = fixture({ phase: 'running', contextSize: 32768 })
  const view = card(f)
  expect(screen.getByTestId('local-model-context').textContent).toBe(`Context window: ${(32768).toLocaleString()} tokens`)
  view.unmount()
  f.set({ phase: 'starting' })
  card(f)
  fireEvent.click(screen.getByTestId('local-model-stop'))
  expect(f.actions.stop).toHaveBeenCalledOnce()
})

it('drops a lookup answer that arrives after the text changed, and remembers started downloads across lookups', async () => {
  const f = fixture({ phase: 'running', models: [jan] })
  let answer: (value: Awaited<ReturnType<LocalModelActions['lookupRepo']>>) => void = () => {}
  f.actions.lookupRepo.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve }))
  card(f)
  const search = screen.getByTestId('local-model-search')
  fireEvent.change(search, { target: { value: 'acme/old-GGUF' } })
  fireEvent.click(screen.getByTestId('local-model-lookup'))
  fireEvent.change(search, { target: { value: 'acme/new-GGUF' } })
  await act(async () => { answer({ ok: true, value: { repo: 'acme/old-GGUF', files: [{ file: 'old.gguf', bytes: 1, recommended: false, installed: false }] } }) })
  expect(screen.queryByTestId('local-model-repo-files')).toBeNull()

  const files = { repo: 'acme/new-GGUF', files: [{ file: 'new-Q4_K_M.gguf', bytes: 2_000_000, quant: 'Q4_K_M', recommended: true, installed: false }] }
  f.actions.lookupRepo.mockResolvedValue({ ok: true, value: files })
  f.actions.downloadRepoFile.mockResolvedValue({ ok: true, value: 'new-q4_k_m' })
  await act(async () => { fireEvent.click(screen.getByTestId('local-model-lookup')) })
  await act(async () => {
    fireEvent.click(screen.getByTestId('local-model-repo-download'))
    f.set({ phase: 'running', models: [jan], downloads: [{ id: 'new-q4_k_m', name: 'new-Q4_K_M' }] })
  })
  await act(async () => { fireEvent.click(screen.getByTestId('local-model-lookup')) })
  expect(screen.queryByTestId('local-model-repo-download')).toBeNull()
  expect(f.actions.downloadRepoFile).toHaveBeenCalledOnce()
})
