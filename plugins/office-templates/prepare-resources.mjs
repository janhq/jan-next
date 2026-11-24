import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createTemplateLibrary } from './lib/templates.js'

const exec = promisify(execFile)
const packageRoot = dirname(fileURLToPath(import.meta.url))
const sources = join(packageRoot, 'sources')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

async function walk(root, prefix = '') {
  const result = []
  for (const item of await readdir(join(root, prefix), { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw new Error('Template inputs must not contain symlinks')
    const name = prefix ? `${prefix}/${item.name}` : item.name
    if (item.isDirectory()) result.push(...await walk(root, name))
    else if (item.isFile()) result.push(name)
  }
  return result.sort()
}

export async function prepareResources({ output, source = sources, node, cli, python }) {
  const catalog = JSON.parse(await readFile(join(source, 'catalog.json'), 'utf8'))
  const templates = join(output, 'templates')
  await mkdir(output, { recursive: true })
  await rm(templates, { recursive: true, force: true })
  await mkdir(templates)
  const prepared = []
  for (const { source: input, previewPages, ...entry } of catalog) {
    const directory = join(templates, entry.id)
    await cp(join(source, input), directory, { recursive: true })
    const sample = join(directory, entry.sampleFile)
    const options = previewPages?.length
      ? previewPages.map(page => ['--sheet', page.sheet, '--range', page.range]) : [[]]
    const aspectRatios = []
    const sheets = []
    await mkdir(join(directory, 'pages'))
    for (const extra of options) {
      const renderDirectory = join(output, `.office-preview-${entry.id}-${aspectRatios.length}`)
      try {
        const { stdout } = await exec(node, [cli, 'render', '--input', sample, '--output-dir', renderDirectory, '--dpi', '100', ...extra], { timeout: 90_000, maxBuffer: 4 * 1024 * 1024 })
        const rendered = JSON.parse(stdout)
        for (const image of rendered.images) {
          const page = aspectRatios.push(image.width / image.height)
          const webp = join(directory, 'pages', `${page}.webp`)
          await exec(python, ['-I', '-B', '-c', 'from PIL import Image; import sys; image=Image.open(sys.argv[1]); image.save(sys.argv[2], format="WEBP", quality=86); image.thumbnail((720,1020)); image.save(sys.argv[3], format="WEBP", quality=86)', image.path, webp, join(directory, 'thumbnail.webp')])
          if (extra.length) {
            const sheet = sheets.find(item => item.name === extra[1]) ?? { name: extra[1], pages: [] }
            if (!sheets.includes(sheet)) sheets.push(sheet)
            sheet.pages.push(page)
          }
        }
      } finally {
        await rm(renderDirectory, { recursive: true, force: true })
      }
    }
    const files = Object.fromEntries(await Promise.all((await walk(directory)).map(async file => [file, sha256(await readFile(join(directory, file)))])))
    prepared.push({ ...entry, pages: aspectRatios.length, pageAspectRatios: aspectRatios, ...(sheets.length ? { sheets } : {}), revision: sha256(Buffer.from(JSON.stringify(files))).slice(0, 24), files })
  }
  await writeFile(join(templates, 'catalog.json'), JSON.stringify(prepared, null, 2) + '\n')
  const library = await createTemplateLibrary(templates)
  for (const item of await library.list()) for (const file of Object.keys(library.entry(item.id).files)) await library.asset(item.id, file)
  return templates
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [output, node, cli, python] = process.argv.slice(2)
  if (![output, node, cli, python].every(Boolean)) throw new Error('Usage: node prepare-resources.mjs <runtime-root> <node> <kit-cli> <python>')
  console.log(await prepareResources({ output, node, cli, python }))
}
