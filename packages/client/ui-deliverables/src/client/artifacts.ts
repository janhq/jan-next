/**
 * Artifacts library model: every file any chat presented and every web link any
 * chat mentioned, derived from the Session list's `presentedFiles` and
 * `sharedLinks` projection values, so no history is opened to list them. Pure
 * derivation plus the small controller that reads what the list does not yet
 * carry (legacy Sessions) and whether each file still exists.
 */
import { classifyFileType } from '@janhq/jan-client-ui-primitives'
import { createSnapshotStore } from '@janhq/jan-client-store'
import type { SessionListState } from '@janhq/jan-api-session-controller/client'
import type { SessionId } from '@janhq/jan-session/types'
import type { PresentedFileEntry } from '@janhq/jan-tool-present/types'
import type { RemoteResult } from '@janhq/jan-typert-protocol'
import type { SharedLinkEntry } from '../links.ts'
import { basename } from '../presented.ts'

/** Kinds the library groups by, in display order. */
export const ARTIFACT_GROUPS = ['documents', 'spreadsheets', 'presentations', 'images', 'code', 'other'] as const

/** One kind of file the library groups by. */
export type ArtifactGroup = typeof ARTIFACT_GROUPS[number]

/** One presented file with the chat that presented it. */
export interface ArtifactRow {
  /** Stable across list refreshes: the declaring event's coordinates. */
  readonly key: string
  readonly sessionId: SessionId
  readonly chatTitle: string
  readonly path: string
  readonly name: string
  readonly description: string | undefined
  /** Coordinates the Host's file-open routes accept. */
  readonly seq: number
  readonly index: number
  /** Unix epoch milliseconds the file was presented. */
  readonly time: number
  readonly group: ArtifactGroup
}

/**
 * Group a file by extension.
 * @param path - file path or name.
 * @returns its library kind; unknown extensions, video, and audio are `other`.
 */
export function artifactGroup(path: string): ArtifactGroup {
  switch (classifyFileType(path)) {
    case 'word': case 'pdf': case 'markdown': return 'documents'
    case 'excel': return 'spreadsheets'
    case 'ppt': return 'presentations'
    case 'image': return 'images'
    case 'video': case 'other': return 'other'
    default: return 'code'
  }
}

/**
 * Key of one row's availability and open state across list refreshes.
 * @param sessionId - Session that produced the artifact.
 * @param seq - transcript entry sequence that presented it.
 * @param index - position of the file within that entry.
 * @returns a key stable across refreshes of the same list.
 */
export function artifactKey(sessionId: SessionId, seq: number, index: number): string {
  return `${sessionId}:${seq}:${index}`
}

/** Subagent Sessions are reached through their parent, not listed as chats. */
function isListedChat(summary: SessionListState['byId'][SessionId] | undefined): summary is NonNullable<typeof summary> {
  return summary !== undefined && summary.origin !== 'subagent' && summary.parentId === undefined
}

/** The presented files a list holds for one Session, or undefined while it holds none. */
function presentedOf(list: SessionListState, id: SessionId): readonly PresentedFileEntry[] | undefined {
  return list.projectionsBySession[id]?.values.presentedFiles ?? list.byId[id]?.projectionValues?.presentedFiles
}

/** The shared links a list holds for one Session, or undefined while it holds none. */
function linksOf(list: SessionListState, id: SessionId): readonly SharedLinkEntry[] | undefined {
  return list.projectionsBySession[id]?.values.sharedLinks ?? list.byId[id]?.projectionValues?.sharedLinks
}

/**
 * Every presented file of every listed chat, newest first.
 * @param list - the Session list snapshot.
 * @returns one row per distinct file per chat.
 */
export function artifactRows(list: SessionListState): ArtifactRow[] {
  const rows: ArtifactRow[] = []
  for (const id of list.ids) {
    const summary = list.byId[id]
    if (!isListedChat(summary)) continue
    for (const entry of presentedOf(list, id) ?? []) {
      rows.push({
        key: artifactKey(id, entry.seq, entry.index), sessionId: id, chatTitle: summary.displayTitle,
        path: entry.path, name: basename(entry.path), description: entry.description,
        seq: entry.seq, index: entry.index, time: entry.time, group: artifactGroup(entry.path),
      })
    }
  }
  return rows.sort((a, b) => b.time - a.time || b.seq - a.seq)
}

/** One web link with the chat that mentioned it. */
export interface LinkRow {
  /** Stable across list refreshes: the chat and the URL. */
  readonly key: string
  readonly sessionId: SessionId
  readonly chatTitle: string
  readonly url: string
  /** Link text from the chat, or the host name when it gave none. */
  readonly title: string
  /** Host name without a leading `www.`. */
  readonly site: string
  readonly from: SharedLinkEntry['from']
  /** Unix epoch milliseconds of the latest mention. */
  readonly time: number
}

/**
 * Every shared link of every listed chat, newest mention first.
 * @param list - the Session list snapshot.
 * @returns one row per distinct link per chat.
 */
export function linkRows(list: SessionListState): LinkRow[] {
  const rows: LinkRow[] = []
  for (const id of list.ids) {
    const summary = list.byId[id]
    if (!isListedChat(summary)) continue
    for (const entry of linksOf(list, id) ?? []) {
      const site = new URL(entry.url).hostname.replace(/^www\./, '')
      rows.push({
        key: `${id}\n${entry.url}`, sessionId: id, chatTitle: summary.displayTitle, url: entry.url,
        title: entry.title ?? site, site, from: entry.from, time: entry.time,
      })
    }
  }
  return rows.sort((a, b) => b.time - a.time)
}

/**
 * Keep the links matching a search.
 * @param rows - rows in display order.
 * @param query - free text matched against the URL, link text, and chat title.
 * @returns the matching rows in the same order.
 */
