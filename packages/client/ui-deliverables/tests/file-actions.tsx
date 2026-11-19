/** Capture delivery action ownership without duplicating the opening-control implementation. */
import type { PropsRenderSlots, SlotMap } from '@janhq/jan-client-ui-slots'
import type {} from '../src/client/index.ts'

/** Slot renderer exposing the owning route and gesture for component tests. */
export const renderFileActions: PropsRenderSlots<'deliverables.file.actions' | 'deliverables.review.file.actions' | 'deliverables.preview.actions'>['renderSlot'] = (name: string, input: object) => {
  if (name === 'deliverables.preview.actions') {
    const props = input as SlotMap['deliverables.preview.actions']['owner']
    return <button type="button" onClick={() => { props.getSurface()?.setAttribute('data-inspected', '') }}>Inspect preview surface</button>
  }
  const props = input as SlotMap['deliverables.file.actions']['owner']
  return props.available ? <button type="button" data-action-url={props.actionUrl} disabled={props.pending}
    onClick={() => { void props.onAction('open') }}>Native file action</button> : null
}
