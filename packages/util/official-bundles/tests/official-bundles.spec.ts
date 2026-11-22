/** Shipped profile templates, and the offline catalog that does not depend on installed provider packages or registry requests. */

import { describe, expect, it } from 'vitest'
import { INSTALLATION_OWNED_PROFILE_TUPLES, OFFICIAL_ON_DEMAND_CATALOG, ON_DEMAND_BUNDLES, PROFILE_TEMPLATES } from '../src/index.ts'

describe('Official on-demand catalog', () => {
  it('offers exactly the two native subagent integrations with offline localized metadata', () => {
    expect(ON_DEMAND_BUNDLES).toEqual(['@janhq/jan-subagent-claude-code', '@janhq/jan-subagent-codex'])
    expect(OFFICIAL_ON_DEMAND_CATALOG.map(entry => entry.packageName)).toEqual(ON_DEMAND_BUNDLES)
    for (const entry of OFFICIAL_ON_DEMAND_CATALOG) {
      expect(entry.meta.icon).toMatch(/^data:image\/svg\+xml;base64,/)
      for (const text of [entry.meta.title, entry.meta.description]) {
        if (typeof text === 'string') throw new Error('Official metadata requires both shipped languages')
        expect(text.en).toMatch(/\S/)
        expect(text.zh).toMatch(/\S/)
      }
      expect(entry).not.toHaveProperty('version')
    }
  })
})

describe('Shipped profile templates', () => {
  it('stack each mode bundle on base except the standalone minimal SDK', () => {
    expect(PROFILE_TEMPLATES).toEqual({
      acp: { bundles: ['@janhq/jan-base', '@janhq/jan-acp-app'] },
      web: { bundles: ['@janhq/jan-base', '@janhq/jan-web-app'] },
      desktop: { bundles: ['@janhq/jan-base', '@janhq/jan-web-app', '@janhq/jan-desktop-app', '@janhq/jan-experimental-plugin-market-bundle'] },
      headless: { bundles: ['@janhq/jan-base', '@janhq/jan-headless'] },
      edge: { bundles: ['@janhq/jan-base', '@janhq/jan-web-app', '@janhq/jan-edge-app'] },
      sdk: { bundles: ['@janhq/jan-base', '@janhq/jan-sdk-app'] },
      'sdk-minimal': { bundles: ['@janhq/jan-sdk-minimal'] },
    })
  })

  it('keeps the former Desktop default separate from the current Desktop template', () => {
    expect(INSTALLATION_OWNED_PROFILE_TUPLES.desktop).toEqual(['@janhq/jan-base', '@janhq/jan-web-app'])
  })
})
