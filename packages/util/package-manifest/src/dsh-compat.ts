/** Package-name compatibility for plugins published against DeepSeek Harness. */
export function janPackageName(name: string): string {
  if (name === '@deepseek-ai/cordis' || name === '@deepseek-ai/cosmokit'
    || name === '@deepseek-ai/schemastery' || name.startsWith('@deepseek-ai/cordis-plugin-')) {
    return `@janhq/${name.slice('@deepseek-ai/'.length)}`
  }
  if (name.startsWith('@deepseek-ai/dsh-')) return `@janhq/jan-${name.slice('@deepseek-ai/dsh-'.length)}`
  return name
}

/** Preserve a package export subpath while translating its DSH package root. */
export function janSpecifier(specifier: string): string {
  if (!specifier.startsWith('@deepseek-ai/')) return specifier
  const start = specifier.indexOf('/', '@deepseek-ai/'.length)
  const root = start < 0 ? specifier : specifier.slice(0, start)
  const translated = janPackageName(root)
  return translated === root ? specifier : translated + (start < 0 ? '' : specifier.slice(start))
}

/** Prefer Jan declarations; accept the legacy declaration only when Jan has none. */
export function janDeclaration<T>(manifest: { jan?: T; dsh?: T }): T | undefined {
  return manifest.jan ?? manifest.dsh
}
