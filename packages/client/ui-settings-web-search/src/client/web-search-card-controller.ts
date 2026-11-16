/**
 * The web search and fetch page's staged form over the `web` namespace, whose
 * `searchProvider` and `fetchProvider` the two provider menus write.
 *
 * A selection equal to the deployment's composed value clears the override
 * instead of storing a copy of it, and while the deployment composes no
 * provider for a capability its menu also offers automatic selection, which
 * clears the override. The menus offer the providers the Host reports through
 * `web/listProviders`, the local fetch provider first and the rest in
 * registration order, plus a selected id the Host no longer registers. A
 * failed read is reported on the page with a retry.
 */

import type { Context as ClientContext } from '@janhq/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@janhq/jan-api-remotes/client'
import type { WebProviderInfo, WebProviderList as ProviderList } from '@janhq/jan-web/types'
import { createSnapshotStore, type SnapshotStore } from '@janhq/jan-client-store'
import {
  SettingsFormModel, settingsTextField, type SettingsFormActions, type SettingsFormShell, type SettingsFormScope,
} from '@janhq/jan-client-ui-primitives'

/**
 * Namespace this page edits. Spelled here rather than imported: a client
 * package must not depend on a Host package.
 */
export const WEB_NS = 'web'

/** Provider ids the page names itself. */
export const PROVIDER_IDS = {
  localFetch: 'http',
} as const

/**
 * The providers each menu lists first, in this order, while the Host
 * registers them; the Host's own list stays in registration order.
 */
const MENU_ORDER = {
  search: [],
  fetch: [PROVIDER_IDS.localFetch],
} as const satisfies Record<keyof ProviderList, readonly string[]>

/** The web service's provider selection. */
export interface WebProviderSelection {
  /** Search provider id. */
  searchProvider?: string
  /** Fetch provider id. */
  fetchProvider?: string
}

/** One entry of a provider menu. */
export interface WebProviderOption {
  /** Provider id, written into the selection. */
  id: string
  /** Title the provider registered with, if any. */
  title?: string
  /** Description the provider registered with, if any; the page shows it under the menu while the provider is selected. */
  description?: WebProviderInfo['description']
  /** True for a selected id the Host does not currently register. */
  missing: boolean
}

/** What the Search section shows for its selected provider. */
export type WebSearchKind = 'plugin' | 'none'
/** What the Fetch section shows for its selected provider. */
export type WebFetchKind = 'local' | 'plugin' | 'none'

/** One provider section: its menu and the controls its selection shows. */
export interface WebProviderSectionState<K extends string> {
  /** Id of the selected provider, or the empty string when the selection names none. */
  selected: string
  /** Menu entries: the registered providers, plus a selected id that is not registered. */
  options: readonly WebProviderOption[]
  /** Which provider-specific controls the section shows. */
  kind: K
  /** Whether the menu offers automatic selection, because the deployment composes no provider for this capability. */
  auto: boolean
}

/** What the web search and fetch page renders. */
export interface WebSearchCardState extends SettingsFormShell {
  /** Invalid edits or failed saves that changing providers must keep visible. */
  selectionBlocked: boolean
  /**
   * Whether the latest provider list read failed. The menus keep the last list
   * read, or before any list arrives only the selected ids, so they may be
   * incomplete.
   */
  providersFailed: boolean
  /** The Search section. */
  search: WebProviderSectionState<WebSearchKind>
  /** The Fetch section. */
  fetch: WebProviderSectionState<WebFetchKind>
}

/** The registration-side face the page's slot entry injects. */
export interface WebSearchCardFace extends Pick<SettingsFormActions, 'save' | 'discard'> {
  hooks: {
    /** Page snapshot bound by the renderer as useWebSearchCard. */
    webSearchCard: SnapshotStore<WebSearchCardState>
  }
  /** Stage one provider selection; the empty id stages automatic selection. */
  selectProvider: (field: keyof WebProviderSelection, id: string) => void
  /** Re-read the registered providers after a failed read. */
  retryProviders: () => void
  /** Resolve a provider description to the active language. */
  resolveText: (text: NonNullable<WebProviderOption['description']>) => string
}

/** Settings scopes for the namespaces the page edits. */
export interface WebSearchCardScopes {
  /** The web service's provider selection. */
  web: SettingsFormScope<WebProviderSelection>
}

/** Bridges the settings scope and the provider lists onto the page. */
export class WebSearchCardController {
  private readonly selection: SettingsFormModel<WebProviderSelection>
  private readonly store: SnapshotStore<WebSearchCardState>
  private readonly unsubscribe: (() => void)[]
  private providers: ProviderList | undefined
  private providersFailed = false
  private providerReadSequence = 0
  private selectionServed = false
  private disposed = false

