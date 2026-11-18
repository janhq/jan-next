import { isAbsolute, join } from 'node:path'
import { createTemplateLibrary } from './lib/templates.js'
import { registerBusinessSkills } from './lib/business-skills.js'
import { registerOfficeContext, registerOfficeRoutes } from './lib/modes.js'
import { templateTool } from './lib/template-tool.js'
import { createDocxWorkflow, docxWriteTool, registerDocxDelivery } from './lib/docx-workflow.js'

export const name = 'ow-desktop-office'
export const inject = ['skills', 'officeModes', 'tools', 'workingDirectory', 'sandboxPolicy', 'sandbox', 'subprocess']

/**
 * @param config.resources Absolute directory holding the prepared `templates/` catalogue.
 * @param config.runtime `host` (default) relies on the application Host's Office skills and
 *   `load_workspace_dependencies`; Desktop registers both, and a second registration aborts startup.
 *   `bundled` mounts them from `primary-runtime/`, `office-skills/` and `cli` for profiles without that Host.
 */
export async function apply(ctx, config) {
  if (!config || typeof config.resources !== 'string' || !isAbsolute(config.resources)) {
    throw new Error('ow-desktop-office: an absolute Office resources path is required')
  }
  const runtime = config.runtime ?? 'host'
  if (runtime === 'bundled') {
    if (typeof config.cli !== 'string' || !isAbsolute(config.cli)) throw new Error('ow-desktop-office: the bundled runtime requires an absolute LibreOffice CLI path')
    const [officeSkills, workspaceDependencies] = await Promise.all([import('@janhq/jan-skill-office'), import('@janhq/jan-tool-workspace-dependencies')])
    const primaryRuntime = join(config.resources, 'primary-runtime')
    const paths = await workspaceDependencies.resolvePrimaryRuntime(primaryRuntime)
    await ctx.plugin(workspaceDependencies, { source: primaryRuntime })
    await ctx.plugin(officeSkills, {
      assetRoot: join(config.resources, 'office-skills'),
      node: paths.node ?? process.execPath,
      cli: config.cli,
    })
  } else if (runtime !== 'host') throw new Error('ow-desktop-office: runtime must be "host" or "bundled"')
  registerBusinessSkills(ctx)
  const library = await createTemplateLibrary(join(config.resources, 'templates'))
  registerOfficeContext(ctx, library, ctx.officeModes)
  const docx = createDocxWorkflow(ctx, library, ctx.officeModes)
  ctx.tools.register(templateTool(ctx, library, ctx.officeModes, docx))
  ctx.tools.register(docxWriteTool(docx))
  registerDocxDelivery(ctx, library, ctx.officeModes, docx)
  ctx.inject(['connection'], routes => registerOfficeRoutes(routes, library, ctx.officeModes))
}
