/**
 * File cache of generated plugin text:
 * `<root>/<pkg>/<sourceHash>/<locale>.json`, `<root>/_strings/<locale>.json`, and `<root>/_consent.json`.
 * Every read validates the file, so a damaged file counts as absent.
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, rm, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { writeFileAtomic } from '@janhq/jan-atomic-write'
import type { PluginI18nConsent, PluginI18nEntries, PluginI18nSources } from './types.ts'

/** On-disk format number of every file this store writes. */
const FORMAT = 1

const STRINGS_DIR = '_strings'
const CONSENT_FILE = '_consent.json'

const entries = z.record(z.string(), z.record(z.string(), z.object({ src: z.string(), text: z.string() })))

const localeFile = z.object({
  format: z.literal(FORMAT),
  pkg: z.string(),
  locale: z.string(),
  sourceLocale: z.string(),
  sourceHash: z.string(),
  model: z.string(),
  generatedAt: z.number(),
  kept: z.number(),
  entries,
})

const stringsFile = z.object({ format: z.literal(FORMAT), entries: z.record(z.string(), z.string()) })

const consentFile = z.object({ format: z.literal(FORMAT), global: z.boolean(), packages: z.array(z.string()) })

/** One stored locale of one package. */
export type LocaleFile = z.infer<typeof localeFile>

/** The mode of every file: the generated text derives from user plugins and stays owner-only. */
const FILE_OPTIONS = { mode: 0o600, dirMode: 0o700 } as const

/**
 * Hash a source set so two runs over identical text share a cache directory.
 * @param sources - namespace, key, source text.
 * @returns a hex digest independent of key order.
 */
export function hashSources(sources: PluginI18nSources): string {
  const canonical = Object.keys(sources).toSorted().map(ns => [
    ns, Object.entries(sources[ns] as Record<string, string>).toSorted(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
  ])
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16)
}

/**
 * Read and validate one JSON file.
 * @param path - file path.
 * @param schema - expected shape.
 * @returns the parsed value, or undefined when the file is absent, unreadable, or does not match.
 */
async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T | undefined> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed = schema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

/**
 * List a directory's entry names.
 * @param path - directory.
 * @returns the names, or none when the directory does not exist.
 */
async function names(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}

/** Generated text, runtime strings, and the consent record under one root directory. */
export class I18nStore {
  /** @param root - absolute directory that holds the cache. */
  constructor(private readonly root: string) {}

  private packageDir(pkg: string): string {
    return join(this.root, encodeURIComponent(pkg))
  }

  /**
   * Read the newest stored file of a package and locale.
   * @param pkg - package name.
   * @param locale - target locale.
   * @returns the file, or undefined when none is stored.
   */
  async readLocale(pkg: string, locale: string): Promise<LocaleFile | undefined> {
    let newest: LocaleFile | undefined
    for (const hash of await names(this.packageDir(pkg))) {
      const file = await readJson(join(this.packageDir(pkg), hash, `${locale}.json`), localeFile)
      if (file !== undefined && (newest === undefined || file.generatedAt > newest.generatedAt)) newest = file
    }
    return newest
  }

  /**
   * Read every stored locale of a package.
   * @param pkg - package name.
   * @returns the newest file of each locale.
   */
  async listLocales(pkg: string): Promise<LocaleFile[]> {
    const locales = new Set<string>()
    for (const hash of await names(this.packageDir(pkg))) {
      for (const file of await names(join(this.packageDir(pkg), hash))) {
        if (file.endsWith('.json')) locales.add(file.slice(0, -'.json'.length))
      }
    }
    const files: LocaleFile[] = []
    for (const locale of [...locales].toSorted()) {
      const file = await this.readLocale(pkg, locale)
      if (file !== undefined) files.push(file)
    }
    return files
  }

  /**
   * List packages that have stored text.
   * @returns decoded package names.
   */
  async listPackages(): Promise<string[]> {
    return (await names(this.root)).filter(name => !name.startsWith('_')).map(decodeURIComponent).toSorted()
  }

  /**
   * Store one locale under its source hash and drop that locale's older files, which the new one supersedes.
   * @param file - the locale file.
   */
  async writeLocale(file: LocaleFile): Promise<void> {
    const dir = this.packageDir(file.pkg)
    await writeFileAtomic(join(dir, file.sourceHash, `${file.locale}.json`), JSON.stringify(file), FILE_OPTIONS)
    for (const hash of await names(dir)) {
      if (hash === file.sourceHash) continue
      await rm(join(dir, hash, `${file.locale}.json`), { force: true })
      await rmdir(join(dir, hash)).catch(() => {})
    }
  }

  /**
   * Delete everything stored for a package.
   * @param pkg - package name.
   */
  async clearPackage(pkg: string): Promise<void> {
    await rm(this.packageDir(pkg), { recursive: true, force: true })
  }

  /**
   * Read the runtime strings of a locale.
   * @param locale - target locale.
   * @returns exact source text to translation, in insertion order.
   */
  async readStrings(locale: string): Promise<Record<string, string>> {
    return (await readJson(join(this.root, STRINGS_DIR, `${locale}.json`), stringsFile))?.entries ?? {}
  }

  /**
   * Replace the runtime strings of a locale.
   * @param locale - target locale.
   * @param strings - exact source text to translation.
   */
  async writeStrings(locale: string, strings: Record<string, string>): Promise<void> {
    await writeFileAtomic(join(this.root, STRINGS_DIR, `${locale}.json`), JSON.stringify({ format: FORMAT, entries: strings }), FILE_OPTIONS)
  }

  /** Delete the runtime strings of every locale. */
  async clearStrings(): Promise<void> {
    await rm(join(this.root, STRINGS_DIR), { recursive: true, force: true })
  }

  /**
   * Read the consent record.
   * @returns the record; nothing is consented to when no file exists.
   */
  async readConsent(): Promise<PluginI18nConsent> {
    const file = await readJson(join(this.root, CONSENT_FILE), consentFile)
    return { global: file?.global ?? false, packages: file?.packages ?? [] }
  }

  /**
   * Replace the consent record.
   * @param consent - the complete record.
   */
  async writeConsent(consent: PluginI18nConsent): Promise<void> {
    await writeFileAtomic(join(this.root, CONSENT_FILE), JSON.stringify({ format: FORMAT, ...consent }), FILE_OPTIONS)
  }
}

/**
 * Build the entries record the store writes from accepted translations.
 * @param sources - source text by namespace and key.
 * @param translated - accepted translation by namespace and key.
 * @returns entries pairing each translation with the source it translated.
 */
export function pairEntries(sources: PluginI18nSources, translated: Record<string, Record<string, string>>): PluginI18nEntries {
  const result: PluginI18nEntries = {}
  for (const [ns, keys] of Object.entries(translated)) {
    const table: PluginI18nEntries[string] = {}
    for (const [key, text] of Object.entries(keys)) table[key] = { src: sources[ns]?.[key] as string, text }
    if (Object.keys(table).length > 0) result[ns] = table
  }
  return result
}
