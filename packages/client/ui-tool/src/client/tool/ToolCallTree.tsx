/** Root/subcall Tool composition with one keyed atomic dispatch path. */
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ToolCallBlock } from '@janhq/jan-client-ui-chat/client'
import type { ToolCallOwnerProps, ToolCallPhaseProps, ToolTreeProps } from '../contract/slots.ts'
import type { ToolTitles } from './title-source.ts'
import { toolRowModel } from './models/tool-call-model.ts'
import { toolResultImages } from './models/image-card-model.ts'
import { liveToolInput } from './models/live-input.ts'
import { GenericToolCard } from './toolviews/GenericToolCard.tsx'
import css from './ToolCallTree.module.css'

function toolCallPhase(block: ToolCallBlock): ToolCallPhaseProps {
  if ('kind' in block) return { phase: 'result', block }
  return block.phase === 'preparing' ? { phase: 'preparing', block } : { phase: 'start', block }
}

/** Resolve a Tool call's wire name from its current stage. */
function callName(call: ToolCallPhaseProps): string {
  return call.phase === 'result' ? call.block.call?.name ?? '' : call.block.name
}

function ToolDuration({ start, end }: { start: number; end?: number }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (end !== undefined) return
    const timer = window.setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [end])
  const ms = Math.max(0, (end ?? now) - start)
  const seconds = end !== undefined && ms < 10_000 ? Math.round(ms / 100) / 10 : Math.floor(ms / 1000)
  const locale = document.documentElement.lang || undefined
  const format = (value: number, unit: 'hour' | 'minute' | 'second') =>
    new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' }).format(value)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  const label = [hours > 0 && format(hours, 'hour'), (hours > 0 || minutes > 0) && format(minutes, 'minute'), format(seconds % 60, 'second')]
    .filter(Boolean).join(' ')
  return <span className={css.duration}>{label}</span>
}

/** One atomic call dispatched through the Tool-owned keyed slot. */
const ToolCall = memo(function ToolCall({
  renderSlot, callId, toolName, call, openFile, renderFallback, cwd, home, inspectCall, loadImage, useDisclosure, titles,
  traceDetailsVisible, t, children,
}: Pick<ToolTreeProps, 'renderSlot' | 'openFile' | 'cwd' | 'inspectCall' | 'loadImage' | 'useDisclosure' | 'traceDetailsVisible' | 't'> & {
  renderFallback: (owner: ToolCallOwnerProps) => ReactNode
  callId: string
  toolName: string
  call: ToolCallPhaseProps
  home?: string | undefined
  titles: ToolTitles
  children?: ReactNode
}) {
  const owner: ToolCallOwnerProps = useMemo(() => ({
    callId,
    toolName,
    ...call,
    openFile,
    cwd,
    home,
    loadImage,
    titles,
    useDisclosure,
    inspect: inspectCall === undefined ? undefined : () => { inspectCall(callId) },
  }), [callId, toolName, call, openFile, cwd, home, loadImage, inspectCall, useDisclosure, titles])
  const autoReviewDenied = useMemo(
    () => call.phase === 'result' && toolRowModel(toolName, call.block).autoReviewDenial !== null,
    [toolName, call],
  )
  const images = useMemo(() => traceDetailsVisible !== false && call.phase === 'result'
    ? toolResultImages(call.block.content) : null, [call, traceDetailsVisible])
  const input = traceDetailsVisible !== false && call.phase !== 'result' ? liveToolInput(toolName, call.block.args) : ''
  return (
    <div
      className={css.callRow}
      data-chat-anchor-key={`call:${callId}`}
      data-chat-call-id={callId}
    >
      <div className={css.cardLine}>
        <div className={css.card}>
          {autoReviewDenied
            ? renderFallback(owner)
            : renderSlot('tool.call.toolview', owner, {
              entryKey: toolName,
              fallback: renderFallback(owner),
            })}
        </div>
        {renderSlot('tool.call.status', {
          callId,
          toolName,
          settledAt: call.phase === 'result' ? call.block.time : undefined,
        })}
        {call.phase === 'start' && <ToolDuration start={call.block.time} />}
        {call.phase === 'result' && call.block.callTime !== null && (
          <ToolDuration start={call.block.callTime} end={call.block.time} />
        )}
      </div>
      {input !== '' && <pre className={css.liveInput} aria-label={t('row.input')}>{input}</pre>}
      {images !== null && (
        <div className={css.inlineImages}>
          {renderSlot('tool.call.images', { images, loadImage, align: 'start', thumbnail: true, lazy: true })}
        </div>
      )}
      {children}
    </div>
  )
})

