import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENTS_HOME_DIR_NAME,
  DEFAULT_AGENTS_HOME_DISPLAY,
  DEFAULT_JAN_HOME_DISPLAY,
  DEFAULT_JAN_HOME_SEGMENTS,
  agentsHomeDisplay,
  canonicalizeWatchPath,
  defaultAgentsHome,
  defaultJanHome,
  janCachePath,
  janHomeDisplay,
  janHomePath,
  expandHomePath,
  resolveAgentsHome,
  resolveJanHome,
} from '@janhq/jan-home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('jan path helpers', () => {
  it('owns the shared default Jan home path', () => {
    expect(DEFAULT_JAN_HOME_SEGMENTS).toEqual(['.config', 'jan-alpha'])
    expect(DEFAULT_JAN_HOME_DISPLAY).toBe('~/.config/jan-alpha')
    expect(defaultJanHome()).toBe(join(homedir(), '.config', 'jan-alpha'))
  })

  it('expands tilde paths without changing non-tilde paths', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/data')).toBe(join(homedir(), 'data'))
    expect(expandHomePath('~\\data')).toBe(join(homedir(), 'data'))
    expect(expandHomePath('/tmp/data')).toBe('/tmp/data')
    expect(expandHomePath('~other/data')).toBe('~other/data')
  })

  it('resolves explicit path before JAN_HOME and the default', () => {
    const envHome = join(homedir(), 'env-jan')

    expect(resolveJanHome('/tmp/explicit-jan', { JAN_HOME: '~/env-jan' })).toBe(resolve('/tmp/explicit-jan'))
    expect(resolveJanHome(undefined, { JAN_HOME: '~/env-jan' })).toBe(envHome)
    expect(resolveJanHome(undefined, {})).toBe(defaultJanHome())
  })

  it('treats an empty or whitespace-only JAN_HOME as unset', () => {
    expect(resolveJanHome(undefined, { JAN_HOME: '' })).toBe(defaultJanHome())
    expect(resolveJanHome(undefined, { JAN_HOME: '   ' })).toBe(defaultJanHome())
  })

  it('joins child segments onto the resolved JAN_HOME', () => {
    vi.stubEnv('JAN_HOME', '~/env-jan')
    expect(janHomePath()).toBe(join(homedir(), 'env-jan'))
    expect(janHomePath('storages', 'cache')).toBe(join(homedir(), 'env-jan', 'storages', 'cache'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(janHomeDisplay(resolve(defaultJanHome()))).toBe('~/.config/jan-alpha')
    expect(janHomeDisplay('/some/other/root')).toBe('$JAN_HOME')
  })

  it('owns the shared default agents home directory name', () => {
    expect(AGENTS_HOME_DIR_NAME).toBe('.agents')
    expect(DEFAULT_AGENTS_HOME_DISPLAY).toBe('~/.agents')
    expect(defaultAgentsHome()).toBe(join(homedir(), '.agents'))
  })

  it('resolves an explicit agents home before JAN_AGENTS_HOME and the default', () => {
    const envHome = join(homedir(), 'env-agents')

    expect(resolveAgentsHome('/tmp/explicit-agents', { JAN_AGENTS_HOME: '~/env-agents' })).toBe(resolve('/tmp/explicit-agents'))
    expect(resolveAgentsHome(undefined, { JAN_AGENTS_HOME: '~/env-agents' })).toBe(envHome)
    expect(resolveAgentsHome(undefined, {})).toBe(defaultAgentsHome())
  })

  it('treats an empty or whitespace-only JAN_AGENTS_HOME as unset', () => {
    expect(resolveAgentsHome(undefined, { JAN_AGENTS_HOME: '' })).toBe(defaultAgentsHome())
    expect(resolveAgentsHome(undefined, { JAN_AGENTS_HOME: '   ' })).toBe(defaultAgentsHome())
  })

  it('labels a resolved agents home by whether it is the default root', () => {
    expect(agentsHomeDisplay(resolve(defaultAgentsHome()))).toBe('~/.agents')
    expect(agentsHomeDisplay('/some/other/root')).toBe('$JAN_AGENTS_HOME')
  })

  it.each([
    [undefined, join(homedir(), '.config', 'jan-alpha')],
    ['', join(homedir(), '.config', 'jan-alpha')],
    ['   ', join(homedir(), '.config', 'jan-alpha')],
    ['~/env-jan', join(homedir(), 'env-jan')],
    ['./relative-jan', resolve('./relative-jan')],
  ] as const)('resolves cache paths with JAN_HOME=%j', (home, expectedHome) => {
    vi.stubEnv('JAN_HOME', home)
    try {
      expect(janCachePath()).toBe(join(expectedHome, 'cache'))
      expect(janCachePath('models', 'index.json')).toBe(join(expectedHome, 'cache', 'models', 'index.json'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('resolves configured cache homes before the environment', () => {
    vi.stubEnv('JAN_HOME', '~/env-jan')
    try {
      expect(janCachePath({ janHome: '~/explicit-jan' })).toBe(join(homedir(), 'explicit-jan', 'cache'))
      expect(janCachePath({ janHome: './explicit-jan' }, 'attachments', 'request-images'))
        .toBe(resolve('./explicit-jan/cache/attachments/request-images'))
      expect(janCachePath({}, 'attachments')).toBe(join(homedir(), 'env-jan', 'cache', 'attachments'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('canonicalizes a watcher ancestor while preserving a missing suffix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jan-watch-path-'))
    const target = join(root, 'target')
    const alias = join(root, 'alias')
    try {
      await mkdir(target)
      await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(canonicalizeWatchPath(alias)).resolves.toBe(await realpath(target))
      await expect(canonicalizeWatchPath(join(alias, 'later', 'config.yml'))).resolves.toBe(
        join(await realpath(target), 'later', 'config.yml'),
      )
      const file = join(root, 'file')
      await writeFile(file, 'not a directory')
      await expect(canonicalizeWatchPath(join(file, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
