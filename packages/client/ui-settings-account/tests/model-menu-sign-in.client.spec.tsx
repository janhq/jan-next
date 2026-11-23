// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@janhq/jan-client-test-runtime'
import type { AccountView } from '@janhq/jan-tokamak-account/types'
import type { AccountSnapshot } from '../src/client/AccountSection.tsx'
import { ModelMenuSignIn, type ModelMenuSignInProps } from '../src/client/ModelMenuSignIn.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

function mount(view: Pick<AccountView, 'status'> | undefined) {
  const snapshot = {
    view, details: undefined, avatar: undefined, failed: false, loginVisible: false, desktopOnboardingVisible: false,
  } as AccountSnapshot
  const start = vi.fn(async () => {})
  const dismiss = vi.fn()
  const props: ModelMenuSignInProps = {
    useAccount: <T,>(select: (value: AccountSnapshot) => T): T => select(snapshot),
    start, dismiss, locked: false, reportFailure: vi.fn(), t: makeTranslate(en),
  } as never
  render(<ModelMenuSignIn {...props} />)
  return { start, dismiss }
}

it('stays hidden while the account loads and once a credential is stored', () => {
  mount(undefined)
  expect(screen.queryByRole('menuitem')).toBeNull()
  cleanup()
  mount({ status: 'credential-stored' })
  expect(screen.queryByRole('menuitem')).toBeNull()
})

it('closes the model menu and starts sign-in when signed out', () => {
  const { start, dismiss } = mount({ status: 'signed-out' })
  fireEvent.click(screen.getByRole('menuitem', { name: 'Sign in for free usage' }))
  expect(dismiss).toHaveBeenCalledOnce()
  expect(start).toHaveBeenCalledOnce()
})
