/**
 * Seed the development profile with fake projects and chats, so the sidebar,
 * Projects, Artifacts and mentions have something realistic to show.
 *
 *   pnpm -C apps/desktop seed:dev             # 20 projects, 89 chats
 *   pnpm -C apps/desktop seed:dev --scale 25  # 25 times the projects, for stress passes
 *   pnpm -C apps/desktop seed:dev --reset     # drop what an earlier run seeded, then seed
 *
 * Only the development profile is written, and only while Jan Next Dev is
 * stopped: the app owns these files while it runs. Logs use the shipped JSONL
 * format, one Zstandard frame per write like the production writer; each chat
 * also gets the projection cache document the cold sidebar lists from.
 * Seeded project folders live beside the profile home, which is how a later
 * run recognises (and `--reset` removes) its own projects.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  eventLines, generationLogFilename, sessionDir, toHeaderLine,
} from '../../../packages/session/session-persistence-jsonl/src/format.ts'
import { compressZstdFrame } from '../../../packages/session/session-persistence-jsonl/src/zstd.ts'
import { workspaceDomainState, workspaceRecord } from '../../../packages/workspace/workspace/src/spec.ts'
import { SESSION_FORMAT_VERSION, SessionId, type SessionEvent, type SessionHeader } from '../../../packages/core/session/src/index.ts'

const HOME = resolve(dirname(fileURLToPath(import.meta.url)), '../.desktop-build/development/home')
const SEED_ROOT = resolve(HOME, '../seed-projects')
const WORKSPACE_FILE = join(HOME, 'storages/workspace.json')
const CACHE_DIR = join(HOME, 'storages/session_projcache/sessions')
const SESSIONS_ROOT = join(HOME, 'sessions')
const BASE_TIME = Date.UTC(2026, 10, 1)

type Color = 'gray' | 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'pink'
type Avatar = { kind: 'icon'; name: 'folder' | 'star' | 'globe' | 'code' | 'sparkle' | 'target' | 'layers' | 'image' }
  | { kind: 'emoji'; value: string }

/** The fixed projects: two long titles, one emoji avatar, and half without colour or avatar. */
const PROJECTS: readonly { slug: string; title: string; color?: Color; avatar?: Avatar }[] = [
  { slug: 'atlas-web', title: 'Atlas web app', color: 'blue', avatar: { kind: 'icon', name: 'globe' } },
  { slug: 'billing-service', title: 'Billing service' },
  { slug: 'mobile-onboarding', title: 'Mobile onboarding redesign for the spring launch campaign', color: 'pink', avatar: { kind: 'icon', name: 'sparkle' } },
  { slug: 'data-pipeline', title: 'Data pipeline' },
  { slug: 'garden-notes', title: 'Garden notes', color: 'green', avatar: { kind: 'emoji', value: '🌱' } },
  { slug: 'infra-terraform', title: 'infra-terraform' },
  { slug: 'design-system', title: 'Design system', color: 'purple', avatar: { kind: 'icon', name: 'layers' } },
  { slug: 'research-papers', title: 'Research papers' },
  { slug: 'customer-support-bot', title: 'Customer support bot', color: 'teal', avatar: { kind: 'icon', name: 'target' } },
  { slug: 'personal-site', title: 'Personal site' },
  { slug: 'ml-experiments', title: 'ML experiments', color: 'orange', avatar: { kind: 'icon', name: 'code' } },
  { slug: 'ios-widgets', title: 'iOS widgets' },
  { slug: 'quarterly-planning', title: 'Quarterly planning and roadmap review for the platform team', color: 'yellow', avatar: { kind: 'icon', name: 'star' } },
  { slug: 'game-jam', title: 'Game jam' },
  { slug: 'photo-library', title: 'Photo library', color: 'red', avatar: { kind: 'icon', name: 'image' } },
  { slug: 'cli-tools', title: 'CLI tools' },
  { slug: 'docs-site', title: 'Docs site', color: 'gray', avatar: { kind: 'icon', name: 'folder' } },
  { slug: 'recipe-app', title: 'Recipe app' },
  { slug: 'security-audit', title: 'Security audit', color: 'blue', avatar: { kind: 'icon', name: 'target' } },
  { slug: 'travel-planner', title: 'Travel planner' },
]

