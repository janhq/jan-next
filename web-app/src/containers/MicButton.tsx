import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  IconLoader2,
  IconMicrophone,
  IconPlayerStopFilled,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useVoice } from '@/hooks/useVoice'

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])
  const s = Math.max(0, Math.floor((now - since) / 1000))
  return (
    <span
      className="text-xs text-destructive tabular-nums"
      aria-live="off"
    >
      ● {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
    </span>
  )
}

/** Records the mic and hands the transcript to `onText`; never sends. */
export function MicButton({ onText }: { onText: (text: string) => void }) {
  const { t } = useTranslation()
  const { recording, recordStartedAt, transcribing, startRecording, stopRecording } =
    useVoice()

  const fail = (key: string, e: unknown) =>
    toast.error(t(key), {
      description: e instanceof Error ? e.message : String(e),
    })

  const onClick = async () => {
    if (!recording) {
      await startRecording().catch((e) => fail('chat:voice.micFailed', e))
      return
    }
    try {
      const text = await stopRecording()
      if (text) onText(text)
    } catch (e) {
      fail('chat:voice.transcribeFailed', e)
    }
  }

  const label = recording ? t('chat:voice.stopRecording') : t('chat:voice.voiceInput')

  return (
    <div className="flex items-center gap-2">
      {recording && recordStartedAt && <Elapsed since={recordStartedAt} />}
      <Button
        variant={recording ? 'destructive' : 'secondary'}
        size="icon-sm"
        data-testid="mic-button"
        aria-label={label}
        title={label}
        disabled={transcribing}
        className="rounded-full mb-1"
        onClick={onClick}
      >
        {transcribing ? (
          <IconLoader2 className="animate-spin" aria-hidden="true" />
        ) : recording ? (
          <IconPlayerStopFilled aria-hidden="true" />
        ) : (
          <IconMicrophone aria-hidden="true" />
        )}
      </Button>
    </div>
  )
}
