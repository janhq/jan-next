/**
 * What a thread's agent did, read back from its messages: the latest todo
 * list, every file it changed (with DSH's per-hunk diffs) and the files it
 * created. All of it is in the persisted tool and data parts, so a reloaded
 * thread shows the same panel as a live one.
 */
import type { UIMessage } from 'ai'
import { z } from 'zod'
import { TodoItem, type DshToolOutput, type FileDiff } from '@/lib/dsh-protocol'

export type FileChange = {
  path: string
  /** Every hunk written to this path, oldest first. */
  diffs: FileDiff[]
  added: number
  removed: number
  /** The first write created the file (no earlier content). */
  created: boolean
}

export type ThreadActivity = {
  todos: TodoItem[] | null
  changes: FileChange[]
  /** Files the agent created, newest first: the thread's artifacts. */
  artifacts: string[]
  added: number
  removed: number
}

type ToolPart = {
  type: string
  state?: string
  input?: unknown
  output?: unknown
}

const split = (text: string | null) => (text ? text.split('\n') : [])

export type DiffLine = { kind: ' ' | '-' | '+'; text: string }

/**
 * A hunk's lines as a unified diff. DSH sends the old and new side with their
 * shared context, so the changed lines are what the sides do not have in
 * common (an LCS; hunks are a few dozen lines, so quadratic is fine).
 */
export function hunkLines(diff: FileDiff): DiffLine[] {
  const a = split(diff.oldText)
  const b = split(diff.newText)
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: ' ', text: a[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: '-', text: a[i++] })
    else out.push({ kind: '+', text: b[j++] })
  }
  while (i < a.length) out.push({ kind: '-', text: a[i++] })
  while (j < b.length) out.push({ kind: '+', text: b[j++] })
  return out
}

const pathOf = (input: unknown): string => {
  const value = (input as { file_path?: unknown; path?: unknown } | undefined) ?? {}
  if (typeof value.file_path === 'string') return value.file_path
  return typeof value.path === 'string' ? value.path : ''
}

const outputOf = (output: unknown): DshToolOutput | undefined =>
  output && typeof output === 'object' && 'content' in output
    ? (output as DshToolOutput)
    : undefined

/** `write` reports `Created file` for a new path (tool-fs `formatWriteOutput`). */
const isCreate = (output: DshToolOutput | undefined) =>
  !!output && /\bCreated file\b/.test(output.content)

export function threadActivity(messages: UIMessage[]): ThreadActivity {
  let todos: TodoItem[] | null = null
  const byPath = new Map<string, FileChange>()
  const created: string[] = []

  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const raw of message.parts) {
      const part = raw as ToolPart & { data?: unknown }
      if (part.type === 'data-todos') {
        todos = Array.isArray(part.data) ? (part.data as TodoItem[]) : todos
        continue
      }
      // Only the live stream carries data-todos; a reloaded thread keeps the
      // todo_write call itself, whose input is the same list.
      if (part.type === 'tool-todo_write') {
        const parsed = z.array(TodoItem).safeParse(
          (part.input as { todos?: unknown } | undefined)?.todos
        )
        if (parsed.success) todos = parsed.data
        continue
      }
      if (part.type !== 'tool-write' && part.type !== 'tool-edit') continue
      if (part.state !== 'output-available') continue
      const path = pathOf(part.input)
      if (!path) continue
      const output = outputOf(part.output)
      const createdNow = part.type === 'tool-write' && isCreate(output)
      // A new file has no `before`, so DSH sends no diff: its content is the addition.
      const content = (part.input as { content?: unknown } | undefined)?.content
      const diffs: FileDiff[] =
        output?.diffs ??
        (createdNow && typeof content === 'string'
          ? [{ path, oldText: null, newText: content }]
          : [])
      const entry = byPath.get(path) ?? {
        path,
        diffs: [],
        added: 0,
        removed: 0,
        created: createdNow,
      }
      for (const diff of diffs) {
        entry.diffs.push(diff)
        for (const line of hunkLines(diff)) {
          if (line.kind === '+') entry.added++
          else if (line.kind === '-') entry.removed++
        }
      }
      byPath.set(path, entry)
      if (createdNow && !created.includes(path)) created.unshift(path)
    }
  }

  const changes = [...byPath.values()]
  return {
    todos,
    changes,
    artifacts: created,
    added: changes.reduce((n, c) => n + c.added, 0),
    removed: changes.reduce((n, c) => n + c.removed, 0),
  }
}

/** Unified-diff text for one change, for the Shiki `diff` grammar. */
export function diffText(change: FileChange): string {
  return change.diffs
    .map((d) => ['@@', ...hunkLines(d).map((l) => l.kind + l.text)].join('\n'))
    .join('\n')
}
