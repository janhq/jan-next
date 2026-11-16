import { describe, expect, it, vi } from 'vitest'
import {
  detectStatusNotifierHost, resolveDesktopStatusNotifierConfig, runDesktopCommand, type DesktopCommandOutcome,
  type DesktopCommandRunner,
} from '../src/status-notifier.ts'

const config = { timeoutMs: 1_500 }

function runner(outcomes: Record<string, DesktopCommandOutcome>) {
  return vi.fn<DesktopCommandRunner>(async file => outcomes[file] ?? { kind: 'missing' })
}

describe('resolveDesktopStatusNotifierConfig', () => {
  it('defaults the query deadline and reads an override', () => {
    expect(resolveDesktopStatusNotifierConfig({})).toEqual({ timeoutMs: 2_000 })
    expect(resolveDesktopStatusNotifierConfig({ DSH_DESKTOP_STATUS_NOTIFIER_TIMEOUT_MS: '5000' })).toEqual({ timeoutMs: 5_000 })
  })

  it('rejects an invalid override', () => {
    expect(() => resolveDesktopStatusNotifierConfig({ DSH_DESKTOP_STATUS_NOTIFIER_TIMEOUT_MS: '10' }))
      .toThrow('DSH_DESKTOP_STATUS_NOTIFIER_TIMEOUT_MS must be an integer from 1000 through 2147483647')
  })
})

describe('detectStatusNotifierHost', () => {
  it('reports a host when gdbus reads the property as true', async () => {
    const run = runner({ gdbus: { kind: 'completed', stdout: '(<true>,)\n' } })
    await expect(detectStatusNotifierHost(config, run)).resolves.toEqual({ present: true })
    expect(run).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith('gdbus', ['call', '--session', '--dest', 'org.kde.StatusNotifierWatcher',
      '--object-path', '/StatusNotifierWatcher', '--method', 'org.freedesktop.DBus.Properties.Get',
      'org.kde.StatusNotifierWatcher', 'IsStatusNotifierHostRegistered'], 1_500)
  })

  it('reports no host when the watcher has none registered', async () => {
    await expect(detectStatusNotifierHost(config, runner({ gdbus: { kind: 'completed', stdout: '(<false>,)\n' } })))
      .resolves.toEqual({ present: false, reason: 'gdbus: no host registered' })
  })

  it('reports no host when the query fails, as it does without a watcher on the bus', async () => {
    await expect(detectStatusNotifierHost(config, runner({ gdbus: { kind: 'failed', reason: 'exit 1' } })))
      .resolves.toEqual({ present: false, reason: 'gdbus: exit 1' })
    await expect(detectStatusNotifierHost(config, runner({ gdbus: { kind: 'failed', reason: 'timeout' } })))
      .resolves.toEqual({ present: false, reason: 'gdbus: timeout' })
  })

  it('reports no host for an unrecognized reply', async () => {
    await expect(detectStatusNotifierHost(config, runner({ gdbus: { kind: 'completed', stdout: "(<'yes'>,)\n" } })))
      .resolves.toEqual({ present: false, reason: 'gdbus: unrecognized reply' })
  })

  it('falls back to dbus-send when gdbus is not installed', async () => {
    const run = runner({ 'dbus-send': { kind: 'completed', stdout: '   variant       boolean true\n' } })
    await expect(detectStatusNotifierHost(config, run)).resolves.toEqual({ present: true })
    expect(run).toHaveBeenLastCalledWith('dbus-send', ['--session', '--print-reply=literal', '--reply-timeout=1500',
      '--dest=org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher', 'org.freedesktop.DBus.Properties.Get',
      'string:org.kde.StatusNotifierWatcher', 'string:IsStatusNotifierHostRegistered'], 1_500)
    await expect(detectStatusNotifierHost(config,
      runner({ 'dbus-send': { kind: 'completed', stdout: '   variant       boolean false\n' } })))
      .resolves.toEqual({ present: false, reason: 'dbus-send: no host registered' })
  })

  it('reports no host when neither query tool is installed', async () => {
    await expect(detectStatusNotifierHost(config, runner({})))
      .resolves.toEqual({ present: false, reason: 'none of gdbus, dbus-send is installed' })
  })
})

describe.skipIf(process.platform === 'win32')('runDesktopCommand', () => {
  it('returns standard output of a successful command', async () => {
    await expect(runDesktopCommand('printf', ['(<true>,)'], 5_000)).resolves.toEqual({ kind: 'completed', stdout: '(<true>,)' })
  })

  it('distinguishes a missing executable from a failing one', async () => {
    await expect(runDesktopCommand('dsh-status-notifier-missing-command', [], 5_000)).resolves.toEqual({ kind: 'missing' })
    await expect(runDesktopCommand('false', [], 5_000)).resolves.toEqual({ kind: 'failed', reason: 'exit 1' })
  })

  it('kills a command that passes its deadline', async () => {
    await expect(runDesktopCommand('sleep', ['30'], 100)).resolves.toEqual({ kind: 'failed', reason: 'timeout' })
  })
})