/** The fixed chats, cycled by index; a few titles run past 50 characters and some replies carry links. */
const CHATS: readonly { title: string; prompt: string; reply: string }[] = [
  { title: 'Fix flaky login test', prompt: 'The login test fails one run in ten. Why?', reply: 'The test clicks before the form hydrates. Wait for the submit button to be enabled first.' },
  { title: 'Explain the build pipeline', prompt: 'Walk me through how the build works.', reply: 'Sources compile with tsc, then tsdown bundles each package. See https://tsdown.dev/guide/ for the options.' },
  { title: 'Draft release notes for version 2.4 including every fixed regression', prompt: 'Draft release notes for 2.4.', reply: 'Highlights: faster startup, a new settings page, and nine regression fixes.' },
  { title: 'Rename the user table', prompt: 'How do I rename the users table safely?', reply: 'Add the new table, dual-write, backfill, switch reads, then drop the old one.' },
  { title: 'Compare charting libraries', prompt: 'Which charting library should we use?', reply: 'For simple dashboards use https://recharts.org; for heavy data try https://echarts.apache.org/en/index.html.' },
  { title: 'Summarise the meeting', prompt: 'Summarise today\'s planning meeting.', reply: 'The team agreed to ship search first and move export to next month.' },
  { title: 'Why is the bundle so large?', prompt: 'Our bundle is 4 MB. Why?', reply: 'Moment locales and an unused icon set make up most of it. Tree-shake both.' },
  { title: 'Write a cron expression', prompt: 'Every weekday at 9:30?', reply: '`30 9 * * 1-5`' },
  { title: 'Review the onboarding copy for tone, clarity and consistency with the brand voice', prompt: 'Review the onboarding copy.', reply: 'Shorten the second screen and use one verb per button.' },
  { title: 'Debug memory leak', prompt: 'Memory grows on every page change.', reply: 'A resize listener is added on mount and never removed. Return a cleanup from the effect.' },
  { title: 'Plan a three day trip', prompt: 'Plan three days in Lisbon.', reply: 'Day one Alfama, day two Belém, day three Sintra. Tickets: https://www.parquesdesintra.pt/en/' },
  { title: 'Translate the error messages', prompt: 'Translate the error messages to French.', reply: 'Done: « Une erreur est survenue », « Réessayer », « Fermer ».' },
  { title: 'Set up CI caching', prompt: 'CI takes 20 minutes. Can we cache?', reply: 'Cache the pnpm store keyed on the lockfile; see https://pnpm.io/continuous-integration.' },
  { title: 'Pick a database', prompt: 'Postgres or SQLite for this app?', reply: 'SQLite: one writer, local data, no server to run.' },
  { title: 'Refactor the settings page', prompt: 'The settings page is 1,200 lines.', reply: 'Split it per section and move form state into one hook per section.' },
  { title: 'Recipe for banana bread', prompt: 'A simple banana bread?', reply: 'Three bananas, 250 g flour, 100 g sugar, 80 g butter, one egg, 1 tsp soda; 60 minutes at 175 °C.' },
  { title: 'Explain OAuth PKCE', prompt: 'What does PKCE protect against?', reply: 'An intercepted authorization code is useless without the verifier. Spec: https://datatracker.ietf.org/doc/html/rfc7636' },
  { title: 'Name the new feature', prompt: 'Ideas for the sharing feature name?', reply: 'Spaces, Rooms, or Shelves. Spaces reads best in menus.' },
  { title: 'Accessibility audit of the checkout flow against WCAG 2.2 AA requirements', prompt: 'Audit checkout accessibility.', reply: 'Two inputs lack labels and the error text is not announced. Guide: https://www.w3.org/WAI/WCAG22/quickref/' },
  { title: 'Estimate the migration', prompt: 'How long to migrate to the new API?', reply: 'About two weeks: three days of mapping, a week of changes, two days of testing.' },
  { title: 'Write a SQL report', prompt: 'Monthly revenue by region?', reply: '`SELECT region, date_trunc(\'month\', paid_at), sum(amount) FROM invoices GROUP BY 1, 2`' },
  { title: 'Shorten the README', prompt: 'Make the README shorter.', reply: 'Keep install, a 10-line example, and links; move the rest to docs.' },
  { title: 'Choose an icon set', prompt: 'Which icon set fits our UI?', reply: 'Lucide matches the stroke weight: https://lucide.dev' },
  { title: 'Fix timezone bug', prompt: 'Dates show one day early for some users.', reply: 'The date is parsed as UTC midnight then shown in local time. Parse it as a local date.' },
  { title: 'Prepare interview questions', prompt: 'Questions for a frontend interview?', reply: 'Ask them to debug a slow list, explain a re-render, and review a small PR.' },
  { title: 'Compare hosting options', prompt: 'Where should we host the docs?', reply: 'GitHub Pages is free and enough: https://pages.github.com' },
  { title: 'Plan the garden beds for spring', prompt: 'What to plant in March?', reply: 'Peas, lettuce, radish and spinach can go in now.' },
  { title: 'Explain the flaky snapshot', prompt: 'Why does the snapshot change every run?', reply: 'It renders the current date. Freeze the clock in the test.' },
  { title: 'Draft a status update', prompt: 'Write this week\'s status update.', reply: 'Search shipped, export is in review, and the billing fix lands Monday.' },
  { title: 'Learn Rust ownership', prompt: 'Explain borrowing simply.', reply: 'One owner; many readers or one writer at a time. Book: https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html' },
]

