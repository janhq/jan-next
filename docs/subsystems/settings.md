# Plugin Configuration Forms

The [settings service](../../packages/settings/settings/README.md) projects volatile Config fields from active profile entries. The [configuration editor](../../packages/boot/config-editor/README.md) persists edits through Cordis patches. Business consumers read `.get()` on their own Config references.

## Identity and values

A form namespace is the local id of a uniquely addressed entry in the active profile. Multiple plugin instances have separate forms when their entry ids differ. Ordinary fields are excluded. Descriptors carry resolved values, inherited values, explicit profile overrides, and an optimistic revision.

## Edits

`update` merges submitted fields. `replace` resets live fields to inherited configuration before applying submitted fields. `mutate` addresses individual paths, preserving secrets absent from a client response. Every write validates the complete Config and refuses stale revisions before persistence.

`settings/document-updated` invalidates form descriptors after Loader configuration changes. It is a UI notification; consumers use `loader/volatile-update` only when they need to refresh registration facts.

## Scoped settings

`ctx.scopedSettings` adds project defaults and per-chat tool restrictions to the Web app composition. These preferences are independent of profile Config forms.

| Setting | Chat | Project | Global | Resolution |
|---|---|---|---|---|
| Model and reasoning effort | Model selection in the Session log | Project model selection | Jan's default model selection | Use the first selection from chat, project, then global. Reasoning effort belongs to that selection. |
| Mode | Agent preset selected for the chat | Default preset for new chats | Default preset for the effective model provider | A new chat uses the requested mode, else an available project preset, else the provider default. Jan records the project preset as an explicit choice, not a mode that follows model changes. |
| Tools and MCP servers | Chat disable list | Project disable list | Global disable list | Union of all three lists. A narrower scope cannot re-enable a tool disabled by a wider one. |

The Web app stores project defaults and all three tool disable lists in `$JAN_HOME/settings/scoped.json`, not in the repository. The Host serializes writes and atomically replaces the document with file mode `0600`. A missing file starts empty; an invalid document is renamed to `scoped.json.invalid-<timestamp>` and the Host starts empty with a warning. Chat model and mode stay in the Session log, and global model and mode defaults stay with their existing services.

The Typert Remote client exposes `ctx.remote.scopedSettings`:

- `read({ scope, id? })` returns only the values stored at one scope, without inheritance.
- `write({ scope, id?, values })` patches one scope and returns its stored values. Use `null` to remove a key or `[]` to clear `toolsDisabled`. A project or chat needs its ID; the global scope takes none. Only projects can store `model` or `mode` here.
- `toolCatalog()` returns `{ tools, mcpServers }`. Store an individual tool by name or a whole server as `mcp:<server>`; the restriction also covers tools the server registers later.

Plugins that register tools already participate through the per-agent tool restriction. A plugin that wants to scope another preference must define how its own per-chat consumer reads and resolves it; there is no generic scoped-key registration API. Host-wide plugin activation stays global. See the [decision record](../../.agents/notes/implemented/architecture/2026-11-24-scoped-settings.md) for the rationale.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`). Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxscopedsettings--scopedsettings"></a>

### `ctx.scopedSettings` — `ScopedSettings`

Stores project defaults for new chats and scoped tool and skill switches. Merges each live agent's profile limits with the tool switches and hides switched-off skills from every lookup.

```ts cordis-catalog
/**
 * Find the project a chat belongs to.
 * @param sessionId - the chat.
 * @param cwd - the chat's folder, for a chat the project list has not indexed yet.
 * @returns the project id, or undefined outside any project.
 */
projectOf(sessionId: SessionId, cwd?: string): WorkspaceId | undefined

/**
 * Find the project whose folder holds a path; the innermost one wins when projects nest.
 * @param path - absolute folder or file.
 * @returns the project id, or undefined outside every project folder.
 */
projectAt(path: string): WorkspaceId | undefined

/**
 * Model a chat starts on from its project. A model the chat picked itself is recorded in its log and wins.
 * @param sessionId - the chat.
 * @param workspaceHint - the project a chat being created joins.
 * @returns the project's model, or undefined to use the global default.
 */
resolveModel(sessionId: SessionId, workspaceHint?: WorkspaceId): ScopedModel | undefined

