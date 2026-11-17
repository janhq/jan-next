import { isAbsolute, join } from 'node:path'
import * as officeSkills from '@janhq/jan-skill-office'
import * as workspaceDependencies from '@janhq/jan-tool-workspace-dependencies'
import { createTemplateLibrary } from './lib/templates.js'
import { registerBusinessSkills } from './lib/business-skills.js'
import { registerOfficeContext, registerOfficeRoutes } from './lib/modes.js'
import { templateTool } from './lib/template-tool.js'
import { createDocxWorkflow, docxWriteTool, registerDocxDelivery } from './lib/docx-workflow.js'

export const name = 'desktop-office'
export const inject = ['skills', 'officeModes', 'tools', 'workingDirectory', 'sandboxPolicy', 'sandbox', 'subprocess']

export async function apply(ctx, config) {
  if (!config || typeof config.resources !== 'string' || !isAbsolute(config.resources)
    || typeof config.cli !== 'string' || !isAbsolute(config.cli)) {
    throw new Error('desktop-office: absolute Office resources and LibreOffice CLI paths are required')
  }
  const primaryRuntime = join(config.resources, 'primary-runtime')
  const paths = await workspaceDependencies.resolvePrimaryRuntime(primaryRuntime)
  await ctx.plugin(workspaceDependencies, { source: primaryRuntime })
  await ctx.plugin(officeSkills, {
    assetRoot: join(config.resources, 'office-skills'),
    node: paths.node ?? process.execPath,
    cli: config.cli,
  })
  registerBusinessSkills(ctx)
  const library = await createTemplateLibrary(join(config.resources, 'templates'))
  registerOfficeContext(ctx, library, ctx.officeModes)
  const docx = createDocxWorkflow(ctx, library, ctx.officeModes, config.resources)
  ctx.tools.register(templateTool(ctx, library, ctx.officeModes, docx))
  ctx.tools.register(docxWriteTool(docx))
  registerDocxDelivery(ctx, library, ctx.officeModes, docx)
  ctx.inject(['connection'], routes => registerOfficeRoutes(routes, library, ctx.officeModes))
}
