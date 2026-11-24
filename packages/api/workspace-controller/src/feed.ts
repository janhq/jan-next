/** Reconnect-safe Workspace baseline and increment producer. */

import type { Context } from '@janhq/cordis'
import { Deque } from '@janhq/jan-deque'
import type { DomainChanged } from '@janhq/jan-storage-domain'
import type { Workspace, WorkspaceRecord } from '@janhq/jan-workspace'
import {
  workspaceDomainState,
  workspaceRecord,
  WorkspaceId,
} from '@janhq/jan-workspace'
import type {
  WorkspaceBaseline,
  WorkspaceFollowFrame,
  WorkspaceView,
} from './types.ts'
import { githubOwnerOf } from './github-owner.ts'

/** The frames the feed produces: every follow frame except `replace`, which only access filtering sends. */
type WorkspaceFeedFrame = Exclude<WorkspaceFollowFrame, { readonly type: 'replace' }>

/**
 * Project one authoritative Workspace entity into its Remote value.
 * @param workspace - authoritative registry entity.
 * @param defaultId - identity of the registered default, if any.
 * @returns detached Workspace projection for Remote consumers.
 */
export function workspaceView(workspace: Workspace, defaultId: Workspace['id'] | undefined): Promise<WorkspaceView> {
  return withGithubOwner(projectWorkspace(workspace, defaultId))
}

function projectWorkspace(workspace: Workspace, defaultId: Workspace['id'] | undefined): WorkspaceView {
  return {
    workspaceId: workspace.id,
    ...(workspace.id === defaultId ? { isDefault: true } : {}),
    path: workspace.path,
    title: workspace.title,
    ...(workspace.color === undefined ? {} : { color: workspace.color }),
    ...(workspace.avatar === undefined ? {} : { avatar: { ...workspace.avatar } }),
    sessionIds: [...workspace.sessionIds],
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  }
}

