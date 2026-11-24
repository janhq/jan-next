/** Edit stored settings at one scope without changing the values inherited from wider scopes. */
import { useId, useRef, useState } from 'react'
import type { ModelProviderGroup } from '@janhq/jan-api-session-controller/types'
import { requiresCodingTools } from '@janhq/jan-agent-preset-registry/display'
import type { AgentPresetRow } from '@janhq/jan-agent-preset-registry/types'
import { Button, Checkbox, IconChevronDownOutlineRegular, IconLoadingOutlineRegular, Modal, SelectMenu } from '@janhq/jan-client-ui-primitives'
import type { PropsLocale, PropsRuntime, SnapshotSelectorHook } from '@janhq/jan-client-ui-slots'
import {
  MCP_SERVER_PREFIX, type InheritedOff, type ScopeAddress, type ScopedModel, type ScopedSkillCatalog, type ScopedSkillFolder,
  type ScopedToolCatalog, type ScopedValues, type ScopedWriteRequest,
} from '../types.ts'
import css from './ScopedSettings.module.css'

type Locale = PropsLocale<'scopedSettings'>
type DialogAddress = ScopeAddress & { readonly title?: string }
type Ready = {
  readonly status: 'ready'
  readonly values: ScopedValues
  readonly catalog: ScopedToolCatalog
  readonly skillCatalog: ScopedSkillCatalog
  readonly models: readonly ModelProviderGroup[]
  readonly modes: readonly AgentPresetRow[]
  readonly agents: readonly string[]
  /** Whether the Coding Tools preference offers the presets that require it, as in the composer's mode picker. */
  readonly codingTools: boolean
}
type DialogState = Ready | { readonly status: 'loading' | 'failed' }

/** Snapshot for one editor opening and its resource load. */
export interface ScopedDialogRequest {
  readonly address: DialogAddress
  readonly state: DialogState
}

/** Inputs owned by one dialog opening. */
export interface ScopedSettingsDialogProps extends DialogAddress, Locale {
  readonly state: DialogState
  readonly write: (request: ScopedWriteRequest) => Promise<void>
  readonly close: () => void
  readonly retry: () => void
  readonly presetName: (preset: AgentPresetRow) => string
}

type ScopedSettingsOverlayProps = PropsRuntime<'shell.overlay'> & Locale & {
  readonly useRequest: SnapshotSelectorHook<ScopedDialogRequest | null>
  readonly write: ScopedSettingsDialogProps['write']
  readonly close: (address: DialogAddress) => void
  readonly retry: (address: DialogAddress) => void
  readonly presetName: ScopedSettingsDialogProps['presetName']
}

/**
 * Render the captured target, independently of the surface that opened it.
 * @param props - snapshot hook, mutations and locale.
 * @returns the dialog or nothing when closed.
 */
export function ScopedSettingsOverlay({ useRequest, write, close, retry, presetName, t }: ScopedSettingsOverlayProps) {
  const request = useRequest(value => value)
  if (request === null) return null
  const { address, state } = request
  return <ScopedSettingsDialog key={JSON.stringify([address.scope, address.id])} {...address} state={state} write={write}
    close={() => { close(address) }} retry={() => { retry(address) }} presetName={presetName} t={t} />
}

/**
 * Render the scope's current values and stage edits until Save.
 * @param props - captured scope, load state and save action.
 * @returns the scoped editor with recovery for failed reads and writes.
 */
