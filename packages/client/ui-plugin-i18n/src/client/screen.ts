/**
 * Detect and translate text a plugin renders itself or the Plugins page shows about it. Only marked regions
 * are read; only consented regions send text to the Host or receive in-place replacements.
 */
import type { LanguageDetection } from './script.ts'

/** Attribute the slot renderer sets on the container of a third-party plugin's entry; its value is the package name. */
export const OWNER_ATTRIBUTE = 'data-plugin-owner'

/**
 * How each region names its package: the attribute and how its value reads as a package name. The Plugins page marks a
 * package card and a package page with the name, and a part's page with `<package>#<part>`.
 */
const REGIONS: readonly { readonly attribute: string; readonly packageOf: (value: string) => string }[] = [
  { attribute: OWNER_ATTRIBUTE, packageOf: value => value },
  { attribute: 'data-plugin-package', packageOf: value => value },
  { attribute: 'data-plugin-detail', packageOf: value => value },
  { attribute: 'data-plugin-row-detail', packageOf: value => value.split('#')[0] ?? value },
]

const OWNER_SELECTOR = REGIONS.map(region => `[${region.attribute}]`).join(', ')

/**
 * Name the package a region element belongs to.
 * @param element - an element matching `OWNER_SELECTOR`.
 * @returns the package name, or undefined when the element carries none.
 */
function packageOfRegion(element: Element): string | undefined {
  for (const { attribute, packageOf } of REGIONS) {
    const value = element.getAttribute(attribute)
    if (value !== null && value !== '') return packageOf(value)
  }
  return undefined
}

/** Attributes whose value is text for the person. */
const READABLE_ATTRIBUTES = ['title', 'placeholder', 'aria-label'] as const

/** Regions whose text is not interface copy: code, drawing surfaces, and anything the person edits. */
const SKIPPED = 'code, pre, canvas, script, style, [translate="no"], [contenteditable]:not([contenteditable="false"])'

/** A textarea's text child is its value, so its text is never touched, though its `placeholder` is. */
const SKIPPED_NODE_PARENTS = `${SKIPPED}, textarea`

const HIDDEN = '[hidden], [aria-hidden="true"]'
const DETECTION_DELAY_MS = 150
const DETECTION_SAMPLE_LIMIT = 64
const DETECTION_NODE_LIMIT = 2000
const DETECTION_CACHE_LIMIT = 512
const DETECTION_SKIPPED = `${SKIPPED}, ${HIDDEN}`
const DETECTION_BOUNDARY = `${DETECTION_SKIPPED}, ${OWNER_SELECTOR}`

const SHOW_ELEMENT = 1
const SHOW_TEXT = 4
const FILTER_ACCEPT = 1
const FILTER_REJECT = 2

/** What the translator needs from the translation service. */
export interface ScreenHost {
  /** Packages whose on-screen text the person agreed to translate. */
  consented(): ReadonlySet<string>
  /** The UI locale. */
  locale(): string
  /** A language or a pending detector load; the host refreshes when the load finishes. */
  detect(text: string, locale: string): LanguageDetection
  /** The cached translation of an exact source text, if one arrived. */
  lookup(text: string): string | undefined
  /** Ask for the translation of text a package displays; the host calls `refresh` when it arrives. */
  request(pkg: string, text: string): void
  /** Whether we still need local detection evidence for a package. */
  detecting(pkg: string): boolean
  /** A pass collected unique foreign source strings and their languages, all locally. */
  report(evidence: ReadonlyMap<string, ReadonlyMap<string, string>>): void
}

/** The replacement the translator made, kept so the original comes back and a re-render is told from our own write. */
interface Applied {
  /** What the plugin wrote. */
  readonly source: string
  /** What the translator wrote in its place. */
  readonly translated: string
  /** The package that rendered it. */
  readonly owner: string
}

