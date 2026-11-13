import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { route } from '@/constants/routes'
import SettingsMenu from '@/containers/SettingsMenu'
import HeaderPage from '@/containers/HeaderPage'
import { Card, CardItem } from '@/containers/Card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useServiceHub } from '@/hooks/useServiceHub'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  IconChevronDown,
  IconPlayerStopFilled,
  IconVolume,
} from '@tabler/icons-react'
import { useVoice } from '@/hooks/useVoice'
import { useVoiceSettings, VOICES } from '@/hooks/useVoiceSettings'
import type {
  SpeechInstallProgress,
  SpeechStatus,
} from '@/services/speech/types'

// Shares useVoice's single playback slot, so a preview stops any reading.
const PREVIEW_ID = '__voice-preview__'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.voice as any)({
  component: VoiceSettings,
})

const mb = (n: number) => Math.round(n / 1_000_000)

function VoicePicker({
  canPreview,
  onPreviewed,
}: {
  canPreview: boolean
  /** Previewing starts the engine lazily; the page re-reads its status. */
  onPreviewed: () => void
}) {
  const { t } = useTranslation()
  const voice = useVoiceSettings((s) => s.voice)
  const setVoice = useVoiceSettings((s) => s.setVoice)
  const toggleSpeak = useVoice((s) => s.toggleSpeak)
  const previewing = useVoice((s) => s.speakingId === PREVIEW_ID)
  const current = VOICES.find((v) => v.id === voice) ?? VOICES[0]

  const preview = () =>
    toggleSpeak(PREVIEW_ID, t('settings:voice.previewText'))
      .catch((e) =>
        toast.error(t('chat:voice.speakFailed'), {
          description: e instanceof Error ? e.message : String(e),
        })
      )
      .finally(onPreviewed)

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            data-testid="voice-picker"
            className="w-36 justify-between"
          >
            <span className="truncate">
              {current.name} · {current.accent}
            </span>
            <IconChevronDown size={14} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 w-44 overflow-y-auto">
          <DropdownMenuRadioGroup value={current.id} onValueChange={setVoice}>
            {VOICES.map((v) => (
              <DropdownMenuRadioItem key={v.id} value={v.id}>
                <span className="flex-1">{v.name}</span>
                <span className="text-xs text-muted-foreground">{v.accent}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        size="icon-sm"
        variant="outline"
        disabled={!canPreview}
        data-testid="voice-preview"
        aria-label={
          previewing ? t('chat:voice.stopReading') : t('settings:voice.preview')
        }
        title={previewing ? t('chat:voice.stopReading') : t('settings:voice.preview')}
        onClick={preview}
      >
        {previewing ? (
          <IconPlayerStopFilled size={14} aria-hidden="true" />
        ) : (
          <IconVolume size={16} aria-hidden="true" />
        )}
      </Button>
    </div>
  )
}

function VoiceSettings() {
  const { t } = useTranslation()
  const speech = useServiceHub().speech()
  const [status, setStatus] = useState<SpeechStatus | null>(null)
  const [progress, setProgress] = useState<SpeechInstallProgress | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(
    () => speech.status().then(setStatus),
    [speech]
  )

  useEffect(() => {
    refresh()
    const offs = [
      speech.onInstallProgress(setProgress),
      speech.onInstallDone(() => {
        setProgress(null)
        refresh()
      }),
    ]
    return () => offs.forEach((p) => p.then((off) => off()))
  }, [speech, refresh])

  const run = async (action: () => Promise<void>, errorKey: string) => {
    setBusy(true)
    try {
      await action()
    } catch (e) {
      toast.error(t(errorKey), {
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setBusy(false)
      setProgress(null)
      refresh()
    }
  }

  const installing = busy || status?.installing

  const engineAction = !status?.installed ? (
    <Button
      size="sm"
      disabled={!status || installing}
      onClick={() => run(() => speech.install(), 'settings:voice.installFailed')}
    >
      {installing ? t('settings:voice.installing') : t('settings:voice.install')}
    </Button>
  ) : status.running ? (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={() => run(() => speech.stop(), 'settings:voice.stopFailed')}
    >
      {t('settings:voice.stop')}
    </Button>
  ) : (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={() => run(() => speech.start(), 'settings:voice.startFailed')}
    >
      {busy ? t('settings:voice.starting') : t('settings:voice.start')}
    </Button>
  )

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
            <Card title={t('common:voice')}>
              <CardItem
                title={
                  <span className="flex items-center gap-2">
                    {t('settings:voice.engine')}
                    {status?.running && (
                      <span
                        data-testid="voice-running"
                        className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400"
                      >
                        {t('settings:voice.running')}
                      </span>
                    )}
                  </span>
                }
                description={
                  <span className="text-pretty">
                    {status?.installed
                      ? t('settings:voice.engineDesc')
                      : t('settings:voice.engineInstallDesc')}
                  </span>
                }
                actions={engineAction}
              />
              {progress && (
                <CardItem
                  title={t('settings:voice.downloading', { file: progress.file })}
                  description={
                    <span className="tabular-nums">
                      {progress.total
                        ? `${mb(progress.downloaded)} / ${mb(progress.total)} MB`
                        : `${mb(progress.downloaded)} MB`}
                    </span>
                  }
                  actions={
                    <Progress
                      className="w-44"
                      value={
                        progress.total
                          ? (progress.downloaded / progress.total) * 100
                          : 0
                      }
                    />
                  }
                />
              )}
              <CardItem
                title={t('settings:voice.tts')}
                description={t('settings:voice.ttsModel')}
              />
              <CardItem
                title={t('settings:voice.voice')}
                description={t('settings:voice.voiceDesc')}
                actions={
                  <VoicePicker
                    canPreview={!!status?.installed}
                    onPreviewed={refresh}
                  />
                }
              />
              <CardItem
                title={t('settings:voice.stt')}
                description={t('settings:voice.sttModel')}
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
