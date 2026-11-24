import { expect, it } from 'vitest'
import { desktopUpdateChannel } from '../src/update-channel.ts'

it('reads the installed channel independently from the current version', () => {
  expect(desktopUpdateChannel({ version: '1.0.0', janDesktopUpdateChannel: 'nightly' })).toBe('nightly')
  expect(desktopUpdateChannel({ version: '1.0.0', janDesktopUpdateChannel: 'stable' })).toBe('stable')
  expect(desktopUpdateChannel({ version: '1.0.0' })).toBe('nightly')
  expect(() => desktopUpdateChannel({ janDesktopUpdateChannel: 'latest' })).toThrow(/channel/u)
  expect(() => desktopUpdateChannel({ janDesktopUpdateChannel: 'beta' })).toThrow(/channel/u)
  expect(() => desktopUpdateChannel(null)).toThrow(/manifest/u)
})