const ToolCallBranch = memo(function ToolCallBranch({
  renderSlot, block, cwd, home, openFile, renderFallback, inspectCall, loadImage, useDisclosure, titles, traceDetailsVisible, t,
}: Pick<ToolTreeProps, 'renderSlot' | 'cwd' | 'openFile' | 'inspectCall' | 'loadImage' | 'useDisclosure' | 'traceDetailsVisible' | 't'> & {
  titles: ToolTitles
  renderFallback: (owner: ToolCallOwnerProps) => ReactNode
  block: ToolCallBlock
  home?: string | undefined
}) {
  const call = useMemo(() => toolCallPhase(block), [block])
  return (
    <ToolCall
      renderSlot={renderSlot}
      callId={call.block.callId}
      toolName={callName(call)}
      call={call}
      openFile={openFile}
      renderFallback={renderFallback}
      cwd={cwd}
      home={home}
      inspectCall={inspectCall}
      useDisclosure={useDisclosure}
      loadImage={loadImage}
      titles={titles}
      traceDetailsVisible={traceDetailsVisible}
      t={t}
    >
      {call.phase !== 'preparing' && call.block.subCalls.length > 0 ? (
        <div className={css.subCalls} data-subcalls>
          {call.block.subCalls.map(child => (
            <ToolCallBranch
              key={child.callId}
              renderSlot={renderSlot}
              block={child}
              cwd={cwd}
              home={home}
              openFile={openFile}
              renderFallback={renderFallback}
              inspectCall={inspectCall}
              useDisclosure={useDisclosure}
              loadImage={loadImage}
              titles={titles}
              traceDetailsVisible={traceDetailsVisible}
              t={t}
            />
          ))}
        </div>
      ) : null}
    </ToolCall>
  )
})

/**
 * Render one root Tool call and its recursive children through the same
 * atomic keyed dispatch.
 * @param props - whole-Tool owner data and the Tool-owned child-slot share.
 * @returns the Tool call tree.
 */
export function ToolCallTree({
  renderSlot, node, cwd, openFile, inspectCall, loadImage, useDisclosure, useHostInfo, useTitles, t,
  traceDetailsVisible,
  useContextMenu, sessionId, resolveFilePath,
}: ToolTreeProps) {
  const { getTriggerProps } = useContextMenu()
  const getFileTriggerProps = useCallback((path: string) => getTriggerProps(() => ({
    kind: 'file', value: { sessionId, path: resolveFilePath(path) },
  })), [getTriggerProps, sessionId, resolveFilePath])
  const renderFallback = useCallback((owner: ToolCallOwnerProps) =>
    <GenericToolCard {...owner} t={t} getFileTriggerProps={getFileTriggerProps} />, [t, getFileTriggerProps])
  const home = useHostInfo(info => info.home)
  const titles = useTitles(view => view)
  return (
    <ToolCallBranch
      renderSlot={renderSlot}
      block={node.data.root}
      cwd={cwd}
      home={home}
      openFile={openFile}
      renderFallback={renderFallback}
      inspectCall={inspectCall}
      useDisclosure={useDisclosure}
      loadImage={loadImage}
      titles={titles}
      traceDetailsVisible={traceDetailsVisible}
      t={t}
    />
  )
}
