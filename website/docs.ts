/**
 * Canonical publication manifest for the documentation website.
 *
 * Markdown stays in its owning repository tier. This manifest maps each
 * canonical source to one site route; pages within a section keep manifest order.
 */

/** Sidebar collection rendered for one top-level module. */
export type DocsSidebar = 'guide' | 'develop' | 'reference'

/** A page projected into the VitePress source tree. */
export interface DocsPage {
  /** Repository-relative canonical Markdown source. */
  source: string
  /** VitePress route, including the `.md` suffix. */
  route: string
  /** Navigation label shown in the sidebar. */
  label: string
  /** Sidebar collection that owns the page, or null for the home page. */
  sidebar: DocsSidebar | null
  /** Section label within the sidebar. */
  section: string
  /** Heading levels included in this page's VitePress outline. */
  outline?: number | readonly [number, number] | 'deep' | false
  /** Additional repository paths that resolve to this page. */
  sourceAliases?: string[]
}

type SectionPage = Omit<DocsPage, 'sidebar' | 'section'>

function sectionPages(sidebar: DocsSidebar, section: string, pages: readonly SectionPage[]): DocsPage[] {
  return pages.map(page => ({ ...page, sidebar, section }))
}

const home: DocsPage = {
  source: 'docs/user/index.md',
  route: 'index.md',
  label: 'Jan',
  sidebar: null,
  section: 'Home',
}

const guide = [
  ...sectionPages('guide', 'Guide', [
    { source: 'docs/user/guide/index.md', route: 'guide/quickstart.md', label: 'Use the Web UI', sourceAliases: ['docs/user/guide'] },
    { source: 'docs/user/guide/providers.md', route: 'guide/providers.md', label: 'Configure models' },
    { source: 'docs/user/guide/network-proxy.md', route: 'guide/network-proxy.md', label: 'Network proxy' },
    { source: 'docs/user/guide/public-deployments.md', route: 'guide/public-deployments.md', label: 'Public deployments' },
  ]),
  ...sectionPages('guide', 'SDK', [
    { source: 'docs/user/guide/python-sdk.md', route: 'guide/python-sdk.md', label: 'Python' },
  ]),
  ...sectionPages('guide', 'Automation', [
    { source: 'docs/user/guide/github-review.md', route: 'guide/github-review.md', label: 'GitHub review sessions' },
    { source: 'docs/user/guide/schedule.md', route: 'guide/schedule.md', label: 'Session reminders' },
  ]),
  ...sectionPages('guide', 'Integrations', [
    { source: 'docs/user/guide/mcp-memory.md', route: 'guide/mcp-memory.md', label: 'Memory MCP' },
    { source: 'docs/user/guide/plugin-market.md', route: 'guide/plugin-market.md', label: 'Plugin indexes' },
  ]),
]

const develop = [
  ...sectionPages('develop', 'Basics', [
    { source: 'docs/user/develop/basic/index.md', route: 'develop/basic/index.md', label: 'Your first Harness plugin', sourceAliases: ['docs/user/develop/basic'] },
    { source: 'docs/user/develop/basic/tool.md', route: 'develop/basic/tool.md', label: 'Build a tool' },
    { source: 'docs/user/develop/basic/config.md', route: 'develop/basic/config.md', label: 'Plugin configuration' },
    { source: 'docs/user/develop/basic/publish.md', route: 'develop/basic/publish.md', label: 'Package and install' },
  ]),
  ...sectionPages('develop', 'Framework', [
    { source: 'docs/user/develop/framework/index.md', route: 'develop/framework/index.md', label: 'Plugin lifecycle', sourceAliases: ['docs/user/develop/framework'] },
    { source: 'docs/user/develop/framework/service.md', route: 'develop/framework/service.md', label: 'Services and dependencies' },
    { source: 'docs/user/develop/framework/events.md', route: 'develop/framework/events.md', label: 'Event system' },
  ]),
  ...sectionPages('develop', 'Practice', [
    { source: 'docs/user/develop/practice/index.md', route: 'develop/practice/index.md', label: 'Capability layering', sourceAliases: ['docs/user/develop/practice'] },
    { source: 'docs/user/develop/practice/llm-adapter.md', route: 'develop/practice/llm-adapter.md', label: 'LLM adapter' },
    { source: 'docs/user/develop/practice/dynamic-cordis.md', route: 'develop/practice/dynamic-cordis.md', label: 'Persistent Harness plugins' },
  ]),
  ...sectionPages('develop', 'Cordis framework tutorial', ([
    ['index.md', 'Overview'],
    ['01-first-plugin.md', '1. Your first plugin'],
    ['02-lifecycle-and-effects.md', '2. Lifecycle and effects'],
    ['03-services.md', '3. Services'],
    ['04-events.md', '4. Events'],
    ['05-config.md', '5. Configuration'],
    ['06-composition-and-hmr.md', '6. Composition and HMR'],
    ['07-into-the-harness.md', '7. Into the harness'],
  ] as const).map(([file, label]) => ({
    source: `docs/cordis-tutorial/${file}`,
    route: `develop/cordis-tutorial/${file}`,
    label,
    ...(file === 'index.md' ? { sourceAliases: ['docs/cordis-tutorial'] } : {}),
  }))),
]

