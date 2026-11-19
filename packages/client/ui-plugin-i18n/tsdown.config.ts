import { readFileSync } from 'node:fs'
import { clientBundle } from '../tsdown.client.ts'

export default clientBundle(import.meta.dirname, ['lib/types/index.js'], {
  clientBanner: (fileName) => {
    if (fileName !== 'client.static.extrasmall.js') return undefined
    const license = readFileSync(new URL('../../LICENSE', import.meta.resolve('eld/extrasmall')), 'utf8')
    return ['//! ELD language detector, Copyright 2023 Nito T.M.', ...license.trimEnd().split('\n').map(line => `// ${line}`)].join('\n')
  },
})
