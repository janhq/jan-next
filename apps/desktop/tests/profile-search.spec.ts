/** Full-text session search in the shipped Desktop composition. */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { composeEntries, loadProfileDirectory } from '@janhq/jan-app-boot'
import { createPluginProfile } from '../src/project-manager.ts'

it('enables desktop session content search without opening SQLite at startup', () => {
  const home = mkdtempSync(join(tmpdir(), 'jan-desktop-profile-search-'))
  try {
    const profileDir = join(home, 'profiles', 'desktop')
    createPluginProfile(profileDir)
    const installAnchor = fileURLToPath(new URL('../../cli/package.json', import.meta.url))
    const profile = loadProfileDirectory('jan desktop', profileDir, installAnchor)
    const rows = composeEntries([...profile.layers.map(layer => layer.patches), profile.patches])

    expect(rows.filter(row => row.id === 'session-query-sqlite')).toEqual([{
      id: 'session-query-sqlite',
      name: '@janhq/jan-session-query-sqlite',
      config: { path: ':memory:', openAt: 'first-search' },
    }])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
