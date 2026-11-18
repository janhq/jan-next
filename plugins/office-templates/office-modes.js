// A presentation package normally provides officeModes. Jan's built-in Office
// workflows do not require that package, so keep document selections scoped
// to the live session while sharing the same service contract with Office.
export const name = 'office-templates-modes'

export function apply(ctx) {
  const states = new Map()
  ctx.on('session/disposed', session => states.delete(session.id))
  const state = id => states.get(id) ?? { documentMode: null, presentationMode: null, selectedDocumentTemplate: null }
  const update = (id, change) => {
    states.set(id, { ...state(id), ...change })
    return true
  }
  ctx.provide('officeModes', {
    state: async id => state(id),
    select: async (id, mode) => update(id, { documentMode: mode, selectedDocumentTemplate: null }),
    selectTemplate: async (id, template) => update(id, { documentMode: template.mode, selectedDocumentTemplate: template }),
    deselectTemplate: async id => update(id, { selectedDocumentTemplate: null }),
    record: async (id, operation, facts) => {
      ctx.logger.info('office %s session=%s facts=%o', operation, id, facts)
      return true
    },
  })
}
