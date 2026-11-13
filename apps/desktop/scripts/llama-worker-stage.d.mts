/** Directory `pnpm run stage:llama-worker` writes and CI extracts the worker artifact into. */
export const LLAMA_WORKER_STAGE: string

/**
 * Read the platform and CPU architectures an ELF, Mach-O (thin or universal) or PE executable targets.
 * @param path - Executable to inspect.
 * @returns The platform its format runs on and its Node architecture names, omitting unknown machine types; undefined for any other file.
 */
export function executableTarget(path: string): { platform: NodeJS.Platform, archs: string[] } | undefined

/**
 * Reject packaging when the staged worker is absent or built for another platform or architecture; electron-builder only warns about a missing resource.
 * @param platform - Packaged platform, which selects the executable name.
 * @param arch - Packaged Node architecture, such as `x64` or `arm64`.
 * @param stage - Staged worker directory.
 */
export function assertStagedLlamaWorker(platform: NodeJS.Platform, arch: string, stage?: string): void
