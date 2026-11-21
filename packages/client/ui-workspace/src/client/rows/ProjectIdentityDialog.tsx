/** Compact editor for a Workspace title, accent and avatar. */
import { useId, useState } from 'react'
import type { WorkspaceAvatar, WorkspaceColor, WorkspaceIcon, WorkspaceUpdateRequest, WorkspaceView } from '@janhq/jan-api-workspace-controller/client'
import { Button, Modal, Tooltip } from '@janhq/jan-client-ui-primitives'
import { remoteErrorOf } from '@janhq/jan-typert-protocol'
import { isWorkspaceEmoji, WORKSPACE_COLORS, WORKSPACE_ICONS } from '@janhq/jan-workspace/types'
import { ProjectAvatar, projectIcons } from '../ProjectAvatar.tsx'
import css from '../ProjectIdentity.module.css'
import type { WorkspaceActionRequest, WorkspaceBrowserProps } from '../contract/slots.ts'
import browserCss from './WorkspaceBrowser.module.css'

/**
 * @param props - captured action, live Workspace rows, and the edit callback.
 * @returns the project editor with a live, unsaved preview.
 */
export function ProjectIdentityDialog(
  { request, workspace, workspaces, updateWorkspaceIdentity, shortcutPlatform, settleWorkspaceAction, t }:
  Pick<WorkspaceBrowserProps, 'updateWorkspaceIdentity' | 'shortcutPlatform' | 'settleWorkspaceAction' | 't'> & {
    request: WorkspaceActionRequest
    workspace: WorkspaceView
    workspaces: readonly WorkspaceView[]
  },
) {
  const formId = useId()
  const emojiHintId = useId()
  const emojiInputId = useId()
  const [title, setTitle] = useState(request.displayTitle)
  const [initialColor] = useState(workspace.color)
  const [initialAvatar] = useState(workspace.avatar)
  const [color, setColor] = useState<WorkspaceColor | undefined>(initialColor)
  const [icon, setIcon] = useState<WorkspaceIcon>(initialAvatar?.kind === 'icon' ? initialAvatar.name : 'folder')
  const [emoji, setEmoji] = useState(initialAvatar?.kind === 'emoji' ? initialAvatar.value : '')
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const trimmedTitle = title.trim()
  const emojiValue = emoji.trim()
  const invalidEmoji = emojiValue !== '' && !isWorkspaceEmoji(emojiValue)
  const duplicate = trimmedTitle !== request.displayTitle && workspaces.some(row =>
    row.workspaceId !== workspace.workspaceId && row.title === trimmedTitle)
  const avatar: WorkspaceAvatar | undefined = emojiValue !== '' && !invalidEmoji ? { kind: 'emoji', value: emojiValue }
    : icon !== 'folder' ? { kind: 'icon', name: icon } : undefined
  const initialChoice = initialAvatar?.kind === 'emoji' ? initialAvatar.value : initialAvatar?.name ?? 'folder'
  const changedAvatar = (emojiValue || icon) !== initialChoice
  const changedTitle = trimmedTitle !== request.displayTitle
  const saveBlocked = saving || trimmedTitle === '' || duplicate || invalidEmoji
    || !(changedTitle || changedAvatar || color !== initialColor)
  const close = () => { if (!saving) settleWorkspaceAction() }
  const save = async () => {
    if (saveBlocked) return
    const patch: WorkspaceUpdateRequest = {
      workspaceId: workspace.workspaceId,
      ...(changedTitle ? { title: trimmedTitle } : {}),
      ...(color !== initialColor ? { color: color ?? null } : {}),
      ...(changedAvatar ? { avatar: avatar ?? null } : {}),
    }
    setSaving(true)
    setFailure(null)
    try {
      await updateWorkspaceIdentity(patch)
      settleWorkspaceAction()
    } catch (reason) {
      const failure = remoteErrorOf(reason)
      setFailure(failure?.code === 'workspace/name-conflict'
        ? t('conflict.named', { name: trimmedTitle }) : t('identity.saveError'))
      setSaving(false)
    }
  }
  const hint = shortcutPlatform === 'macos' ? t('identity.emojiMac')
    : shortcutPlatform === 'windows' ? t('identity.emojiWindows') : t('identity.emojiOther')

  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('close')}
      title={t('identity.title')}
      className={css.dialog ?? ''}
      footer={(
        <>
          <Button variant="outline" disabled={saving} onClick={close}>{t('cancel')}</Button>
          <Button variant="primary" type="submit" form={formId} disabled={saveBlocked}>{t('save')}</Button>
        </>
      )}
    >
      <form id={formId} className={css.form} onSubmit={(event) => { event.preventDefault(); void save() }}>
        <div className={css.preview} aria-hidden="true">
          <ProjectAvatar avatar={avatar} color={color} size={24} />
          <span className={css.previewTitle}>{trimmedTitle || request.displayTitle}</span>
        </div>
        <label className={css.field}>
          {t('field.workspaceName')}
          <input
            className={browserCss.renameInput}
            value={title}
            data-modal-autofocus
            disabled={saving}
            aria-invalid={duplicate}
            onChange={(event) => { setTitle(event.target.value); setFailure(null) }}
          />
        </label>
        <fieldset className={css.options} disabled={saving}>
          <legend>{t('identity.color')}</legend>
          <div className={css.choices}>
            {([undefined, ...WORKSPACE_COLORS] as const).map((option) => {
              const label = t(option === undefined ? 'identity.color.default' : `identity.color.${option}`)
              return (
                <Tooltip key={option ?? 'default'} label={label}>
                  <label className={css.choice} data-color={option}>
                    <input type="radio" name="color" aria-label={label} checked={color === option}
                      onChange={() => { setColor(option); setFailure(null) }} />
                    <span className={css.swatch} aria-hidden="true" />
                  </label>
                </Tooltip>
              )
            })}
          </div>
        </fieldset>
        <fieldset className={css.options} disabled={saving}>
          <legend>{t('identity.icon')}</legend>
          <div className={css.choices}>
            {WORKSPACE_ICONS.map((option) => {
              const Icon = projectIcons[option]
              const label = t(`identity.icon.${option}`)
              return (
                <Tooltip key={option} label={label}>
                  <label className={css.choice}>
                    <input type="radio" name="icon" aria-label={label} checked={emojiValue === '' && icon === option}
                      onChange={() => { setIcon(option); setEmoji(''); setFailure(null) }} />
                    <Icon size={16} />
                  </label>
                </Tooltip>
              )
            })}
          </div>
        </fieldset>
        <div className={css.field}>
          <label htmlFor={emojiInputId}>{t('identity.emoji')}</label>
          <input id={emojiInputId} className={browserCss.renameInput} value={emoji} disabled={saving} aria-invalid={invalidEmoji}
            aria-describedby={emojiHintId} onChange={(event) => { setEmoji(event.target.value); setFailure(null) }} />
          <span id={emojiHintId} className={css.hint}>{hint}</span>
        </div>
        {invalidEmoji && <div className={css.error} role="alert">{t('identity.emojiError')}</div>}
        {duplicate && <div className={css.error} role="alert">{t('conflict.named', { name: trimmedTitle })}</div>}
        {failure !== null && <div className={css.error} role="alert">{failure}</div>}
      </form>
    </Modal>
  )
}
