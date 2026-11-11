/** Release-pinned downloads. Digests come from the GitHub release assets and the Hugging Face LFS index. */

/** Another place to fetch the same bytes, tried when the primary URL fails. */
export interface Mirror {
  readonly url: string
  /** Request headers the mirror needs. */
  readonly headers?: Readonly<Record<string, string>>
}

/** One verified downloadable file. */
export interface Artifact {
  readonly url: string
  readonly sha256: string
  readonly bytes: number
  /** Fallbacks for an HTTP or network failure; the digest still decides. */
  readonly mirrors?: readonly Mirror[]
}

/** llama.cpp build tag; a newer build is a deliberate edit of this table. */
export const ENGINE_VERSION = 'b12211'

const release = `https://github.com/ggml-org/llama.cpp/releases/download/${ENGINE_VERSION}`

/** Where `llama-server` runs: the Node platform and architecture, and the requested backend. */
export interface EngineTarget {
  platform: NodeJS.Platform
  arch: string
  backend: 'cpu' | 'vulkan'
}

/** A pinned engine archive and how to run what it contains. */
export interface EngineArtifact extends Artifact {
  /** Name of the server executable inside the archive. */
  readonly executable: string
  /** Whether the build offloads to a GPU by default (Metal on Apple Silicon, Vulkan where selected). */
  readonly gpu: boolean
  /** Short label for the build, shown to users ("cpu", "metal", "vulkan"). */
  readonly flavor: 'cpu' | 'metal' | 'vulkan'
}

/** GitHub release asset ids, for the API download route that survives `releases/download` outages. */
const ASSET_IDS: Readonly<Record<string, number>> = {
  'macos-arm64.tar.gz': 724566541,
  'macos-x64.tar.gz': 724566613,
  'ubuntu-arm64.tar.gz': 724566748,
  'ubuntu-vulkan-arm64.tar.gz': 724568826,
  'ubuntu-vulkan-x64.tar.gz': 724568866,
  'ubuntu-x64.tar.gz': 724568969,
  'win-cpu-arm64.zip': 724569086,
  'win-cpu-x64.zip': 724569181,
  'win-vulkan-arm64.zip': 724571355,
  'win-vulkan-x64.zip': 724571407,
}

function asset(name: string, sha256: string, bytes: number): Artifact {
  const id = ASSET_IDS[name]
  return {
    url: `${release}/llama-${ENGINE_VERSION}-bin-${name}`, sha256, bytes,
    ...id === undefined ? {} : { mirrors: [{
      url: `https://api.github.com/repos/ggml-org/llama.cpp/releases/assets/${id}`,
      headers: { accept: 'application/octet-stream' },
    }] },
  }
}

/**
 * Pinned engine archives by `platform-arch-backend`. macOS builds include Metal and ignore the
 * backend choice; Windows archives are zips, which `tar` (bsdtar) on Windows 10+ also unpacks.
 */
export const ENGINES: Readonly<Record<string, EngineArtifact>> = {
  'linux-x64-cpu': { ...asset('ubuntu-x64.tar.gz', '962924b5431bc1237a9e5d26ba072d37b6fe05f79b495206e7ff6134887624c5', 23_109_987), executable: 'llama-server', gpu: false, flavor: 'cpu' },
  'linux-x64-vulkan': { ...asset('ubuntu-vulkan-x64.tar.gz', '9759acd293d3738f39d3ceed740bd3125d87dfb492ef8c4f00114d3393d37942', 35_924_677), executable: 'llama-server', gpu: true, flavor: 'vulkan' },
  'linux-arm64-cpu': { ...asset('ubuntu-arm64.tar.gz', '6eed2da01c098f814170e941e11a8d91eed200a9a2923eac805fe116b14aff30', 18_759_007), executable: 'llama-server', gpu: false, flavor: 'cpu' },
  'linux-arm64-vulkan': { ...asset('ubuntu-vulkan-arm64.tar.gz', '60cd8d013eb2c539d07db45d01376909804b6b2a51fa28ef4e51cd6b846a6741', 29_209_302), executable: 'llama-server', gpu: true, flavor: 'vulkan' },
  'darwin-arm64': { ...asset('macos-arm64.tar.gz', '4da4edb437358d31d55938ad849d262ca31b0e0ffb35e9caedb727a0cd5a8f0f', 16_711_245), executable: 'llama-server', gpu: true, flavor: 'metal' },
  'darwin-x64': { ...asset('macos-x64.tar.gz', '6055cc672cc5c744481bb88ac1a7739ff476966c8a190ddaa20676034693a358', 12_455_590), executable: 'llama-server', gpu: false, flavor: 'cpu' },
  'win32-x64-cpu': { ...asset('win-cpu-x64.zip', '23729000408c6968faf5e322afc99319d3b8c576ba872ef7663d9b89810090f3', 24_886_431), executable: 'llama-server.exe', gpu: false, flavor: 'cpu' },
  'win32-x64-vulkan': { ...asset('win-vulkan-x64.zip', '20954cbad1a4626436c6ebaed5e48477f68427b075934689f360301ac426a2f1', 37_845_757), executable: 'llama-server.exe', gpu: true, flavor: 'vulkan' },
  'win32-arm64-cpu': { ...asset('win-cpu-arm64.zip', 'bf52f65602d713a4a13ed366a8ba8d924558bb43be04b7a37f4f5f506a6b6512', 13_236_751), executable: 'llama-server.exe', gpu: false, flavor: 'cpu' },
  'win32-arm64-vulkan': { ...asset('win-vulkan-arm64.zip', '06c268aa8505a0ba71b8b6992df78af0b955c63d01a2417dd76279d00e5a3b4e', 25_768_892), executable: 'llama-server.exe', gpu: true, flavor: 'vulkan' },
}

/**
 * Pick the pinned engine for a machine.
 * @param target - platform, architecture and requested backend.
 * @returns the engine archive, or undefined where no prebuilt build exists.
 */
export function engineFor(target: EngineTarget): EngineArtifact | undefined {
  if (target.platform === 'darwin') return ENGINES[`darwin-${target.arch}`]
  return ENGINES[`${target.platform}-${target.arch}-${target.backend}`]
}
