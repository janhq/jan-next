/**
 * Render the install icons of the Web application from the Jan logo.
 *
 * A browser installs a Web App only with a raster 192px and a 512px icon, masks
 * the icon it puts on the home screen, and has no manifest support for iOS,
 * which reads `apple-touch-icon` instead. iOS paints transparent pixels black,
 * so every variant composes the logo (`ui-brand-official`'s `jan-logo.png`, a
 * transparent waving hand) onto an opaque white square. The maskable variant
 * shrinks the logo so its ink stays inside the circle a platform mask always
 * shows.
 *
 * The same script writes both scheme-selected favicons as SVG documents that
 * embed a small raster of the logo; the colored logo reads on light and dark
 * tabs alike, so the two documents are identical.
 *
 * The committed files under `public/` are the output; rerun
 * `pnpm --filter @deepseek-ai/dsh-web-frontend run render:app-icons` after the
 * logo changes.
 * @module render-app-icons
 */

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertNever } from '@deepseek-ai/dsh-util-values'

/** Raster logo owned by the brand plugin; the single home of the artwork. */
export const LOGO_SOURCE = fileURLToPath(new URL('../../../packages/client/ui-brand-official/src/client/assets/jan-logo.png', import.meta.url))

/** Directory the generated PNGs are committed to. */
export const ICON_OUTPUT_DIRECTORY = fileURLToPath(new URL('../public/', import.meta.url))

/** Fraction of the icon edge the logo occupies on an `any` icon. */
export const TILE_ARTWORK_SCALE = 0.86

/**
 * Fraction of the icon edge the logo occupies on the maskable icon. The logo's
 * ink reaches 0.51 of its edge from the centre, so 0.76 keeps it within
 * {@link MASKABLE_SAFE_RADIUS_RATIO}; `pwa-manifest.e2e.ts` checks the committed
 * artwork against that circle.
 */
export const MASKABLE_ARTWORK_SCALE = 0.76

/** Radius a platform mask is guaranteed to show, as a fraction of the icon edge. */
export const MASKABLE_SAFE_RADIUS_RATIO = 0.4

/** Opaque background behind the transparent logo. */
const BACKGROUND = { r: 255, g: 255, b: 255, alpha: 1 } as const

/** One committed install icon: the manifest or link member it serves and its edge in pixels. */
export interface AppIconVariant {
  /** File name inside `public/`. */
  readonly file: string
  /** Square edge in pixels. */
  readonly size: number
  /** Which rendering the platform receives. */
  readonly kind: 'tile' | 'maskable'
}

/**
 * Install icons the Web application ships. Chrome requires the 192px and 512px
 * raster pair to offer installation, prefers a maskable icon for the home
 * screen, and iOS reads the touch icon alone.
 */
export const APP_ICON_VARIANTS: readonly AppIconVariant[] = [
  { file: 'icon-192.png', size: 192, kind: 'tile' },
  { file: 'icon-512.png', size: 512, kind: 'tile' },
  { file: 'icon-maskable-512.png', size: 512, kind: 'maskable' },
  { file: 'apple-touch-icon.png', size: 180, kind: 'tile' },
]

/**
 * Fraction of the icon edge the logo occupies for a variant kind.
 * @param kind - variant rendering.
 * @returns the logo scale.
 */
export function artworkScale(kind: AppIconVariant['kind']): number {
  switch (kind) {
    case 'tile': return TILE_ARTWORK_SCALE
    case 'maskable': return MASKABLE_ARTWORK_SCALE
    default: return assertNever(kind)
  }
}

/**
 * Compose the logo, centred at its variant scale, onto an opaque square.
 * @param logo - PNG bytes of the logo.
 * @param variant - icon to render.
 * @returns the PNG bytes.
 */
async function renderPng(logo: Buffer, variant: AppIconVariant): Promise<Buffer> {
  const { default: sharp } = await import('sharp')
  const edge = Math.round(variant.size * artworkScale(variant.kind))
  const inset = Math.floor((variant.size - edge) / 2)
  const artwork = await sharp(logo).resize(edge, edge, { kernel: 'lanczos3' }).png().toBuffer()
  return sharp({ create: { width: variant.size, height: variant.size, channels: 4, background: BACKGROUND } })
    .composite([{ input: artwork, left: inset, top: inset }])
    .flatten({ background: BACKGROUND })
    .png()
    .toBuffer()
}

/**
 * Render every install icon from the logo.
 * @param logo - PNG bytes of the logo.
 * @returns one PNG per {@link APP_ICON_VARIANTS} entry, in declaration order.
 */
export async function renderAppIcons(logo: Buffer): Promise<readonly { variant: AppIconVariant; png: Buffer }[]> {
  return Promise.all(APP_ICON_VARIANTS.map(async variant => ({ variant, png: await renderPng(logo, variant) })))
}

/** Favicon documents `index.html` selects by `prefers-color-scheme`. */
export const FAVICON_FILES = ['favicon.svg', 'favicon-dark.svg'] as const

/** Raster edge embedded in the favicon document. */
const FAVICON_EDGE = 64

/**
 * Render the favicon document: an SVG wrapping a {@link FAVICON_EDGE}px PNG of the logo.
 * @param logo - PNG bytes of the logo.
 * @returns the SVG text, ending with a newline.
 */
export async function renderFavicon(logo: Buffer): Promise<string> {
  const { default: sharp } = await import('sharp')
  const png = await sharp(logo).resize(FAVICON_EDGE, FAVICON_EDGE, { kernel: 'lanczos3' }).png().toBuffer()
  const edge = String(FAVICON_EDGE)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${edge}" height="${edge}" viewBox="0 0 ${edge} ${edge}">`
    + `<image width="${edge}" height="${edge}" href="data:image/png;base64,${png.toString('base64')}"/></svg>\n`
}

async function main(): Promise<void> {
  const logo = await readFile(LOGO_SOURCE)
  const icons = await renderAppIcons(logo)
  const favicon = await renderFavicon(logo)
  await Promise.all([
    ...icons.map(async ({ variant, png }) => { await writeFile(resolve(ICON_OUTPUT_DIRECTORY, variant.file), png) }),
    ...FAVICON_FILES.map(async (file) => { await writeFile(resolve(ICON_OUTPUT_DIRECTORY, file), favicon) }),
  ])
  const written = [...icons.map(icon => icon.variant.file), ...FAVICON_FILES]
  console.info(`app icons: wrote ${written.join(', ')} to ${ICON_OUTPUT_DIRECTORY}`)
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) await main()
