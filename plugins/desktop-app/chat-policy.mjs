/** Chat mode can create artifacts, but it cannot read local media or overwrite files. */
export const name = 'jan-chat-policy'
export const inject = ['tools']

/** @param {import('@janhq/cordis').Context} ctx - Chat preset context. */
export function apply(ctx) {
  ctx.effect(function* () {
    yield ctx.tools.restrict({ deny: ['edit_image', 'transcribe_audio'] }, { allowUnregistered: true })

    // Tool execution is scope-filtered, but filesystem intents are unbound.
    // Mark only the executions that actually dispatch through this preset.
    const chatExecutions = new WeakSet()
    yield ctx.on('tools/execute', async (exec, next) => {
      chatExecutions.add(exec)
      try {
        return await next()
      } finally {
        chatExecutions.delete(exec)
      }
    })
    yield ctx.on('fs/write-intent', async (_target, actor, next) => {
      const intent = await next()
      return actor !== undefined && chatExecutions.has(actor) ? { kind: 'createIfAbsent' } : intent
    }, { prepend: true })
  }, 'jan-chat-policy')
}
