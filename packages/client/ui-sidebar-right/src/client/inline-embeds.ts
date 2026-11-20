/**
 * Tab bodies shown in place, outside the column: a caller lends a container
 * (a chat turn's tail, say) and the Session's right-Sidebar seat draws the tab
 * type that claims the address into it through a portal, so the body runs with
 * the same slot dispatch and hooks as in a pane. Only the highest-ranked embed
 * of a Session is drawn, which bounds live viewers (3D contexts, frames) to one.
 */
import type { TabId, TabRecord } from '@janhq/jan-client-ui-dockkit'
import type { SessionId } from '@janhq/jan-session/types'
import type { SidebarRightTabActions, SidebarRightTabNavigation } from './contract/slots.ts'
import type { SidebarRightOpenResourceOptions, SidebarRightOpenTabOptions } from './service.ts'
import type { SidebarRightTabDefinition, SidebarRightTabRegistry } from './tab-registry.ts'

/** One lent container and the tab drawn into it. */
export interface InlineEmbed {
  readonly sessionId: SessionId
  /** Higher ranks win; ties go to the embed added last. */
  readonly rank: number
  readonly serial: number
  readonly container: HTMLElement
  readonly tab: TabRecord
  readonly navigation: SidebarRightTabNavigation
  /** Aborted when the lender withdraws the container. */
  readonly signal: AbortSignal
  readonly actions: SidebarRightTabActions
}

/** What an inline body may ask of the column. */
export interface InlineNavigator {
  openResourceIn(sessionId: SessionId, address: string, options?: SidebarRightOpenResourceOptions): void
  openTabIn(sessionId: SessionId, kind: string, options?: SidebarRightOpenTabOptions): void
}

/**
 * Which viewer would draw an address in place.
 * @returns `dedicated` for a type made for the content, `fallback` for the generic file preview, or undefined when nothing claims it.
 */
export type InlineViewer = 'dedicated' | 'fallback' | undefined

/**
 * Page types that draw a file kind without claiming its address. Such a body
 * follows its Session (CAD shows the live model the turn's tools built), so it
 * stands in for a file it made when no dedicated type claims the file itself.
 */
const PAGE_FILES: readonly { readonly kind: string; readonly file: RegExp }[] = [
  { kind: 'cad', file: /\.(?:step|stp|stl|iges|igs|brep|3mf|obj|glb|gltf)$/i },
]

/** The live embeds of every Session, as one observable list. */
export class InlineEmbeds {
  private embeds: readonly InlineEmbed[] = []
  private readonly listeners = new Set<() => void>()
  private serial = 0

  /** Observable list for the seat. */
  readonly source = {
    subscribe: (listener: () => void): (() => void) => {
      this.listeners.add(listener)
      return () => { this.listeners.delete(listener) }
    },
    getSnapshot: (): readonly InlineEmbed[] => this.embeds,
  }

  constructor(private readonly tabs: SidebarRightTabRegistry, private readonly navigator: InlineNavigator) {}

  /**
   * Which viewer would draw an address.
   * @param address - a `jan-resource://` address.
   * @returns the claiming type's band as an inline viewer, or undefined.
   */
  viewer(address: string): InlineViewer {
    const definition = this.drawer(address)
    if (definition === undefined) return undefined
    return definition.priority === 'fallback' ? 'fallback' : 'dedicated'
  }

  /**
   * Draw the type claiming an address into a container.
   * @param sessionId - the Session whose seat draws it.
   * @param address - a `jan-resource://` address.
   * @param container - the element the body renders into.
   * @param rank - precedence among the Session's embeds.
   * @returns withdraws the embed; a no-op when nothing claims the address.
   */
  add(sessionId: SessionId, address: string, container: HTMLElement, rank: number): () => void {
    const definition = this.drawer(address)
    if (definition === undefined) return () => {}
    const controller = new AbortController()
    const serial = ++this.serial
    const { navigator } = this
    let withdraw = (): void => {}
    const embed: InlineEmbed = {
      sessionId,
      rank,
      serial,
      container,
      tab: { id: `inline:${serial}` as TabId, kind: definition.kind, contentId: address, title: definition.title(address) },
      navigation: { address, params: undefined, revision: 1 },
      signal: controller.signal,
      // A body's own opens land in the column: there is no pane here to place them in.
      actions: {
        bindCommands: () => () => {},
        openResource: (target, options = {}) => {
          navigator.openResourceIn(sessionId, target, {
            ...options.params === undefined ? {} : { params: options.params },
            ...options.destination === undefined ? {} : { destination: options.destination },
          })
        },
        openTab: (kind, options = {}) => {
          navigator.openTabIn(sessionId, kind, options.params === undefined ? {} : { params: options.params })
        },
        close: () => { withdraw() },
      },
    }
    withdraw = () => {
      if (!this.embeds.includes(embed)) return
      controller.abort()
      this.embeds = this.embeds.filter(entry => entry !== embed)
      this.notify()
    }
    this.embeds = [...this.embeds, embed]
    this.notify()
    return withdraw
  }

  /** A dedicated claimant, else a registered page type that draws the file, else the fallback preview. */
  private drawer(address: string): SidebarRightTabDefinition | undefined {
    const [best] = this.tabs.candidates(address)
    if (best !== undefined && best.priority !== 'fallback') return best
    const path = address.replace(/[?#].*$/s, '')
    for (const { kind, file } of PAGE_FILES) {
      const page = file.test(path) ? this.tabs.get(kind) : undefined
      if (page !== undefined && (page.patterns ?? []).length === 0) return page
    }
    return best
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

/**
 * The one embed a Session draws.
 * @param embeds - every live embed.
 * @param sessionId - the Session on the seat.
 * @returns its highest-ranked, most recent embed, or undefined.
 */
export function drawnEmbed(embeds: readonly InlineEmbed[], sessionId: SessionId): InlineEmbed | undefined {
  let drawn: InlineEmbed | undefined
  for (const embed of embeds) {
    if (embed.sessionId !== sessionId) continue
    if (drawn === undefined || embed.rank > drawn.rank || (embed.rank === drawn.rank && embed.serial > drawn.serial)) drawn = embed
  }
  return drawn
}
