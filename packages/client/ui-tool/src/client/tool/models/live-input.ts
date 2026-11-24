import type { ToolCallBlock } from './tool-call-model.ts'

/**
 * Read the decoded body fields a tool has streamed so far, including open strings.
 * @param name - Wire tool name.
 * @param args - Lazy argument reader owned by the Chat tool node.
 * @returns Input body text, or an empty string until a body field has text.
 */
export function liveToolInput(name: string, args: ToolCallBlock['args']): string {
  switch (name) {
    case 'write': return args.text('content') ?? ''
    case 'edit': {
      const before = args.text('old_string') ?? ''
      const after = args.text('new_string') ?? ''
      return before === '' ? after : after === '' ? before : `${before}\n${after}`
    }
    case 'apply_patch': return args.text('input') ?? ''
    case 'bash':
    case 'pwsh': return args.text('command') ?? ''
    case 'run_code': return args.text('code') ?? ''
    default: {
      const fields: string[] = []
      for (const key of args.keys()) {
        if (key === 'description') continue
        const value = args.text(key)
        if (value !== undefined && value !== '') fields.push(`${key}: ${value}`)
      }
      return fields.join('\n')
    }
  }
}
