#!/usr/bin/env node
// Regenerates mimi-tokens.json from Mimi's "Jan - Desktop v04" Figma file.
//   FIGMA_TOKEN=figd_... node plugins/jan-theme/design/extract-figma.mjs
// Each role reads one named node, so a redesign only needs new node ids here.
// The Variables API needs an Enterprise plan, so roles carry the Figma
// variable id they are bound to instead of the variable's name.
import { writeFileSync } from 'node:fs'

const FILE = 'YA2ZFuuatxKCGLrh0OXxzs'
const token = process.env.FIGMA_TOKEN
if (!token) throw new Error('Set FIGMA_TOKEN to a Figma personal access token with file read access.')

// [role, light node, dark node, paint]. Light comes from Themes > Default
// (light) or Chat + Cowork merged > Reviewing changes; dark from Themes >
// Default (dark). A null dark node means Mimi has not drawn that role dark.
const COLORS = [
  ['bg-base', '16708:57740', '16708:61212', 'fill'],
  ['bg-layer-1', '16708:57819', '16708:61285', 'fill'],
  ['bg-layer-2', '16708:57742', '16708:61214', 'fill'],
  ['label-primary', '16708:57761', '16708:61230', 'fill'],
  ['label-secondary', '16708:57810', '16708:61277', 'fill'],
  ['label-tertiary', '16708:57762', '16708:61231', 'fill'],
  ['label-placeholder', 'I16708:57819;2433:38930', '16708:61304', 'fill'],
  ['border-l1', '16708:57742', '16708:61285', 'stroke'],
  ['border-l2', 'I17240:21676;8422:4100', null, 'fill'],
  ['interactive-bg-hover', 'I16708:57819;2433:38933', '16708:61307', 'fill'],
  ['sidebar-item-selected', 'I17211:6903;8337:3605', null, 'fill'],
]
const RADII = [
  ['sidebar-card', '16708:57742'],
  ['composer', '16708:57819'],
  ['sidebar-row', 'I17211:6903;8337:3605'],
  ['user-bubble', 'I17211:6909;8317:3053'],
]
// Accent frames on Themes: the sidebar gradient's first stop, light and dark.
const ACCENTS = {
  red: ['16708:57881', '16708:59235'], orange: ['16708:57998', '16708:59289'],
  green: ['16708:58115', '16708:59343'], emerald: ['16708:58232', '16708:59397'],
  teal: ['16708:58349', '16708:59451'], cyan: ['16708:58466', '16708:59505'],
  blue: ['16708:58583', '16708:59667'], purple: ['16708:58700', '16708:59721'],
  pink: ['16708:58817', '16708:59559'], rose: ['16708:58934', '16708:59613'],
}
const PAGES = { merged: '17145:3' }

const api = async (path) => {
  const response = await fetch(`https://api.figma.com/v1/files/${FILE}${path}`, { headers: { 'X-Figma-Token': token } })
  if (!response.ok) throw new Error(`Figma ${path}: ${response.status} ${await response.text()}`)
  return response.json()
}
const hex = ({ r, g, b, a = 1 }, opacity = 1) => {
  const channel = value => Math.round(value * 255).toString(16).padStart(2, '0').toUpperCase()
  const alpha = Math.round(a * opacity * 100)
  return `#${channel(r)}${channel(g)}${channel(b)}${alpha >= 100 ? '' : `/${alpha}`}`
}
const solid = paints => (paints ?? []).find(paint => paint.type === 'SOLID' && paint.visible !== false)
const ids = [...new Set([...COLORS.flatMap(([, light, dark]) => [light, dark]), ...RADII.map(([, id]) => id), ...Object.values(ACCENTS).flat()].filter(Boolean))]
const { nodes } = await api(`/nodes?ids=${encodeURIComponent(ids.join(','))}`)
const node = id => nodes[id]?.document ?? (() => { throw new Error(`Figma node ${id} is gone; update extract-figma.mjs`) })()
const paint = (id, kind) => {
  const target = node(id)
  const found = solid(kind === 'fill' ? target.fills : target.strokes)
  if (!found) throw new Error(`Figma node ${id} has no solid ${kind}`)
  const binding = target.boundVariables?.[kind === 'fill' ? 'fills' : 'strokes']?.[0]?.id
  return { value: hex(found.color, found.opacity), ...(binding ? { variable: binding } : {}) }
}

