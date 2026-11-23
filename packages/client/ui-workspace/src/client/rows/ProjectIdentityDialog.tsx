/** Compact editor for a Workspace title, accent and avatar. */
import { useId, useRef, useState } from 'react'
import type { WorkspaceAvatar, WorkspaceColor, WorkspaceUpdateRequest, WorkspaceView } from '@janhq/jan-api-workspace-controller/client'
import { Button, IconImageOutlineRegular, IconLinkOutlineRegular, LinkIconMedium, Modal, SegmentedTabs, Tooltip } from '@janhq/jan-client-ui-primitives'
import { remoteErrorOf } from '@janhq/jan-typert-protocol'
import { isWorkspaceDomain, isWorkspaceEmoji, isWorkspaceImage, sameWorkspaceAvatar, WORKSPACE_COLORS, WORKSPACE_ICONS } from '@janhq/jan-workspace/types'
import { ProjectAvatar, projectIcons } from '../ProjectAvatar.tsx'
import css from '../ProjectIdentity.module.css'
import type { WorkspaceActionRequest, WorkspaceBrowserProps } from '../contract/slots.ts'
import browserCss from './WorkspaceBrowser.module.css'

type AvatarTab = 'avatar' | 'icon' | 'emoji'

/** Edge of the square an uploaded picture is scaled to: twice the largest 24px seat. */
const UPLOAD_EDGE = 64

/**
 * Center-crop a picked image to a small square PNG, the only picture form the Host stores.
 * @param file - image the user picked.
 * @returns a PNG `data:` URL, or null when the browser cannot decode the file.
 */
async function squarePng(file: File): Promise<string | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return null
  }
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = UPLOAD_EDGE
  canvas.height = UPLOAD_EDGE
  const context = canvas.getContext('2d')
  if (context === null || side === 0) return null
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, UPLOAD_EDGE, UPLOAD_EDGE)
  bitmap.close()
  const url = canvas.toDataURL('image/png')
  return isWorkspaceImage(url) ? url : null
}

/**
 * @param text - what the user typed: a host, or a pasted address with scheme and path.
 * @returns the bare lower-case host, or null when it is not a dotted host name.
 */
