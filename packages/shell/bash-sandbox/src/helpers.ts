/** Shell-result projection over shared sandbox diagnostics. */
import type { ShellRunResult } from '@janhq/jan-shell'
import { matchesSignature } from '@janhq/jan-sandbox'
export { isRunnerSpawnFailure, classifyRunnerFailure, matchesSignature } from '@janhq/jan-sandbox'

/**
 * Classify a failed run against the selected backend's denial dialect.
 * @param result - settled foreground run.
 * @param signatures - case-insensitive denial substrings from the active wrap.
 * @returns whether the failed run matches that denial dialect.
 */
export function classifyDenial(result: ShellRunResult, signatures: readonly string[]): boolean {
  return matchesSignature(result.exitCode, result.stderr.text, signatures)
}
