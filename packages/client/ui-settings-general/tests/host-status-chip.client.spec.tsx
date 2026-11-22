// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ConnectionState } from '@janhq/jan-client-connection/client'
import type { RemoteHostFacts } from '@janhq/jan-api-remotes/client'
import type { PropsLocale } from '@janhq/jan-client-ui-slots'
import { HostStatusChip } from '../src/client/HostStatusChip.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

function translate(): PropsLocale<'settings'>['t'] {
  const messages: Readonly<Record<string, string>> = en
  return (key, params) => Object.entries(params ?? {})
    .reduce((message, [name, value]) => message.replaceAll(`{${name}}`, String(value)), messages[key] ?? key)
}

function chip(host: RemoteHostFacts, state: ConnectionState | undefined) {
  const reconnect = vi.fn()
  render(
    <HostStatusChip
      reconnect={reconnect}
      useHostInfo={selector => selector(host)}
      useConnectionState={selector => selector(state)}
      tooltipSide="bottom"
      portal={false}
      t={translate()}
    />,
  )
  return reconnect
}

const remote: RemoteHostFacts = { home: '/home/me', name: 'homelab-lan', remote: true, isLoopback: true }

it('shows nothing in a window on this computer', () => {
  chip({ ...remote, remote: false }, 'connected')
  expect(screen.queryByText('homelab-lan')).toBeNull()
})

it('names the remote computer and says the link is up', () => {
  const reconnect = chip(remote, 'connected')
  expect(screen.getByRole('status', { name: 'Connected to homelab-lan' }).textContent).toBe('homelab-lan')
  expect(screen.queryByRole('button')).toBeNull()
  expect(reconnect).not.toHaveBeenCalled()
})

it('turns into a reconnect button while the link is down', () => {
  const reconnect = chip(remote, 'disconnected')
  fireEvent.click(screen.getByRole('button', { name: 'Disconnected from homelab-lan. Click to reconnect now' }))
  expect(reconnect).toHaveBeenCalledOnce()
})
