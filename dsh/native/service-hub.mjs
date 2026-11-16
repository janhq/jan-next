import { invoke } from './runtime.mjs'
const core = { invoke }
export const getServiceHub = () => ({ core: () => core })
