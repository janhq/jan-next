/** Settings dialog for editing one Jan agent file or copying a foreign agent. */
import { useEffect, useId, useRef, useState } from 'react'
import type { ModelProviderGroup } from '@janhq/jan-api-session-controller/types'
import type { PropsLocale } from '@janhq/jan-client-ui-slots'
import { Button, Checkbox, IconLoadingOutlineRegular, Input, Modal, SelectMenu } from '@janhq/jan-client-ui-primitives'
import type { AgentProfile, AgentProfileDraft, AgentProfileGetRequest, AgentProfileModel, AgentProfileSaveRequest,
  AgentProfileScope, AgentProfileSummary, AgentProfileUse } from '../types.ts'
import css from './AgentProfiles.module.css'

type Locale = PropsLocale<'agentProfiles'>
type Scope = Pick<AgentProfileSaveRequest, 'scope' | 'workspaceId'>

/** One operation against the selected scope and source file, if any. */
export interface AgentProfileEditTarget extends Scope {
  readonly profile?: AgentProfileSummary
  readonly janIds: ReadonlySet<string>
}

/** Remote work used only while the editor is mounted. */
export interface AgentProfileEditorActions {
  readonly get: (request: AgentProfileGetRequest) => Promise<AgentProfile>
  readonly save: (request: AgentProfileSaveRequest) => Promise<void>
  readonly models: () => Promise<readonly ModelProviderGroup[]>
  readonly tools: () => Promise<readonly string[]>
}

type ModelChoice = {
  readonly id: string
  readonly label: string
  readonly selection: AgentProfileModel
  readonly efforts: readonly { readonly id: string; readonly name: string }[]
}
const NEW_AGENT: AgentProfileDraft = { id: '', description: '', use: 'all', instructions: '' }
const USES: readonly AgentProfileUse[] = ['all', 'primary', 'subagent']
const ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/

type EditorData = {
  readonly draft: AgentProfileDraft
  readonly models: readonly ModelProviderGroup[] | null
  readonly tools: readonly string[] | null
}

type EditorProps = AgentProfileEditorActions & Locale & {
  readonly target: AgentProfileEditTarget
  readonly close: () => void
}

/**
 * Load the exact source file and the available form choices, preserving edits on save failure.
 * @param props - target address, catalog callbacks and localized labels.
 * @returns the agent-file editor dialog.
 */
export function AgentProfileEditor({ target, get, models, tools, save, close, t }: EditorProps) {
  const { profile, scope, workspaceId, janIds } = target
  const title = profile === undefined ? t('new') : profile.writable ? t('editTitle', { id: profile.id }) : t('copyTitle', { id: profile.id })
  const formId = useId()
  const [retry, setRetry] = useState(0)
  const [data, setData] = useState<EditorData | null>()
  const [saving, setSaving] = useState(false)
  const submitting = useRef(false)
  useEffect(() => {
    let current = true
    setData(undefined)
    const load = async () => {
      try {
        const [draft, modelCatalog, toolCatalog] = await Promise.all([
          profile === undefined
            ? NEW_AGENT
            : get({ id: profile.id, path: profile.path, ...workspaceId === undefined ? {} : { workspaceId } }),
          models().catch(() => null), tools().catch(() => null),
        ])
        if (current) setData({ draft, models: modelCatalog, tools: toolCatalog })
      } catch {
        // The selected source might have changed or been removed since listing.
        if (current) setData(null)
      }
    }
    void load()
    return () => { current = false }
  }, [get, models, profile, retry, tools, workspaceId])

  const saveDraft = async (draft: AgentProfileDraft) => {
    if (submitting.current) return
    submitting.current = true
    setSaving(true)
    try {
      await save({ scope, ...workspaceId === undefined ? {} : { workspaceId },
        ...profile?.writable === true ? { path: profile.path } : {}, profile: draft,
      })
      close()
    } finally {
      setSaving(false)
      submitting.current = false
    }
  }
  const dismiss = () => { if (!submitting.current) close() }
  return <Modal open title={title} closeLabel={t('close')} onClose={dismiss}
    className={css.dialog ?? ''} contentClassName={css.content ?? ''} footer={<>
      <Button variant="outline" disabled={saving} onClick={dismiss}>{t('cancel')}</Button>
      <Button variant="primary" type="submit" form={formId} disabled={saving || data == null}>{t('save')}</Button>
    </>}>
    {data === undefined && <div className={css.loading} role="status" aria-label={t('loading')}>
      <IconLoadingOutlineRegular size={18} aria-hidden="true" />
    </div>}
    {data === null && <div className={css.form}>
      <p className={css.notice} role="alert">{t('readError')}</p>
      <Button variant="outline" onClick={() => { setRetry(count => count + 1) }}>{t('retry')}</Button>
    </div>}
    {data != null && <AgentForm initial={data} formId={formId} scope={scope} saving={saving} save={saveDraft}
      janIds={janIds} existing={profile !== undefined} copying={profile?.writable === false} t={t} />}
  </Modal>
}

