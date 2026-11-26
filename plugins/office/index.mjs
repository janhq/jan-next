import Schema from '@janhq/schemastery'
import * as skillOffice from '@janhq/jan-skill-office'
import * as workspaceDependencies from '@janhq/jan-tool-workspace-dependencies'
import { officeSkills } from './skills.mjs'

/** Cordis identity of the Office plugin. */
export const name = 'jan-office'

/** Office switches, edited from Customize > Plugins > Office. */
export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('Offer the Office skills to agents.'),
  word: Schema.boolean().default(true).description('Word documents (.docx).'),
  powerpoint: Schema.boolean().default(false).description('PowerPoint presentations (.pptx); off until switched on.'),
  excel: Schema.boolean().default(true).description('Excel workbooks (.xlsx).'),
  operations: Schema.boolean().default(true).description('Render pages, recalculate formulas and export PDF with LibreOffice Kit.'),
})

const env = name => process.env[name] || undefined

/**
 * Register the selected Office skills, with the bundled Python payload and LibreOffice Kit when the carrier names them.
 * The Desktop Host sets `JAN_BUNDLED_*` before the profile loads; elsewhere the skills use their packaged assets.
 * @param {import('@janhq/cordis').Context} ctx - Host context.
 * @param {{ enabled: boolean, word: boolean, powerpoint: boolean, excel: boolean, operations: boolean }} config - Switches.
 */
export async function apply(ctx, config) {
  // The plugin draws its own settings page, so the generated editor stays out of Settings.
  ctx.inject(['settings'], scope => {
    scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber))
  })
  const skills = config.enabled ? officeSkills(config) : []
  if (skills.length === 0) return
  const source = env('JAN_BUNDLED_PRIMARY_RUNTIME')
  if (source !== undefined) {
    const root = env('JAN_BUNDLED_PRIMARY_RUNTIME_ROOT')
    await ctx.plugin(workspaceDependencies, { source, ...root === undefined ? {} : { root } })
  }
  const assetRoot = env('JAN_BUNDLED_OFFICE_SKILLS')
  const node = env('JAN_BUNDLED_OFFICE_NODE')
  const cli = config.operations ? env('JAN_BUNDLED_OFFICE_CLI') : false
  await ctx.plugin(skillOffice, {
    skills,
    ...assetRoot === undefined ? {} : { assetRoot },
    ...node === undefined ? {} : { node },
    ...cli === undefined ? {} : { cli },
  })
}