/**
 * Subsystem pages grouped by the concern they document. One flat list of every
 * subsystem pushed the rest of the reference sidebar below the fold.
 */
const subsystemGroups = [
  ['Overview', [
    ['README.md', 'Subsystems'],
  ]],
  ['Core and scopes', [
    ['core.md', 'Core'],
    ['scope.md', 'Scopes'],
  ]],
  ['Sessions and persistence', [
    ['session.md', 'Sessions'],
    ['session-query.md', 'Session query'],
    ['session-reference.md', 'Session references'],
    ['session-title.md', 'Session titles'],
    ['session-projection.md', 'Session projections'],
    ['persistence.md', 'Session persistence'],
    ['spill.md', 'Spill storage'],
    ['session-telemetry.md', 'SessionTelemetryBackend'],
  ]],
  ['Model and context', [
    ['llm-streaming.md', 'LLM streaming'],
    ['token-meter.md', 'Token metering'],
    ['system-prompt.md', 'System prompts'],
    ['compaction.md', 'Compaction'],
  ]],
  ['Execution and tools', [
    ['tools.md', 'Tools'],
    ['shell.md', 'Bash execution'],
    ['subprocess.md', 'Subprocesses'],
    ['terminal.md', 'PTY sessions'],
    ['jobs.md', 'Background jobs'],
    ['filesystem.md', 'Filesystem'],
    ['lsp.md', 'LSP navigation'],
    ['ptc-runtime.md', 'PTC runtime'],
    ['web.md', 'Web access'],
    ['skills.md', 'Skills'],
    ['workflow.md', 'Workflows'],
    ['subagent.md', 'Subagents'],
  ]],
  ['Policy and interaction', [
    ['approval.md', 'Approvals'],
    ['permission-presets.md', 'Permission presets'],
    ['sandbox.md', 'Sandboxing'],
    ['plan.md', 'Plan mode'],
    ['user-questions.md', 'User interaction'],
    ['commands.md', 'Human commands'],
    ['goal.md', 'Goals'],
    ['schedule.md', 'Scheduled reminders'],
  ]],
  ['Platform and access', [
    ['web-server.md', 'HTTP server'],
    ['web-client.md', 'Web Client architecture'],
    ['client-modules.md', 'Client modules'],
    ['slots.md', 'Client slots'],
    ['client-resources.md', 'Client resources'],
    ['sidebar-right.md', 'Right Sidebar'],
    ['conversation.md', 'Conversation assembly'],
    ['typert.md', 'Typert'],
    ['storage.md', 'Storage'],
    ['workspace.md', 'Workspaces'],
    ['settings.md', 'User settings'],
    ['credentials.md', 'User credentials'],
  ]],
] as const

const reference = [
  ...sectionPages('reference', 'Concepts', [
    { source: 'docs/architecture.md', route: 'reference/index.md', label: 'Architecture' },
    { source: 'docs/cordis-primer.md', route: 'reference/cordis-primer.md', label: 'Cordis primer' },
    { source: 'docs/capability-seams.md', route: 'reference/capability-seams.md', label: 'Capability services' },
    { source: 'docs/agent-lifecycle.md', route: 'reference/agent-lifecycle.md', label: 'Agent lifecycle' },
    { source: 'docs/tool-execution-pipeline.md', route: 'reference/tool-execution-pipeline.md', label: 'Tool execution' },
    { source: 'docs/api-gateway.md', route: 'reference/api-gateway.md', label: 'API Gateway' },
  ]),
  ...sectionPages('reference', 'Generated reference', [
    { source: 'docs/config-catalog.md', route: 'reference/config-catalog.md', label: 'Plugin configuration' },
    { source: 'docs/tool-catalog.md', route: 'reference/tool-catalog.md', label: 'Tool schemas' },
    { source: 'docs/persistence-catalog.md', route: 'reference/persistence-catalog.md', label: 'Persistence events', outline: 'deep' },
    { source: 'docs/experimental-persistence-catalog.md', route: 'reference/experimental-persistence-catalog.md', label: 'Experimental persistence' },
  ]),
  ...sectionPages('reference', 'Cordis Core API', ([
    ['context.md', 'Context'],
    ['events.md', 'Events'],
    ['fiber.md', 'Fiber'],
    ['registry.md', 'Plugin Registry'],
    ['service.md', 'Service'],
    ['inherited.md', 'Inherited surface'],
  ] as const).map(([file, label]) => ({ source: `docs/cordis-api/${file}`, route: `reference/cordis-api/${file}`, label }))),
  ...sectionPages('reference', 'Cookbook', ([
    ['adding-a-package.md', 'Adding a package'],
    ['adding-a-tool.md', 'Adding a tool'],
    ['adding-an-llm-adapter.md', 'Adding an LLM adapter'],
    ['adding-a-settings-card.md', 'Adding a settings page'],
    ['extension-cookbook.md', 'Extension patterns'],
  ] as const).map(([file, label]) => ({ source: `docs/cookbook/${file}`, route: `reference/cookbook/${file}`, label }))),
  ...subsystemGroups.flatMap(([section, files]) => sectionPages('reference', section, files.map(([file, label]) => ({
    source: `docs/subsystems/${file}`,
    route: file === 'README.md' ? 'reference/subsystems/index.md' : `reference/subsystems/${file}`,
    label,
    // Subsystem pages carry long third-level sections a two-level outline reaches.
    outline: [2, 3] as const,
    ...(file === 'README.md' ? { sourceAliases: ['docs/subsystems'] } : {}),
  })))),
]

