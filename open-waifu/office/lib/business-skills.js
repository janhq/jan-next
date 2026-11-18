import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { BUNDLED_SKILL_RANK } from '@janhq/jan-skill'

const provider = 'dsh-desktop-office-business'
const definitions = [
  { name: 'official-notice-writer', description: 'Official notices and memos: write organizational notices, announcements and memos from the audience, purpose and current materials, with office-docx and the official memo template for an editable Word file.' },
  { name: 'meeting-recap', description: 'Meeting minutes: organize topics, discussion, decisions, action items, owners and deadlines, delivered with office-docx and the meeting minutes example.' },
  { name: 'work-report-writer', description: 'Work reports: turn current records into daily, weekly and monthly reports and period summaries, checking deliverables, numbers, risks and next-period plans, with office-docx for an editable Word file.' },
  { name: 'research-writer', description: 'Research reports: organize research questions, evidence, sources, judgments and risks, with office-docx for an editable report.' },
  { name: 'saas-metrics-coach', description: 'Business metrics: check revenue, MRR, customer retention, growth assumptions and calculation definitions, with office-xlsx for business analysis.' },
  { name: 'dataset-health-audit', description: 'Data quality: check missing values, outliers, units, definitions, duplicates and reproducible calculations, with office-xlsx for business data analysis.' },
  { name: 'data-viz-gen', description: 'Data charts: choose charts and annotations by data type and business question, with office-xlsx keeping native formulas and charts.' }
]

/** Business methods share the official file-authoring skills and runtime. */
export function registerBusinessSkills(ctx, root = fileURLToPath(new URL('../business-skills/', import.meta.url))) {
  const candidates = definitions.map(item => ({ ...item, provider, source: 'bundled', rank: BUNDLED_SKILL_RANK,
    invocation: { modelInvocable: true, userInvocable: true },
    resourceBase: { kind: 'directory', path: join(root, item.name) },
    locator: join(root, item.name, 'SKILL.md') }))
  ctx.skills.registerProvider(() => ({ name: provider, list: async () => candidates,
    async get(candidate, options = {}) {
      const item = candidates.find(value => value.name === candidate.name)
      if (!item) return undefined
      const body = await readFile(item.locator, { encoding: 'utf8', signal: options.signal })
      return { ...item, content: body.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, '').trim()
        + '\n\n## Desktop file delivery\n\nThe user\'s materials supply the facts; the selected template supplies the structure and layout. Use office-docx for Word and office-xlsx for Excel, with the installed-level Python returned by load_workspace_dependencies. Complete whatever the existing material determines, and mark unknown fields as to be confirmed. After changing an Excel file, recalculate it with the official Kit and check the key numbers. Deliver the final file with present.' }
    }
  }))
}
