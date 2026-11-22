/**
 * Layout guide measurement: the edges a page's items line up on and the items
 * that miss them. Every container gets its dominant lines - the lead line
 * (first ink in text rows), the box line (boxed controls), the icon-column
 * centre, the label line (first text after a leading icon), the trailing line
 * and its centre, and the centre line when rows are centred - and each row that
 * sits 2px or more off its line is reported as a miss. Ink is measured, not
 * boxes: a text run's glyph bounds, an icon's bounds, and for a boxed control
 * (fill, full border or shadow) the box itself.
 *
 * Adapted from the gridlines probe by Pritam Paul (MIT License, Copyright (c)
 * 2026 Pritam Paul), itself after Karri Saarinen's redraw of the Linear
 * sidebar. Changes: items belong to their innermost container, boxed cards
 * count as containers, centred rows take a centre line instead of missing the
 * lead line, and results are plain data in viewport coordinates for an
 * overlay drawn outside the page.
 *
 * {@link measureGuides} runs inside opaque preview frames (the element probe
 * serializes it into the page), so it stays self-contained: no outer
 * references, no helpers a build could hoist.
 */

/** A rectangle in the measured document's viewport, CSS pixels. */
export interface GuideRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The edge a missed row was expected to sit on. */
export type GuideEdge = 'leading' | 'label' | 'icon-column' | 'trailing' | 'vertical-centre'

/** One container's dominant lines, as viewport x positions, and the items that miss them. */
export interface GuideContainer {
  readonly rect: GuideRect
  readonly lines: {
    readonly lead?: number | undefined
    readonly box?: number | undefined
    readonly iconCentre?: number | undefined
    readonly label?: number | undefined
    readonly trailing?: number | undefined
    readonly trailCentre?: number | undefined
    readonly centre?: number | undefined
  }
  /** `offset` is how far the item sits from its line, in CSS pixels (signed for horizontal edges). */
  readonly misses: readonly { readonly edge: GuideEdge; readonly rect: GuideRect; readonly offset: number }[]
}

/**
 * Measure the guide lines of every container under a root element.
 * @param root - the element whose subtree is measured; it is a container itself.
 * @returns the containers that hold at least one row, largest first, at most 16.
 */
