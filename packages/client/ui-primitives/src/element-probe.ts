/**
 * Element picking inside an opaque HTML preview. A delivered page runs in a
 * script-only sandbox with no same-origin access, so the app cannot read its
 * DOM. The preview appends a probe script to the page and marks its iframe
 * with {@link ELEMENT_PROBE_ATTRIBUTE}; the probe answers one query at a time
 * over postMessage: the element under a point, or the page's layout guides
 * ({@link measureGuides}). It reports only the page's own markup and geometry,
 * which the app already holds, and grants the page nothing.
 */
import { measureGuides, type GuideContainer } from './layout-guides.ts'

/** Marks an opaque iframe whose page carries the probe. */
export const ELEMENT_PROBE_ATTRIBUTE = 'data-element-probe'

const REQUEST = 'jan-element-probe'
const REPLY = 'jan-element-probe-reply'
const GUIDES = 'jan-element-guides'
const GUIDES_REPLY = 'jan-element-guides-reply'
const HTML_LIMIT = 2400

/** A unique selector and a bounded outerHTML excerpt for one element. */
export interface ElementDescription {
  readonly selector: string
  readonly html: string
}

/** An element found by the probe; `bounds` are in the framed page's viewport. */
export interface ProbedElement extends ElementDescription {
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
}

/**
 * Describe only the chosen element and keep the excerpt bounded. The probe
 * serializes this function into the framed page, so it stays self-contained:
 * no outer references, no helpers a build could hoist.
 * @param element - the chosen element.
 * @returns a selector that matches only this element, and its outerHTML up to 2400 characters.
 */
export function describeElement(element: Element): ElementDescription {
  const limit = 2400
  const css = globalThis.CSS
  const parts: string[] = []
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    const id = node.id
    const escaped = css && css.escape ? css.escape(id) : /^[\w-]+$/u.test(id) ? id : ''
    if (escaped && node.ownerDocument.querySelectorAll('#' + escaped).length === 1) {
      parts.unshift('#' + escaped)
      break
    }
    const name = node.localName
    const siblings: HTMLCollection | null = node.parentElement === null ? null : node.parentElement.children
    if (siblings === null) { parts.unshift(name); break }
    let index = 0
    let count = 0
    for (const sibling of siblings) {
      if (sibling.localName !== name) continue
      count++
      if (sibling === node) index = count
    }
    parts.unshift(count > 1 ? name + ':nth-of-type(' + index + ')' : name)
  }
  const html = element.outerHTML
  return { selector: parts.join(' > '), html: html.length <= limit ? html : html.slice(0, limit) + '…' }
}

/** Runs inside the framed page; serialized with {@link describeElement} and {@link measureGuides}. */
function installProbe(describe: typeof describeElement, request: string, reply: string,
  measure: typeof measureGuides, guides: string, guidesReply: string): void {
  addEventListener('message', (event) => {
    const data = event.data as { type?: unknown; id?: unknown; x?: unknown; y?: unknown } | null
    if (event.source !== parent || data === null || typeof data !== 'object') return
    if (data.type === guides) {
      parent.postMessage({ type: guidesReply, id: data.id, guides: measure(document.documentElement) }, '*')
      return
    }
    if (data.type !== request || typeof data.x !== 'number' || typeof data.y !== 'number') return
    const hit = document.elementFromPoint(data.x, data.y)
    let found = null
    if (hit !== null) {
      const box = hit.getBoundingClientRect()
      found = Object.assign(describe(hit), { bounds: { x: box.left, y: box.top, width: box.width, height: box.height } })
    }
    parent.postMessage({ type: reply, id: data.id, hit: found }, '*')
  })
}

const PROBE_SCRIPT = `(${installProbe.toString()})(${describeElement.toString()},${JSON.stringify(REQUEST)},${JSON.stringify(REPLY)},`
  + `${measureGuides.toString()},${JSON.stringify(GUIDES)},${JSON.stringify(GUIDES_REPLY)})`
const PROBE_TAG = new TextEncoder().encode(`\n<script>${PROBE_SCRIPT}</script>\n`)

/**
 * Append the probe to a page's bytes. The tag goes after the page's own
 * markup, so it never changes the document mode, and it is ASCII, so any
 * ASCII-compatible page encoding still decodes.
 * @param page - the HTML file bytes.
 * @returns the same bytes followed by the probe script.
 */
export function withElementProbe(page: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(page.length + PROBE_TAG.length)
  out.set(page)
  out.set(PROBE_TAG, page.length)
  return out
}

function isBounds(value: unknown): value is ProbedElement['bounds'] {
  if (value === null || typeof value !== 'object') return false
  const { x, y, width, height } = value as Record<string, unknown>
  return [x, y, width, height].every(item => typeof item === 'number' && Number.isFinite(item))
}

/** Correlates a probe request with its reply; replies are also matched by source frame. */
let probeSequence = 0

