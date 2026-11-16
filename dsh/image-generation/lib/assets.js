// MIT License. Copyright (c) 2026 DataElement. Ported for open-waifu.
import { lstat, mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { ImageError, MAX_IMAGE_BYTES } from './provider.js'

export async function workspaceFor(ctx, exec) {
  const session = exec.agent?.session
  if (!session?.header.cwd) throw new ImageError('WORKSPACE', 'Choose a workspace for the generated image.')
  const policy = ctx.sandboxPolicy.resolve({ session })
  if (!['workspace-write', 'danger-full-access'].includes(policy.mode)) throw new ImageError('POLICY', 'Image generation requires workspace write permission.')
  const root = await realpath(session.header.cwd)
  if (root !== await realpath(policy.workspaceRoot) || !(await lstat(root)).isDirectory()) throw new ImageError('WORKSPACE', 'The session workspace does not match its write policy.')
  exec.signal?.throwIfAborted()
  return root
}

/** A predictable subdirectory, checked before the paid request and again before commit. */
export async function assetDirectory(root, create = false) {
  let directory = root
  for (const part of ['.workbuddy', 'generated-images']) {
    directory = path.join(directory, part)
    try {
      const info = await lstat(directory)
      if (info.isSymbolicLink() || !info.isDirectory() || await realpath(directory) !== directory) throw new ImageError('ASSET_PATH', 'The generated image directory must be a regular workspace directory.')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      if (!create) continue
      try { await mkdir(directory, { mode: 0o700 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
      const info = await lstat(directory)
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw new ImageError('ASSET_PATH', 'The generated image directory must be a regular workspace directory.')
    }
  }
  return directory
}

// Providers are asked for PNG; preserve their bytes instead of loading a native codec.
export async function normalizeImage(raw) {
  if (raw.length < 33 || raw.length > MAX_IMAGE_BYTES || raw.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || raw.readUInt32BE(8) !== 13 || raw.toString('ascii', 12, 16) !== 'IHDR') {
    throw new ImageError('IMAGE', 'The provider must return a PNG image.', 502)
  }
  const width = raw.readUInt32BE(16), height = raw.readUInt32BE(20)
  if (!width || !height || width > 8192 || height > 8192 || width * height > 64_000_000) {
    throw new ImageError('IMAGE', 'The provider returned unsupported image dimensions.', 502)
  }
  return { data: raw, width, height }
}