/** Write a file through a temp file and a rename, so a reader never sees half of it. */
async function writeAtomic(path: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, content)
  await rename(temp, path)
}

/** The events of one closed turn: a prompt, a title, one step with the reply. */
function chatEvents(sessionId: string, createdAt: number, chat: (typeof CHATS)[number]): SessionEvent[] {
  const text = { type: 'text', text: chat.reply }
  const stream = [
    { type: 'chunk', time: createdAt + 4000, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
    { type: 'text-chunks', time0: createdAt + 4000, index: 0, dt: [], texts: [chat.reply] },
    { type: 'chunk', time: createdAt + 4000, chunk: { type: 'block-end', index: 0, block: text } },
    { type: 'chunk', time: createdAt + 4000, chunk: { type: 'finish', reason: { kind: 'stop' } } },
  ]
  const drafts = [
    { type: 'turn/start', data: { turn: 1 } },
    {
      type: 'user/message',
      data: { id: `${sessionId}-user`, role: 'user', content: [{ type: 'text', text: chat.prompt }], source: { kind: 'user' } },
      surfaceOp: 'append',
    },
    { type: 'session/title', data: { title: chat.title, messageSeqs: [], source: { kind: 'user' } } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    {
      type: 'assistant/message',
      data: {
        turn: 1, step: 1, stream,
        message: { id: `${sessionId}-reply`, role: 'assistant', content: [text], source: { kind: 'model', provider: 'seed', model: 'seed' } },
      },
      surfaceOp: 'append',
    },
    { type: 'step/end', data: { turn: 1, step: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  return drafts.map((draft, seq) => ({ ...draft, seq, time: createdAt + seq * 1000 }) as unknown as SessionEvent)
}

interface WorkspaceFile {
  unit: { name: string; version: number }
  global: { workspaceIds: string[]; archivedSessionIds?: string[]; pinnedSessionIds?: string[] } & Record<string, unknown>
  tables: { workspaces: Record<string, { path: string; sessionIds: string[] } & Record<string, unknown>> }
}

async function readWorkspaces(): Promise<WorkspaceFile> {
  try {
    return JSON.parse(await readFile(WORKSPACE_FILE, 'utf8')) as WorkspaceFile
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    console.error('seed-dev-profile: start Jan Next Dev once first, so the profile exists')
    process.exit(1)
  }
}

/** Remove every project an earlier run seeded, with its chats' logs and cache documents. */
async function removeSeeded(state: WorkspaceFile, seedRoot: string): Promise<void> {
  const seededIds = Object.entries(state.tables.workspaces).filter(([, record]) => record.path.startsWith(seedRoot)).map(([id]) => id)
  const sessions = new Set<string>()
  for (const id of seededIds) {
    const record = state.tables.workspaces[id]!
    for (const sessionId of record.sessionIds) {
      sessions.add(sessionId)
      await rm(sessionDir(SESSIONS_ROOT, record.path, SessionId(sessionId)), { recursive: true, force: true })
      await rm(join(CACHE_DIR, `${sessionId}.json`), { force: true })
    }
    await rm(dirname(sessionDir(SESSIONS_ROOT, record.path, SessionId('x'))), { recursive: true, force: true })
    delete state.tables.workspaces[id]
  }
  const dropped = new Set(seededIds)
  state.global.workspaceIds = state.global.workspaceIds.filter(id => !dropped.has(id))
  state.global.archivedSessionIds = (state.global.archivedSessionIds ?? []).filter(id => !sessions.has(id))
  state.global.pinnedSessionIds = (state.global.pinnedSessionIds ?? []).filter(id => !sessions.has(id))
  // The app drops chats it cannot read from a project's membership, so their cache documents are found by cwd too.
  for (const name of await readdir(CACHE_DIR).catch(() => [] as string[])) {
    if (!name.endsWith('.json')) continue
    const path = join(CACHE_DIR, name)
    const cwd = await readFile(path, 'utf8').then(
      text => (JSON.parse(text) as { record?: { identity?: { cwd?: unknown } } }).record?.identity?.cwd, () => undefined)
    if (typeof cwd === 'string' && cwd.startsWith(seedRoot)) await rm(path, { force: true })
  }
  await rm(SEED_ROOT, { recursive: true, force: true })
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const reset = args.includes('--reset')
  const scaleAt = args.indexOf('--scale')
  const scale = scaleAt === -1 ? 1 : Number(args[scaleAt + 1])
  if (!Number.isInteger(scale) || scale < 1) {
    console.error('seed-dev-profile: --scale takes a whole number of at least 1')
    process.exit(1)
  }
  if (process.env.JAN_HOME !== undefined && resolve(process.env.JAN_HOME) !== HOME) {
    console.error('seed-dev-profile: refusing to write outside the dev profile')
    process.exit(1)
  }
  const running = await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(500) }).then(() => true, () => false)
  if (running) {
    console.error('seed-dev-profile: stop Jan Next Dev first')
    process.exit(1)
  }

  const state = await readWorkspaces()
  await mkdir(SEED_ROOT, { recursive: true })
  const seedRoot = await realpath(SEED_ROOT)
  const existing = Object.values(state.tables.workspaces).filter(record => record.path.startsWith(seedRoot)).length
  if (existing > 0 && !reset) {
    console.log(`seed-dev-profile: already seeded (${existing} projects)`)
    return
  }
  if (reset) {
    await removeSeeded(state, seedRoot)
    await mkdir(SEED_ROOT, { recursive: true })
  }

  let chats = 0
  const now = new Date().toISOString()
  for (let i = 0; i < PROJECTS.length * scale; i++) {
    const base = PROJECTS[i % PROJECTS.length]!
    const round = Math.floor(i / PROJECTS.length)
    const slug = round === 0 ? base.slug : `${base.slug}-${round + 1}`
    const title = round === 0 ? base.title : `${base.title} ${round + 1}`
    const folder = join(seedRoot, slug)
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'README.md'), `# ${title}\n`)
    const sessionIds: string[] = []
    for (let j = 0; j < 2 + (i % 6); j++) {
      const chat = CHATS[(i * 7 + j) % CHATS.length]!
      const id = SessionId(`session-${randomUUID()}`)
      const createdAt = BASE_TIME + (i * 7 + j) * 3_600_000
      const header: SessionHeader = {
        version: SESSION_FORMAT_VERSION, id, createdAt, cwd: folder, isSeeded: false, delegationDepth: 0, agentPreset: 'standard',
      }
      // The header is its own frame, as the production writer lays it out: the listing decodes only that frame.
      const log = Buffer.concat([
        await compressZstdFrame(`${JSON.stringify(toHeaderLine(header))}\n`),
        await compressZstdFrame(`${eventLines(chatEvents(id, createdAt, chat))}\n`),
      ])
      await writeAtomic(join(sessionDir(SESSIONS_ROOT, folder, id), generationLogFilename(SESSION_FORMAT_VERSION, 'zstd')), log)
      await writeAtomic(join(CACHE_DIR, `${id}.json`), JSON.stringify({
        version: 7,
        record: {
          identity: { formatVersion: SESSION_FORMAT_VERSION, createdAt, cwd: folder, isSeeded: false, inheritedEventCount: 0 },
          rows: {
            title: { ver: 1, seq: 6, val: chat.title },
            sessionListMetadata: { ver: 1, seq: 6, val: { blank: false, lastPromptAt: createdAt + 1000 } },
          },
        },
      }))
      sessionIds.push(id)
      chats++
    }
    const workspaceId = randomUUID()
    const created = new Date(BASE_TIME + i * 7 * 3_600_000).toISOString()
    state.tables.workspaces[workspaceId] = workspaceRecord.parse({
      path: folder, title, ...base.color === undefined ? {} : { color: base.color },
      ...base.avatar === undefined ? {} : { avatar: base.avatar }, sessionIds, createdAt: created, updatedAt: now,
    })
    state.global.workspaceIds.push(workspaceId)
  }
  workspaceDomainState.parse(state.global)
  await writeAtomic(WORKSPACE_FILE, `${JSON.stringify(state, null, 2)}\n`)
  console.log(`seed-dev-profile: ${PROJECTS.length * scale} projects, ${chats} chats`)
}

await main()
