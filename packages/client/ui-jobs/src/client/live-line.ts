/** The one line of live output a tool-call row can show. */

/** Bytes of tail scanned; a line longer than this is cut at its start. */
const SCAN_CHARS = 4_096

// CSI sequences, OSC strings (BEL or ST terminated), and single-character escapes.
const ESCAPES = /\u001B\[[0-?]*[ -/]*[@-~]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\u001B[@-Z\\-_]/g
// Remaining C0 controls except tab and newline render as nothing.
const CONTROLS = /[\u0000-\u0008\u000B-\u001F\u007F]/g

/**
 * The latest non-empty output line as a terminal would show it: a carriage
 * return rewrites its line, so only the text after the last one counts, and
 * escape sequences are dropped.
 * @param text - accumulated output tail.
 * @returns the line, or undefined when the output has no visible text yet.
 */
export function latestLine(text: string): string | undefined {
  const lines = text.slice(-SCAN_CHARS).split('\n')
  for (const line of lines.reverse()) {
    for (const segment of line.split('\r').reverse()) {
      const visible = segment.replace(ESCAPES, '').replace(CONTROLS, '').replace(/\t/g, ' ').trim()
      if (visible !== '') return visible
    }
  }
  return undefined
}
