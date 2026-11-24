/** Source-only motion declarations from standalone stylesheets and plugin CSS strings. */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { packageStylesheets } from './stylesheet-scan.ts'

/** The only stylesheet that defines the theme's shared motion values. */
export const MOTION_TOKEN_OWNER = 'packages/client/ui-theme/src/styles/base.css'
const ROOT = new URL('../../../../', import.meta.url)
const OMIT = /(?:^|\/)(?:vendor|lib|dist|node_modules|test|tests|fixtures)\//
const MOTION_PROPERTY = /^(?:-webkit-)?(?:animation|transition)(?:-duration|-delay|-timing-function)?$/i
const MOTION_TOKEN = /^(?:--ds-transition-duration(?:-fast|-slow|-loop|-ambient)?|--ds-ease-(?:in-out|in|out|emphasized|pulse))$/
const TIME = /(?<![\w.-])[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?(ms|s)(?![\w-])/gi
const TIMING = /(?<![\w-])(?:ease(?:-in-out|-in|-out)?\b|step-(?:start|end)\b|(?:cubic-bezier|steps|linear)\s*\()/i
const LINEAR = /(?<![\w-])linear(?![\w-])/i
const CONSTANT_MOTION = /\b(?:spin|rotate|turn|progress|sweep|ds-transition-duration-loop)\b/i
const MOTION_FALLBACK = /var\(\s*(--[\w-]+)\s*,(?:[^()]|\([^()]*\))*\)/gi

/**
 * Collect literal CSS fragments without evaluating plugin code.
 * @param js - JavaScript source.
 * @returns CSS fragments with dynamic values left opaque.
 */
export function pluginStylesheets(js: string): string[] {
  const sheets: string[] = []
  function fragment(node: ts.Node): string | undefined {
    if (ts.isStringLiteralLike(node)) return node.text
    if (ts.isTemplateExpression(node)) {
      return node.head.text + node.templateSpans.map(span => `${fragment(span.expression) ?? '__dynamic__'}${span.literal.text}`).join('')
    }
    if (ts.isParenthesizedExpression(node)) return fragment(node.expression)
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = fragment(node.left)
      const right = fragment(node.right)
      if (left !== undefined || right !== undefined) return `${left ?? '__dynamic__'}${right ?? '__dynamic__'}`
    }
    return undefined
  }
  function visit(node: ts.Node): void {
    const css = fragment(node)
    if (css?.includes('{') && css.includes('}')) sheets.push(css)
    else ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile('client.js', js, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS))
  return sheets
}

/**
 * Enumerate app CSS, shipped package CSS, plugin CSS and plugin client strings.
 * @returns Repository-relative paths and the CSS found at each path.
 */
export function motionFiles(): { file: string; stylesheets: string[] }[] {
  const root = fileURLToPath(ROOT).replaceAll('\\', '/')
  const files = packageStylesheets().map(path => path.slice(root.length))
    .filter(file => /^packages\/[^/]+\/[^/]+\/src\//.test(file))
  for (const dir of ['apps/web', 'plugins']) {
    function walk(relative: string): void {
      for (const entry of readdirSync(new URL(`${relative}/`, ROOT), { withFileTypes: true })) {
        const file = `${relative}/${entry.name}`
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && !OMIT.test(`${file}/`)) walk(file)
        } else if (entry.isFile() && (file.endsWith('.css') || (dir === 'plugins' && /^client.*\.js$/.test(entry.name)))) {
          files.push(file)
        }
      }
    }
    walk(dir)
  }
  return files.filter(file => !OMIT.test(file)).sort().map((file) => {
    const source = readFileSync(new URL(file, ROOT), 'utf8')
    return { file, stylesheets: file.endsWith('.js') ? pluginStylesheets(source) : [source] }
  })
}

/**
 * Find explicit times and curves, including local aliases and custom-property fallbacks.
 * @param css - Stylesheet text.
 * @param allowThemeFallback - Whether theme `var()` fallbacks are permitted.
 * @param tokenOwner - Whether this is the stylesheet defining the shared tokens.
 * @returns Selectors and declarations that require a shared token or an exception.
 */
export function motionLiterals(css: string, allowThemeFallback = false, tokenOwner = false): { selector: string; declaration: string }[] {
  const found: { selector: string; declaration: string }[] = []
  const blocks: string[] = []
  const text = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  // Skip delimiters in quoted strings, functions, and attribute selectors. Keep the outer selector when a nested block ends.
  const syntax = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\\.|[()[\]{};]/gs
  let start = 0
  let depth = 0
  for (const match of text.matchAll(syntax)) {
    const [token] = match
    if (token === '(' || token === '[') depth++
    else if (token === ')' || token === ']') depth--
    else if (depth === 0 && (token === '{' || token === '}' || token === ';')) {
      const statement = text.slice(start, match.index).trim().replace(/\s+/g, ' ')
      start = match.index + 1
      if (token === '{') {
        blocks.push(statement)
        continue
      }
      const selector = blocks.at(-1)
      if (token === '}') blocks.pop()
      if (!selector || selector.startsWith('@')) continue
      const colon = statement.indexOf(':')
      if (colon < 0) continue
      const property = statement.slice(0, colon).trim()
      const raw = statement.slice(colon + 1).trim()
      const custom = property.startsWith('--')
      if (!custom && !MOTION_PROPERTY.test(property)) continue
      if (tokenOwner && selector === ':root' && MOTION_TOKEN.test(property)) continue
      const value = raw.replace(MOTION_FALLBACK, (call, name: string) =>
        allowThemeFallback && MOTION_TOKEN.test(name) ? ' ' : call)
      const time = Array.from(value.matchAll(TIME)).some(([literal, unit = '']) => Number(literal.slice(0, -unit.length)) !== 0)
      const curve = TIMING.test(value)
      const linear = !custom && value.replace(/(?<!var)\((?:[^()]|\([^()]*\))*\)/g, ' ').split(',')
        .some(part => LINEAR.test(part) && !CONSTANT_MOTION.test(part))
      if (time || curve || linear) found.push({ selector, declaration: `${property}: ${raw}` })
    }
  }
  return found
}
