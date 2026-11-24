/** A local photo editor with one immutable background and undoable marks. */
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type PointerEvent } from 'react'
import { Button } from '@janhq/jan-client-ui-primitives'
import type { CaptureCardProps } from './contract.ts'
import styles from './capture.module.css'

/** Export the exact annotated pixels displayed in the review. */
export type PhotoExport = () => Promise<Blob | null>

type Tool = 'pen' | 'arrow' | 'box' | 'text'
type Point = { x: number; y: number }
type Mark =
  | { tool: 'pen'; color: string; points: Point[] }
  | { tool: 'arrow' | 'box'; color: string; start: Point; end: Point }
  | { tool: 'text'; color: string; start: Point; text: string }
const TOOLS = ['pen', 'arrow', 'box', 'text'] as const

function draw(ctx: CanvasRenderingContext2D, mark: Mark): void {
  const size = Math.max(2, ctx.canvas.width / 200)
  ctx.lineWidth = size
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = mark.color
  ctx.fillStyle = mark.color
  if (mark.tool === 'pen') {
    const first = mark.points[0]
    if (first === undefined) return
    ctx.beginPath()
    if (mark.points.length === 1) {
      ctx.arc(first.x, first.y, size / 2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.moveTo(first.x, first.y)
      for (const point of mark.points) ctx.lineTo(point.x, point.y)
      ctx.stroke()
    }
    return
  }
  const { start } = mark
  if (mark.tool === 'text') {
    ctx.font = `600 ${Math.max(14, size * 6)}px system-ui`
    ctx.textBaseline = 'top'
    ctx.fillText(mark.text, start.x, start.y, Math.max(1, ctx.canvas.width - start.x))
    return
  }
  const { end } = mark
  if (mark.tool === 'box') {
    ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y)
    return
  }
  const theta = Math.atan2(end.y - start.y, end.x - start.x)
  const head = Math.min(size * 4, Math.hypot(end.x - start.x, end.y - start.y) * 0.4)
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(end.x, end.y)
  ctx.moveTo(end.x - head * Math.cos(theta - Math.PI / 6), end.y - head * Math.sin(theta - Math.PI / 6))
  ctx.lineTo(end.x, end.y)
  ctx.lineTo(end.x - head * Math.cos(theta + Math.PI / 6), end.y - head * Math.sin(theta + Math.PI / 6))
  ctx.stroke()
}