export function ScopedSettingsDialog({ scope, id, title, state, write, close, retry, presetName, t }: ScopedSettingsDialogProps) {
  const formId = useId()
  const submitting = useRef(false)
  const [saving, setSaving] = useState(false)
  const dismiss = () => { if (!submitting.current) close() }
  const save = async (values: ScopedWriteRequest['values']) => {
    if (submitting.current) return
    if (Object.keys(values).length === 0) { close(); return }
    submitting.current = true
    setSaving(true)
    try {
      await write({ scope, ...id === undefined ? {} : { id }, values })
      close()
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }
  const heading = scope === 'project' ? (title === undefined ? t('project.settings') : t('project.title', { title }))
    : scope === 'session' ? t('session.title') : t('global.title')
  return <Modal open title={heading} closeLabel={t('close')} onClose={dismiss} className={css.dialog ?? ''}
    contentClassName={css.content ?? ''} footer={<>
      <Button variant="outline" disabled={saving} onClick={dismiss}>{t('cancel')}</Button>
      <Button variant="primary" type="submit" form={formId} disabled={saving || state.status !== 'ready'}>{t('save')}</Button>
    </>}>
    {state.status === 'loading' && <div className={css.loading} role="status" aria-label={t('loading')}>
      <IconLoadingOutlineRegular size={18} aria-hidden="true" />
    </div>}
    {state.status === 'failed' && <div className={css.form}>
      <p className={css.notice} role="alert">{t('load.error')}</p>
      <Button variant="outline" onClick={retry}>{t('retry')}</Button>
    </div>}
    {state.status === 'ready' && <SettingsForm initial={state} scope={scope} formId={formId} saving={saving} save={save}
      presetName={presetName} t={t} />}
  </Modal>
}

function modelKey(model: ScopedModel): string {
  return JSON.stringify([model.provider, model.model])
}

function sameModel(left: ScopedModel | undefined, right: ScopedModel | undefined): boolean {
  return left?.provider === right?.provider && left?.model === right?.model && left?.reasoningEffort === right?.reasoningEffort
}

function updateSwitch(previous: ReadonlySet<string>, name: string, enabled: boolean): Set<string> {
  const next = new Set(previous)
  if (enabled) next.delete(name)
  else next.add(name)
  return next
}

function changedSwitches(stored: readonly string[] | undefined, draft: ReadonlySet<string>): string[] | null | undefined {
  const original = new Set(stored)
  if (original.size === draft.size && [...original].every(value => draft.has(value))) return undefined
  return draft.size === 0 ? null : [...draft].sort()
}

function SettingsForm({ initial, scope, formId, saving, save, presetName, t }: Locale & {
  initial: Ready
  scope: ScopeAddress['scope']
  formId: string
  saving: boolean
  save: (values: ScopedWriteRequest['values']) => Promise<void>
  presetName: ScopedSettingsDialogProps['presetName']
}) {
  const [original] = useState(() => initial.values)
  const [model, setModel] = useState(original.model)
  const [mode, setMode] = useState(original.mode ?? '')
  const [agent, setAgent] = useState(original.agent ?? '')
  const [tools, setTools] = useState(() => new Set(original.toolsDisabled))
  const [skills, setSkills] = useState(() => new Set(original.skillsDisabled))
  const [folders, setFolders] = useState(() => new Set(original.skillFoldersDisabled))
  const [failed, setFailed] = useState(false)
  const names = initial.catalog.tools
  const servers = initial.catalog.mcpServers
  const toolChoice = (name: string, label: string) => <Checkbox key={name} label={label} checked={!tools.has(name)} disabled={saving}
    onChange={(checked) => { setTools(previous => updateSwitch(previous, name, checked)) }} />
  return <form id={formId} className={css.form} onSubmit={(event) => {
    event.preventDefault()
    setFailed(false)
    const toolsDisabled = changedSwitches(original.toolsDisabled, tools)
    const skillsDisabled = changedSwitches(original.skillsDisabled, skills)
    const skillFoldersDisabled = changedSwitches(original.skillFoldersDisabled, folders)
    void save({
      ...scope === 'project' && !sameModel(model, original.model) ? { model: model ?? null } : {},
      ...scope === 'project' && mode !== (original.mode ?? '') ? { mode: mode || null } : {},
      ...scope === 'project' && agent !== (original.agent ?? '') ? { agent: agent || null } : {},
      ...toolsDisabled === undefined ? {} : { toolsDisabled },
      ...skillsDisabled === undefined ? {} : { skillsDisabled },
      ...skillFoldersDisabled === undefined ? {} : { skillFoldersDisabled },
    }).catch(() => { setFailed(true) })
  }}>
    {scope === 'project' && <>
      <ModelFields groups={initial.models} model={model} setModel={setModel} saving={saving} t={t} />
      <ModeField modes={initial.modes} codingTools={initial.codingTools} mode={mode} setMode={setMode} saving={saving}
        presetName={presetName} t={t} />
      <div className={css.field}>
        <span>{t('agent.label')}</span>
        <SelectMenu align="start" label={t('agent.label')} value={agent} disabled={saving} onChange={setAgent}
          placeholder={agent !== '' && !initial.agents.includes(agent) ? t('choice.unavailable', { name: agent }) : undefined}
          options={[{ id: '', label: t('agent.none') }, ...initial.agents.map(id => ({ id, label: id }))]} />
      </div>
    </>}
    <fieldset className={css.switches}>
      <legend>{t('tools.label')}</legend>
      {scope !== 'global' && <p className={css.hint}>{t('tools.inherited')}</p>}
      {names.length + servers.length === 0 ? <p className={css.hint}>{t('tools.empty')}</p>
        : <div className={css.choices}>
          {names.map(name => toolChoice(name, name))}
          {servers.map(name => toolChoice(`${MCP_SERVER_PREFIX}${name}`, t('tools.mcp', { name })))}
        </div>}
    </fieldset>
    <fieldset className={css.switches}>
      <legend>{t('skills.label')}</legend>
      {initial.skillCatalog.folders.length === 0 ? <p className={css.hint}>{t('skills.empty')}</p>
        : <div className={css.choices}>
          {initial.skillCatalog.folders.map(folder => <SkillFolder key={folder.path} folder={folder} disabledSkills={skills}
            folderOff={folder.path !== null && folders.has(folder.path)} saving={saving} t={t}
            onSkillChange={(name, checked) => { setSkills(previous => updateSwitch(previous, name, checked)) }}
            onFolderChange={(path, checked) => { setFolders(previous => updateSwitch(previous, path, checked)) }} />)}
        </div>}
    </fieldset>
    {failed && <p className={css.notice} role="alert">{t('save.error')}</p>}
  </form>
}

function SkillFolder({ folder, disabledSkills, folderOff, saving, onSkillChange, onFolderChange, t }: Locale & {
  folder: ScopedSkillFolder
  disabledSkills: ReadonlySet<string>
  folderOff: boolean
  saving: boolean
  onSkillChange: (name: string, checked: boolean) => void
  onFolderChange: (path: string, checked: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const { path, offAt } = folder
  const label = folder.label ?? t('skills.builtIn')
  const off = folderOff || offAt !== undefined
  const active = off ? 0 : folder.skills.filter(skill => skill.offAt === undefined && !disabledSkills.has(skill.name)).length
  const reason = (at: InheritedOff | undefined) => at === undefined ? undefined : t(`skills.off.${at}`)
  return <div>
    <div className={css.folderRow}>
      <div className={css.switchLabel}>
        {path === null ? <span>{label}</span> : <Checkbox label={label} title={reason(offAt)} checked={!off}
          disabled={saving || offAt !== undefined} onChange={(checked) => { onFolderChange(path, checked) }} />}
        {offAt !== undefined && <span className={css.choiceDetail}>{reason(offAt)}</span>}
      </div>
      <Button size="sm" className={css.folderExpand} aria-label={t('skills.folder', { name: label })}
        aria-describedby={`${id}-count`} aria-controls={id} aria-expanded={open}
        onClick={(event) => { event.currentTarget.focus(); setOpen(value => !value) }}>
        <span id={`${id}-count`}>{t('skills.count', { active, total: folder.skills.length })}</span>
        <IconChevronDownOutlineRegular className={css.folderChevron} size={12} aria-hidden="true" />
      </Button>
    </div>
    <div id={id} className={css.folderBody} data-open={open || undefined} {...{ inert: open ? undefined : '' }} aria-hidden={!open}>
      <div className={css.folderClip}>
        <div className={css.skillChoices}>
          {folder.skills.map((skill) => {
            const inherited = skill.offAt ?? offAt
            return <div className={css.switchLabel} key={skill.name}>
              <Checkbox label={skill.name} title={reason(inherited)}
                checked={!off && inherited === undefined && !disabledSkills.has(skill.name)}
                disabled={saving || off || inherited !== undefined} onChange={(checked) => { onSkillChange(skill.name, checked) }} />
              {inherited !== undefined && <span className={css.choiceDetail}>{reason(inherited)}</span>}
              {skill.description !== '' && <span className={css.choiceDetail}>{skill.description}</span>}
            </div>
          })}
        </div>
      </div>
    </div>
  </div>
}

function ModeField({ modes, codingTools, mode, setMode, saving, presetName, t }: Locale & {
  modes: readonly AgentPresetRow[]
  codingTools: boolean
  mode: string
  setMode: (mode: string) => void
  saving: boolean
  presetName: ScopedSettingsDialogProps['presetName']
}) {
  const offered = (row: AgentPresetRow) => row.showInModePicker !== false && (codingTools || !requiresCodingTools(row))
  const current = modes.find(row => row.id === mode)
  const unavailable = mode !== '' && (current === undefined || !offered(current))
  return <div className={css.field}>
    <span>{t('mode.label')}</span>
    <SelectMenu align="start" label={t('mode.label')} value={mode} disabled={saving} onChange={setMode}
      placeholder={unavailable ? t('choice.unavailable', { name: current === undefined ? mode : presetName(current) }) : undefined}
      options={[
        { id: '', label: t('inherit.global') },
        ...modes.filter(offered).map((row) => {
          const name = presetName(row)
          return { id: row.id, label: row.broken === undefined ? name : t('choice.unavailable', { name }),
            disabled: row.broken !== undefined }
        }),
      ]} />
  </div>
}

function ModelFields({ groups, model, setModel, saving, t }: Locale & {
  groups: readonly ModelProviderGroup[]
  model: ScopedModel | undefined
  setModel: (model: ScopedModel | undefined) => void
  saving: boolean
}) {
  const choices = groups.flatMap(group => group.models.map((row) => {
    const selection = { provider: group.id, model: row.id }
    return {
      id: modelKey(selection), label: t('model.route', { model: row.name, provider: group.name }), selection, reasoning: row.reasoning,
    }
  }))
  const id = model === undefined ? '' : modelKey(model)
  const selected = choices.find(choice => choice.id === id)
  const effort = model?.reasoningEffort ?? ''
  const efforts = selected?.reasoning?.efforts ?? []
  return <>
    <div className={css.field}>
      <span>{t('model.label')}</span>
      <SelectMenu align="start" label={t('model.label')} value={id} disabled={saving} options={[
        { id: '', label: t('inherit.global') }, ...choices,
        ...model !== undefined && selected === undefined ? [{ id, disabled: true, label: t('choice.unavailable', {
          name: t('model.route', { model: model.model, provider: model.provider }),
        }) }] : [],
      ]} onChange={(next) => { setModel(choices.find(choice => choice.id === next)?.selection) }} />
    </div>
    {model !== undefined && (effort !== '' || efforts.length > 0) && <div className={css.field}>
      <span>{t('model.effort')}</span>
      <SelectMenu align="start" label={t('model.effort')} value={effort} disabled={saving} options={[
        { id: '', label: t('inherit.model') }, ...efforts.map(row => ({ id: row.id, label: row.name })),
        ...effort !== '' && !efforts.some(row => row.id === effort)
          ? [{ id: effort, disabled: true, label: t('choice.unavailable', { name: effort }) }] : [],
      ]} onChange={(reasoningEffort) => { setModel({ provider: model.provider, model: model.model,
        ...reasoningEffort === '' ? {} : { reasoningEffort },
      }) }} />
    </div>}
  </>
}
