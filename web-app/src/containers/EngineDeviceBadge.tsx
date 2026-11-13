import { useEffect, useState } from 'react'
import { getEngineInfo } from '@janhq/tauri-plugin-llamacpp-api'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/** Vendor prefixes add width without telling one card from another. */
const shortName = (name: string) =>
  name.replace(/^(NVIDIA|AMD|Intel\(R\))\s+(GeForce\s+|Radeon\s+)?/i, '')

/**
 * Where the local engine runs, from the devices the running worker itself
 * initialised. The fit dot beside the model is only an estimate; this is what
 * the engine actually has, so a CPU-only fallback is visible in the chat.
 */
export function EngineDeviceBadge({ className }: { className?: string }) {
  const [devices, setDevices] = useState<{ id: string; name: string }[] | null>(
    null
  )

  useEffect(() => {
    let cancelled = false
    const read = () =>
      getEngineInfo()
        .then((info) => {
          if (!cancelled) setDevices(info?.devices ?? null)
        })
        .catch(() => {
          if (!cancelled) setDevices(null)
        })
    void read()
    // The worker restarts when devices change, so a slow poll is enough.
    const timer = setInterval(read, 15000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  if (!devices) return null
  const gpus = devices.filter((d) => !/^CPU/i.test(d.id))
  const label = gpus.length
    ? `GPU · ${shortName(gpus[0].name)}${gpus.length > 1 ? ` +${gpus.length - 1}` : ''}`
    : 'CPU'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground tabular-nums',
            className
          )}
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {gpus.length
          ? `llama.cpp runs on ${gpus.map((d) => `${d.name} (${d.id})`).join(', ')}`
          : 'llama.cpp found no GPU and runs on the CPU'}
      </TooltipContent>
    </Tooltip>
  )
}
