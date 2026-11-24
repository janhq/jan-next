/** Edit stored settings at one scope without changing the values inherited from wider scopes. */
import { useId, useRef, useState } from 'react'
import type { ModelProviderGroup } from '@janhq/jan-api-session-controller/types'
import type { AgentPresetRow } from '@janhq/jan-agent-preset-registry/types'
import { Button, Checkbox, IconLoadingOutlineRegular, Modal, SelectMenu } from '@janhq/jan-client-ui-primitives'
import type { PropsLocale, PropsRuntime, SnapshotSelectorHook } from '@janhq/jan-client-ui-slots'
import {
  MCP_SERVER_PREFIX, type ScopeAddress, type ScopedModel, type ScopedToolCatalog, type ScopedValues, type ScopedWriteRequest,
} from '../types.ts'
import css from './ScopedSettings.module.css'

type Locale = PropsLocale<'scopedSettings'>
type DialogAddress = ScopeAddress & { readonly title?: string }
type Ready = {
  readonly status: 'ready'
  readonly values: ScopedValues
  readonly catalog: ScopedToolCatalog
  readonly models: readonly ModelProviderGroup[]
  readonly modes: readonly AgentPresetRow[]
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
}

type ScopedSettingsOverlayProps = PropsRuntime<'shell.overlay'> & Locale & {
  readonly useRequest: SnapshotSelectorHook<ScopedDialogRequest | null>
  readonly write: ScopedSettingsDialogProps['write']
  readonly close: (address: DialogAddress) => void
  readonly retry: (address: DialogAddress) => void
}

/**
 * Render the captured target, independently of the surface that opened it.
 * @param props - snapshot hook, mutations and locale.
 * @returns the dialog or nothing when closed.
 */
export function ScopedSettingsOverlay({ useRequest, write, close, retry, t }: ScopedSettingsOverlayProps) {
  const request = useRequest(value => value)
  if (request === null) return null
  const { address, state } = request
  return <ScopedSettingsDialog key={JSON.stringify([address.scope, address.id])} {...address} state={state} write={write}
    close={() => { close(address) }} retry={() => { retry(address) }} t={t} />
}

/**
 * Render the scope's current values and stage edits until Save.
 * @param props - captured scope, load state and save action.
 * @returns the scoped editor with recovery for failed reads and writes.
 */
export function ScopedSettingsDialog({ scope, id, title, state, write, close, retry, t }: ScopedSettingsDialogProps) {
  const formId = useId()
  const submitting = useRef(false)
  const [saving, setSaving] = useState(false)
  const dismiss = () => { if (!submitting.current) close() }
  const save = async (values: ScopedWriteRequest['values']) => {
    if (submitting.current) return
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
    {state.status === 'ready' && <SettingsForm initial={state} scope={scope} formId={formId} saving={saving} save={save} t={t} />}
  </Modal>
}

function modelKey(model: ScopedModel): string {
  return JSON.stringify([model.provider, model.model])
}

function SettingsForm({ initial, scope, formId, saving, save, t }: Locale & {
  initial: Ready
  scope: ScopeAddress['scope']
  formId: string
  saving: boolean
  save: (values: ScopedWriteRequest['values']) => Promise<void>
}) {
  const [model, setModel] = useState(initial.values.model)
  const [mode, setMode] = useState(initial.values.mode ?? '')
  const [tools, setTools] = useState(() => new Set(initial.values.toolsDisabled))
  const [failed, setFailed] = useState(false)
  const names = initial.catalog.tools
  const servers = initial.catalog.mcpServers
  const toolChoice = (name: string, label: string) => <Checkbox key={name} label={label} checked={!tools.has(name)} disabled={saving}
    onChange={(checked) => {
      setTools((previous) => {
        const next = new Set(previous)
        if (checked) next.delete(name)
        else next.add(name)
        return next
      })
    }} />
  return <form id={formId} className={css.form} onSubmit={(event) => {
    event.preventDefault()
    setFailed(false)
    void save({ ...scope === 'project' ? { model: model ?? null, mode: mode || null } : {},
      toolsDisabled: tools.size === 0 ? null : [...tools].sort(),
    }).catch(() => { setFailed(true) })
  }}>
    {scope === 'project' && <>
      <ModelFields groups={initial.models} model={model} setModel={setModel} saving={saving} t={t} />
      <div className={css.field}>
        <span>{t('mode.label')}</span>
        <SelectMenu align="start" label={t('mode.label')} value={mode} disabled={saving} onChange={setMode} options={[
          { id: '', label: t('inherit.global') },
          ...initial.modes.map(row => ({
            id: row.id, label: row.broken === undefined ? row.name ?? row.id : t('choice.unavailable', { name: row.name ?? row.id }),
            disabled: row.broken !== undefined,
          })),
          ...mode !== '' && !initial.modes.some(row => row.id === mode)
            ? [{ id: mode, label: t('choice.unavailable', { name: mode }), disabled: true }] : [],
        ]} />
      </div>
    </>}
    <fieldset className={css.tools}>
      <legend>{t('tools.label')}</legend>
      {scope !== 'global' && <p className={css.hint}>{t('tools.inherited')}</p>}
      {names.length + servers.length === 0 ? <p className={css.hint}>{t('tools.empty')}</p>
        : <div className={css.choices}>
          {names.map(name => toolChoice(name, name))}
          {servers.map(name => toolChoice(`${MCP_SERVER_PREFIX}${name}`, t('tools.mcp', { name })))}
        </div>}
    </fieldset>
    {failed && <p className={css.notice} role="alert">{t('save.error')}</p>}
  </form>
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