export function filterLinks(rows: readonly LinkRow[], query: string): LinkRow[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...rows]
  return rows.filter(row => row.url.toLowerCase().includes(needle) || row.title.toLowerCase().includes(needle)
    || row.chatTitle.toLowerCase().includes(needle))
}

/**
 * Chats whose Session list row carries no presented-files or shared-links value
 * yet: Sessions checkpointed before an index existed. Reading their projections
 * once fills both.
 * @param list - the Session list snapshot.
 * @returns ids not yet read, newest chat first.
 */
export function unindexedChats(list: SessionListState): SessionId[] {
  return list.ids.filter((id) => {
    const summary = list.byId[id]
    return isListedChat(summary) && !summary.blank && (presentedOf(list, id) === undefined || linksOf(list, id) === undefined)
      && (list.projectionsBySession[id]?.state ?? 'idle') === 'idle'
  })
}

/**
 * Keep the rows matching a search and a kind.
 * @param rows - rows in display order.
 * @param query - free text matched against file name, path, description, and chat title.
 * @param group - the kind to keep, or null for all.
 * @returns the matching rows in the same order.
 */
export function filterArtifacts(rows: readonly ArtifactRow[], query: string, group: ArtifactGroup | null): ArtifactRow[] {
  const needle = query.trim().toLowerCase()
  return rows.filter(row => (group === null || row.group === group)
    && (needle === '' || row.path.toLowerCase().includes(needle) || row.chatTitle.toLowerCase().includes(needle)
      || row.description?.toLowerCase().includes(needle) === true))
}

/** Whether a file was last seen on disk; absent until the first check settles. */
export type ArtifactAvailability = 'available' | 'missing'

/** Availability by {@link artifactKey}. */
export type ArtifactAvailabilityMap = Readonly<Record<string, ArtifactAvailability | undefined>>

/** Host reads the controller needs, supplied by the plugin. */
export interface ArtifactsSources {
  /** Stat one file through its Session's filesystem. */
  stat(sessionId: SessionId, path: string, signal: AbortSignal): Promise<RemoteResult<unknown>>
  /** Read a Session's projections without opening its conversation. */
  refreshProjections(sessionId: SessionId): Promise<void>
}

/** Sessions read at a time while filling legacy rows; each read folds one log on the Host. */
const HYDRATE_CONCURRENCY = 2

// A call, not a property read: TypeScript keeps `signal.aborted` narrowed to false across awaits.
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/** Reads what the Session list does not carry: unindexed chats, and whether each file still exists. */
export class ArtifactsController {
  /** Availability by {@link artifactKey}. */
  readonly availability = createSnapshotStore<ArtifactAvailabilityMap>({})
  /** Chats still being read for presented files. */
  readonly scanning = createSnapshotStore(0)
  /** Changes on each Host connection reset so visible files are checked again. */
  readonly resetGeneration = createSnapshotStore(0)
  private readonly requested = new Set<SessionId>()
  private readonly queue: SessionId[] = []
  private workers = 0
  private lifetime = new AbortController()

  constructor(private readonly sources: ArtifactsSources) {}

  /**
   * Read the projections of chats the list has no presented files for, newest first, a few at a time.
   * @param sessionIds - candidate chats; each is read at most once per connection.
   */
  hydrate(sessionIds: readonly SessionId[]): void {
    if (this.lifetime.signal.aborted) return
    for (const id of sessionIds) {
      if (this.requested.has(id)) continue
      this.requested.add(id)
      this.queue.push(id)
    }
    this.scanning.set(this.queue.length + this.workers)
    while (this.workers < HYDRATE_CONCURRENCY && this.queue.length > 0) {
      this.workers += 1
      void this.drain(this.lifetime.signal)
    }
  }

  private async drain(signal: AbortSignal): Promise<void> {
    try {
      while (!signal.aborted) {
        const id = this.queue.shift()
        if (id === undefined) break
        try {
          await this.sources.refreshProjections(id)
        } catch {
          // An unreadable chat contributes no files; the list stays usable.
        }
        if (!isAborted(signal)) this.scanning.set(this.queue.length + this.workers)
      }
    } finally {
      if (!signal.aborted) {
        this.workers -= 1
        this.scanning.set(this.queue.length + this.workers)
      }
    }
  }

  /**
   * Record whether a file is still on disk. A transport failure records nothing,
   * so an unknown file stays actionable rather than reading as deleted.
   * @param row - the file to check.
   * @returns after the check settles.
   */
  async check(row: Pick<ArtifactRow, 'key' | 'sessionId' | 'path'>): Promise<void> {
    const { signal } = this.lifetime
    let next: ArtifactAvailability | undefined
    try {
      const result = await this.sources.stat(row.sessionId, row.path, signal)
      if (result.ok) next = 'available'
      else if (result.error.code === 'workspace-file/not-found' || result.error.code === 'workspace-file/not-regular-file') next = 'missing'
    } catch {
      next = undefined
    }
    if (signal.aborted || next === undefined || this.availability.getSnapshot()[row.key] === next) return
    this.availability.set({ ...this.availability.getSnapshot(), [row.key]: next })
  }

  /** Forget everything read from the previous Host connection. */
  reset(): void {
    this.lifetime.abort()
    this.lifetime = new AbortController()
    this.requested.clear()
    this.queue.length = 0
    this.workers = 0
    this.scanning.set(0)
    this.availability.set({})
    this.resetGeneration.set(this.resetGeneration.getSnapshot() + 1)
  }

  /** Stop reading; outstanding results are dropped. */
  dispose(): void {
    this.lifetime.abort()
    this.queue.length = 0
  }
}