/**
 * Mode (agent preset) a new chat in a project starts in.
 * @param workspaceId - the project, or undefined outside any project.
 * @returns the project's mode while that preset exists, else undefined.
 */
async resolveMode(workspaceId: WorkspaceId | undefined): Promise<string | undefined>

/**
 * Default agent profile stored for a project's new chats.
 * @param workspaceId - the project, or undefined outside any project.
 * @returns the stored profile id, without checking whether the profile is still available.
 */
resolveAgent(workspaceId: WorkspaceId | undefined): string | undefined

/**
 * Tool switches in effect for a chat: any scope that switches a tool off switches it off for every narrower one.
 * @param sessionId - the chat.
 * @param cwd - the chat's folder, for a chat the project list has not indexed yet.
 * @returns sorted tool names and `mcp:<server>` entries.
 */
resolveToolsDisabled(sessionId: SessionId, cwd?: string): string[]

/**
 * List every skill a chat in one scope could load, grouped by folder, with that scope's switches and the
 * wider scopes' ones. A global listing reads the skill folders outside any project.
 * @param address - the scope and, for a project or chat, its id.
 * @returns folders with their skills.
 */
@Remote async skillCatalog(address: ScopeAddress): Promise<ScopedSkillCatalog>

/**
 * Read the values one scope stores, without inherited ones.
 * @param address - the scope and, for a project or chat, its id.
 * @returns the stored values; an empty object when the scope stores nothing.
 */
@Remote read(address: ScopeAddress): ScopedValues

/**
 * Replace or remove values of one scope.
 * @param request - the scope, its id, and the keys to set; `null` or an empty list returns a key to the wider scope.
 * @returns the values the scope stores after the write.
 */
@Remote async write(request: ScopedWriteRequest): Promise<ScopedValues>

/**
 * Switch one entry of one list off or back on, reading the list inside the write queue so
 * concurrent switches from the editor and the agent never drop each other.
 * @param address - the scope and, for a project or chat, its id.
 * @param key - the list.
 * @param entry - a tool name, `mcp:<server>`, skill name or absolute skill folder.
 * @param off - true adds the entry, false removes it.
 * @returns the values the scope stores after the write.
 */
@Remote async setSwitch(address: ScopeAddress, key: ScopeListKey, entry: string, off: boolean): Promise<ScopedValues>

/**
 * List what a scope can switch off.
 * @returns global tool names outside MCP and the MCP servers that registered tools.
 */
@Remote toolCatalog(): ScopedToolCatalog
```

Types: [SessionId](core.md) · [WorkspaceId](workspace.md)

Source: [`packages/settings/scoped-settings/src/index.ts`](../../packages/settings/scoped-settings/src/index.ts)

<a id="ctxsettings--settingsforms"></a>

### `ctx.settings` — `SettingsForms`

Project Config schemas into forms and own optional instance-level UI policy.

```ts cordis-catalog
/** Register the calling plugin instance's page policy without changing its Config.
 * @param presentation Automatic-page policy for this instance; `auto` defaults to true.
 * @param owner Plugin instance the policy belongs to; defaults to the calling fiber.
 * @returns Disposer; register it with the calling plugin's effects.
 * @throws If this instance already has a registered policy.
 */
configure(presentation: { auto?: boolean }, owner: Fiber = this.ctx.fiber): () => void

/** Locate the profile patch for native editing.
 * @returns The existing profile patch path.
 */
prepareDocument(): Promise<string>

/** Read active plugin schemas and their live values.
 * @param options Redaction required for remote callers.
 * @returns Forms keyed by unique profile entry ids.
 */
describe(options?: SettingsDescribeOptions): SettingsDescriptor[]

/** Merge editable fields into an entry's config.
 * @param ns Profile entry id.
 * @param patch Fields to merge.
 * @param expectedRevision Revision returned by describe.
 */
async update(ns: string, patch: object, expectedRevision?: number): Promise<void>

/** Reset all live fields, then set the supplied fields; ordinary config is preserved.
 * @param ns Profile entry id.
 * @param section Complete form values.
 * @param expectedRevision Revision returned by describe.
 */
async replace(ns: string, section: object, expectedRevision?: number): Promise<void>

/** Apply field edits without restating redacted secrets; unsetting an array index removes its element.
 * @param ns Profile entry id.
 * @param ops Ordered form edits.
 * @param expectedRevision Revision returned by describe.
 */
