/** Resolvable stand-in for the generated `./remote` contribution when this package has no built `lib/`. */
import type { TypertRemoteContribution } from '@janhq/jan-typert-protocol'

const contribution: TypertRemoteContribution = { package: '@janhq/jan-api-llama-cpp-controller', descriptors: [] }
export default contribution
