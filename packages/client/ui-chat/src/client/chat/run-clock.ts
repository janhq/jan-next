/** Live elapsed time of a running Turn, shared by the running status and a live process header. */
import { useEffect, useState } from 'react'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { formatRunDuration, LIVE_RUN_CLOCK_INTERVAL_MS } from './message-chrome.ts'

/**
 * Tick once a second from the Turn's start, without announcing the ticks.
 * @param startTime - Turn start in epoch milliseconds; undefined shows no clock.
 * @param stopped - Freeze the shown time, e.g. while the Client cannot observe the Session.
 * @param t - Chat translator.
 * @returns the localized " - 7s" suffix, or null without a start time.
 */
export function useRunDurationLabel(startTime: number | undefined, stopped: boolean, t: ChatViewSlotProps['t']): string | null {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (startTime === undefined || stopped) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, LIVE_RUN_CLOCK_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [startTime, stopped])
  return startTime === undefined ? null : t('chat.running.duration', {
    duration: formatRunDuration(Math.max(1000, now - startTime), t).map(part => part.text).join(''),
  })
}
