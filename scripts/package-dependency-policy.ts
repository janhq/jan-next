/** Explicit exceptions and Host packages for the published dependency policy. */

/** Packages treated as Client/Host packages without declaring `jan.client`. */
const CLIENT_FACE_INCLUDE: readonly string[] = []

/** Packages exempted from automatic Client/Host treatment despite declaring `jan.client`. */
const CLIENT_FACE_EXCLUDE: readonly string[] = [
  '@janhq/jan-api-session-controller',
  '@janhq/jan-api-workspace-controller',
]

/** Host-only packages whose peer relays are deliberately flattened. */
const HOST_DEPENDENCY_PACKAGES: readonly string[] = [
  '@janhq/jan-llm',
  '@janhq/jan-session',
]

/** Required Cordis services whose Host imports are type-only. */
const REQUIRED_SERVICE_PEERS = {
  '@janhq/jan-api-terminal-controller': ['@janhq/jan-subprocess'],
} as const satisfies Readonly<Record<string, readonly string[]>>

/** Development-only package relationships not represented by source imports. */
const CONFIGURATION_ONLY_DEV_DEPENDENCIES = {
  '@janhq/jan-client-locale': ['@janhq/jan-api-remotes'],
  '@janhq/jan-client-ui-conversation': [
    '@janhq/jan-api-remotes',
    '@janhq/jan-client-ui-workspace',
  ],
  '@janhq/jan-client-ui-model-selection': ['@janhq/jan-client-ui-input-trigger'],
  '@janhq/jan-client-ui-sidebar': ['@janhq/jan-client-ui-workspace'],
  '@janhq/jan-client-ui-subagent': ['@janhq/jan-client-ui-input-trigger'],
  '@janhq/jan-client-ui-theme': ['@janhq/jan-api-remotes'],
  '@janhq/jan-client-ui-tool': ['@janhq/jan-api-remotes'],
} as const satisfies Readonly<Record<string, readonly string[]>>

/** Workspace packages whose complete runtime surface is safe across duplicate installations. */
const DUPLICATE_SAFE_PACKAGES: readonly string[] = [
  '@janhq/jan-brand',
  '@janhq/jan-lazy-require',
  '@janhq/jan-package-manifest',
  '@janhq/jan-typert-protocol',
  '@janhq/jan-util-code-language',
  '@janhq/jan-util-crypto',
  '@janhq/jan-util-values',
]

/**
 * Runtime exports whose values remain valid when npm installs another package copy.
 * New entries are forbidden by default. Automated agents must not add an
 * exception; every addition requires explicit human review and a dedicated,
 * prominent heading in the pull request description.
 */
const SAFE_HOST_DEPENDENCY_EXPORTS = {
  '@janhq/jan-atomic-write': ['withFileLock', 'writeFileAtomic'],
  '@janhq/jan-computer-use/brand': ['ComputerUseProviderName'],
  '@janhq/jan-credentials': ['credentialKey'],
  '@janhq/jan-deque': ['Deque'],
  // Builds a dispatcher from the resolved proxy policy; the caller owns and closes it.
  '@janhq/jan-http-proxy': ['createRouteDispatcher'],
  // The Liveshare wire codec and identity helpers are stateless functions over caller-owned values.
  '@janhq/jan-experimental-liveshare-protocol': [
    'LIVESHARE_CAPABILITIES', 'LIVESHARE_PROTOCOL_VERSION', 'parseRelayFrame', 'parseShareAccessState',
    'parseTunnelWorkerCommand', 'parseTunnelWorkerEvent', 'rawText', 'sendFrame', 'unsupportedFrameRefusal',
    'viewerRequestFields', 'identityFromKey', 'identityKeyOf',
  ],
  // The shipped profile templates are plain data; a consumer reads their bundle names only.
  '@janhq/jan-official-bundles': ['PROFILE_TEMPLATES'],
  '@janhq/jan-llm': ['callConfigEquals'],
  '@janhq/jan-session': ['SessionId'],
  '@janhq/jan-session-format': ['sessionFormatLogFilename'],
  '@janhq/jan-storage-domain': ['defineDomain'],
  '@janhq/jan-timeout': ['MAX_TIMER_DELAY_MS'],
  '@janhq/schemastery': ['default'],
} as const satisfies HostDependencyExports

/** Runtime exports that require every consumer to resolve the provider's shared peer instance. */
const PEER_REQUIRED_HOST_EXPORTS = {
  // Profile settings must match the installed Node provider's configuration schema.
  '@janhq/jan-ptc-runtime-node/configuration': ['resolvePersistentExecution'],
  // CUA checks UserQuestionError and preserves AttachmentError from image admission.
  '@janhq/jan-attachment': ['admitEncodedImages'],
  '@janhq/jan-user-questions': ['UserQuestionError'],
  // `instanceof` checks need the translator's own class instance.
  '@janhq/jan-experimental-translator': ['TranslationError'],
  // Stateless; a safe classification would turn the forge panel's forge and worktree peers into dependencies.
  '@janhq/jan-experimental-forge': ['changeRequestKey'],
  '@janhq/jan-experimental-worktree': ['generatedWorktreeName'],
  // The forge panel matches ctx.fs failures with `instanceof FsError`.
  '@janhq/jan-fs': ['FsError'],
  '@janhq/jan-scope': ['carrierKeyOf', 'createScope', 'scopeOf', 'scopeTarget'],
  // appendPluginRecord writes through the Session class's private log; pluginRecordOf is stateless.
  '@janhq/jan-session': ['SESSION_FORMAT_VERSION', 'appendPluginRecord', 'pluginRecordOf'],
  '@janhq/jan-session-persistence': ['SessionPersistenceNotFoundError'],
  // Readers recognize a deadline's TimeoutReason only by `instanceof` against their own copy.
  '@janhq/jan-timeout': ['deadline'],
} as const satisfies HostDependencyExports

/** Exact import specifier to reviewed runtime exports. */
type HostDependencyExports = Readonly<Record<string, readonly string[]>>

/** Complete configurable input to package dependency classification. */
export interface PackageDependencyPolicy {
  readonly clientFaceInclude: readonly string[]
  readonly clientFaceExclude: readonly string[]
  readonly hostPackages: readonly string[]
  readonly requiredServicePeers?: Readonly<Record<string, readonly string[]>>
  readonly configurationOnlyDevDependencies: Readonly<Record<string, readonly string[]>>
  readonly duplicateSafePackages?: readonly string[]
  readonly safeHostDependencyExports: HostDependencyExports
  readonly peerRequiredHostExports: HostDependencyExports
}

/** Repository dependency policy consumed by verification and benchmarking. */
export const PACKAGE_DEPENDENCY_POLICY: PackageDependencyPolicy = {
  clientFaceInclude: CLIENT_FACE_INCLUDE,
  clientFaceExclude: CLIENT_FACE_EXCLUDE,
  hostPackages: HOST_DEPENDENCY_PACKAGES,
  requiredServicePeers: REQUIRED_SERVICE_PEERS,
  configurationOnlyDevDependencies: CONFIGURATION_ONLY_DEV_DEPENDENCIES,
  duplicateSafePackages: DUPLICATE_SAFE_PACKAGES,
  safeHostDependencyExports: SAFE_HOST_DEPENDENCY_EXPORTS,
  peerRequiredHostExports: PEER_REQUIRED_HOST_EXPORTS,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a package manifest declares a dynamically loaded Client entry. */
export function hasClientDeclaration(janField: unknown): boolean {
  return isRecord(janField) && Object.hasOwn(janField, 'client')
}
