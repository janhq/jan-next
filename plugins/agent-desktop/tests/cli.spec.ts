import { describe, expect, it } from 'vitest'
import { binaryCandidates, buildCommand, formatResult } from '../cli.mjs'

const ref = '@s8f3k2p9:e8'

it('filters a window inventory without interpreting the app name as a switch', () => {
  expect(buildCommand('list', { kind: 'windows', app: '--headed' })).toEqual(['list-windows', '--app=--headed'])
})

it('scopes compact snapshots either to a window or to a qualified subtree', () => {
  expect(buildCommand('snapshot', { window_id: 'w-63', skeleton: true })).toEqual(['snapshot', '--window-id=w-63', '-i', '--compact', '--skeleton'])
  expect(buildCommand('snapshot', { root: ref, interactive_only: false })).toEqual(['snapshot', `--root=${ref}`, '--compact'])
  expect(() => buildCommand('snapshot', { root: ref, window_id: 'w-63' })).toThrow(/either/i)
})

it('limits exact find results to a selected window', () => {
  expect(buildCommand('find', { window_id: 'w-63', role: 'button', name: 'Done', exact: true })).toEqual([
    'find', '--window-id=w-63', '--limit=20', '--role=button', '--name=Done', '--exact',
  ])
  expect(() => buildCommand('find', { window_id: 'w-63' })).toThrow(/search/i)
})

it('requires qualified refs and uses only fixed semantic actions', () => {
  expect(buildCommand('act', { action: 'set-value', ref, value: '' })).toEqual(['set-value', '--', ref, ''])
  expect(buildCommand('act', { action: 'type', ref, value: '--headed' })).toEqual(['type', '--', ref, '--headed'])
  expect(buildCommand('act', { action: 'scroll', ref, direction: 'up', amount: 2 })).toEqual(['scroll', '--direction=up', '--amount=2', ref])
  expect(() => buildCommand('act', { action: 'click', ref: '@e8' })).toThrow(/qualified/i)
  expect(() => buildCommand('act', { action: 'press', ref })).toThrow(/semantic/i)
})

it('waits for a condition on a ref and never captures an unscoped screenshot', () => {
  expect(buildCommand('wait', { ref, predicate: 'value', value: 'Done', timeout_ms: 80 })).toEqual([
    'wait', `--element=${ref}`, '--predicate=value', '--timeout=80', '--value=Done',
  ])
  expect(buildCommand('screenshot', { window_id: 'w-63' })).toEqual(['screenshot', '--window-id=w-63'])
  expect(() => buildCommand('screenshot', {})).toThrow(/window/i)
})

describe('desktop action dispositions', () => {
  it('guides a stale, safe-to-retry call to a fresh snapshot', () => {
    const error = formatResult('act', { ok: false, error: { code: 'STALE_REF', disposition: { delivery: 'not_delivered', retry: 'safe' } } }, 'macos')
    expect(error.text).toMatch(/fresh desktop_snapshot/i)
    expect(error.isError).toBe(true)
  })

  it('distinguishes delivery from verification and never suggests replay', () => {
    const result = formatResult('act', { ok: true, data: { disposition: { delivery: 'delivered_unverified', retry: 'unsafe' }, text: 'private action echo' } }, 'macos')
    expect(result.text).toMatch(/do not repeat/i)
    expect(result.text).toContain('delivered_unverified')
    expect(result.text).not.toContain('private action echo')
    expect(result.isError).toBe(false)
  })

  it('gives macOS permission guidance without forwarding native error details', () => {
    const result = formatResult('snapshot', { ok: false, error: { code: 'PERM_DENIED', details: { text: 'private' } } }, 'macos')
    expect(result.text).toContain('agent-desktop permissions --guide')
    expect(result.text).not.toContain('private')
  })
})

it.each([
  ['macos', '/custom/bin:rel:/usr/bin', ['/custom/bin/agent-desktop', '/usr/bin/agent-desktop', '/opt/homebrew/bin/agent-desktop']],
  ['windows', 'C:\\Tools;relative;D:\\Bin', [
    'C:\\Tools\\agent-desktop.exe', 'C:\\Tools\\node_modules\\agent-desktop\\bin\\agent-desktop-win32-x64.exe',
    'D:\\Bin\\agent-desktop.exe', 'D:\\Bin\\node_modules\\agent-desktop\\bin\\agent-desktop-win32-x64.exe',
  ]],
  ['linux', '/opt/bin:/usr/bin', ['/opt/bin/agent-desktop', '/usr/bin/agent-desktop']],
] as const)('searches safe absolute binary locations on %s', (platform, path, expected) => {
  expect(binaryCandidates(platform, path, 'x64')).toEqual(expected)
})

it('tries the executable bundled with Jan Desktop before PATH, ignoring a relative one', () => {
  const bundled = '/Applications/Jan.app/Contents/Resources/runtime/agent-desktop/agent-desktop'
  expect(binaryCandidates('macos', '/usr/bin', 'arm64', bundled)).toEqual([bundled, '/usr/bin/agent-desktop', '/opt/homebrew/bin/agent-desktop'])
  expect(binaryCandidates('linux', '/usr/bin', 'x64', 'agent-desktop')).toEqual(['/usr/bin/agent-desktop'])
})
