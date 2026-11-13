import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/containers/Card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useDshSettings } from '@/hooks/useDshSettings'
import type { DshStatus } from '@/services/dsh/types'
import { toast } from 'sonner'
import { windowKey } from '@/constants/windows'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.dsh as any)({
  component: DshSettings,
})

/** A text field with a Browse button that picks a folder. */
function FolderField({
  value,
  placeholder,
  onChange,
  label,
}: {
  value: string
  placeholder: string
  onChange: (value: string) => void
  label: string
}) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const browse = async () => {
    const picked = await serviceHub.dialog().open({ directory: true })
    if (typeof picked === 'string') onChange(picked)
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        aria-label={label}
        className="w-72"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <Button variant="outline" size="sm" onClick={browse}>
        {t('settings:dsh.browse')}
      </Button>
    </div>
  )
}

function DshSettings() {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const { root, workspace, setRoot, setWorkspace } = useDshSettings()
  const [status, setStatus] = useState<DshStatus | null>(null)
  // null while unchecked; '' when the folder is usable.
  const [rootError, setRootError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    serviceHub.dsh().status().then(setStatus).catch(() => setStatus(null))
  }, [serviceHub])

  useEffect(() => {
    refresh()
    let stop: (() => void) | undefined
    serviceHub
      .dsh()
      .onExit(refresh)
      .then((u) => (stop = u))
    return () => stop?.()
  }, [serviceHub, refresh])

  // Validates as the user types, so the error sits next to the field.
  useEffect(() => {
    if (!root.trim()) {
      setRootError(null)
      return
    }
    let current = true
    serviceHub
      .dsh()
      .checkRoot(root.trim())
      .then(() => current && setRootError(''))
      .catch((e) => current && setRootError(String(e)))
    return () => {
      current = false
    }
  }, [serviceHub, root])

  const [opening, setOpening] = useState(false)
  // DSH's own shell, where every screen is a DSH UI plugin and its modes
  // (Creator mode among them) live. Its own window until it replaces this UI.
  const openDshApp = async () => {
    setOpening(true)
    try {
      const url = await serviceHub.dsh().webStart(root.trim())
      await serviceHub.window().openWindow({
        label: windowKey.dshApp,
        url,
        title: t('settings:dsh.appWindow'),
        width: 1280,
        height: 860,
        center: true,
        resizable: true,
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setOpening(false)
    }
  }

  const stopRuntime = async () => {
    await serviceHub.dsh().stop()
    refresh()
  }

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className="font-medium text-base font-studio">
            {t('common:settings')}
          </span>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full overflow-y-auto">
          <div className="flex flex-col gap-4 w-full">
            <Card title={t('common:dsh')}>
              <CardItem
                title={t('settings:dsh.root')}
                description={
                  <span className="text-pretty">
                    {rootError ? (
                      <span
                        data-testid="dsh-root-error"
                        className="text-destructive"
                      >
                        {rootError}
                      </span>
                    ) : rootError === '' ? (
                      <span className="text-green-700 dark:text-green-400">
                        {t('settings:dsh.rootOk')}
                      </span>
                    ) : (
                      t('settings:dsh.rootDesc')
                    )}
                  </span>
                }
                actions={
                  <FolderField
                    label={t('settings:dsh.root')}
                    value={root}
                    placeholder={t('settings:dsh.rootPlaceholder')}
                    onChange={setRoot}
                  />
                }
              />
              <CardItem
                title={t('settings:dsh.workspace')}
                description={
                  <span className="text-pretty">
                    {t('settings:dsh.workspaceDesc')}
                  </span>
                }
                actions={
                  <FolderField
                    label={t('settings:dsh.workspace')}
                    value={workspace}
                    placeholder={t('settings:dsh.workspacePlaceholder')}
                    onChange={setWorkspace}
                  />
                }
              />
              <CardItem
                title={
                  <span className="flex items-center gap-2">
                    {t('settings:dsh.status')}
                    {status?.running && (
                      <span
                        data-testid="dsh-running"
                        className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400"
                      >
                        {t('settings:dsh.running')}
                      </span>
                    )}
                  </span>
                }
                description={
                  <span className="text-pretty">
                    {status?.running
                      ? status.launch?.baseUrl
                      : t('settings:dsh.stopped')}
                  </span>
                }
                actions={
                  status?.running && (
                    <Button variant="outline" size="sm" onClick={stopRuntime}>
                      {t('settings:dsh.stop')}
                    </Button>
                  )
                }
              />
            </Card>
            <Card title={t('settings:dsh.app')}>
              <CardItem
                title={t('settings:dsh.appOpen')}
                description={<span className="text-pretty">{t('settings:dsh.appDesc')}</span>}
                actions={
                  <Button
                    size="sm"
                    data-testid="dsh-open-app"
                    disabled={rootError !== '' || opening}
                    onClick={openDshApp}
                  >
                    {opening ? t('settings:dsh.appStarting') : t('settings:dsh.appOpen')}
                  </Button>
                }
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
