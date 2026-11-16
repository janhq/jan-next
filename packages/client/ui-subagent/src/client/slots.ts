/** Extension position below the root conversation's subagent catalog. */

declare module '@janhq/jan-client-ui-slots' {
  interface SlotMap {
    /** Content below the root Session's subagent tree. */
    'conversation.session.header.actions.subagent.footer': {
      kind: 'list'
      scope: 'session'
    }
  }
}

export {}
