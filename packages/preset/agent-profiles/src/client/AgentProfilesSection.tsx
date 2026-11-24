/** Settings roster of all local profile files, including shadowed or unreadable entries. */
import { useEffect, useRef, useState } from 'react'
import type { WorkspaceView } from '@janhq/jan-api-workspace-controller/types'
import { workspaceDisplayTitle } from '@janhq/jan-api-workspace-controller/default-workspace'
import type { InjectFace, PropsLocale, PropsRuntime } from '@janhq/jan-client-ui-slots'
import { Button, IconLoadingOutlineRegular, Modal } from '@janhq/jan-client-ui-primitives'
import type { AgentProfileList, AgentProfileRemoveRequest, AgentProfileSummary } from '../types.ts'
import type { AgentProfilePickerInjected } from './AgentProfilePicker.tsx'
import { ProfileBadges } from './AgentProfilePicker.tsx'
import { AgentProfileEditor, type AgentProfileEditorActions, type AgentProfileEditTarget } from './AgentProfileEditor.tsx'
import css from './AgentProfiles.module.css'

type Locale = PropsLocale<'agentProfiles'>
type FileManager = 'finder' | 'folder'
type WorkspaceId = WorkspaceView['workspaceId']

/** Settings actions and the live catalog revision supplied by the Client plugin. */
export interface AgentProfilesSectionInjected extends AgentProfileEditorActions, Pick<AgentProfilePickerInjected, 'list' | 'hooks'> {
  readonly fileManager: () => Promise<FileManager | undefined>
  readonly reveal: (path: string) => Promise<void>
  readonly remove: (request: AgentProfileRemoveRequest) => Promise<void>
}

/** Props assembled by the settings section registration. */
export type AgentProfilesSectionProps = PropsRuntime<'settings.section'> & Locale & InjectFace<AgentProfilesSectionInjected>

type Catalog = ReadonlyMap<WorkspaceId | undefined, AgentProfileList | null>
type DeleteTarget = { readonly workspace: WorkspaceView | undefined; readonly profile: AgentProfileSummary }

/**
 * List files in the Jan home and in named local projects, with a per-file editor and native reveal action.
 * @param props - workspace snapshot, catalog readers and file actions.
 * @returns the Agents section content.
 */
