/**
 * Whether a tool call ran the shell. DSH's shell tool is `pwsh` on Windows and
 * `bash` elsewhere; turns saved by Jan's old agent say `shell`.
 */
export const isRecordedShellCall = (toolName: string): boolean =>
  toolName === 'shell' || toolName === 'bash' || toolName === 'pwsh'
