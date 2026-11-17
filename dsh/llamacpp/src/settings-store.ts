import { fs, joinPath, getJanDataFolderPath } from '@/lib/native'
import type { SettingComponentProps } from '@janhq/core'

// Engine settings belong to this app, so they live in the DSH profile home the
// host already owns (`DSH_HOME`, set by the desktop launcher), not in Jan's
// data folder where a stock DSH install would never look. The legacy location
// is read-only input: it is imported once and never extended.
const DIR_NAME = 'ow-llamacpp'
const LEGACY_DIR_NAME = 'llamacpp'
const FILE_NAME = 'settings.json'
const TMP_NAME = 'settings.json.tmp'

let writeChain: Promise<unknown> = Promise.resolve()

async function paths(): Promise<{ dir: string; file: string; tmp: string }> {
  const profileHome = process.env.DSH_HOME?.trim()
  if (!profileHome) {
    // Outside the desktop host (unit checks, a plain Node import) the DSH home
    // is unknown, so the legacy folder stays the only usable location.
    const root = await getJanDataFolderPath()
    const dir = await joinPath([root, LEGACY_DIR_NAME])
    const file = await joinPath([dir, FILE_NAME])
    const tmp = await joinPath([dir, TMP_NAME])
    return { dir, file, tmp }
  }
  const dir = await joinPath([profileHome, DIR_NAME])
  const file = await joinPath([dir, FILE_NAME])
  const tmp = await joinPath([dir, TMP_NAME])
  return { dir, file, tmp }
}

async function legacyPath(): Promise<string> {
  const root = await getJanDataFolderPath()
  return await joinPath([root, LEGACY_DIR_NAME, FILE_NAME])
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Read the persisted engine settings.
 *
 * A missing file is an empty set: the shipped schema then stands in. A file
 * that exists but cannot be read or parsed must NOT look like an empty set,
 * because the caller writes the shipped defaults over it and silently discards
 * the user's values; the real error is thrown instead so the caller can keep
 * the file.
 */
export async function readSettingsFile(): Promise<SettingComponentProps[]> {
  const { file } = await paths()
  if (await fs.existsSync(file)) return await readSettingsAt(file)
  if (!process.env.DSH_HOME?.trim()) return []
  // First run after the move: the profile has no engine settings yet, so the
  // legacy Jan file is read as-is and the next save writes the merged set into
  // the profile. Nothing is ever written back to the legacy path.
  const legacy = await legacyPath()
  if (!(await fs.existsSync(legacy))) return []
  try {
    return await readSettingsAt(legacy)
  } catch {
    // An unreadable legacy file must not stop startup; the shipped schema
    // stands in and the original stays on disk for recovery.
    return []
  }
}

async function readSettingsAt(file: string): Promise<SettingComponentProps[]> {
  let raw: string
  try {
    raw = await fs.readFileSync(file, 'utf8')
  } catch (error) {
    throw new Error(`Engine settings could not be read from ${file}: ${reasonOf(error)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Engine settings at ${file} are not valid JSON: ${reasonOf(error)}`)
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Engine settings at ${file} are not a settings list, so they were left untouched`)
  }
  return parsed as SettingComponentProps[]
}

/**
 * Move an unreadable settings file aside so the value the user had is not
 * destroyed, and a fresh one can be written in its place.
 * @returns the backup path, or undefined when there was nothing to keep.
 */
export async function preserveInvalidSettingsFile(): Promise<string | undefined> {
  const { file } = await paths()
  try {
    if (!(await fs.existsSync(file))) return undefined
    const backup = `${file}.invalid-${Date.now()}`
    await fs.mv(file, backup)
    return backup
  } catch {
    // Best effort: losing the backup must not stop the engine from starting.
    return undefined
  }
}

/**
 * Apply one change to the settings file, reading it inside the same queue slot
 * that writes it.
 *
 * Reading before queueing is what loses a value: two saves that both read the
 * old file and then write their own copy leave only the later one's change on
 * disk, and the caller reports success for both. Reading and writing under one
 * lock makes every save land on top of the previous one.
 *
 * The write is also verified against the bytes just written, because a write
 * that silently does not land is otherwise indistinguishable from a save.
 * @param mutate - receives the current settings, returns the next ones, or
 *   null to leave the file untouched.
 * @returns the settings now on disk.
 */
export async function mutateSettingsFile(
  mutate: (current: SettingComponentProps[]) => SettingComponentProps[] | null
): Promise<SettingComponentProps[]> {
  let landed: SettingComponentProps[] = []
  const task = async () => {
    const { dir, file, tmp } = await paths()
    const current = await readSettingsFile()
    const next = mutate(current)
    if (next === null) {
      landed = current
      return
    }
    if (!(await fs.existsSync(dir))) await fs.mkdir(dir)
    const json = JSON.stringify(next, null, 2)
    await fs.writeFileSync(tmp, json)
    try {
      await fs.mv(tmp, file)
    } catch {
      await fs.writeFileSync(file, json)
      try {
        if (await fs.existsSync(tmp)) await fs.rm(tmp)
      } catch {
        /* best-effort */
      }
    }
    let written: string
    try {
      written = await fs.readFileSync(file, 'utf8')
    } catch (error) {
      throw new Error(`Engine settings were not saved to ${file}: ${reasonOf(error)}`)
    }
    if (written !== json) {
      throw new Error(`Engine settings were not saved to ${file}: the file does not hold what was just written`)
    }
    landed = next
  }
  writeChain = writeChain.then(task, task)
  await writeChain
  return landed
}

/**
 * Replace the whole file, through the same queue and the same read-back.
 * @param settings - the complete settings list to persist.
 */
export async function writeSettingsFile(
  settings: SettingComponentProps[]
): Promise<void> {
  await mutateSettingsFile(() => settings)
}

export async function settingsFileExists(): Promise<boolean> {
  const { file } = await paths()
  if (await fs.existsSync(file)) return true
  if (!process.env.DSH_HOME?.trim()) return false
  // The legacy file still answers reads until the first save seeds the profile,
  // so an existing store must count as existing for the one-time importers.
  return await fs.existsSync(await legacyPath())
}
