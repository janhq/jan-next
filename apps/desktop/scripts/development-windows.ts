/** Windows development copy of Electron that Windows names and draws as Jan Next Dev. */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit'
import sharp from 'sharp'
import { packIco } from './render-tray-icon.ts'

/** The packaged Windows icon; the development copy carries the same artwork. */
const ICON_SOURCE = fileURLToPath(new URL('../resources/icon-windows.png', import.meta.url))
/** Bitmap edges Windows picks from for the taskbar, Explorer, Task Manager and the firewall prompt. */
const ICON_EDGES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256] as const
// Electron reports app.isPackaged unless the binary is named electron.exe, and the desktop main process reads its
// development paths from that flag; Windows shows the version strings and icon below, not the file name.
const EXECUTABLE = 'electron.exe'

/** Strings Windows shows for the executable: the firewall prompt, Task Manager, the taskbar and file properties. */
export const DEVELOPMENT_VERSION_STRINGS = {
  ProductName: 'Jan Next Dev',
  FileDescription: 'Jan Next Dev',
  CompanyName: 'Jan',
  InternalName: 'Jan Next Dev',
  OriginalFilename: 'Jan Next Dev.exe',
  LegalCopyright: `Copyright © ${String(new Date().getFullYear())} Jan`,
} as const

/**
 * Keep a Jan-branded copy of the Electron distribution beside the other development state and return its executable.
 * The copy is rebuilt only when Electron or the icon changes; the installed Electron package is never modified.
 * @param electron - `electron.exe` from the installed `electron` package.
 * @param directory - Development state directory owned by this launcher.
 * @returns path of the branded executable to launch instead of the package's `electron.exe`.
 */
export async function prepareDevelopmentWindowsApp(electron: string, directory: string): Promise<string> {
  const source = dirname(electron)
  const target = join(directory, 'electron')
  const executable = join(target, EXECUTABLE)
  const stamp = join(target, 'jan-development.json')
  const identity = JSON.stringify({
    electron: createHash('sha256').update(readFileSync(electron)).digest('hex'),
    icon: createHash('sha256').update(readFileSync(ICON_SOURCE)).digest('hex'),
    strings: DEVELOPMENT_VERSION_STRINGS,
    executable: EXECUTABLE,
  })
  if (existsSync(executable) && existsSync(stamp) && readFileSync(stamp, 'utf8') === identity) return executable
  // A half-written copy from an interrupted run would otherwise be reused.
  const staging = `${target}.staging`
  rmSync(staging, { recursive: true, force: true })
  cpSync(source, staging, { recursive: true })
  const staged = join(staging, EXECUTABLE)
  writeFileSync(staged, await brandExecutable(readFileSync(staged)))
  writeFileSync(join(staging, 'jan-development.json'), identity)
  rmSync(target, { recursive: true, force: true })
  renameSync(staging, target)
  return executable
}

/**
 * Replace the version strings and the main icon group of one Windows executable.
 * @param bytes - The executable image.
 * @returns the rewritten image; its code is unchanged.
 */
export async function brandExecutable(bytes: Buffer): Promise<Buffer> {
  const executable = NtExecutable.from(bytes)
  const resources = NtExecutableResource.from(executable)
  const [info = Resource.VersionInfo.createEmpty()] = Resource.VersionInfo.fromEntries(resources.entries)
  const [language = { lang: 0x0409, codepage: 1200 }] = info.getAllLanguagesForStringValues()
  info.setStringValues(language, DEVELOPMENT_VERSION_STRINGS)
  info.outputToResourceEntries(resources.entries)
  const ico = packIco(await Promise.all(ICON_EDGES.map(async size => ({
    size, png: await sharp(ICON_SOURCE).resize(size, size).png().toBuffer(),
  }))))
  const [group] = Resource.IconGroupEntry.fromEntries(resources.entries)
  Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group?.id ?? 1, group?.lang ?? language.lang,
    Data.IconFile.from(ico).icons.map(icon => icon.data))
  resources.outputResource(executable)
  return Buffer.from(executable.generate())
}
