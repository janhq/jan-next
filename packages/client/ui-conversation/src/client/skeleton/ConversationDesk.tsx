/** The main desk's per-pane seat, carried through the existing Conversation slot tree. */
import { createContext } from 'react'

/** The pane whose Conversation header is rendering. */
export interface ConversationDeskSeat {
  readonly leading: boolean
  readonly primary: boolean
  readonly stripTarget?: HTMLElement | undefined
}

/** The root desk supplies its seat only to main Conversation occurrences. */
export const ConversationDeskContext = createContext<ConversationDeskSeat | undefined>(undefined)