/** Detects foreign screen text and translates it once the package has consent. */
export class ScreenTranslator {
  private readonly texts = new WeakMap<Text, Applied>()
  private readonly attributes = new WeakMap<Element, Map<string, Applied>>()
  /** Packages with at least one replacement standing; only these need a restore walk. */
  private readonly touched = new Set<string>()
  private observer: MutationObserver | undefined
  private readonly dirty = new Set<Element>()
  private readonly detected = new Map<string, string | undefined>()
  private detectionLocale = ''
  private detectionTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * @param host - consent, locale, and cached translations.
   * @param doc - the document to observe.
   */
  constructor(private readonly host: ScreenHost, private readonly doc: Document) {}

  /**
   * Restore packages that lost consent, apply translations already cached, and schedule detection of
   * the visible non-consented regions.
   */
  refresh(): void {
    const consented = this.host.consented()
    for (const pkg of [...this.touched]) if (!consented.has(pkg)) this.restore(pkg)
    this.handle(this.observer?.takeRecords() ?? [])
    this.connect()
    for (const container of this.doc.querySelectorAll(OWNER_SELECTOR)) {
      const pkg = packageOfRegion(container)
      if (pkg === undefined) continue
      if (consented.has(pkg)) this.scan(container, true)
      else this.queueDetection(container, pkg)
    }
    this.observer?.takeRecords()
  }

  /**
   * Put the original text back for one package, or for every package.
   * @param pkg - the package to restore; omitted restores all.
   */
  restore(pkg?: string): void {
    for (const container of this.doc.querySelectorAll(OWNER_SELECTOR)) {
      const owner = packageOfRegion(container)
      if (owner === undefined || (pkg !== undefined && owner !== pkg)) continue
      const walker = this.doc.createTreeWalker(container, SHOW_ELEMENT | SHOW_TEXT)
      for (let node = walker.currentNode as Node | null; node !== null; node = walker.nextNode()) {
        if (node instanceof Text) this.restoreText(node)
        else if (node instanceof Element) this.restoreAttributes(node)
      }
    }
    if (pkg === undefined) this.touched.clear()
    else this.touched.delete(pkg)
    this.observer?.takeRecords()
  }

  /** Stop watching and put every original back. */
  dispose(): void {
    this.restore()
    this.disconnect()
  }

  /** Detect against the new locale rather than any evidence scheduled before the switch. */
  resetDetection(): void {
    clearTimeout(this.detectionTimer)
    this.detectionTimer = undefined
    this.dirty.clear()
    this.detected.clear()
  }