async mutate(ns: string, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void>
```

Source: [`packages/settings/settings/src/index.ts`](../../packages/settings/settings/src/index.ts)

<a id="ctxsettingscontroller--settingscontroller"></a>

### `ctx.settingsController` — `SettingsController`

Host service backing the generated `ctx.remote.settings` namespace. Every remote read uses `redactSecrets: true`, so a `role('secret')` field cannot ride a response. Writes expose the settings service's merge, replacement, and path-addressed operations, and classify every provider refusal as `settings/conflict` or `settings/rejected` with the service's message.

```ts cordis-catalog
/**
 * Describe every registered namespace for a configuration page: redacted
 * layered values plus the serialized schema the page renders its form from.
 * @returns provider writability, local-document presence, and one view per namespace.
 * @throws RemoteError when no settings provider is mounted.
 */
@Remote describe(): SettingsDescribeValue

/**
 * Merge a patch into one namespace's stored user section.
 * @param ns - namespace key to write.
 * @param patch - fields to merge into the user section.
 * @param expectedRevision - revision the caller read; `undefined` writes unconditionally.
 * @returns the namespace's redacted view after the write.
 * @throws RemoteError when the request is invalid, no provider is mounted, or the provider refuses the write.
 */
@Remote update( ns: string, patch: Record<string, JsonValue>, expectedRevision: number | undefined, ): Promise<SettingsNamespaceView>

/**
 * Replace one namespace's stored user section wholesale.
 * @param ns - namespace key to write.
 * @param section - complete replacement user section.
 * @param expectedRevision - revision the caller read; `undefined` writes unconditionally.
 * @returns the namespace's redacted view after the write.
 * @throws RemoteError when the request is invalid, no provider is mounted, or the provider refuses the write.
 */
@Remote replace( ns: string, section: Record<string, JsonValue>, expectedRevision: number | undefined, ): Promise<SettingsNamespaceView>

/**
 * Apply path-addressed edits to one namespace's user section, resolved against
 * the section as stored rather than against whatever the caller last read,
 * then answer with that namespace's new redacted view.
 * @param ns - namespace key to write.
 * @param ops - the edits to apply, in order.
 * @param expectedRevision - revision the caller read; `undefined` writes unconditionally.
 * @returns the namespace's redacted view after the write.
 * @throws RemoteError when the request is invalid, no provider is mounted, or the provider refuses the write.
 */
@Remote async mutate( ns: string, ops: SettingsPathOpView[], expectedRevision: number | undefined, ): Promise<SettingsNamespaceView>

/**
 * Materialize the provider-owned settings document and open it in a native text editor.
 * @param signal - caller lifetime; abort terminates preparation or the native command.
 * @returns confirmation after the native opener accepts the document.
 * @throws RemoteError when no document exists, preparation fails, or opening fails.
 */
@Remote async openSettingsDocument(signal: AbortSignal): Promise<SettingsDocumentOpenValue>
```

Source: [`packages/api/settings-controller/src/index.ts`](../../packages/api/settings-controller/src/index.ts)

<a id="scoped-settings-events"></a>

### `scoped-settings/*` events

<a id="scoped-settingschanged--emit"></a>

#### `scoped-settings/changed` — emit

One scope's stored values changed.

```ts cordis-catalog
/**
 * One scope's stored values changed.
 * @param address - the scope that was written.
 * @mode emit
 */
'scoped-settings/changed'(address: ScopeAddress): void
```

Source: [`packages/settings/scoped-settings/src/index.ts`](../../packages/settings/scoped-settings/src/index.ts)

<a id="settings-events"></a>

### `settings/*` events

<a id="settingsdocument-updated--emit"></a>

#### `settings/document-updated` — emit

One profile entry's form values, availability, or page policy changed. Form clients re-read its schema, resolved values, and revision.

```ts cordis-catalog
/**
 * One profile entry's form values, availability, or page policy changed.
 * Form clients re-read its schema, resolved values, and revision.
 * @param ns Profile entry id.
 * @param revision The entry's new revision.
 * @mode emit
 */
'settings/document-updated'(ns: SettingsNamespace, revision: number): void
```

Source: [`packages/settings/settings/src/types.ts`](../../packages/settings/settings/src/types.ts)
<!-- END GENERATED cordis-surface -->
