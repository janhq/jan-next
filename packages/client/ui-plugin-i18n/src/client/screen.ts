/**
 * On-screen translation of text a plugin renders itself or the Plugins page shows about it. A MutationObserver watches
 * the regions that name a package: the owner markers the slot renderer puts around a third-party plugin's entries,
 * and the plugin's card and detail pages in the Plugins page, which show its name, description, and settings. Text
 * nodes and the `title`, `placeholder`, and `aria-label` attributes inside a consented plugin's region are replaced
 * in place once their translation is cached, and put back when the plugin loses consent or the locale changes.
 */
import { mismatchesLocale } from './script.ts'

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
const SKIPPED = 'code, pre, canvas, script, style, [contenteditable]:not([contenteditable="false"])'

/** A textarea's text child is its value, so its text is never touched, though its `placeholder` is. */
const SKIPPED_NODE_PARENTS = `${SKIPPED}, textarea`

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
  /** The cached translation of an exact source text, if one arrived. */
  lookup(text: string): string | undefined
  /** Ask for the translation of text a package displays; the host calls `refresh` when it arrives. */
  request(pkg: string, text: string): void
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

/** Translates the on-screen text of consented plugins and restores it on demand. */
export class ScreenTranslator {
  private readonly texts = new WeakMap<Text, Applied>()
  private readonly attributes = new WeakMap<Element, Map<string, Applied>>()
  /** Packages with at least one replacement standing; only these need a restore walk. */
  private readonly touched = new Set<string>()
  private observer: MutationObserver | undefined

  /**
   * @param host - consent, locale, and cached translations.
   * @param doc - the document to observe.
   */
  constructor(private readonly host: ScreenHost, private readonly doc: Document) {}

  /**
   * Bring the screen in line with consent and the cache: restore packages that lost consent, watch the document
   * while any package consents, and translate what the consented packages show now, including text whose
   * translation just arrived or changed.
   */
  refresh(): void {
    const consented = this.host.consented()
    for (const pkg of [...this.touched]) if (!consented.has(pkg)) this.restore(pkg)
    if (consented.size === 0) {
      this.disconnect()
      return
    }
    this.connect()
    for (const container of this.doc.querySelectorAll(OWNER_SELECTOR)) {
      if (consented.has(packageOfRegion(container) ?? '')) this.scan(container, true)
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

  private connect(): void {
    if (this.observer !== undefined) return
    this.observer = new MutationObserver((records) => { this.handle(records) })
    this.observer.observe(this.doc.documentElement, {
      childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...READABLE_ATTRIBUTES],
    })
  }

  private disconnect(): void {
    this.observer?.disconnect()
    this.observer = undefined
  }

  private handle(records: readonly MutationRecord[]): void {
    const consented = this.host.consented()
    if (consented.size > 0) {
      for (const record of records) {
        if (record.type === 'childList') {
          for (const added of record.addedNodes) this.scanAdded(added)
        } else if (record.type === 'characterData') {
          if (record.target instanceof Text) this.processText(record.target, false)
        } else if (record.target instanceof Element && record.attributeName !== null) {
          this.processAttribute(record.target, record.attributeName, false)
        }
      }
    }
    // Everything queued while this callback ran is our own write; dropping it ends the write-observe cycle.
    this.observer?.takeRecords()
  }

  /** Scan a node a mutation added: its own subtree when it sits inside a marker, else the markers it contains. */
  private scanAdded(node: Node): void {
    const element = node instanceof Element ? node : node.parentElement
    if ((element?.closest(OWNER_SELECTOR) ?? null) !== null) {
      this.scan(node, false)
      return
    }
    if (node instanceof Element) for (const container of node.querySelectorAll(OWNER_SELECTOR)) this.scan(container, false)
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

  private ownerOf(node: Node): string | undefined {
    const element = node instanceof Element ? node : node.parentElement
    const region = element?.closest(OWNER_SELECTOR)
    return region === null || region === undefined ? undefined : packageOfRegion(region)
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
    const locale = this.host.locale()
    const core = value.trim()
    if (core === '' || !mismatchesLocale(core, locale)) return stale
    const owner = ownerOf()
    if (owner === undefined || !this.host.consented().has(owner)) return stale
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