export function measureGuides(root: Element): GuideContainer[] {
  const view = root.ownerDocument.defaultView
  if (view === null) return []
  const tolerance = 1
  const style = (el: Element) => view.getComputedStyle(el)
  const clear = (colour: string) => colour === '' || colour === 'transparent' || /rgba\([^)]*,\s*0\)$/u.test(colour)
  const shown = (el: Element) => {
    const cs = style(el)
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0
  }
  const hidden = (el: Element) => el.closest('[hidden], [aria-hidden="true"], script, style, noscript, template') !== null
  const isBox = (el: Element) => {
    if (el.matches('[role="tab"], [role="tablist"], table, thead, tbody, tr, td, th')) return false
    const cs = style(el)
    if (!clear(cs.backgroundColor) || cs.backgroundImage !== 'none') return true
    if (cs.boxShadow !== '' && cs.boxShadow !== 'none') return true
    return ['top', 'right', 'bottom', 'left'].every(side => parseFloat(cs.getPropertyValue('border-' + side + '-width')) > 0
      && !clear(cs.getPropertyValue('border-' + side + '-color')))
  }
  const rectOf = (r: { left: number; top: number; width: number; height: number }) => (
    { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) })

  const semantic = 'aside, nav, header, footer, main, section, article, form, ul, ol, [role="dialog"], [role="menu"], '
    + '[role="listbox"], [role="toolbar"], [role="group"]'
  const candidates = new Set<Element>([root])
  for (const el of root.querySelectorAll('*')) {
    if (el.matches(semantic)) { candidates.add(el); continue }
    const r = el.getBoundingClientRect()
    if (r.height > 64 && r.width > 120 && isBox(el)) candidates.add(el)
  }
  const containers = new Set<Element>()
  for (const el of candidates) {
    const r = el.getBoundingClientRect()
    if (r.width > 120 && r.height > 24 && shown(el) && !hidden(el)) containers.add(el)
  }
  const containerOf = (el: Element) => {
    for (let node: Element | null = el; node !== null; node = node.parentElement) {
      if (containers.has(node)) return node
      if (node === root) break
    }
    return null
  }
  /** The outermost small box between an item and its container: a button or chip reads as one shape. */
  const boxOf = (el: Element | null, container: Element, width: number) => {
    let box: Element | null = null
    for (let node = el; node !== null && node !== container; node = node.parentElement) {
      const r = node.getBoundingClientRect()
      if (r.width < width - 4 && r.height <= 64 && isBox(node)) box = node
    }
    return box
  }

  type Item = { r: DOMRect; kind: 'text' | 'icon' | 'box' }
  const items = new Map<Element, Item[]>()
  const seen = new Set<Element>()
  const add = (container: Element, item: Item) => {
    const list = items.get(container)
    if (list === undefined) items.set(container, [item])
    else list.push(item)
  }
  const walker = root.ownerDocument.createTreeWalker(root, 4)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const el = node.parentElement
    if (el === null || (node.textContent ?? '').trim() === '' || hidden(el) || !shown(el)) continue
    const container = containerOf(el)
    if (container === null) continue
    const box = boxOf(el, container, container.getBoundingClientRect().width)
    if (box !== null) {
      if (!seen.has(box)) { seen.add(box); add(container, { r: box.getBoundingClientRect(), kind: 'box' }) }
      continue
    }
    const range = root.ownerDocument.createRange()
    range.selectNodeContents(node)
    for (const r of range.getClientRects()) if (r.width > 1) add(container, { r, kind: 'text' })
  }
  for (const el of root.querySelectorAll('svg, img, input, select, textarea, [role="checkbox"], [role="switch"]')) {
    if (hidden(el) || !shown(el) || el.parentElement?.closest('svg')) continue
    const r = el.getBoundingClientRect()
    if (r.width < 6 || r.width > 64 || r.height > 64) continue
    const container = containerOf(el)
    if (container === null) continue
    const box = boxOf(el.parentElement, container, container.getBoundingClientRect().width)
    if (box !== null) {
      if (!seen.has(box)) { seen.add(box); add(container, { r: box.getBoundingClientRect(), kind: 'box' }) }
      continue
    }
    add(container, { r, kind: 'icon' })
  }

  const out: GuideContainer[] = []
  for (const [container, list] of items) {
    const cr = container.getBoundingClientRect()
    const inside = list.filter(i => i.r.height > 0 && i.r.left >= cr.left - 1 && i.r.right <= cr.right + 1
      && i.r.top >= cr.top - 1 && i.r.bottom <= cr.bottom + 1)
    const rows: { cy: number; items: Item[] }[] = []
    for (const item of inside.sort((a, b) => a.r.top + a.r.bottom - b.r.top - b.r.bottom)) {
      const cy = (item.r.top + item.r.bottom) / 2
      const row = rows.find(candidate => Math.abs(candidate.cy - cy) < 6)
      if (row === undefined) rows.push({ cy, items: [item] })
      else row.items.push(item)
    }
    if (rows.length === 0) continue
    const middle = cr.left + cr.width / 2
    const edges = rows.map((row) => {
      const first = row.items.reduce((a, b) => (a.r.left <= b.r.left ? a : b))
      const last = row.items.reduce((a, b) => (a.r.right >= b.r.right ? a : b))
      const label = first.kind === 'icon'
        ? row.items.filter(i => i.kind === 'text' && i.r.left > first.r.right).sort((a, b) => a.r.left - b.r.left)[0]
        : undefined
      const tops = row.items.map(i => i.r.top)
      const bottoms = row.items.map(i => i.r.bottom)
      const centres = row.items.map(i => (i.r.top + i.r.bottom) / 2)
      return {
        first, last, label,
        left: Math.round(first.r.left), right: Math.round(last.r.right),
        iconCentre: first.kind === 'icon' ? Math.round((first.r.left + first.r.right) / 2) : undefined,
        labelLeft: label === undefined ? undefined : Math.round(label.r.left),
        trailCentre: Math.round((last.r.left + last.r.right) / 2),
        centred: Math.abs((first.r.left + last.r.right) / 2 - middle) <= tolerance,
        spread: Math.max(...centres) - Math.min(...centres),
        bounds: { left: first.r.left, top: Math.min(...tops), width: last.r.right - first.r.left,
          height: Math.max(...bottoms) - Math.min(...tops) },
      }
    })
    type Edge = (typeof edges)[number]
    const dominant = (pick: (edge: Edge) => number | undefined, keep: (edge: Edge) => boolean = () => true) => {
      const counts = new Map<number, number>()
      for (const edge of edges) {
        const value = keep(edge) ? pick(edge) : undefined
        if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1)
      }
      let best: number | undefined
      let most = 0
      for (const [value, count] of counts) if (count > most) { best = value; most = count }
      return best
    }
    // Ragged-right text is not a trailing item: only rows ending in the trailing quarter take part.
    const reachesTrailing = (edge: Edge) => cr.right - edge.right < cr.width / 4
    const edgeRows = (edge: Edge) => !edge.centred
    const lines = {
      lead: dominant(edge => edge.left, edge => edgeRows(edge) && edge.first.kind !== 'box'),
      box: dominant(edge => edge.left, edge => edgeRows(edge) && edge.first.kind === 'box'),
      iconCentre: dominant(edge => edge.iconCentre, edgeRows),
      label: dominant(edge => edge.labelLeft, edgeRows),
      trailing: dominant(edge => edge.right, edge => edgeRows(edge) && reachesTrailing(edge)),
      trailCentre: dominant(edge => edge.trailCentre, edge => edgeRows(edge) && reachesTrailing(edge)),
      centre: edges.some(edge => edge.centred) ? Math.round(middle) : undefined,
    }
    const near = (value: number | undefined, line: number | undefined) => value !== undefined && line !== undefined
      && Math.abs(value - line) <= tolerance
    const misses: { edge: GuideEdge; rect: GuideRect; offset: number }[] = []
    for (const edge of edges) {
      if (edge.spread > tolerance) misses.push({ edge: 'vertical-centre', rect: rectOf(edge.bounds), offset: Math.round(edge.spread) })
      if (edge.centred) continue
      const lead = edge.first.kind === 'box' ? lines.box : lines.lead
      if (lead !== undefined && ![lines.lead, lines.box, lines.label].some(line => near(edge.left, line))) {
        misses.push({ edge: 'leading', rect: rectOf(edge.first.r), offset: edge.left - lead })
      }
      if (edge.label !== undefined && edge.labelLeft !== undefined && lines.label !== undefined && !near(edge.labelLeft, lines.label)) {
        misses.push({ edge: 'label', rect: rectOf(edge.label.r), offset: edge.labelLeft - lines.label })
      }
      if (edge.iconCentre !== undefined && lines.iconCentre !== undefined && !near(edge.iconCentre, lines.iconCentre)) {
        misses.push({ edge: 'icon-column', rect: rectOf(edge.first.r), offset: edge.iconCentre - lines.iconCentre })
      }
      if (reachesTrailing(edge) && lines.trailing !== undefined && !near(edge.right, lines.trailing)
        && !near(edge.trailCentre, lines.trailCentre)) {
        misses.push({ edge: 'trailing', rect: rectOf(edge.last.r), offset: edge.right - lines.trailing })
      }
    }
    out.push({ rect: rectOf(cr), lines, misses })
  }
  return out.sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height).slice(0, 16)
}
