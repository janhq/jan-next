/**
 * This utility is to extract cortexso model description from README.md file
 * @returns
 */
export const extractDescription = (text?: string) => {
  if (!text) return text
  const normalizedText = removeYamlFrontMatter(text)
  const overviewPattern = /(?:##\s*Overview\s*\n)([\s\S]*?)(?=\n\s*##|$)/
  const matches = normalizedText?.match(overviewPattern)
  let extractedText =
    matches && matches[1]
      ? matches[1].trim()
      : normalizedText?.slice(0, 500).trim()

  // Remove image markdown syntax ![alt text](image-url)
  extractedText = extractedText?.replace(/!\[.*?\]\(.*?\)/g, '')

  // Remove <img> HTML tags
  extractedText = extractedText?.replace(/<img[^>]*>/g, '')

  return extractedText
}
/**
 * Remove YAML (HF metadata) front matter from content
 * @param content
 * @returns
 */
export const removeYamlFrontMatter = (content: string): string => {
  return content.replace(/^---\n([\s\S]*?)\n---\n/, '')
}

/**
 * Extract model name from repo path, e.g. cortexso/tinyllama -> tinyllama
 * @param modelId
 * @returns
 */
export const extractModelName = (model?: string) => {
  return model?.split('/')[1] ?? model
}

/**
 * Extract model name from repo path, e.g. https://huggingface.co/cortexso/tinyllama -> cortexso/tinyllama
 * @param modelId
 * @returns
 */
export const extractModelRepo = (model?: string) => {
  return model?.replace('https://huggingface.co/', '')
}

export const selectDefaultQuant = <T extends { model_id: string }>(
  quants: T[] | undefined,
  preferred: readonly string[]
): T | undefined => {
  if (!quants?.length) return undefined
  return (
    quants.find((q) =>
      preferred.some((p) => q.model_id.toLowerCase().includes(p))
    ) ?? quants[0]
  )
}

export const extractQuantLabel = (modelId?: string): string | null => {
  if (!modelId) return null
  const match = modelId.match(
    /(IQ\d+(?:_[A-Z0-9]+)+|Q\d+(?:_[A-Z0-9]+)*|BF16|F16|F32)(?:[-_.][^-_.]*)?$/i
  )
  return match ? match[1].toUpperCase() : null
}
