import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { Card, CardItem } from '@/containers/Card'
import {
  IconPencil,
  IconPlus,
  IconTrash,
  IconCodeCircle,
} from '@tabler/icons-react'
import { useMCPServers, MCPServerConfig } from '@/hooks/useMCPServers'
import { Fragment, useState } from 'react'
import AddEditMCPServer from '@/containers/dialogs/AddEditMCPServer'
import DeleteMCPServerConfirm from '@/containers/dialogs/DeleteMCPServerConfirm'
import EditJsonMCPserver from '@/containers/dialogs/EditJsonMCPserver'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useAppState } from '@/hooks/useAppState'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { normalizeAppError } from '@/utils/appError'

// Function to mask sensitive URL parameters
const maskSensitiveUrl = (url: string) => {
  if (!url) return url

  try {
    const urlObj = new URL(url)
    const params = urlObj.searchParams

    // List of sensitive parameter names (case-insensitive)
    const sensitiveParams = [
      'api_key',
      'apikey',
      'key',
      'token',
      'secret',
      'password',
      'pwd',
      'auth',
      'authorization',
      'bearer',
      'access_token',
      'refresh_token',
      'client_secret',
      'private_key',
      'signature',
      'hash',
    ]

    // Mask sensitive parameters
    sensitiveParams.forEach((paramName) => {
      // Check both exact match and case-insensitive match
      for (const [key] of params.entries()) {
        if (key.toLowerCase() === paramName.toLowerCase()) {
          params.set(key, '******')
        }
      }
    })

    // Reconstruct URL with masked parameters
    urlObj.search = params.toString()
    return urlObj.toString()
  } catch {
    // If URL parsing fails, just mask the entire query string after '?'
    const queryIndex = url.indexOf('?')
    if (queryIndex === -1) return url

    const baseUrl = url.substring(0, queryIndex + 1)
    return baseUrl + '******'
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.mcp_servers as any)({
  component: MCPServersDesktop,
})

type ServerMap = Record<string, MCPServerConfig>

function MCPServersDesktop() {
  const { t } = useTranslation()
  const {
    mcpServers,
    addServer,
    editServer,
    renameServer,
    deleteServer,
    syncServersAndRestart,
  } = useMCPServers()
  const setErrorMessage = useAppState((state) => state.setErrorMessage)

  const [open, setOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [currentConfig, setCurrentConfig] = useState<
    MCPServerConfig | undefined
  >(undefined)

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [serverToDelete, setServerToDelete] = useState<string | null>(null)

  const [jsonEditorOpen, setJsonEditorOpen] = useState(false)
  const [jsonServerName, setJsonServerName] = useState<string | null>(null)
  const [jsonEditorData, setJsonEditorData] = useState<
    MCPServerConfig | ServerMap | { mcpServers: ServerMap } | undefined
  >(undefined)
  const [loadingServers, setLoadingServers] = useState<
    Record<string, boolean>
  >({})

  // Persist the config and restart DSH so its mcp-client picks it up.
  const apply = async () => {
    try {
      await syncServersAndRestart()
    } catch (error) {
      setErrorMessage({
        message: normalizeAppError(error),
        subtitle: t('mcp-servers:checkParams'),
      })
    }
  }

  const handleOpenDialog = (serverKey?: string) => {
    setCurrentConfig(serverKey ? mcpServers[serverKey] : undefined)
    setEditingKey(serverKey ?? null)
    setOpen(true)
  }

  const handleSaveServer = async (name: string, config: MCPServerConfig) => {
    if (editingKey && editingKey !== name) {
      renameServer(editingKey, name, config)
    } else if (editingKey) {
      editServer(editingKey, config)
    } else {
      addServer(name, config)
    }
    await apply()
  }

  const handleConfirmDelete = async () => {
    if (!serverToDelete) return
    deleteServer(serverToDelete)
    toast.success(
      t('mcp-servers:deleteServer.success', { serverName: serverToDelete })
    )
    setServerToDelete(null)
    await apply()
  }

  const handleOpenJsonEditor = (serverKey?: string) => {
    if (serverKey) {
      setJsonServerName(serverKey)
      setJsonEditorData(mcpServers[serverKey])
    } else {
      setJsonServerName(null)
      setJsonEditorData({ mcpServers })
    }
    setJsonEditorOpen(true)
  }

  const handleSaveJson = async (
    data: MCPServerConfig | ServerMap | { mcpServers?: ServerMap }
  ) => {
    if (jsonServerName) {
      editServer(jsonServerName, data as MCPServerConfig)
    } else {
      let nextServers: ServerMap = {}
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        nextServers =
          'mcpServers' in data
            ? ((data as { mcpServers?: ServerMap }).mcpServers ?? {})
            : (data as ServerMap)
      }
      Object.keys(mcpServers).forEach((key) => deleteServer(key))
      Object.entries(nextServers).forEach(([key, config]) =>
        addServer(key, config)
      )
    }
    await apply()
  }

  const toggleServer = async (serverKey: string, active: boolean) => {
    const config = mcpServers[serverKey]
    if (!config) return
    setLoadingServers((prev) => ({ ...prev, [serverKey]: true }))
    editServer(serverKey, { ...config, active })
    try {
      await apply()
    } finally {
      setLoadingServers((prev) => ({ ...prev, [serverKey]: false }))
    }
  }

  return (
    <Fragment>
      <div className="flex flex-col h-svh w-full">
        <HeaderPage>
          <div className={cn("flex items-center justify-between w-full mr-2 pr-3", !IS_MACOS && "pr-30")}>
            <span className='font-medium text-base font-studio'>{t('common:settings')}</span>
            <Button variant="outline" size="sm" onClick={() => handleOpenDialog()} className="relative z-50">
              <IconPlus size={18} className="text-muted-foreground" />
              {t('mcp-servers:addServer')}
            </Button>
          </div>
        </HeaderPage>
        <div className="flex h-[calc(100%-60px)]">
          <SettingsMenu />
          <div className="p-4 pt-0 w-full overflow-y-auto">
            <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
              <Card
                header={
                  <div className="flex flex-col mb-4">
                    <div className="flex items-center justify-between">
                      <h1 className="text-foreground font-medium text-base font-studio">
                        {t('mcp-servers:title')}
                      </h1>
                      <div className="flex items-center gap-0.5">
                        <Button
                          onClick={() => handleOpenJsonEditor()}
                          title={t('mcp-servers:editAllJson')}
                          size="icon-xs"
                          variant="ghost"
                        >
                          <IconCodeCircle
                            size={18}
                            className="text-muted-foreground"
                          />
                        </Button>
                      </div>
                    </div>
                    <p className="text-sm mt-1 text-muted-foreground">
                      {t('mcp-servers:dshRuns')}
                    </p>
                    <p className="text-sm mt-1">
                      {t('mcp-servers:findMore')}{' '}
                      <a
                        href="https://mcp.so/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        mcp.so
                      </a>
                    </p>
                  </div>
                }
              />

              {Object.keys(mcpServers).length === 0 ? (
                <div className="py-4 text-center font-medium text-muted-foreground">
                  {t('mcp-servers:noServers')}
                </div>
              ) : (
                Object.entries(mcpServers).map(([key, config], index) => (
                  <Card key={`${key}-${index}`}>
                    <CardItem
                      align="start"
                      title={
                        <h1 className="text-foreground text-base capitalize font-studio">
                          {key}
                        </h1>
                      }
                      descriptionOutside={
                        <div className="text-sm text-muted-foreground">
                          <div className="mb-1">
                            Transport:{' '}
                            <span className="uppercase">
                              {config.type || 'stdio'}
                            </span>
                          </div>

                          {config.type === 'stdio' || !config.type ? (
                            <>
                              <div>
                                {t('mcp-servers:command')}: {config.command}
                              </div>
                              <div className="my-1 break-all">
                                {t('mcp-servers:args')}:{' '}
                                {config?.args?.join(', ')}
                              </div>
                              {config.env &&
                                Object.keys(config.env).length > 0 && (
                                  <div className="break-all">
                                    {t('mcp-servers:env')}:{' '}
                                    {Object.entries(config.env)
                                      .map(([key]) => `${key}=******`)
                                      .join(', ')}
                                  </div>
                                )}
                            </>
                          ) : (
                            <>
                              <div className="break-all">
                                URL: {maskSensitiveUrl(config.url || '')}
                              </div>
                              {config.headers &&
                                Object.keys(config.headers).length > 0 && (
                                  <div className="my-1 break-all">
                                    Headers:{' '}
                                    {Object.entries(config.headers)
                                      .map(([key]) => `${key}=******`)
                                      .join(', ')}
                                  </div>
                                )}
                            </>
                          )}
                        </div>
                      }
                      actions={
                        <div className="flex items-center gap-0.5">
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => handleOpenJsonEditor(key)}
                            title={t('mcp-servers:editJson.title', {
                              serverName: key,
                            })}
                          >
                            <IconCodeCircle
                              size={18}
                              className="text-muted-foreground"
                            />
                          </Button>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => handleOpenDialog(key)}
                            title={t('mcp-servers:editServer')}
                          >
                            <IconPencil
                              size={18}
                              className="text-muted-foreground"
                            />
                          </Button>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => {
                              setServerToDelete(key)
                              setDeleteDialogOpen(true)
                            }}
                            title={t('mcp-servers:deleteServer.title')}
                          >
                            <IconTrash
                              size={18}
                              className="text-muted-foreground"
                            />
                          </Button>
                          <div className="ml-2">
                            <Switch
                              checked={config.active}
                              loading={!!loadingServers[key]}
                              onCheckedChange={(checked) =>
                                void toggleServer(key, checked)
                              }
                            />
                          </div>
                        </div>
                      }
                    />
                  </Card>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <AddEditMCPServer
        open={open}
        onOpenChange={setOpen}
        editingKey={editingKey}
        initialData={currentConfig}
        onSave={handleSaveServer}
      />

      <DeleteMCPServerConfirm
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        serverName={serverToDelete || ''}
        onConfirm={handleConfirmDelete}
      />

      <EditJsonMCPserver
        open={jsonEditorOpen}
        onOpenChange={setJsonEditorOpen}
        serverName={jsonServerName}
        initialData={jsonEditorData ?? { mcpServers }}
        onSave={handleSaveJson}
      />
    </Fragment>
  )
}
