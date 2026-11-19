import type { ContextFormed } from '@janhq/jan-llm'
import type {} from '@janhq/jan-browser-use'
import type {} from '../../packages/attachment/attachment/lib/types/index.d.ts'

// The source is accepted by current Session readers without a schema migration.
declare module '@janhq/jan-llm' {
  interface MessageSourceMap {
    'jan-browser': { kind: 'jan-browser' } & ContextFormed
  }
}
