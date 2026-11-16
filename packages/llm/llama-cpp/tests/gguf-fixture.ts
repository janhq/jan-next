/** Builds minimal GGUF v3 files: a metadata header with no tensors, padded to a size. */

type Value = string | number | boolean

function text(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8')
  const length = Buffer.alloc(8)
  length.writeBigUInt64LE(BigInt(bytes.length))
  return Buffer.concat([length, bytes])
}

function entry(key: string, value: Value): Buffer {
  const type = Buffer.alloc(4)
  if (typeof value === 'string') { type.writeUInt32LE(8); return Buffer.concat([text(key), type, text(value)]) }
  if (typeof value === 'boolean') { type.writeUInt32LE(7); return Buffer.concat([text(key), type, Buffer.from([value ? 1 : 0])]) }
  type.writeUInt32LE(4)
  const number = Buffer.alloc(4)
  number.writeUInt32LE(value)
  return Buffer.concat([text(key), type, number])
}

/**
 * @param metadata - keys and values; numbers are written as uint32.
 * @param size - total file size; the header is padded with zero bytes.
 * @returns the file contents.
 */
export function ggufFile(metadata: Readonly<Record<string, Value>>, size = 0): Buffer {
  const head = Buffer.alloc(24)
  head.write('GGUF', 0, 'ascii')
  head.writeUInt32LE(3, 4)
  head.writeBigUInt64LE(0n, 8)
  head.writeBigUInt64LE(BigInt(Object.keys(metadata).length), 16)
  const header = Buffer.concat([head, ...Object.entries(metadata).map(([key, value]) => entry(key, value))])
  return Buffer.concat([header, Buffer.alloc(Math.max(0, size - header.length))])
}

/** Metadata of a small Qwen3-like chat model with the given trained context. */
export function chatModel(contextLength: number): Record<string, Value> {
  return {
    'general.architecture': 'qwen3', 'general.file_type': 15,
    'qwen3.context_length': contextLength, 'qwen3.block_count': 28, 'qwen3.embedding_length': 1024,
    'qwen3.attention.head_count': 16, 'qwen3.attention.head_count_kv': 8,
    'qwen3.attention.key_length': 128, 'qwen3.attention.value_length': 128,
    'tokenizer.chat_template': '{{ messages }}',
  }
}