/**
 * Sidebar collections in the order the site's navigation presents them. The
 * navigation bar and the llms.txt index both read this sequence, so a new
 * collection lands in both surfaces together.
 */
export const docsCollections = ['guide', 'develop', 'reference'] as const satisfies readonly DocsSidebar[]

/** A sidebar group, matched to pages by `label`. */
export interface DocsSection {
  /** Group heading, equal to the `section` field of every page it holds. */
  label: string
  /** Render the group collapsed until it holds the page being read. */
  collapsed?: boolean
}

/**
 * Every sidebar group, in render order.
 *
 * The subsystem groups collapse because together they outnumber the rest of the
 * reference sidebar; expanded, they push every other group below the fold.
 */
const sections: readonly DocsSection[] = [
  { label: 'Guide' }, { label: 'SDK' }, { label: 'Automation' }, { label: 'Integrations' },
  { label: 'Basics' }, { label: 'Framework' }, { label: 'Practice' }, { label: 'Cordis framework tutorial' },
  { label: 'Concepts' }, { label: 'Generated reference' }, { label: 'Cordis Core API' }, { label: 'Cookbook' },
  { label: 'Overview' },
  { label: 'Core and scopes', collapsed: true },
  { label: 'Sessions and persistence', collapsed: true },
  { label: 'Model and context', collapsed: true },
  { label: 'Execution and tools', collapsed: true },
  { label: 'Policy and interaction', collapsed: true },
  { label: 'Platform and access', collapsed: true },
]

/**
 * Placement and collapse behavior of one sidebar group.
 *
 * @param label - Section label carried by the pages in the group.
 * @returns The declared group, plus its zero-based render position.
 * @throws When no placement is declared for the label. Ranking by list
 *   membership alone would sort an undeclared group silently ahead of every
 *   declared one.
 */
export function sectionSpec(label: string): DocsSection & { index: number } {
  const section = sections.find(candidate => candidate.label === label)
  if (section === undefined) throw new Error(`Sidebar section "${label}" has no placement.`)
  return { ...section, index: sections.indexOf(section) }
}

/** Every canonical page published by the documentation website. */
export const docsPages: DocsPage[] = [home, ...guide, ...develop, ...reference]

/**
 * Pages of one sidebar collection, in the order the sidebar lists them.
 *
 * @param collection - Sidebar collection to read.
 * @returns The collection's pages, ordered by section placement then by manifest order.
 */
export function orderedPages(collection: DocsSidebar): DocsPage[] {
  return docsPages
    .filter(page => page.sidebar === collection)
    .sort((left, right) => sectionSpec(left.section).index - sectionSpec(right.section).index)
}

/**
 * Site-relative link for a published route.
 *
 * @param route - Manifest route, including its `.md` suffix.
 * @returns The link VitePress serves the route at.
 */
export function routeLink(route: string): string {
  return `/${route.replace(/(?:index)?\.md$/, '')}`
}

/**
 * Where a top-level navigation item lands.
 *
 * The target is derived rather than written down: a collection whose first page
 * is renamed or reordered would otherwise leave the navigation bar pointing at
 * a route the manifest no longer publishes.
 *
 * @param collection - Sidebar collection the item opens.
 * @returns Site-relative link of the collection's first page.
 * @throws When the collection publishes no page.
 */
export function landingLink(collection: DocsSidebar): string {
  const first = orderedPages(collection)[0]
  if (first === undefined) throw new Error(`Sidebar collection "${collection}" publishes no page.`)
  return routeLink(first.route)
}
