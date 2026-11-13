/**
 * Tauri ignores capability files the config does not name. desktop.json is
 * not named: it carries a `remote` section and grants beyond default.json,
 * and activating it would silently widen what the main window may do.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const TAURI_DIR = join(__dirname, '..', '..', '..', 'src-tauri')

const activeIn = (file: string): string[] => {
  const conf: unknown = JSON.parse(readFileSync(join(TAURI_DIR, file), 'utf8'))
  const caps =
    conf && typeof conf === 'object' && 'app' in conf && conf.app &&
      typeof conf.app === 'object' && 'security' in conf.app && conf.app.security &&
      typeof conf.app.security === 'object' && 'capabilities' in conf.app.security
      ? conf.app.security.capabilities
      : undefined
  return Array.isArray(caps) ? caps.filter((c): c is string => typeof c === 'string') : []
}

describe('Tauri capabilities', () => {
  it('leaves desktop.json inactive', () => {
    expect(activeIn('tauri.conf.json')).not.toContain('desktop')
  })
})
