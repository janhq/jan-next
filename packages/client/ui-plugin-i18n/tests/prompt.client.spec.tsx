// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@janhq/jan-client-store'
import { allowAllAccess, contextMenuHook, makeTranslate } from '@janhq/jan-client-test-runtime'
import type { LocaleSnapshot } from '@janhq/jan-client-locale/client'
import type { PluginI18nJob } from '@janhq/jan-api-remotes/client'
import { PluginTranslationPrompt, type PluginTranslationPromptProps } from '../src/client/PluginTranslationPrompt.tsx'
import type { PluginTranslationSuggestion } from '../src/client/service.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const cad: PluginTranslationSuggestion = { pkg: 'dsh-cad', title: 'CAD', language: 'zh', languageName: 'Chinese', target: 'en' }
const ppt: PluginTranslationSuggestion = { ...cad, pkg: 'dsh-ppt', title: 'Presentations' }
const done: PluginI18nJob = { pkg: cad.pkg, locale: 'en', state: 'done', done: 0, total: 0 }
const locale: LocaleSnapshot = { active: 'en', locales: [], revision: 0 }
const unread = (): never => { throw new Error('The translation prompt must not read application state') }

function mount() {
  const suggestions = createSnapshotStore<readonly PluginTranslationSuggestion[]>([cad, ppt])
  const translate = vi.fn<PluginTranslationPromptProps['translate']>()
  const clear = vi.fn(async (_pkg: string) => {})
  const dismiss = vi.fn((pkg: string) => { suggestions.set(suggestions.getSnapshot().filter(item => item.pkg !== pkg)) })
  render(<PluginTranslationPrompt
    usePanelInfo={unread} useSessions={unread} useSessionStatus={unread} useSessionRetainInfo={unread}
    useWorkspaces={unread} useResource={unread} useContextMenu={contextMenuHook()} {...allowAllAccess}
    t={makeTranslate(en, {})}
    useLocale={select => select(locale)}
    useSuggestions={select => select(useSyncExternalStore(listener => suggestions.subscribe(listener), () => suggestions.getSnapshot()))}
    translate={translate}
    clear={clear}
    dismiss={dismiss}
  />)
  return { suggestions, translate, clear, dismiss }
}

describe('plugin translation prompt', () => {
  it('offers one plugin at a time and exposes both dismissal choices', () => {
    const h = mount()
    expect(screen.getByText('CAD is in Chinese. Translate to English?')).toBeTruthy()
    expect(screen.queryByText('Presentations is in Chinese. Translate to English?')).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(h.dismiss).toHaveBeenCalledWith(cad.pkg, 'later')
    expect(screen.getByText('Presentations is in Chinese. Translate to English?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: "Don't show again", exact: true }))
    expect(h.dismiss).toHaveBeenCalledWith(ppt.pkg, 'never')
    expect(screen.queryByRole('button', { name: en.actionTranslate })).toBeNull()
  })

  it('holds progress even when consent removes the suggestion, then allows showing the original', async () => {
    const h = mount()
    const task = Promise.withResolvers<PluginI18nJob>()
    h.translate.mockImplementationOnce(() => {
      h.suggestions.set([ppt])
      return task.promise
    })
    fireEvent.click(screen.getByRole('button', { name: en.actionTranslate }))
    expect(screen.getByText('Translating CAD into English...')).toBeTruthy()
    expect(screen.queryByText('Presentations is in Chinese. Translate to English?')).toBeNull()
    await act(async () => { task.resolve(done) })
    expect(screen.getByText('CAD translated into English.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.offerOriginal }))
    expect(h.clear).toHaveBeenCalledWith(cad.pkg)
    await screen.findByText('Presentations is in Chinese. Translate to English?')
  })

  it('reports the translation error and lets the user retry', async () => {
    const h = mount()
    h.translate.mockResolvedValueOnce({ ...done, state: 'failed', message: 'model offline' }).mockResolvedValueOnce(done)
    fireEvent.click(screen.getByRole('button', { name: en.actionTranslate }))
    await screen.findByText('Translation failed: model offline')
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(h.translate).toHaveBeenLastCalledWith(cad.pkg, true)
    await screen.findByRole('button', { name: en.offerOriginal })
  })
})
