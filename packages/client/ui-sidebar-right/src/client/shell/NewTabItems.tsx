/**
 * Rows for the chat tab strip's `+` menu: one per tab type the guide offers
 * (Files, Terminal, Browser and whatever plugins register), opening that type
 * in the pane's chat sidebar. A blank chat has no sidebar yet, so its rows are
 * disabled with the reason.
 */
import type { ReactNode } from 'react'
import { MenuItemButton } from '@janhq/jan-client-ui-primitives'
import type { ShortcutCatalogEntry } from '@janhq/jan-client-shortcuts/client'
import type { ObservableSnapshot } from '@janhq/jan-client-store'
import type { SessionId } from '@janhq/jan-session/types'
import type { InjectFace, PropsLocale } from '@janhq/jan-client-ui-slots'
import type { ConversationNewTabItemOwnerProps } from '@janhq/jan-client-ui-conversation/client'
import type { SidebarRightGuideBox } from '../tab-registry.ts'
import { CubeGlyph } from '../tabs/guide/GuideTitle.tsx'

/** What the rows need from the plugin: the offered types, their shortcuts, and the open. */
export interface NewTabItemsInjected {
  readonly hooks: {
    readonly guideEntries: ObservableSnapshot<readonly SidebarRightGuideBox[]>
    readonly shortcuts: ObservableSnapshot<readonly ShortcutCatalogEntry[]>
  }
  /**
   * Open a tab type in one chat's sidebar, expanding it.
   * @param sessionId - the pane's chat.
   * @param kind - the tab type.
   */
  readonly openIn: (sessionId: SessionId, kind: string) => void
}

type Props = ConversationNewTabItemOwnerProps & InjectFace<NewTabItemsInjected> & PropsLocale<'sidebarRight'>

/** @param props - the pane's chat, the menu dismissal, and the offered types. @returns one row per type. */
export function NewTabItems({ sessionId, dismiss, useGuideEntries, useShortcuts, openIn, t }: Props): ReactNode {
  const entries = useGuideEntries(value => value)
  const shortcuts = useShortcuts(value => value)
  return entries.map((entry) => {
    const Icon = entry.icon ?? CubeGlyph
    const shortcut = shortcuts.find(candidate => candidate.id === entry.commandId)
    return (
      <MenuItemButton
        key={`${entry.providerId}:${entry.id}`}
        icon={<Icon size={16} />}
        {...shortcut === undefined || shortcut.keys.length === 0 ? {} : { shortcut: { keys: shortcut.keys, aria: shortcut.aria } }}
        disabled={sessionId === undefined}
        {...sessionId === undefined ? { disabledReason: t('newTab.needsChat') } : {}}
        onSelect={() => {
          if (sessionId === undefined) return
          dismiss()
          openIn(sessionId, entry.kind)
        }}
      >
        {entry.title()}
      </MenuItemButton>
    )
  })
}
