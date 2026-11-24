import { useEffect, useRef, useState } from 'react'
import { Button } from './Button.tsx'
import { Modal } from './Modal.tsx'
import { writeClipboard } from './clipboard.ts'
import { buildFailureDetails, failureLogSource, type FailureDetails } from './failure-details.ts'
import { failureLabels } from './locales/failure-details.ts'
import css from './Toast.module.css'

async function copyDetails(text: Promise<string>): Promise<boolean> {
  const clipboard = navigator.clipboard
  /* oxlint-disable-next-line typescript/no-unnecessary-condition -- insecure contexts omit clipboard */
  if (typeof ClipboardItem === 'function' && clipboard?.write !== undefined) {
    try {
      // Register the clipboard write while the button press still grants clipboard access.
      await clipboard.write([new ClipboardItem({ 'text/plain': text.then(value => new Blob([value], { type: 'text/plain' })) })])
      return true
    } catch {
      // Fall back on hosts that do not support deferred writes.
    }
  }
  return writeClipboard(await text)
}

/**
 * Show failure diagnostics either as toast actions or as one inline Details button.
 * @param props.failure - Snapshot captured when the operation failed.
 * @param props.kind - Whether the trigger is an inline panel or a toast.
 * @param props.closeLabel - Dismiss label used by the dialog.
 * @param props.onActiveChange - Keeps the enclosing toast up across asynchronous actions and an open dialog.
 * @returns The trigger buttons and, when opened, the accessible details dialog.
 */
export function FailureActions({ failure, kind, closeLabel, onActiveChange }: {
  failure: FailureDetails
  kind: 'toast' | 'inline'
  closeLabel: string
  onActiveChange?: (active: boolean) => void
}) {
  const [details, copy, show, copied, copyFailed] = failureLabels(document.documentElement.lang)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<'copied' | 'failed' | null>(null)
  const [text, setText] = useState<string>()
  const read = useRef<Promise<string> | undefined>(undefined)
  const lifetime = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => { lifetime.current?.abort(); lifetime.current = undefined; read.current = undefined }, [])

  useEffect(() => { onActiveChange?.(open || busy) }, [open, busy, onActiveChange])
  const report = (signal: AbortSignal): Promise<string> => {
    if (read.current !== undefined) return read.current
    const source = failureLogSource()
    read.current = (async () => {
      let tail: string | undefined
      try { tail = await source?.readTail(AbortSignal.any([signal, AbortSignal.timeout(1_500)])) }
      catch { /* The local report remains available when the Host is offline. */ }
      const value = buildFailureDetails(failure, tail)
      if (!signal.aborted) setText(value)
      return value
    })()
    return read.current
  }
  const close = () => { setOpen(false) }
  const openDetails = (signal: AbortSignal): void => {
    setOpen(true)
    void report(signal)
  }
  const act = (kind: 'copy' | 'show'): void => {
    if (busy) return
    const signal = (lifetime.current ??= new AbortController()).signal
    const source = failureLogSource()
    if (kind === 'show' && source === undefined) { openDetails(signal); return }
    setBusy(true)
    setResult(null)
    void (async () => {
      try {
        if (kind === 'copy') {
          const success = await copyDetails(report(signal))
          if (signal.aborted) return
          setResult(success ? 'copied' : 'failed')
          if (success) return
        } else {
          await source?.open(AbortSignal.any([signal, AbortSignal.timeout(15_000)]))
          return
        }
      } catch {
        if (signal.aborted) return
        if (kind === 'copy') setResult('failed')
      } finally {
        if (!signal.aborted) setBusy(false)
      }
      openDetails(signal)
    })()
  }
  return <>
    {kind === 'inline'
      ? <Button variant="outline" size="sm" onClick={() => { openDetails((lifetime.current ??= new AbortController()).signal) }}>{details}</Button>
      : <span className={css.diagnosticActions}>
        <button type="button" className={css.diagnosticAction} aria-disabled={busy || undefined} onClick={() => { act('copy') }}>{copy}</button>
        <button type="button" className={css.diagnosticAction} aria-disabled={busy || undefined} onClick={() => { act('show') }}>{show}</button>
        {!open && result === 'copied' && <span className={css.diagnosticStatus} role="status">{copied}</span>}
      </span>}
    <Modal open={open} onClose={close} title={details} closeLabel={closeLabel} footer={<>
      {result !== null && <span className={css.diagnosticStatus} role="status">{result === 'copied' ? copied : copyFailed}</span>}
      {failureLogSource() !== undefined && <Button variant="outline" size="sm" disabled={busy} onClick={() => { act('show') }}>{show}</Button>}
      <Button variant="outline" size="sm" aria-disabled={busy || undefined} onClick={() => { act('copy') }}>{copy}</Button>
    </>}>
      <pre className={css.diagnosticText} tabIndex={0} aria-label={details} data-modal-autofocus>
        {text ?? buildFailureDetails(failure)}
      </pre>
    </Modal>
  </>
}