export function AgentProfilesSection({
  useWorkspaces, useProfileRevision, list, fileManager, reveal, remove, get, save, models, tools, t,
}: AgentProfilesSectionProps) {
  const { items, state } = useWorkspaces(value => value)
  const revision = useProfileRevision(value => value)
  const [catalog, setCatalog] = useState<Catalog>(new Map())
  const [retry, setRetry] = useState(0)
  const [manager, setManager] = useState<FileManager>()
  const [editor, setEditor] = useState<AgentProfileEditTarget>()
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>()
  const [revealError, setRevealError] = useState<string>()
  const localProjects = items.filter(workspace => workspace.hostId === undefined)
  useEffect(() => {
    let current = true
    void fileManager().then((manager) => { if (current) setManager(manager) }).catch((_error: unknown) => {
      // A Host without an available desktop does not expose the native action.
    })
    return () => { current = false }
  }, [fileManager])
  useEffect(() => {
    let current = true
    const workspaces = [undefined, ...items.filter(workspace => workspace.hostId === undefined).map(workspace => workspace.workspaceId)]
    for (const workspaceId of workspaces) {
      const load = async () => {
        let result: AgentProfileList | null = null
        try { result = await list(workspaceId === undefined ? {} : { workspaceId }) } catch {
          // Render a failure inside the affected scope without hiding the other scopes.
        }
        if (current) setCatalog(previous => new Map(previous).set(workspaceId, result))
      }
      void load()
    }
    return () => { current = false }
  }, [items, list, revision, retry])

  return <section className={css.section}>
    <p className={css.intro}>{t('intro')}</p>
    {[undefined, ...localProjects].map((workspace) => {
      const scope = workspace === undefined ? 'global' : 'project'
      const workspaceId = workspace?.workspaceId
      const data = catalog.get(workspaceId)
      const profiles = data?.profiles.filter(profile => profile.scope === scope) ?? []
      const problems = data?.problems.filter(problem => problem.scope === scope) ?? []
      const title = workspace === undefined ? t('scope.global') : workspaceDisplayTitle(workspace, t('workspace.defaultName'))
      const startEdit = (profile?: AgentProfileSummary) => {
        setEditor({ scope, ...workspaceId === undefined ? {} : { workspaceId }, ...profile === undefined ? {} : { profile },
          janIds: new Set(profiles.filter(row => row.writable).map(row => row.id)),
        })
      }
      const showInFolder = (path: string) => {
        setRevealError(undefined)
        void reveal(path).catch(() => { setRevealError(path) })
      }
      return <section key={workspaceId ?? 'global'} className={css.group} aria-label={title}>
        <div className={css.groupHeading}>
          <h3>{title}</h3>
          <Button size="sm" variant="outline" disabled={data == null} onClick={() => { startEdit() }}>{t('new')}</Button>
        </div>
        {data === undefined && <div className={css.loading} role="status" aria-label={t('loading')}>
          <IconLoadingOutlineRegular size={18} aria-hidden="true" />
        </div>}
        {data === null && <div className={css.groupHeading}>
          <p className={css.notice} role="alert">{t('listError')}</p>
          <Button size="sm" variant="outline" onClick={() => {
            setCatalog((previous) => { const next = new Map(previous); next.delete(workspaceId); return next })
            setRetry(value => value + 1)
          }}>{t('retry')}</Button>
        </div>}
        {data != null && profiles.length + problems.length === 0 && <p className={css.hint}>{t('empty')}</p>}
        {profiles.map(profile => <div key={profile.path} className={css.row}>
          <div className={css.file}>
            <div className={css.menuHeading}>
              <span className={css.ellipsis}>{profile.id}</span><ProfileBadges profile={profile} t={t} />
            </div>
            {profile.description !== '' && <p className={css.description}>{profile.description}</p>}
            <code className={css.path} title={profile.path}>{profile.path}</code>
            {profile.shadowedBy !== undefined && <p className={css.description}>{t('shadowed', { path: profile.shadowedBy })}</p>}
            {revealError === profile.path && <p className={css.notice} role="alert">{t('revealError')}</p>}
          </div>
          <div className={css.actions}>
            <Button size="sm" variant="outline" onClick={() => { startEdit(profile) }}>{t(profile.writable ? 'edit' : 'copyToJan')}</Button>
            {profile.writable && <Button size="sm" onClick={() => { setDeleteTarget({ workspace, profile }) }}>{t('delete')}</Button>}
            {manager !== undefined && <Button size="sm" onClick={() => { showInFolder(profile.path) }}>{t(`reveal.${manager}`)}</Button>}
          </div>
        </div>)}
        {problems.map(problem => <div key={problem.path} className={css.row}>
          <div className={css.file}>
            <code className={css.path} title={problem.path}>{problem.path}</code>
            <p className={css.notice}>{problem.reason}</p>
            {revealError === problem.path && <p className={css.notice} role="alert">{t('revealError')}</p>}
          </div>
          {manager !== undefined && <Button size="sm" onClick={() => { showInFolder(problem.path) }}>{t(`reveal.${manager}`)}</Button>}
        </div>)}
      </section>
    })}
    {state === 'error' && <p className={css.notice} role="alert">{t('projectsError')}</p>}
    {editor !== undefined && <AgentProfileEditor target={editor} get={get} models={models} tools={tools} save={async (request) => {
      await save(request)
      setRetry(value => value + 1)
    }} close={() => { setEditor(undefined) }} t={t} />}
    {deleteTarget !== undefined && <DeleteProfile target={deleteTarget} remove={async (request) => {
      await remove(request)
      setRetry(value => value + 1)
    }} close={() => { setDeleteTarget(undefined) }} t={t} />}
  </section>
}

function DeleteProfile({ target, remove, close, t }: Locale & {
  target: DeleteTarget
  remove: AgentProfilesSectionInjected['remove']
  close: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const removing = useRef(false)
  const id = target.profile.id
  const workspaceId = target.workspace?.workspaceId
  const dismiss = () => { if (!removing.current) close() }
  const confirm = async () => {
    if (removing.current) return
    removing.current = true
    setBusy(true)
    setFailed(false)
    try {
      await remove({ scope: target.profile.scope, id, path: target.profile.path, ...workspaceId === undefined ? {} : { workspaceId } })
      close()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
      removing.current = false
    }
  }
  return <Modal open title={t('deleteTitle', { id })} closeLabel={t('close')} onClose={dismiss} footer={<>
    <Button variant="outline" disabled={busy} onClick={dismiss}>{t('cancel')}</Button>
    <Button variant="primary" disabled={busy} onClick={() => { void confirm() }}>{t('delete')}</Button>
  </>}>
    <p className={css.hint}>{t('deleteConfirm', { id })}</p>
    {failed && <p className={css.notice} role="alert">{t('deleteError')}</p>}
  </Modal>
}