function changedWorkspaceView(workspaceId: string, value: unknown, defaultId: Workspace['id'] | undefined): WorkspaceView {
  const record: WorkspaceRecord = workspaceRecord.parse(value)
  return {
    workspaceId: WorkspaceId(workspaceId),
    ...(workspaceId === defaultId ? { isDefault: true } : {}),
    path: record.path,
    title: record.title,
    ...(record.color === undefined ? {} : { color: record.color }),
    ...(record.avatar === undefined ? {} : { avatar: record.avatar }),
    sessionIds: [...record.sessionIds],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

async function withGithubOwner(workspace: WorkspaceView): Promise<WorkspaceView> {
  const githubOwner = await githubOwnerOf(workspace.path)
  return githubOwner === undefined ? workspace : { ...workspace, githubOwner }
}

/** Owns Workspace domain observation and all active follow generations. */
export class WorkspaceFeed {
  private readonly followers = new Set<WorkspaceFollower>()
  private knownIds: Set<string>
  private order: readonly string[]
  private archived: readonly string[]
  private pinned: readonly string[]
  private defaultId: WorkspaceId | undefined

  /** @param ctx - Host context containing the authoritative Workspace registry. */
  constructor(private readonly ctx: Context) {
    const baseline = ctx.workspaceRegistry.list()
    this.knownIds = new Set(baseline.map(workspace => String(workspace.id)))
    this.order = baseline.map(workspace => String(workspace.id))
    this.archived = ctx.workspaceRegistry.archivedSessionIds.map(String)
    this.pinned = ctx.workspaceRegistry.pinnedSessionIds.map(String)
    this.defaultId = ctx.workspaceRegistry.defaultWorkspace?.id
    ctx.on('domain/changed', (change: DomainChanged) => { this.changed(change) })
    ctx.effect(() => () => {
      for (const follower of this.followers) follower.close()
      this.followers.clear()
    }, 'workspace-controller.feed')
  }

  /**
   * Capture the current projection before enriching it with optional Git metadata.
   * @returns all active Workspaces plus archived and pinned Session identities.
   */
  async baseline(): Promise<WorkspaceBaseline> {
    const registry = this.ctx.workspaceRegistry
    const defaultId = registry.defaultWorkspace?.id
    const baseline = {
      items: registry.list().map(workspace => projectWorkspace(workspace, defaultId)),
      archivedSessionIds: [...registry.archivedSessionIds],
      pinnedSessionIds: [...registry.pinnedSessionIds],
    }
    return { ...baseline, items: await Promise.all(baseline.items.map(withGithubOwner)) }
  }

  /**
   * Open one generation beginning with a complete baseline.
   * @param signal - generation cancellation.
   * @returns baseline followed by ordered Workspace increments.
   */
  async *follow(signal: AbortSignal): AsyncIterable<WorkspaceFeedFrame> {
    signal.throwIfAborted()
    const follower = new WorkspaceFollower()
    this.followers.add(follower)
    try {
      yield { type: 'baseline', value: await this.baseline() }
      for await (const frame of follower.read(signal)) {
        yield frame.type === 'upsert' ? { ...frame, workspace: await withGithubOwner(frame.workspace) } : frame
      }
    } finally {
      this.followers.delete(follower)
      follower.close()
    }
  }

  private changed(change: DomainChanged): void {
    if (change.domain !== 'workspace') return
    if (change.table === '') {
      if (change.operation !== 'put') return
      const state = workspaceDomainState.parse(change.value)
      const nextOrder = state.workspaceIds.map(String)
      const orderChanged = !sameStrings(this.order, nextOrder)
      for (const id of state.workspaceIds) {
        if (this.knownIds.has(id) && (id === this.defaultId) === (id === state.defaultWorkspaceId)) continue
        const workspace = this.ctx.workspaceRegistry.get(id)
        if (workspace === undefined) {
          throw new Error(`committed Workspace registry references missing Workspace "${id}"`)
        }
        this.knownIds.add(id)
        this.publish({ type: 'upsert', workspace: projectWorkspace(workspace, state.defaultWorkspaceId) })
      }
      this.defaultId = state.defaultWorkspaceId
      this.order = nextOrder
      if (orderChanged) this.publish({ type: 'order', workspaceIds: [...state.workspaceIds] })
      const nextArchived = state.archivedSessionIds.map(String)
      if (!sameStrings(this.archived, nextArchived)) {
        this.archived = nextArchived
        this.publish({ type: 'archived', archivedSessionIds: [...state.archivedSessionIds] })
      }
      const nextPinned = state.pinnedSessionIds.map(String)
      if (!sameStrings(this.pinned, nextPinned)) {
        this.pinned = nextPinned
        this.publish({ type: 'pinned', pinnedSessionIds: [...state.pinnedSessionIds] })
      }
      return
    }
    if (change.table !== 'workspaces') return
    if (change.operation === 'deleted') {
      if (!this.knownIds.delete(change.key)) return
      this.publish({ type: 'remove', workspaceId: WorkspaceId(change.key) })
      return
    }
    if (!this.knownIds.has(change.key)) return
    this.publish({
      type: 'upsert',
      workspace: changedWorkspaceView(change.key, change.value, this.ctx.workspaceRegistry.defaultWorkspace?.id),
    })
  }

  private publish(frame: Exclude<WorkspaceFeedFrame, { readonly type: 'baseline' }>): void {
    for (const follower of this.followers) follower.push(frame)
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

class WorkspaceFollower {
  private readonly frames = new Deque<WorkspaceFeedFrame>()
  private waiting: (() => void) | undefined
  private closed = false

  push(frame: WorkspaceFeedFrame): void {
    /* v8 ignore next -- closed followers are removed before later publication can reach them. */
    if (this.closed) return
    this.frames.pushBack(frame)
    this.waiting?.()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.waiting?.()
  }

  async *read(signal: AbortSignal): AsyncIterable<WorkspaceFeedFrame> {
    while (!this.closed && !signal.aborted) {
      const frame = this.frames.popFront()
      if (frame !== undefined) {
        yield frame
        continue
      }
      await this.wait(signal)
    }
  }

  private wait(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const finish = (): void => {
        signal.removeEventListener('abort', finish)
        /* v8 ignore next -- one read owns the sole installed wait callback. */
        if (this.waiting === finish) this.waiting = undefined
        resolve()
      }
      this.waiting = finish
      signal.addEventListener('abort', finish, { once: true })
      /* v8 ignore next -- native signals and the private queue cannot change during this synchronous setup. */
      if (signal.aborted || this.closed || this.frames.size > 0) finish()
    })
  }
}
