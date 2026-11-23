import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import css from './NotificationLayer.module.css'

const LAYER = 'data-jan-notifications'

/**
 * The one bottom-right notification stack, created on first use. Every
 * transient notice and notification card portals here, so notices that
 * arrive together pile up in one corner instead of covering each other.
 * @returns the stack element, attached to `document.body`.
 */
export function notificationLayer(): HTMLElement {
  const existing = document.body.querySelector<HTMLElement>(`:scope > [${LAYER}]`)
  if (existing !== null) return existing
  const layer = document.createElement('div')
  layer.setAttribute(LAYER, '')
  layer.className = css.layer ?? ''
  document.body.appendChild(layer)
  return layer
}

/**
 * Render a notification into the shared bottom-right stack. The newest one
 * sits in front; earlier ones step back diagonally behind it, and hovering
 * the stack fans them out into a readable column.
 * @param props.children - the notice or card; it owns its own surface.
 * @returns the portal into the stack.
 */
export function NotificationPortal({ children }: { children: ReactNode }) {
  return createPortal(<div className={css.item} data-jan-notification="">{children}</div>, notificationLayer())
}
