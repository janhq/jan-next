/** Committed install icons and favicons match what the generator renders from the Jan logo. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APP_ICON_VARIANTS, FAVICON_FILES, ICON_OUTPUT_DIRECTORY, LOGO_SOURCE, MASKABLE_ARTWORK_SCALE,
  TILE_ARTWORK_SCALE, artworkScale, renderAppIcons, renderFavicon,
} from '../scripts/render-app-icons.ts'
import { pngSize } from './png-size.ts'

describe('web install icons', () => {
  it('ships every declared variant at its declared edge', async () => {
    for (const variant of APP_ICON_VARIANTS) {
      expect(pngSize(await readFile(join(ICON_OUTPUT_DIRECTORY, variant.file))))
        .toEqual([variant.size, variant.size])
    }
  })

  it('commits exactly the icons and favicons the generator renders from the logo', async () => {
    const logo = await readFile(LOGO_SOURCE)
    for (const { variant, png } of await renderAppIcons(logo)) {
      expect(png.equals(await readFile(join(ICON_OUTPUT_DIRECTORY, variant.file))), variant.file).toBe(true)
    }
    const favicon = await renderFavicon(logo)
    for (const file of FAVICON_FILES) expect(await readFile(join(ICON_OUTPUT_DIRECTORY, file), 'utf8'), file).toBe(favicon)
  })

  it('shrinks only the maskable artwork', () => {
    expect(artworkScale('tile')).toBe(TILE_ARTWORK_SCALE)
    expect(artworkScale('maskable')).toBe(MASKABLE_ARTWORK_SCALE)
    expect(MASKABLE_ARTWORK_SCALE).toBeLessThan(TILE_ARTWORK_SCALE)
  })

  it('rejects non-PNG bytes and incomplete image headers', () => {
    expect(() => pngSize(Buffer.from('<svg/>'))).toThrow(/PNG IHDR/)
    expect(() => pngSize(Buffer.alloc(33))).toThrow(/PNG IHDR/)
  })
})
