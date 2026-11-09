/** Resumable, verified downloads: `<file>.partial` is resumed with HTTP Range and renamed only after its digest matches. */
import { createHash, type Hash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Artifact } from './artifacts.ts'

/** Why a download failed, without raw causes, signed URLs or local paths. */
export class DownloadError extends Error {
  constructor(
    readonly reason: 'http' | 'integrity' | 'network' | 'storage',
    readonly resource: string,
    detail?: string,
    options?: ErrorOptions,
  ) {
    super(`Could not download ${resource}: ${detail ?? reason}`, options)
  }
}

const STORAGE = /^(ENOSPC|EDQUOT|EACCES|EPERM|EROFS)$/

async function sizeOf(path: string): Promise<number | undefined> {
  try { return (await stat(path)).size }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function hashInto(digest: Hash, path: string, signal: AbortSignal): Promise<void> {
  for await (const chunk of createReadStream(path, { signal })) digest.update(chunk as Buffer)
}

/**
 * Whether a file exists with the artifact's exact size and digest.
 * @param path - candidate file.
 * @param artifact - pinned identity.
 * @param signal - cancellation.
 * @returns true only for a verified match.
 */
export async function isVerified(path: string, artifact: Artifact, signal: AbortSignal): Promise<boolean> {
  const size = await sizeOf(path)
  if (size !== artifact.bytes) return false
  const digest = createHash('sha256')
  await hashInto(digest, path, signal)
  return digest.digest('hex') === artifact.sha256
}

/**
 * Download one artifact to `destination`, resuming a previous partial file.
 * @param artifact - pinned URL, size and digest.
 * @param destination - final path; written only after verification.
 * @param resource - short label for errors ("engine", "model").
 * @param signal - cancellation; the partial file is kept so a later call resumes.
 * @param report - progress callback with received and total bytes.
 */
export async function download(
  artifact: Artifact,
  destination: string,
  resource: string,
  signal: AbortSignal,
  report: (receivedBytes: number, totalBytes: number) => void,
): Promise<void> {
  const sources = [{ url: artifact.url }, ...artifact.mirrors ?? []]
  for (const [index, source] of sources.entries()) {
    try {
      await downloadFrom(artifact, source.url, source.headers ?? {}, destination, resource, signal, report)
      return
    } catch (error) {
      const retryable = error instanceof DownloadError && (error.reason === 'http' || error.reason === 'network')
      if (signal.aborted || !retryable || index === sources.length - 1) throw error
    }
  }
}

async function downloadFrom(
  artifact: Artifact,
  url: string,
  headers: Readonly<Record<string, string>>,
  destination: string,
  resource: string,
  signal: AbortSignal,
  report: (receivedBytes: number, totalBytes: number) => void,
): Promise<void> {
  signal.throwIfAborted()
  const partial = `${destination}.partial`
  try {
    await mkdir(dirname(destination), { recursive: true })
    if (await isVerified(destination, artifact, signal)) {
      report(artifact.bytes, artifact.bytes)
      return
    }
    let offset = await sizeOf(partial) ?? 0
    if (offset > artifact.bytes) { await rm(partial, { force: true }); offset = 0 }
    const digest = createHash('sha256')
    if (offset > 0) await hashInto(digest, partial, signal)

    let received = offset
    if (offset < artifact.bytes) {
      const response = await fetch(url, {
        signal, redirect: 'follow', headers: { ...headers, ...offset > 0 ? { range: `bytes=${offset}-` } : {} },
      })
      if (!response.ok || !response.body) {
        await response.body?.cancel()
        throw new DownloadError('http', resource, `HTTP ${response.status}`)
      }
      let append = offset > 0
      if (append && response.status !== 206) {
        // The server ignored the range: start over from the full body.
        append = false
        received = 0
      }
      const hash = append ? digest : createHash('sha256')
      report(received, artifact.bytes)
      const counting = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length
          if (received > artifact.bytes) { callback(new DownloadError('integrity', resource, 'larger than expected')); return }
          hash.update(chunk)
          report(received, artifact.bytes)
          callback(null, chunk)
        },
      })
      await pipeline(response.body, counting, createWriteStream(partial, { flags: append ? 'a' : 'w', mode: 0o600 }), { signal })
      if (received !== artifact.bytes || hash.digest('hex') !== artifact.sha256) {
        await rm(partial, { force: true })
        throw new DownloadError('integrity', resource, 'checksum mismatch')
      }
    } else if (digest.digest('hex') !== artifact.sha256) {
      await rm(partial, { force: true })
      throw new DownloadError('integrity', resource, 'checksum mismatch')
    }
    signal.throwIfAborted()
    await rename(partial, destination)
    report(artifact.bytes, artifact.bytes)
  } catch (error) {
    // Oversized or corrupt bytes must not be resumed by the next attempt.
    if (error instanceof DownloadError && error.reason === 'integrity') await rm(partial, { force: true })
    if (signal.aborted || error instanceof DownloadError) throw error
    const code = (error as NodeJS.ErrnoException).code
    if (typeof code === 'string' && STORAGE.test(code)) throw new DownloadError('storage', resource, code, { cause: error })
    throw new DownloadError('network', resource, error instanceof Error ? error.message : String(error), { cause: error })
  }
}
