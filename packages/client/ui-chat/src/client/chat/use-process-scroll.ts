/** Capped process-group scrolling and fades over the shared follow controller. */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type DOMAttributes, type KeyboardEvent, type RefObject } from 'react'
import { scrollMetrics, useScrollFollow } from './use-scroll-follow.ts'

interface ScrollEdges { readonly canScrollUp: boolean; readonly canScrollDown: boolean }
const AT_REST: ScrollEdges = { canScrollUp: false, canScrollDown: false }
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])

/**
 * Observe one group's body and content without coupling its follow intent to the outer transcript.
 * Wheel, touchstart, any pointerdown, and unprevented scroll keys interrupt active animations,
 * including events from editable controls; subsequent position sampling determines follow intent.
 * @param bodyRef - capped scrolling body.
 * @param contentRef - uncapped content whose size reports growth.
 * @param open - local disclosure state.
 * @param capped - whether the display mode retains the group's height cap.
 * @param fullTrace - whether the reader explicitly removed the cap.
 * @returns edge fades, DOM event bindings, and one-shot positioning for manual opening.
 */
export function useProcessScroll(
  bodyRef: RefObject<HTMLDivElement>, contentRef: RefObject<HTMLDivElement>, open: boolean, capped: boolean, fullTrace: boolean,
): {
  edges: ScrollEdges
  events: Pick<DOMAttributes<HTMLDivElement>, 'onScroll' | 'onWheel' | 'onTouchStart' | 'onPointerDown' | 'onKeyDown'>
  initialize: (position: 'top' | 'bottom' | number) => void
} {
  const follow = useScrollFollow(false, 1)
  const initialPosition = useRef<'top' | 'bottom' | number | null>(null)
  const [edges, setEdges] = useState<ScrollEdges>(AT_REST)
  const initialize = useCallback((position: 'top' | 'bottom' | number) => { initialPosition.current = position }, [])
  const sync = useCallback((cause: 'resize' | 'scroll' | 'scrollend') => {
    const body = bodyRef.current
    let next = AT_REST
    if (open && capped && body !== null && body.closest('[hidden]') === null) {
      let metrics = scrollMetrics(body)
      const initial = cause === 'resize' ? initialPosition.current : null
      if (initial !== null) {
        metrics = follow.jump(body, metrics, initial === 'bottom' ? metrics.floor : initial === 'top' ? 0 : initial)
        if (initial !== 'bottom') follow.setFollowing(false)
        initialPosition.current = null
      } else {
        const wasAnimating = follow.animating
        if (cause === 'scrollend') follow.settle(metrics)
        else follow.sample(metrics, cause === 'resize' ? false : undefined)
        if (follow.active && (cause === 'resize' || (cause === 'scrollend' && wasAnimating))) {
          metrics = follow.toBottom(body, metrics, 'smooth')
        }
      }
      next = { canScrollUp: metrics.top > 1, canScrollDown: metrics.top < metrics.floor - 1 }
    } else follow.reset()
    setEdges(previous => previous.canScrollUp === next.canScrollUp && previous.canScrollDown === next.canScrollDown
      ? previous : next)
  }, [bodyRef, capped, follow, open])
  const syncRef = useRef(sync)
  useLayoutEffect(() => { syncRef.current = sync }, [sync])
  const interrupt = useCallback(() => {
    const body = bodyRef.current
    if (body !== null && follow.animating) follow.interrupt(body, scrollMetrics(body))
  }, [bodyRef, follow])
  const events = useMemo(() => ({
    onScroll: () => { sync('scroll') },
    onWheel: interrupt,
    onTouchStart: interrupt,
    onPointerDown: interrupt,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (!event.defaultPrevented && SCROLL_KEYS.has(event.key)) interrupt()
    },
  }), [interrupt, sync])

  useLayoutEffect(() => {
    interrupt()
    follow.reset()
    if (!capped || !open) initialPosition.current = null
  }, [capped, follow, interrupt, open])
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (body === null || !open || fullTrace || typeof ResizeObserver === 'undefined') return
    const unbind = follow.bind(body)
    const observer = new ResizeObserver(() => { syncRef.current('resize') })
    const onScrollEnd = (event: Event): void => { if (event.target === body) syncRef.current('scrollend') }
    body.addEventListener('scrollend', onScrollEnd)
    observer.observe(body)
    if (contentRef.current !== null) observer.observe(contentRef.current)
    return () => {
      unbind()
      observer.disconnect()
      body.removeEventListener('scrollend', onScrollEnd)
    }
  }, [bodyRef, contentRef, follow, fullTrace, open])
  return { edges, events, initialize }
}
