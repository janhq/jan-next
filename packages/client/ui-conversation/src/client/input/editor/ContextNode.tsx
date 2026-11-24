/** Atomic composer context node: plugin-supplied model text shown as one labelled chip. */

import type { JSX } from 'react'
import { IconCloseOutlineRegular, IconCodeOutlineRegular } from '@janhq/jan-client-ui-primitives'
import type {
  EditorConfig, LexicalEditor, LexicalNode, NodeKey, SerializedLexicalNode, Spread,
} from 'lexical'
import { createCommand, DecoratorNode } from 'lexical'
import css from './ContextNode.module.css'

/** Localized non-persisted labels applied by the owning input shell. */
export interface ContextNodeLabels {
  readonly remove: string
}

const EMPTY_LABELS: ContextNodeLabels = { remove: '' }

/** JSON form used only by Lexical's editor-state APIs, not browser persistence. */
export type SerializedContextNode = Spread<{
  text: string
  label: string
}, SerializedLexicalNode>

/** Remove one context occurrence by its Lexical identity. */
export const REMOVE_CONTEXT_COMMAND = createCommand<NodeKey>('REMOVE_CONTEXT_COMMAND')

/** Pure React face of one context node: glyph, label, and a remove control. */
export function ContextNodeView({ editor, nodeKey, label, labels }: {
  readonly editor: LexicalEditor
  readonly nodeKey: NodeKey
  readonly label: string
  readonly labels: ContextNodeLabels
}) {
  return (
    <span className={css.chip} data-composer-context-chip="" title={label}>
      <IconCodeOutlineRegular size={14} className={css.icon} aria-hidden />
      <span className={css.label}>{label}</span>
      <button
        type="button"
        className={css.remove}
        aria-label={labels.remove}
        onPointerDown={(event) => { event.preventDefault(); event.stopPropagation() }}
        onKeyDown={(event) => { event.stopPropagation() }}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          editor.dispatchCommand(REMOVE_CONTEXT_COMMAND, nodeKey)
        }}
      >
        <IconCloseOutlineRegular size={12} />
      </button>
    </span>
  )
}

/** One plugin context represented as an atomic inline decorator whose text reaches the model verbatim. */
export class ContextNode extends DecoratorNode<JSX.Element> {
  __text: string
  __label: string
  __labels: ContextNodeLabels

  /** Lexical node registry type tag. */
  static override getType(): string {
    return 'context'
  }

  /** @param node - node to clone. @returns a copy carrying the same NodeKey. */
  static override clone(node: ContextNode): ContextNode {
    return new ContextNode(node.__text, node.__label, node.__labels, node.__key)
  }

  /** @param json - serialized editor node. @returns a fresh node with default runtime labels. */
  static override importJSON(json: SerializedContextNode): ContextNode {
    return new ContextNode(json.text, json.label)
  }

  /**
   * @param text - exact model-visible text.
   * @param label - chip label.
   * @param labels - runtime-only localized labels.
   * @param key - Lexical clone-path key; absent for fresh nodes.
   */
  constructor(text: string, label: string, labels: ContextNodeLabels = EMPTY_LABELS, key?: NodeKey) {
    super(key)
    this.__text = text
    this.__label = label
    this.__labels = labels
  }

  /** Serialize the context data without its runtime presentation state. */
  override exportJSON(): SerializedContextNode {
    return { ...super.exportJSON(), type: 'context', version: 1, text: this.__text, label: this.__label }
  }

  /** Mount one non-editable inline host. */
  override createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement('span')
    element.setAttribute('data-composer-context', '')
    element.setAttribute('contenteditable', 'false')
    return element
  }

  /** Updates reuse the existing host element. */
  override updateDOM(): boolean {
    return false
  }

  /** Contexts flow inline like quotes. */
  override isInline(): boolean {
    return true
  }

  /** Arrow movement crosses the chip without entering a NodeSelection. */
  override isKeyboardSelectable(): boolean {
    return false
  }

  /** Clipboard and model text is the supplied text, unchanged. */
  override getTextContent(): string {
    return this.getLatest().__text
  }

  /** Exact model-visible text. */
  getContextText(): string {
    return this.getLatest().__text
  }

  /** Chip label. */
  getLabel(): string {
    return this.getLatest().__label
  }

  /** Update the localized remove label without changing persisted context data. */
  setLabels(labels: ContextNodeLabels): void {
    if (this.getLatest().__labels.remove !== labels.remove) this.getWritable().__labels = labels
  }

  /** Render the chip. */
  override decorate(editor: LexicalEditor): JSX.Element {
    return <ContextNodeView editor={editor} nodeKey={this.__key} label={this.__label} labels={this.__labels} />
  }
}

/** @param text - model text. @param label - chip label. @param labels - runtime labels. @returns a fresh node. */
export function $createContextNode(text: string, label: string, labels: ContextNodeLabels): ContextNode {
  return new ContextNode(text, label, labels)
}

/** @param node - possible Lexical node. @returns whether it is a ContextNode. */
export function $isContextNode(node: LexicalNode | null | undefined): node is ContextNode {
  return node instanceof ContextNode
}
