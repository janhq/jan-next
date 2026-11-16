import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// Bundled plugins live outside DSH's node_modules, so resolve DSH's own schema
// library from the running CLI entry.
const { default: z } = await import(pathToFileURL(createRequire(process.argv[1]).resolve('@deepseek-ai/schemastery')).href)

export const name = 'ow-onboarding'

// The welcome step records its acknowledgement here, in this plugin's profile
// entry, so it follows the DSH profile rather than a Jan settings file.
export const Config = z.object({
  completedVersion: z.string().default('').volatile(),
})

export function apply() {}