/**
 * Post one request to a probed frame and resolve with its parsed reply.
 * @param frame - an iframe carrying {@link ELEMENT_PROBE_ATTRIBUTE}.
 * @param request - the request message, without its correlation id.
 * @param replyType - the reply type that answers it.
 * @param parse - checks and bounds the untrusted reply.
 * @param timeoutMs - how long to wait for a page that never answers.
 * @returns the parsed reply, or null when the page did not answer.
 */
function askProbe<T>(frame: HTMLIFrameElement, request: Record<string, unknown>, replyType: string,
  parse: (data: Record<string, unknown>) => T | null, timeoutMs: number): Promise<T | null> {
  const target = frame.contentWindow
  const host = frame.ownerDocument.defaultView
  if (target === null || host === null) return Promise.resolve(null)
  const id = ++probeSequence
  return new Promise((resolve) => {
    const finish = (value: T | null): void => {
      clearTimeout(timer)
      host.removeEventListener('message', onMessage)
      resolve(value)
    }
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as Record<string, unknown> | null
      if (event.source !== target || data === null || typeof data !== 'object' || data.type !== replyType || data.id !== id) return
      finish(parse(data))
    }
    const timer = setTimeout(() => { finish(null) }, timeoutMs)
    host.addEventListener('message', onMessage)
    target.postMessage({ ...request, id }, '*')
  })
}

/**
 * Ask a probed frame which element sits at a point. The page answers for
 * itself, so its reply is checked and bounded like any untrusted input.
 * @param frame - an iframe carrying {@link ELEMENT_PROBE_ATTRIBUTE}.
 * @param x - horizontal point in the frame's viewport.
 * @param y - vertical point in the frame's viewport.
 * @param timeoutMs - how long to wait for a page that never answers.
 * @returns the element, or null when nothing is there or the page did not answer.
 */
export function probeFrameElement(frame: HTMLIFrameElement, x: number, y: number, timeoutMs = 500): Promise<ProbedElement | null> {
  return askProbe(frame, { type: REQUEST, x, y }, REPLY, (data) => {
    const hit = data.hit as { selector?: unknown; html?: unknown; bounds?: unknown } | null
    if (hit === null || typeof hit !== 'object' || typeof hit.selector !== 'string' || typeof hit.html !== 'string'
      || !isBounds(hit.bounds)) return null
    const { x: left, y: top, width, height } = hit.bounds
    return { selector: hit.selector.slice(0, HTML_LIMIT), html: hit.html.slice(0, HTML_LIMIT + 1),
      bounds: { x: left, y: top, width, height } }
  }, timeoutMs)
}

const GUIDE_LINES = ['lead', 'box', 'iconCentre', 'label', 'trailing', 'trailCentre', 'centre'] as const
const GUIDE_EDGES: readonly string[] = ['leading', 'label', 'icon-column', 'trailing', 'vertical-centre']

/** Keep only well-formed guides from an untrusted reply, at most 16 containers of 64 misses each. */
function sanitizeGuides(value: unknown): GuideContainer[] | null {
  if (!Array.isArray(value)) return null
  const out: GuideContainer[] = []
  for (const item of value.slice(0, 16) as unknown[]) {
    if (item === null || typeof item !== 'object') return null
    const { rect, lines, misses } = item as Record<string, unknown>
    if (!isBounds(rect) || lines === null || typeof lines !== 'object' || !Array.isArray(misses)) return null
    const clean: Partial<Record<(typeof GUIDE_LINES)[number], number>> = {}
    for (const key of GUIDE_LINES) {
      const line = (lines as Record<string, unknown>)[key]
      if (typeof line === 'number' && Number.isFinite(line)) clean[key] = line
    }
    const kept = (misses as unknown[]).slice(0, 64).filter((miss): miss is GuideContainer['misses'][number] => {
      if (miss === null || typeof miss !== 'object') return false
      const { edge, rect: box, offset } = miss as Record<string, unknown>
      return typeof edge === 'string' && GUIDE_EDGES.includes(edge) && isBounds(box) && typeof offset === 'number' && Number.isFinite(offset)
    })
    out.push({ rect, lines: clean, misses: kept })
  }
  return out
}

/**
 * Ask a probed frame for its layout guides. The page measures itself, so its
 * reply is checked and bounded like any untrusted input.
 * @param frame - an iframe carrying {@link ELEMENT_PROBE_ATTRIBUTE}.
 * @param timeoutMs - how long to wait for a page that never answers.
 * @returns the guides in the frame's viewport, or null when the page did not answer.
 */
export function probeFrameGuides(frame: HTMLIFrameElement, timeoutMs = 1000): Promise<GuideContainer[] | null> {
  return askProbe(frame, { type: GUIDES }, GUIDES_REPLY, data => sanitizeGuides(data.guides), timeoutMs)
}
