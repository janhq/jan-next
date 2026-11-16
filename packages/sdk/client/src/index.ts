/**
 * TypeScript client SDK for the Jan runtime: spawn the
 * same-version `jan --profile sdk` runtime as a subprocess and drive agent
 * turns over stdio JSON-RPC. `Jan` is the high-level run API;
 * `HarnessClient` is the lower-level protocol client. A pure library — it
 * registers nothing on a Cordis context; named profiles and ordered patch
 * files customize the runtime process it spawns.
 *
 * @module @janhq/jan-sdk-client
 */

export { Jan, HarnessSession, validatedSessionEvent } from './api.ts'
export type { RunOptions } from './api.ts'
export {
  HarnessClient,
  RequestTimeoutError,
  SdkProtocolError,
  TransportClosedError,
} from './client.ts'
export type { NotificationSubscription } from './client.ts'
export { JsonRpcResponseError } from '@janhq/jan-sdk-protocol'
export type {
  ContentBlock,
  SdkEncodedImageBlock,
  SdkPromptContentBlock,
  SdkUserQuestionAnswer,
  SdkUserQuestionResult,
  SdkUserQuestionRequest,
  JanOptions,
  HarnessClientOptions,
  HarnessNotification,
  NotificationFilter,
  RunResult,
} from './types.ts'