  private connect(): void {
    if (this.observer !== undefined) return
    this.observer = new MutationObserver((records) => { this.handle(records) })
    this.observer.observe(this.doc.documentElement, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: [...READABLE_ATTRIBUTES, ...REGIONS.map(region => region.attribute), 'hidden', 'aria-hidden', 'translate'],
    })
  }

  private disconnect(): void {
    this.observer?.disconnect()
    this.observer = undefined
    this.resetDetection()
  }

  private handle(records: readonly MutationRecord[]): void {
    for (const record of records) {
      if (record.type === 'childList') {
        for (const added of record.addedNodes) this.scanAdded(added)
      } else if (record.type === 'characterData' && record.target instanceof Text) {
        if (this.queueContainingRegion(record.target) === 'consented') this.processText(record.target, false)
      } else if (record.target instanceof Element && record.attributeName !== null) {
        if (READABLE_ATTRIBUTES.some(name => name === record.attributeName)) {
          if (this.queueContainingRegion(record.target) === 'consented') this.processAttribute(record.target, record.attributeName, false)
        } else {
          // A retained pane can become visible, or gain its owner, without a child insertion.
          this.scanAdded(record.target)
        }
      }
    }
    // Everything queued while this callback ran is our own write; dropping it ends the write-observe cycle.
    this.observer?.takeRecords()
  }

  /** Translate a newly added subtree or schedule its unconsented regions for the next detection pass. */
  private scanAdded(node: Node): void {
    if (!node.isConnected) return
    const containing = this.queueContainingRegion(node)
    if (containing === 'consented') this.scan(node, false)
    if (node instanceof Element) {
      for (const region of node.querySelectorAll(OWNER_SELECTOR)) {
        const pkg = packageOfRegion(region)
        if (pkg === undefined) continue
        if (this.host.consented().has(pkg)) {
          if (containing !== 'consented') this.scan(region, false)
        } else this.queueDetection(region, pkg)
      }
    }
  }

  private queueContainingRegion(node: Node): 'consented' | undefined {
    const region = this.regionOf(node)
    if (region == null) return undefined
    const pkg = packageOfRegion(region)
    if (pkg === undefined) return undefined
    if (this.host.consented().has(pkg)) return 'consented'
    this.queueDetection(region, pkg)
    return undefined
  }

  private queueDetection(region: Element, pkg: string): void {
    if (!this.host.detecting(pkg) || region.closest(HIDDEN) !== null) return
    this.dirty.add(region)
    this.detectionTimer ??= setTimeout(() => { this.detectDirty() }, DETECTION_DELAY_MS)
  }

  private detectDirty(): void {
    this.detectionTimer = undefined
    const evidence = new Map<string, Map<string, string>>()
    for (const region of this.dirty) {
      const pkg = packageOfRegion(region)
      if (pkg === undefined || !region.isConnected || !this.host.detecting(pkg) || region.closest(DETECTION_SKIPPED) !== null) continue
      const samples = evidence.get(pkg) ?? new Map<string, string>()
      evidence.set(pkg, samples)
      const record = (value: string): void => {
        const text = value.trim()
        const language = this.detectLanguage(text)
        if (language !== undefined) samples.set(text, language)
      }
      const walker = this.doc.createTreeWalker(region, SHOW_ELEMENT | SHOW_TEXT, {
        acceptNode: node => node instanceof Element && node.matches(DETECTION_BOUNDARY) ? FILTER_REJECT : FILTER_ACCEPT,
      })
      let count = 0
      for (let node = walker.currentNode as Node | null; node !== null && count < DETECTION_NODE_LIMIT
        && samples.size < DETECTION_SAMPLE_LIMIT; node = walker.nextNode(), count += 1) {
        if (node instanceof Text) {
          if (node.parentElement?.closest('textarea') === null) record(node.data)
        } else if (node instanceof Element) {
          for (const name of READABLE_ATTRIBUTES) {
            const text = node.getAttribute(name)
            if (text !== null) record(text)
          }
        }
      }
    }
    this.dirty.clear()
    if (evidence.size > 0) this.host.report(evidence)
  }

  private detectLanguage(text: string): string | undefined {
    if (text.length < 2 || text.length > 1200) return undefined
    const locale = this.host.locale()
    if (locale !== this.detectionLocale) {
      this.detected.clear()
      this.detectionLocale = locale
    }
    if (this.detected.has(text)) return this.detected.get(text)
    if (this.detected.size >= DETECTION_CACHE_LIMIT) this.detected.clear()
    const language = this.host.detect(text, locale)
    if (language instanceof Promise) return undefined
    this.detected.set(text, language)
    return language
  }

  private scan(root: Node, revalidate: boolean): void {
    if (root instanceof Text) {
      this.processText(root, revalidate)
      return
    }
    if (!(root instanceof Element) || root.closest(SKIPPED) !== null) return
    const walker = this.doc.createTreeWalker(root, SHOW_ELEMENT | SHOW_TEXT, {
      acceptNode: node => node instanceof Element && node.matches(SKIPPED) ? FILTER_REJECT : FILTER_ACCEPT,
    })
    for (let node = walker.currentNode as Node | null; node !== null; node = walker.nextNode()) {
      if (node instanceof Text) {
        this.processText(node, revalidate)
      } else if (node instanceof Element) {
        for (const name of READABLE_ATTRIBUTES) this.processAttribute(node, name, revalidate)
      }
    }
  }

  private regionOf(node: Node): Element | null | undefined {
    const element = node instanceof Element ? node : node.parentElement
    return element?.closest(OWNER_SELECTOR)
  }

  private ownerOf(node: Node): string | undefined {
    const region = this.regionOf(node)
    return region == null ? undefined : packageOfRegion(region)
  }

  private processText(node: Text, revalidate: boolean): void {
    const next = this.translate(node.data, this.texts.get(node), revalidate, () => this.textOwner(node))
    if (next === undefined) return
    if (next === null) {
      this.texts.delete(node)
      return
    }
    node.data = next.translated
    this.texts.set(node, next)
    this.touched.add(next.owner)
  }

  private processAttribute(element: Element, name: string, revalidate: boolean): void {
    const value = element.getAttribute(name)
    if (value === null) return
    const states = this.attributes.get(element)
    const next = this.translate(value, states?.get(name), revalidate, () => this.attributeOwner(element))
    if (next === undefined) return
    if (next === null) {
      states?.delete(name)
      return
    }
    element.setAttribute(name, next.translated)
    const own = states ?? new Map<string, Applied>()
    own.set(name, next)
    this.attributes.set(element, own)
    this.touched.add(next.owner)
  }

  /** The package that owns a text node when its region may be translated. */
  private textOwner(node: Text): string | undefined {
    const owner = this.ownerOf(node)
    return owner !== undefined && node.parentElement?.closest(SKIPPED_NODE_PARENTS) === null ? owner : undefined
  }

  /** The package that owns an element's attributes when its region may be translated. */
  private attributeOwner(element: Element): string | undefined {
    const owner = this.ownerOf(element)
    return owner !== undefined && element.closest(SKIPPED) === null ? owner : undefined
  }

  /**
   * Decide what a text or attribute value should become.
   * @param value - the value now in the DOM.
   * @param applied - the replacement standing on it, if any.
   * @param revalidate - whether a standing replacement is checked against a newer cached translation.
   * @param ownerOf - reads the owning package when the region may be translated.
   * @returns the replacement to write, null to forget a stale replacement, or undefined to leave the value alone.
   */
  private translate(
    value: string, applied: Applied | undefined, revalidate: boolean, ownerOf: () => string | undefined,
  ): Applied | null | undefined {
    if (applied !== undefined && value === applied.translated) {
      return revalidate ? this.apply(applied.source, applied.owner, applied) : undefined
    }
    // A write of our own is never here, so the plugin wrote this value: whatever stood on it is stale.
    const stale = applied === undefined ? undefined : null
    const owner = ownerOf()
    if (owner === undefined || !this.host.consented().has(owner)) return stale
    if (this.detectLanguage(value.trim()) === undefined) return stale
    return this.apply(value, owner, undefined) ?? stale
  }

  /** Build the replacement for a source value from the cache, asking for the translation when it is missing. */
  private apply(source: string, owner: string, standing: Applied | undefined): Applied | undefined {
    const core = source.trim()
    const translation = this.host.lookup(core)
    if (translation === undefined) {
      this.host.request(owner, core)
      return undefined
    }
    const lead = source.slice(0, source.indexOf(core))
    const translated = `${lead}${translation}${source.slice(lead.length + core.length)}`
    if (translated === source || translated === standing?.translated) return undefined
    return { source, translated, owner }
  }

  private restoreText(node: Text): void {
    const applied = this.texts.get(node)
    if (applied === undefined) return
    this.texts.delete(node)
    if (node.data === applied.translated) node.data = applied.source
  }

  private restoreAttributes(element: Element): void {
    const states = this.attributes.get(element)
    if (states === undefined) return
    this.attributes.delete(element)
    for (const [name, applied] of states) if (element.getAttribute(name) === applied.translated) element.setAttribute(name, applied.source)
  }
}