  /**
   * @param scopes - the bound settings scopes for the page's namespaces.
   * @param ctx - the page plugin's context, whose `remote.web` namespace lists the registered providers.
   */
  constructor(
    private readonly scopes: WebSearchCardScopes,
    private readonly ctx: ClientContext,
  ) {
    this.selection = new SettingsFormModel(scopes.web, [
      settingsTextField('searchProvider'), settingsTextField('fetchProvider'),
    ])
    this.selectionServed = this.selection.shell().available
    this.store = createSnapshotStore(this.projection())
    this.unsubscribe = [
      this.selection.bind(() => this.selection.shell()).subscribe(() => { this.publish() }),
      scopes.web.subscribe(() => {
        // The provider list comes from the web service; a Host that starts
        // serving it registers providers this page has not read.
        const served = this.selection.shell().available
        if (served && !this.selectionServed) this.refreshProviders()
        this.selectionServed = served
      }),
    ]
    this.refreshProviders()
  }

  private publish(): void {
    this.store.set(this.projection())
  }

  /** The provider id a selection field stages. */
  private selected(field: keyof WebProviderSelection): string {
    return this.selection.field(field).text
  }

  /**
   * Menu entries for one capability: the registered providers in
   * {@link MENU_ORDER}, then every other registered provider in Host order,
   * and the selected id when the Host does not register it. Before the list
   * arrives, the menu holds only the selected id.
   */
  private options(capability: keyof ProviderList, selected: string): WebProviderOption[] {
    const registered = this.providers?.[capability]
    if (registered === undefined) return selected === '' ? [] : [{ id: selected, missing: false }]
    const first: readonly string[] = MENU_ORDER[capability]
    const ordered = [
      ...first.flatMap(id => registered.filter(info => info.id === id)),
      ...registered.filter(info => !first.includes(info.id)),
    ]
    const options = ordered.map(info => ({
      id: info.id,
      ...info.title === undefined ? {} : { title: info.title },
      ...info.description === undefined ? {} : { description: info.description },
      missing: false,
    }))
    if (selected !== '' && !registered.some(info => info.id === selected)) options.push({ id: selected, missing: true })
    return options
  }

  /** Whether the Host reports `id` as registered, or has not answered yet. */
  private registered(capability: keyof ProviderList, id: string): boolean {
    return this.providers === undefined || this.providers[capability].some(info => info.id === id)
  }

  private searchKind(): WebSearchKind {
    const id = this.selected('searchProvider')
    if (id === '' || !this.registered('search', id)) return 'none'
    return this.providers === undefined ? 'none' : 'plugin'
  }

  private fetchKind(): WebFetchKind {
    const id = this.selected('fetchProvider')
    if (id === '' || !this.registered('fetch', id)) return 'none'
    if (id === PROVIDER_IDS.localFetch) return 'local'
    return this.providers === undefined ? 'none' : 'plugin'
  }

  private projection(): WebSearchCardState {
    const shell = this.selection.shell()
    const searchSelected = this.selected('searchProvider')
    const fetchSelected = this.selected('fetchProvider')
    const base = this.scopes.web.getSnapshot().base as WebProviderSelection | undefined
    return {
      ...shell,
      selectionBlocked: shell.invalid || shell.failed,
      providersFailed: this.providersFailed,
      search: {
        selected: searchSelected,
        options: this.options('search', searchSelected),
        kind: this.searchKind(),
        auto: base?.searchProvider === undefined,
      },
      fetch: {
        selected: fetchSelected,
        options: this.options('fetch', fetchSelected),
        kind: this.fetchKind(),
        auto: base?.fetchProvider === undefined,
      },
    }
  }

  /**
   * Re-read the registered providers. Only the latest read publishes; a failed
   * read keeps the previous list and marks the page's provider list as failed
   * until a later read succeeds.
   */
  refreshProviders(): void {
    void this.readProviders()
  }

  private async readProviders(): Promise<void> {
    if (this.disposed) return
    const sequence = ++this.providerReadSequence
    const response = await this.ctx.remote.web.listProviders()
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- dispose() can run during the await.
    if (this.disposed || sequence !== this.providerReadSequence) return
    if (response.ok) this.providers = response.value
    this.providersFailed = !response.ok
    this.publish()
  }

  /**
   * Build the face the page's slot registration injects.
   * @returns the page's snapshot and its form actions.
   */
  inject(): WebSearchCardFace {
    return {
      hooks: { webSearchCard: this.store },
      selectProvider: (field, id) => { this.select(field, id) },
      retryProviders: () => { this.refreshProviders() },
      resolveText: text => this.ctx.locale.resolveText(text),
      save: () => { void this.save() },
      discard: () => { this.selection.actions().discard() },
    }
  }

  /**
   * Stage one provider selection. Automatic selection and a target equal to
   * the composed value clear the override, so the deployment default keeps
   * applying.
   * @param field - the selection field.
   * @param id - the provider id to select, or the empty string for automatic selection.
   */
  private select(field: keyof WebProviderSelection, id: string): void {
    const composed = (this.scopes.web.getSnapshot().base as WebProviderSelection | undefined)?.[field]
    if (id === '' || composed === id) this.selection.actions().resetField(field)
    else this.selection.actions().edit(field, id)
  }

  /**
   * Save the staged selection.
   * @returns settlement after the write.
   */
  private async save(): Promise<void> {
    const state = this.projection()
    if (!state.available || state.invalid || state.saving || !state.dirty) return
    await this.selection.save()
  }

  /** Release subscriptions and prevent late answers from publishing. */
  dispose(): void {
    this.disposed = true
    for (const off of this.unsubscribe) off()
    this.selection.dispose()
  }
}