function AgentForm({ initial, formId, scope, saving, save, janIds, existing, copying, t }: Locale & {
  initial: EditorData
  formId: string
  scope: AgentProfileScope
  saving: boolean
  save: (draft: AgentProfileDraft) => Promise<void>
  janIds: ReadonlySet<string>
  existing: boolean
  copying: boolean
}) {
  const [id, setId] = useState(initial.draft.id)
  const [description, setDescription] = useState(initial.draft.description)
  const [instructions, setInstructions] = useState(initial.draft.instructions)
  const [use, setUse] = useState(initial.draft.use)
  const [model, setModel] = useState(initial.draft.model)
  const [allow, setAllow] = useState(() => new Set(initial.draft.tools))
  const [deny, setDeny] = useState(() => new Set(initial.draft.disallowedTools))
  const [error, setError] = useState<'idError' | 'idTaken' | 'saveError'>()
  const choices = [...new Set([...(initial.tools ?? []), ...allow, ...deny])].sort()
  return <form id={formId} className={css.form} onSubmit={(event) => {
    event.preventDefault()
    const name = id.trim()
    if (!ID.test(name) || name.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) { setError('idError'); return }
    if (!existing && janIds.has(name)) { setError('idTaken'); return }
    setError(undefined)
    void save({ id: name, description, instructions, use, ...model === undefined ? {} : { model },
      ...allow.size === 0 ? {} : { tools: [...allow].sort() }, disallowedTools: [...deny].sort(),
    }).catch(() => { setError('saveError') })
  }}>
    <p className={css.hint}>{t(`scope.${scope}`)}</p>
    {copying && janIds.has(id) && <p className={css.hint}>{t('copyOverwrite')}</p>}
    <label className={css.field}>
      <span>{t('id')}</span>
      <Input value={id} required maxLength={64} readOnly={existing} disabled={saving} onChange={(event) => { setId(event.target.value) }} />
    </label>
    <label className={css.field}>
      <span>{t('description')}</span>
      <Input value={description} disabled={saving} onChange={(event) => { setDescription(event.target.value) }} />
    </label>
    <div className={css.field}>
      <span>{t('use')}</span>
      <SelectMenu align="start" label={t('use')} value={use} disabled={saving}
        options={USES.map(value => ({ id: value, label: t(`use.${value}`) }))}
        onChange={setUse} />
    </div>
    <ModelFields groups={initial.models} model={model} setModel={setModel} saving={saving} t={t} />
    {initial.tools === null && <p className={css.hint} role="status">{t('toolsError')}</p>}
    <ToolChoices title={t('allow')} hint={t('allowHint')} names={choices} selected={allow} setSelected={setAllow} saving={saving} t={t} />
    <ToolChoices title={t('deny')} names={choices} selected={deny} setSelected={setDeny} saving={saving} t={t} />
    <label className={css.field}>
      <span>{t('instructions')}</span>
      <textarea className={css.instructions} rows={6} value={instructions} disabled={saving}
        onChange={(event) => { setInstructions(event.target.value) }} />
    </label>
    {error !== undefined && <p className={css.notice} role="alert">{t(error)}</p>}
  </form>
}

function ToolChoices({ title, hint, names, selected, setSelected, saving, t }: Locale & {
  title: string
  hint?: string
  names: readonly string[]
  selected: ReadonlySet<string>
  setSelected: (selected: Set<string>) => void
  saving: boolean
}) {
  return <fieldset className={css.switches}>
    <legend>{title}</legend>
    {hint !== undefined && <p className={css.hint}>{hint}</p>}
    {names.length === 0 ? <p className={css.hint}>{t('toolsEmpty')}</p> : <div className={css.choices}>
      {names.map(name => <Checkbox key={name} label={name.startsWith('mcp:') ? t('mcp', { name: name.slice(4) }) : name}
        checked={selected.has(name)} disabled={saving} onChange={(checked) => {
          const next = new Set(selected)
          if (checked) next.add(name)
          else next.delete(name)
          setSelected(next)
        }} />)}
    </div>}
  </fieldset>
}

function ModelFields({ groups, model, setModel, saving, t }: Locale & {
  groups: readonly ModelProviderGroup[] | null
  model: AgentProfileModel | undefined
  setModel: (model: AgentProfileModel | undefined) => void
  saving: boolean
}) {
  const choices: ModelChoice[] = (groups ?? []).flatMap(group => group.models.map(row => ({
    id: JSON.stringify([group.id, row.id]), label: t('route', { model: row.name, provider: group.name }),
    selection: { provider: group.id, model: row.id }, efforts: row.reasoning?.efforts ?? [],
  })))
  const id = model === undefined ? '' : JSON.stringify([model.provider, model.model])
  const selected = choices.find(choice => choice.id === id)
  const effort = model?.reasoningEffort ?? ''
  const efforts = selected?.efforts ?? []
  const current = model?.provider === undefined ? model?.model : t('route', { model: model.model, provider: model.provider })
  return <>
    <div className={css.field}>
      <span>{t('model')}</span>
      <SelectMenu align="start" label={t('model')} value={id} disabled={saving} options={[
        { id: '', label: t('inherit') }, ...choices,
        ...current !== undefined && selected === undefined ? [{ id, disabled: true, label: current }] : [],
      ]} onChange={(next) => { setModel(choices.find(choice => choice.id === next)?.selection) }} />
      {groups === null && <p className={css.hint} role="status">{t('modelsError')}</p>}
    </div>
    {model !== undefined && (effort !== '' || efforts.length > 0) && <div className={css.field}>
      <span>{t('effort')}</span>
      <SelectMenu align="start" label={t('effort')} value={effort} disabled={saving} options={[
        { id: '', label: t('inherit') }, ...efforts.map(row => ({ id: row.id, label: row.name })),
        ...effort !== '' && !efforts.some(row => row.id === effort) ? [{ id: effort, disabled: true, label: effort }] : [],
      ]} onChange={(reasoningEffort) => {
        setModel({
          model: model.model, ...model.provider === undefined ? {} : { provider: model.provider },
          ...reasoningEffort === '' ? {} : { reasoningEffort },
        })
      }} />
    </div>}
  </>
}
