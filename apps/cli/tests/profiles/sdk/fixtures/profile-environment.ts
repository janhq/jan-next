import { join } from 'node:path'
import { clearAmbientProxyEnv } from '../../../../../../scripts/test-proxy-environment.ts'
import { MOCK_MODEL_KEY_ENV } from './mock-model-route.ts'

/** Isolate SDK profile processes from ambient profile, runtime and Node loader settings. */
export function profileEnvironment(root: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('DSH_')))
  Object.assign(env, {
    DSH_PERMISSION_MODE: 'danger-full-access', DSH_TELEMETRY_DISABLED: '1',
    DSH_AGENTS_HOME: join(root, 'agents'), DSH_PRIMARY_RUNTIME: '',
    [MOCK_MODEL_KEY_ENV]: 'keyless-profile-test',
    NODE_OPTIONS: '', NODE_PATH: '',
  })
  clearAmbientProxyEnv(env)
  return env
}
