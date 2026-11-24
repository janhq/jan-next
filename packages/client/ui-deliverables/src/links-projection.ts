/**
 * Cross-Session index of the web links a chat's messages mention, so the
 * Artifacts library lists every chat's links from the Session list without
 * opening any history. A summary key: cold list rows carry it from the
 * persisted projection cache.
 *
 * This entry is its own always-mounted Host plugin, beside the presented-files
 * index, so a composition can drop it without losing native file opens.
 * @module @janhq/jan-client-ui-deliverables/links
 */
import { z } from 'zod'
import type { Context } from '@janhq/cordis'
import type { SessionEvent, SessionHeader, SessionLogOffset } from '@janhq/jan-session'
import type { ProjectionDefinition } from '@janhq/jan-session-projection'
import type { SharedLinkEntry } from './links.ts'

/** Links kept per Session, newest mentions; every Session list row carries them. */
export const MAX_SESSION_LINKS = 100
/** Characters of one text block read for links; a pasted log of megabytes is not scanned whole. */
const MAX_SCANNED_CHARS = 256 * 1024
const MAX_URL_LENGTH = 2048
const MAX_TITLE_LENGTH = 300

/** Host fold state: the fork-inherited prefix and the distinct links mentioned after it. */
export interface SharedLinksState {
  readonly inheritedEventCount: SessionLogOffset
  readonly links: SharedLinkEntry[]
}

const inheritedOffsetSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  .transform(value => value as SessionLogOffset)

const entrySchema = z.object({
  url: z.string(),
  title: z.string().exactOptional(),
  from: z.enum(['user', 'assistant']),
  seq: z.number().int().nonnegative(),
  time: z.number(),
}).strict()
const viewSchema = z.array(entrySchema)
const stateSchema = z.object({
  inheritedEventCount: inheritedOffsetSchema,
  links: viewSchema,
}).strict()

/** Code is quoted, not shared: fenced blocks and inline spans are skipped. */
const CODE = /(```|~~~)[\s\S]*?(?:\1|$)|`[^`\n]*`/g
/** `[text](url "title")` and `![alt](url)`; group 1 marks an image. */
const MARKDOWN_LINK = /(!?)\[([^\]\n]{0,500})\]\((https?:\/\/[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+"[^"\n]*")?\)/gi
const BARE_URL = /https?:\/\/[^\s<>"'`[\]{}|\\^]+/gi

/** One link candidate in the order the text mentions it. */
interface Mention {
  readonly url: string
  readonly title: string | undefined
}

/** Drop sentence punctuation and an unmatched closing parenthesis a bare URL picked up. */
function trimBare(raw: string): string {
  let url = raw.replace(/[.,;:!?*_~]+$/, '')
  while (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
    url = url.slice(0, -1).replace(/[.,;:!?*_~]+$/, '')
  }
  return url
}

/** The canonical spelling of an absolute web URL, or undefined for anything else. */
function canonical(raw: string): string | undefined {
  if (raw.length > MAX_URL_LENGTH) return undefined
  try {
    const url = new URL(raw)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '' ? url.href : undefined
  } catch {
    return undefined
  }
}

/**
 * Web links one text mentions, in order: Markdown links with their text, then
 * bare URLs. Images and code are not links someone shared.
 * @param text - message text.
 * @returns each valid mention, duplicates included.
 */
export function linkMentions(text: string): Mention[] {
  const prose = (text.length > MAX_SCANNED_CHARS ? text.slice(0, MAX_SCANNED_CHARS) : text)
    .replace(CODE, match => ' '.repeat(match.length))
  const found: { at: number; mention: Mention }[] = []
  const rest = prose.replace(MARKDOWN_LINK, (match, image: string, label: string, raw: string, at: number) => {
    const url = image === '' ? canonical(raw) : undefined
    if (url !== undefined) {
      const title = label.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LENGTH)
      found.push({ at, mention: { url, title: title === '' || canonical(title) !== undefined ? undefined : title } })
    }
    return ' '.repeat(match.length)
  })
  for (const match of rest.matchAll(BARE_URL)) {
    const url = canonical(trimBare(match[0]))
    if (url !== undefined) found.push({ at: match.index, mention: { url, title: undefined } })
  }
  return found.sort((a, b) => a.at - b.at).map(item => item.mention)
}

type MessageContent = SessionEvent<'user/message'>['data']['content']

function mentionsOf(content: MessageContent): Mention[] {
  const mentions: Mention[] = []
  for (const block of content) if (block.type === 'text') mentions.push(...linkMentions(block.text))
  return mentions
}

/**
 * Fold one message event into the distinct-link list. Only the person's own
 * messages and the assistant's replies count; context the app injects does
 * not. Events of a fork's inherited prefix belong to the parent's index.
 * @param state - the links mentioned so far.
 * @param event - the next committed Session event.
 * @returns the same state for any other event or a message without links.
 */
export function applySharedLinks(state: SharedLinksState, event: SessionEvent): SharedLinksState {
  if (event.seq < state.inheritedEventCount) return state
  let from: SharedLinkEntry['from']
  let mentions: Mention[]
  if (event.type === 'user/message') {
    if (event.data.source.kind !== 'user') return state
    from = 'user'
    mentions = mentionsOf(event.data.content)
  } else if (event.type === 'assistant/message') {
    from = 'assistant'
    mentions = mentionsOf(event.data.message.content)
  } else return state
  if (mentions.length === 0) return state
  const byUrl = new Map(state.links.map(link => [link.url, link]))
  for (const { url, title } of mentions) {
    const kept = title ?? byUrl.get(url)?.title
    byUrl.delete(url)
    byUrl.set(url, { url, ...kept === undefined ? {} : { title: kept }, from, seq: event.seq, time: event.time })
  }
  return { ...state, links: [...byUrl.values()].slice(-MAX_SESSION_LINKS) }
}

/** Shared links per Session; a summary key, so cold list rows carry it. */
export const sharedLinksProjectionDefinition = {
  key: 'sharedLinks',
  stateSchema,
  init: (_header: SessionHeader, inheritedEventCount: SessionLogOffset) => ({ inheritedEventCount, links: [] }),
  apply: applySharedLinks,
  stateVersion: 1,
  wire: { viewSchema, view: (state: SharedLinksState) => state.links },
} satisfies ProjectionDefinition<'sharedLinks', SharedLinksState>

/** The Session projection registry this plugin registers into. */
export const inject = ['sessionProjections']

/**
 * Register the shared-links projection on the Host.
 * @param ctx - host context carrying the Session projection registry.
 */
export async function apply(ctx: Context): Promise<void> {
  await ctx.sessionProjections.register(sharedLinksProjectionDefinition)
}
