/** Durable file deliveries produced by the present tool. */
import type { ToolCallId } from '@janhq/jan-llm/brand'

/** A declared filesystem file whose current contents remain at its source path. */
export interface PresentedFile {
  /** Original absolute path or path relative to the Session working directory. */
  path: string
  /** Optional description supplied by the model. */
  description?: string
}

/**
 * One distinct file a Session has presented, addressed by the latest
 * `deliverables/presented` event that declared it. `seq` and `index` are the
 * coordinates the Host's file-open routes accept.
 */
export interface PresentedFileEntry extends PresentedFile {
  /** Turn of the declaring event. */
  turn: number
  /** Sequence of the declaring event within its Session. */
  seq: number
  /** Index of the file within the declaring event's `files`. */
  index: number
  /** Unix epoch milliseconds the declaring event was committed. */
  time: number
}

declare module '@janhq/jan-session/types' {
  interface SessionEventMap {
    /** Declared filesystem files from a successful final present result, including nested calls. */
    'deliverables/presented': { turn: number; callId: ToolCallId; files: PresentedFile[] }
  }
}

declare module '@janhq/jan-session-projection/types' {
  interface SessionProjectionMap {
    /** Distinct files the Session presented, oldest declaration first; a re-declared path moves to the end. */
    presentedFiles: PresentedFileEntry[]
  }
}