// Text and effect styles keep their Figma names; scan the merged page once.
const page = (await api(`/nodes?ids=${PAGES.merged}`)).nodes[PAGES.merged]
const typography = {}
const effects = {}
const visit = (current) => {
  for (const [kind, styleId] of Object.entries(current.styles ?? {})) {
    const name = page.styles[styleId]?.name
    if (kind === 'text' && name && !typography[name] && /^(?:\dx?)?[a-z0-9]+\/(?:regular|medium)$/.test(name)) {
      const style = current.style
      typography[name] = { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeightPx, letterSpacing: Math.round(style.letterSpacing * 100) / 100 }
    }
    if (kind === 'effect' && name && !effects[name]) {
      effects[name] = current.effects.filter(effect => effect.visible !== false).map(effect => ({
        inset: effect.type === 'INNER_SHADOW', x: effect.offset.x, y: effect.offset.y, blur: effect.radius, spread: effect.spread ?? 0, color: hex(effect.color),
      }))
    }
  }
  for (const child of current.children ?? []) visit(child)
}
visit(page.document)
const count = new Map()
const tally = (current) => {
  if (current.visible === false) return
  if (current.layoutMode && current.layoutMode !== 'NONE') {
    for (const value of [current.itemSpacing, current.paddingLeft, current.paddingRight, current.paddingTop, current.paddingBottom]) {
      if (value) count.set(`space:${value}`, (count.get(`space:${value}`) ?? 0) + 1)
    }
  }
  // Radii under 4 round icon strokes, not surfaces.
  if (current.cornerRadius >= 4) count.set(`radius:${current.cornerRadius}`, (count.get(`radius:${current.cornerRadius}`) ?? 0) + 1)
  for (const child of current.children ?? []) tally(child)
}
tally(page.document)
// A step used fewer than 20 times on the page is a one-off, not part of the scale.
const scale = prefix => [...count].filter(([key, uses]) => key.startsWith(prefix) && uses >= 20)
  .map(([key]) => Number(key.slice(prefix.length))).sort((a, b) => a - b)

const meta = (await api('?depth=1'))
const sortKeys = object => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)))
const snapshot = {
  source: { file: FILE, name: meta.name, lastModified: meta.lastModified, url: `https://www.figma.com/design/${FILE}` },
  colors: Object.fromEntries(COLORS.map(([role, light, dark, kind]) => [role, { light: paint(light, kind), dark: dark ? paint(dark, kind) : null }])),
  radii: Object.fromEntries(RADII.map(([role, id]) => [role, node(id).cornerRadius])),
  accents: Object.fromEntries(Object.entries(ACCENTS).map(([name, [light, dark]]) => {
    const sidebar = (current) => current.name === 'sidebar' && current.fills?.some(fill => fill.type === 'GRADIENT_LINEAR') ? current : (current.children ?? []).map(sidebar).find(Boolean)
    const stop = id => hex(sidebar(node(id)).fills.find(fill => fill.type === 'GRADIENT_LINEAR').gradientStops[0].color)
    return [name, { sidebarLight: stop(light), sidebarDark: stop(dark) }]
  })),
  typography: sortKeys(typography),
  effects: sortKeys(effects),
  scales: { space: scale('space:'), radius: scale('radius:') },
}
writeFileSync(new URL('./mimi-tokens.json', import.meta.url), `${JSON.stringify(snapshot, null, 2)}\n`)
console.log(`mimi-tokens.json: ${Object.keys(snapshot.colors).length} colors, ${Object.keys(snapshot.typography).length} text styles, ${Object.keys(snapshot.effects).length} effects`)
