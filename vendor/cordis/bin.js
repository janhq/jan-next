#!/usr/bin/env node

import { Context } from '@janhq/cordis'
import { pathToFileURL } from 'node:url'
import Loader from '@janhq/cordis-plugin-loader'

const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@janhq/cordis-plugin-include',
  config: {
    path: './cordis.yml',
  },
})
