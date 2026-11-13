/**
 * Whether a recorded tool call ran the shell, for displaying saved history.
 * DSH names its shell tool `bash`; turns saved by Jan's old agent say `shell`.
 */
export const isRecordedShellCall = (toolName: string): boolean =>
  toolName === 'shell' || toolName === 'bash'
