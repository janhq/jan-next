import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { runProfile } from '../../../apps/cli/lib/profile-boot.js'
import { loadLayeredEnv } from '../../../packages/boot/app-boot/lib/index.js'

const home = process.env.JAN_HOME
const resources = process.env.JAN_OFFICE_RESOURCES
if (!home || !resources) throw new Error('Set JAN_HOME and JAN_OFFICE_RESOURCES')
const cwd = join(home, 'output')
await mkdir(cwd, { recursive: true })
// A base-only profile has no Desktop Host, so this package mounts the Office runtime itself.
const overlay = join(home, 'office-bundled.patch.yml')
await writeFile(overlay, JSON.stringify([{ id: 'office-templates', config: { resources, runtime: 'bundled', cli: process.env.JAN_OFFICE_CLI } }]))
const { ctx } = await runProfile({ environment: loadLayeredEnv('jan'), profile: process.env.JAN_OFFICE_PROFILE ?? 'office-r1', patchFiles: [overlay], args: [] })
try {
  await ctx.loader.await()
  const { createTemplateLibrary } = await import('../lib/templates.js')
  const { templateTool } = await import('../lib/template-tool.js')
  const { createDocxWorkflow, docxWriteTool } = await import('../lib/docx-workflow.js')
  const names = (await ctx.skills.list()).map(item => item.name)
  console.log('Office skills:', names.filter(name => name.startsWith('office-') || ['meeting-recap', 'saas-metrics-coach', 'official-notice-writer'].includes(name)))
  console.log('Office tools:', ctx.tools.definitions().map(item => item.name).filter(name => /office|dependencies/.test(name)))
  const library = await createTemplateLibrary(join(resources, 'templates'))
  const sessionId = `office-proof-${crypto.randomUUID()}`
  const handle = await ctx.agents.create({ sessionId, meta: { cwd } })
  const agent = handle.agent
  const exec = { agent, signal: new AbortController().signal }
  const modes = ctx.officeModes
  const docs = library.entry('meeting-minutes')
  await modes.select(sessionId, 'word')
  await modes.selectTemplate(sessionId, { id: docs.id, mode: docs.mode, revision: docs.revision })
  const docx = createDocxWorkflow(ctx, library, modes)
  const copy = await templateTool(ctx, library, modes, docx).execute({ template_id: docs.id }, exec)
  console.log('Prepared Word:', copy.workspace_path, 'paragraphs:', copy.editable_paragraphs.length)
  const target = `office-meeting-${crypto.randomUUID()}.docx`
  const paragraph = copy.editable_paragraphs.find(item => item.text && item.can_remove && item.runs.some(run => run.text))
  if (!paragraph) throw new Error('No editable Word template paragraph')
  const written = await docxWriteTool(docx).execute({ output_path: target, replacements: [{ id: paragraph.id, text: 'Jan Office proof: planning review, owner Alex, due Friday.' }] }, exec)
  console.log('Written Word:', written)
  const excel = library.entry('annual-business')
  await modes.select(sessionId, 'excel')
  await modes.selectTemplate(sessionId, { id: excel.id, mode: excel.mode, revision: excel.revision })
  const workbook = await templateTool(ctx, library, modes).execute({ template_id: excel.id }, exec)
  const dependencies = ctx.tools.definitions().find(tool => tool.name === 'load_workspace_dependencies')
  const runtime = await dependencies.execute({}, exec)
  console.log('Office Python:', runtime.python, 'openpyxl:', runtime.pythonDistributions.openpyxl)
  await writeFile(join(cwd, 'fill-business-workbook.py'), `from openpyxl import load_workbook\nfrom sys import argv\nw=load_workbook(argv[1]); s=w.active; s['B3']='Jan Office annual review'; s['B4']='Planning review - owner Alex, due Friday'; w.save(argv[2])\n`)
  const result = await ctx.subprocess.spawn({ argv: [runtime.python, '-I', '-B', join(cwd, 'fill-business-workbook.py'), join(cwd, workbook.workspace_path), join(cwd, `office-business-${sessionId}.xlsx`)], cwd, env: { PATH: process.env.PATH }, graceMs: 1000, stdio: { stdout: { maxBytes: 2048 }, stderr: { maxBytes: 2048 } } }).done
  if (result.exitCode !== 0) throw new Error('Bundled Python could not edit the selected workbook')
  console.log('Written Excel: office-business.xlsx')
  console.log('Prepared Excel:', workbook.workspace_path)
  await writeFile(join(cwd, 'build-deck.py'), `from pptx import Presentation\nfrom pptx.util import Inches, Pt\nfrom sys import argv\np=Presentation(); p.slide_width=Inches(13.333); p.slide_height=Inches(7.5)\ns=p.slides.add_slide(p.slide_layouts[6]); r=s.shapes.add_textbox(Inches(.6),Inches(.4),Inches(12),Inches(.8)).text_frame.paragraphs[0].add_run(); r.text='Jan Office deck'; r.font.size=Pt(30)\np.save(argv[1])\n`)
  const deck = join(cwd, `office-deck-${sessionId}.pptx`)
  const built = await ctx.subprocess.spawn({ argv: [runtime.python, '-I', '-B', join(cwd, 'build-deck.py'), deck], cwd, env: { PATH: process.env.PATH }, graceMs: 1000, stdio: { stdout: { maxBytes: 2048 }, stderr: { maxBytes: 2048 } } }).done
  if (built.exitCode !== 0) throw new Error('Bundled Python could not build a presentation')
  console.log('Written PowerPoint:', deck)
  await writeFile(join(home, 'proof.json'), JSON.stringify({ word: join(cwd, target), excel: join(cwd, `office-business-${sessionId}.xlsx`), powerpoint: deck, wordTemplate: copy.workspace_path, excelTemplate: excel.id, skills: names }, null, 2))
} finally {
  await ctx.fiber.dispose()
}