/** Draw marks onto a photo and retain undo history until this draft closes. */
export function PhotoAnnotation({ blob, exporter, disabled, t }: {
  blob: Blob
  exporter: MutableRefObject<PhotoExport | null>
  disabled: boolean
  t: CaptureCardProps['t']
}) {
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState('#f04040')
  const [text, setText] = useState('')
  const [count, setCount] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const base = useRef<HTMLCanvasElement>(null)
  const layer = useRef<HTMLCanvasElement>(null)
  const marks = useRef<Mark[]>([])
  const pointer = useRef<{ id: number; mark: Mark }>()

  function redraw(): void {
    const ctx = layer.current?.getContext('2d')
    if (ctx == null) return
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    for (const mark of marks.current) draw(ctx, mark)
    if (pointer.current !== undefined) draw(ctx, pointer.current.mark)
  }

  useEffect(() => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      const target = base.current
      const overlay = layer.current
      if (target === null || overlay === null) return
      const ctx = target.getContext('2d')
      if (ctx === null || overlay.getContext('2d') === null) { setFailed(true); return }
      target.width = overlay.width = image.naturalWidth
      target.height = overlay.height = image.naturalHeight
      ctx.drawImage(image, 0, 0)
      setLoaded(true)
    }
    image.onerror = () => { setFailed(true) }
    image.src = url
    return () => { image.onload = image.onerror = null; URL.revokeObjectURL(url) }
  }, [blob])

  useLayoutEffect(() => {
    exporter.current = () => {
      if (!loaded || pointer.current !== undefined) return Promise.resolve(null)
      if (marks.current.length === 0) return Promise.resolve(blob)
      const background = base.current
      const overlay = layer.current
      if (background === null || overlay === null) return Promise.resolve(null)
      const output = document.createElement('canvas')
      output.width = background.width
      output.height = background.height
      const ctx = output.getContext('2d')
      if (ctx === null) return Promise.resolve(null)
      ctx.drawImage(background, 0, 0)
      ctx.drawImage(overlay, 0, 0)
      const { promise, resolve } = Promise.withResolvers<Blob | null>()
      output.toBlob(resolve, 'image/jpeg', 0.92)
      return promise
    }
    return () => { exporter.current = null }
  }, [blob, exporter, loaded])

  function position(event: PointerEvent<HTMLCanvasElement>): Point {
    const canvas = event.currentTarget
    const box = canvas.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - box.left) / box.width * canvas.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - box.top) / box.height * canvas.height)),
    }
  }

  function start(event: PointerEvent<HTMLCanvasElement>): void {
    if (disabled || !loaded || event.button !== 0 || pointer.current !== undefined) return
    const point = position(event)
    if (tool === 'text') {
      if (text.trim() === '') return
      marks.current.push({ tool, color, start: point, text: text.trim() })
      setCount(marks.current.length)
      redraw()
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    const mark: Mark = tool === 'pen' ? { tool, color, points: [point] } : { tool, color, start: point, end: point }
    pointer.current = { id: event.pointerId, mark }
    redraw()
  }

  function move(event: PointerEvent<HTMLCanvasElement>): void {
    const active = pointer.current
    if (active === undefined || active.id !== event.pointerId) return
    const point = position(event)
    if (active.mark.tool === 'pen') active.mark.points.push(point)
    else if (active.mark.tool !== 'text') active.mark.end = point
    redraw()
  }

  function finish(event: PointerEvent<HTMLCanvasElement>, keep: boolean): void {
    const active = pointer.current
    if (active === undefined || active.id !== event.pointerId) return
    pointer.current = undefined
    if (keep) {
      const point = position(event)
      if (active.mark.tool === 'pen') {
        const last = active.mark.points.at(-1)
        if (last?.x !== point.x || last.y !== point.y) active.mark.points.push(point)
      } else if (active.mark.tool !== 'text') active.mark.end = point
      marks.current.push(active.mark)
      setCount(marks.current.length)
    }
    redraw()
  }

  return <>
    <div className={styles.controls} role="group" aria-label={t('annotationTools')}>
      {TOOLS.map(option => <Button key={option} size="sm" variant={tool === option ? 'primary' : 'outline'}
        disabled={disabled || !loaded} aria-pressed={tool === option} onClick={() => { setTool(option) }}>{t(option)}</Button>)}
      <label className={styles.color}>{t('color')}<input type="color" value={color} disabled={disabled || !loaded} onChange={(event) => { setColor(event.currentTarget.value) }} /></label>
      <Button size="sm" variant="outline" disabled={disabled || count === 0} onClick={() => {
        marks.current.pop()
        setCount(marks.current.length)
        redraw()
      }}>{t('undo')}</Button>
    </div>
    {tool === 'text' && <label className={styles.field}>{t('annotationText')}
      <input type="text" value={text} maxLength={160} disabled={disabled} onChange={(event) => { setText(event.currentTarget.value) }} />
    </label>}
    {failed && <p role="alert" className={styles.error}>{t('captureFailed')}</p>}
    <div className={styles.canvas} hidden={!loaded}>
      <canvas ref={base} aria-hidden="true" />
      <canvas ref={layer} aria-label={t('photoPreview')} onPointerDown={start} onPointerMove={move}
        onPointerUp={(event) => { finish(event, true) }} onPointerCancel={(event) => { finish(event, false) }}
        onLostPointerCapture={(event) => { finish(event, false) }} />
    </div>
  </>
}