function faviconDomain(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  try {
    const host = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname.toLowerCase()
    return isWorkspaceDomain(host) ? host : null
  } catch {
    return null
  }
}

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
  const tabsId = useId()
  const emojiHintId = useId()
  const emojiInputId = useId()
  const githubHintId = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(request.displayTitle)
  const [initialColor] = useState(workspace.color)
  const [initialAvatar] = useState(workspace.avatar)
  const [color, setColor] = useState<WorkspaceColor | undefined>(initialColor)
  // Undefined is the automatic avatar: the GitHub owner's picture, else the folder.
  const [avatar, setAvatar] = useState<WorkspaceAvatar | undefined>(initialAvatar)
  const [tab, setTab] = useState<AvatarTab>(initialAvatar?.kind === 'icon' ? 'icon' : initialAvatar?.kind === 'emoji' ? 'emoji' : 'avatar')
  const [emoji, setEmoji] = useState(initialAvatar?.kind === 'emoji' ? initialAvatar.value : '')
  const [domain, setDomain] = useState(initialAvatar?.kind === 'favicon' ? initialAvatar.domain : '')
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const githubOwner = workspace.githubOwner
  const trimmedTitle = title.trim()
  const emojiValue = emoji.trim()
  const invalidEmoji = emojiValue !== '' && !isWorkspaceEmoji(emojiValue)
  const duplicate = trimmedTitle !== request.displayTitle && workspaces.some(row =>
    row.workspaceId !== workspace.workspaceId && row.title === trimmedTitle)
  const changedAvatar = !sameWorkspaceAvatar(avatar, initialAvatar)
  const changedTitle = trimmedTitle !== request.displayTitle
  const saveBlocked = saving || trimmedTitle === '' || duplicate || invalidEmoji
    || !(changedTitle || changedAvatar || color !== initialColor)
  const choose = (next: WorkspaceAvatar | undefined) => {
    setAvatar(next)
    setAvatarError(null)
    setFailure(null)
    if (next?.kind !== 'emoji') setEmoji('')
  }
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
  const upload = async (file: File | undefined) => {
    if (file === undefined) return
    const url = await squarePng(file)
    if (url === null) setAvatarError(t('identity.uploadError'))
    else choose({ kind: 'image', url })
  }
  const applyFavicon = () => {
    const host = faviconDomain(domain)
    if (host === null) {
      setAvatarError(t('identity.faviconError'))
      return
    }
    setDomain(host)
    choose({ kind: 'favicon', domain: host })
  }
  const hint = shortcutPlatform === 'macos' ? t('identity.emojiMac')
    : shortcutPlatform === 'windows' ? t('identity.emojiWindows') : t('identity.emojiOther')
  const panelId = (value: AvatarTab) => `${tabsId}-${value}-panel`
  const tabIdOf = (value: AvatarTab) => `${tabsId}-${value}-tab`

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
        <div className={css.preview}>
          <ProjectAvatar avatar={avatar} githubOwner={githubOwner} color={color} size={24} />
          <span className={css.previewTitle} aria-hidden="true">{trimmedTitle || request.displayTitle}</span>
          <Button variant="outline" size="sm" disabled={saving || (avatar === undefined && color === undefined)}
            onClick={() => { choose(undefined); setColor(undefined); setDomain('') }}>
            {t('identity.reset')}
          </Button>
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
        <SegmentedTabs<AvatarTab>
          size="sm"
          label={t('identity.avatarKind')}
          value={tab}
          onChange={(value) => { setTab(value); setAvatarError(null) }}
          items={[
            { value: 'avatar', label: t('identity.avatar'), id: tabIdOf('avatar'), panelId: panelId('avatar') },
            { value: 'icon', label: t('identity.icon'), id: tabIdOf('icon'), panelId: panelId('icon') },
            { value: 'emoji', label: t('identity.emoji'), id: tabIdOf('emoji'), panelId: panelId('emoji') },
          ]}
        />
        {tab === 'avatar' && (
          <div id={panelId('avatar')} role="tabpanel" aria-labelledby={tabIdOf('avatar')} className={css.avatarPanel}>
            <Button variant={githubOwner !== undefined && avatar === undefined ? 'contrast' : 'outline'} className={css.githubButton}
              disabled={saving || githubOwner === undefined}
              aria-pressed={githubOwner !== undefined && avatar === undefined} aria-describedby={githubHintId}
              icon={<LinkIconMedium kind="url" href="https://github.com" size={16} />}
              onClick={() => { choose(undefined); setDomain('') }}>
              {t('identity.github')}
            </Button>
            <span id={githubHintId} className={css.hint}>
              {githubOwner === undefined ? t('identity.githubMissing') : t('identity.githubHint', { owner: githubOwner })}
            </span>
            <div>
              <Button variant="outline" disabled={saving} icon={<IconImageOutlineRegular size={16} />}
                aria-pressed={avatar?.kind === 'image'} onClick={() => { fileInput.current?.click() }}>
                {t('identity.upload')}
              </Button>
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
                onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = '' }} />
            </div>
            <div className={css.faviconRow}>
              <input className={browserCss.renameInput} value={domain} disabled={saving} placeholder="example.com"
                aria-label={t('identity.faviconSite')} inputMode="url" autoComplete="off" spellCheck={false}
                onChange={(event) => { setDomain(event.target.value); setAvatarError(null) }}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); applyFavicon() } }} />
              <Button variant="outline" disabled={saving || domain.trim() === ''} icon={<IconLinkOutlineRegular size={16} />}
                aria-pressed={avatar?.kind === 'favicon'} onClick={applyFavicon}>
                {t('identity.favicon')}
              </Button>
            </div>
          </div>
        )}
        {tab === 'icon' && (
          <fieldset id={panelId('icon')} role="tabpanel" aria-labelledby={tabIdOf('icon')} className={css.options} disabled={saving}>
            <div className={css.choices}>
              {WORKSPACE_ICONS.map((option) => {
                const Icon = projectIcons[option]
                const label = t(`identity.icon.${option}`)
                return (
                  <Tooltip key={option} label={label}>
                    <label className={css.choice}>
                      <input type="radio" name="icon" aria-label={label} checked={avatar?.kind === 'icon' && avatar.name === option}
                        onChange={() => { choose({ kind: 'icon', name: option }) }} />
                      <Icon size={16} />
                    </label>
                  </Tooltip>
                )
              })}
            </div>
          </fieldset>
        )}
        {tab === 'emoji' && (
          <div id={panelId('emoji')} role="tabpanel" aria-labelledby={tabIdOf('emoji')} className={css.field}>
            <label htmlFor={emojiInputId}>{t('identity.emoji')}</label>
            <input id={emojiInputId} className={browserCss.renameInput} value={emoji} disabled={saving} aria-invalid={invalidEmoji}
              aria-describedby={emojiHintId} onChange={(event) => {
                const value = event.target.value
                setEmoji(value)
                setFailure(null)
                if (isWorkspaceEmoji(value.trim())) {
                  setAvatar({ kind: 'emoji', value: value.trim() })
                  setAvatarError(null)
                } else if (value.trim() === '' && avatar?.kind === 'emoji') {
                  setAvatar(undefined)
                }
              }} />
            <span id={emojiHintId} className={css.hint}>{hint}</span>
          </div>
        )}
        {invalidEmoji && <div className={css.error} role="alert">{t('identity.emojiError')}</div>}
        {avatarError !== null && <div className={css.error} role="alert">{avatarError}</div>}
        {duplicate && <div className={css.error} role="alert">{t('conflict.named', { name: trimmedTitle })}</div>}
        {failure !== null && <div className={css.error} role="alert">{failure}</div>}
      </form>
    </Modal>
  )
}
