import { Button } from '@/components/ui/button'
import { IconPlayerStopFilled, IconVolume } from '@tabler/icons-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useVoice } from '@/hooks/useVoice'

export const SpeakButton = ({ id, text }: { id: string; text: string }) => {
  const { t } = useTranslation()
  const active = useVoice((s) => s.speakingId === id)
  const toggleSpeak = useVoice((s) => s.toggleSpeak)
  const label = active ? t('chat:voice.stopReading') : t('chat:voice.readAloud')

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      data-testid="speak-message"
      aria-label={label}
      title={label}
      className={cn(active && 'bg-secondary')}
      onClick={() =>
        toggleSpeak(id, text).catch((e) =>
          toast.error(t('chat:voice.speakFailed'), {
            description: e instanceof Error ? e.message : String(e),
          })
        )
      }
    >
      {active ? (
        <IconPlayerStopFilled size={14} aria-hidden="true" />
      ) : (
        <IconVolume size={16} aria-hidden="true" />
      )}
    </Button>
  )
}
