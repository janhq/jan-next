/**
 * The docked split tree: nested flex runs sized by each split's fractions, with a
 * draggable divider between neighbours. A live divider drag renders from the
 * preview fractions instead of the recorded ones — the gesture only settles one
 * intent when it ends.
 */
import { Fragment } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { LayoutState, NodeId, SplitId } from '../contract/types.ts'
import { getNode } from '../engine/tree.ts'
import type { PaneCallbacks } from './render.ts'
import { TabPanel } from './TabPanel.tsx'
import css from './dockkit.module.css'

/** Fractions a live divider drag is previewing for one split. */
export interface SizePreview {
  readonly splitId: SplitId
  readonly sizes: readonly number[]
}

/** One subtree of the docked layout. */
export interface PaneTreeProps {
  readonly state: LayoutState
  readonly nodeId: NodeId
  readonly callbacks: PaneCallbacks
  readonly preview: SizePreview | undefined
}

/** Render a split or pane node and everything under it. */
export function PaneTree({ state, nodeId, callbacks, preview }: PaneTreeProps): ReactNode {
  const node = getNode(state, nodeId)
  if (node.kind === 'pane') return <TabPanel state={state} pane={node} callbacks={callbacks} />
  const sizes = preview !== undefined && preview.splitId === node.id ? preview.sizes : node.sizes
  const horizontal = node.axis === 'row'
  return (
    <div
      className={clsx(css.split, node.axis === 'row' ? css.splitRow : css.splitColumn)}
      data-dockkit-split={node.id}
    >
      {node.children.map((childId, index) => (
        <Fragment key={childId}>
          {index > 0 && (
            <div
              className={css.divider}
              data-dockkit-divider={`${node.id}:${index - 1}`}
              role={callbacks.dividerLabel === undefined ? undefined : 'separator'}
              aria-label={callbacks.dividerLabel}
              aria-orientation={horizontal ? 'vertical' : 'horizontal'}
              aria-valuenow={Math.round(sizes.slice(0, index).reduce((total, size) => total + size, 0) * 100)}
              tabIndex={callbacks.dividerLabel === undefined ? undefined : 0}
              onKeyDown={(event) => {
                const backward = horizontal ? 'ArrowLeft' : 'ArrowUp'
                const forward = horizontal ? 'ArrowRight' : 'ArrowDown'
                if (event.key !== backward && event.key !== forward) return
                event.preventDefault()
                callbacks.onDividerNudge?.(node.id, index - 1, event.key === backward ? -0.05 : 0.05)
              }}
              onPointerDown={(event) => { callbacks.onDividerPressed(node.id, index - 1, event) }}
            />
          )}
          <div
            className={css.splitCell}
            data-dockkit-cell={`${node.id}:${index}`}
            style={{ flexGrow: sizes[index] }}
          >
            <PaneTree state={state} nodeId={childId} callbacks={callbacks} preview={preview} />
          </div>
        </Fragment>
      ))}
    </div>
  )
}
