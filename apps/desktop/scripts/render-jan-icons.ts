/**
 * tokamak-harness: render the Desktop application icons from Jan's app icon
 * (`src-tauri/icons/icon.png` in janhq/jan, a transparent waving hand), stored as
 * `resources/jan-icon.png`.
 *
 * - `icon-macos.png`: the hand on a light rounded tile inside Apple's 1024 px icon grid
 *   (an 824 px tile with a 100 px margin), the shape the Dock expects.
 * - `icon-windows.png`: the hand on a nearly full-bleed rounded tile; also the About and
 *   window icon.
 * - `icon.png`: the hand on a full square.
 *
 * Each `.svg` beside them draws the same tile and hand, with the hand in the `tray-glyph` group
 * `render:tray-icon` enlarges (it reads `icon-windows.svg`). Rerun with
 * `pnpm --filter @janhq/jan-desktop exec tsx scripts/render-jan-icons.ts`.
 * @module render-jan-icons
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const resources = (name: string): string => fileURLToPath(new URL(`../resources/${name}`, import.meta.url))

/** Tile colour, matching the light tile of the previous icons. */
const TILE = '#FBFBFB'

interface IconSpec {
  readonly file: string
  readonly edge: number
  /** Tile inset from the canvas edge and its corner radius, in pixels; no tile when undefined. */
  readonly tile: { readonly inset: number; readonly radius: number } | undefined
  /** Edge of the hand artwork, centred on the canvas. */
  readonly art: number
}

const ICONS: readonly IconSpec[] = [
  { file: 'icon-macos', edge: 1024, tile: { inset: 100, radius: 185 }, art: 560 },
  { file: 'icon-windows', edge: 1024, tile: { inset: 32, radius: 200 }, art: 700 },
  { file: 'icon', edge: 1104, tile: { inset: 0, radius: 0 }, art: 760 },
]

async function render(hand: Buffer, spec: IconSpec): Promise<Buffer> {
  const layers: { input: Buffer; left: number; top: number }[] = []
  if (spec.tile !== undefined) {
    const size = spec.edge - 2 * spec.tile.inset
    const tile = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}">`
      + `<rect width="${String(size)}" height="${String(size)}" rx="${String(spec.tile.radius)}" fill="${TILE}"/></svg>`)
    layers.push({ input: tile, left: spec.tile.inset, top: spec.tile.inset })
  }
  const art = await sharp(hand).resize(spec.art, spec.art, { kernel: 'lanczos3' }).png().toBuffer()
  const offset = Math.round((spec.edge - spec.art) / 2)
  layers.push({ input: art, left: offset, top: offset })
  return sharp({ create: { width: spec.edge, height: spec.edge, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers).png().toBuffer()
}

/**
 * The same icon as an SVG document: the tile as a shape and the hand in the `tray-glyph` group
 * that `render-tray-icon.ts` enlarges for the Windows tray.
 * @param spec - icon geometry.
 * @param hand - PNG bytes of the hand, embedded once at its source resolution.
 * @returns the SVG text, ending with a newline.
 */
function svgDocument(spec: IconSpec, hand: Buffer): string {
  const edge = String(spec.edge)
  const offset = String(Math.round((spec.edge - spec.art) / 2))
  const tile = spec.tile === undefined ? '' : `<rect x="${String(spec.tile.inset)}" y="${String(spec.tile.inset)}" `
    + `width="${String(spec.edge - 2 * spec.tile.inset)}" height="${String(spec.edge - 2 * spec.tile.inset)}" `
    + `rx="${String(spec.tile.radius)}" fill="${TILE}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${edge}" height="${edge}" viewBox="0 0 ${edge} ${edge}">${tile}`
    + `<g id="tray-glyph"><image x="${offset}" y="${offset}" width="${String(spec.art)}" height="${String(spec.art)}" `
    + `href="data:image/png;base64,${hand.toString('base64')}"/></g></svg>\n`
}

async function main(): Promise<void> {
  const hand = await readFile(resources('jan-icon.png'))
  for (const spec of ICONS) {
    await writeFile(resources(`${spec.file}.png`), await render(hand, spec))
    await writeFile(resources(`${spec.file}.svg`), svgDocument(spec, hand))
  }
  console.info(`jan icons: wrote ${ICONS.map(spec => `${spec.file}.png/.svg`).join(', ')}`)
}

await main()
