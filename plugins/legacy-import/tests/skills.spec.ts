import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { importSkills, readSkillSource } from '../skills.mjs'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'jan-skills-'))
  roots.push(root)
  const home = join(root, 'home')
  const omp = join(home, '.omp', 'agent')
  const skill = async (folder: string, name: string, body: string) => {
    await mkdir(join(folder, name), { recursive: true })
    await writeFile(join(folder, name, 'SKILL.md'), body)
  }
  await skill(join(omp, 'skills'), 'writer', 'source writer')
  await skill(join(omp, 'skills'), 'kept', 'source kept')
  await mkdir(join(omp, 'skills', 'writer', 'node_modules', 'dep'), { recursive: true })
  await mkdir(join(omp, 'skills', 'no-skill-file'), { recursive: true })
  await writeFile(join(omp, 'AGENTS.md'), 'omp rules')
  await mkdir(join(omp, 'plugins', 'gitingest'), { recursive: true })
  const janHome = join(root, 'jan')
  await skill(join(janHome, 'skills'), 'kept', 'jan kept')
  return { root, home, omp, janHome, agentsHome: join(root, 'agents') }
}

it('copies ready skills and the instruction file without overwriting what Jan has', async () => {
  const { home, janHome, agentsHome } = await fixture()
  const scan = await readSkillSource('omp', { home, env: {}, janHome, agentsHome })
  expect(scan.skills.map((row: { name: string, status: string }) => [row.name, row.status])).toEqual([['kept', 'already here'], ['writer', 'ready']])
  expect(scan.others).toEqual([{ label: 'OMP plugins', path: expect.any(String), names: ['gitingest'] }])

  const result = await importSkills(scan, { skills: true, instructions: true })
  expect(result).toMatchObject({ imported: ['writer'], already: ['kept'], failed: [], instructions: { status: 'imported' } })
  expect(await readFile(join(janHome, 'skills', 'kept', 'SKILL.md'), 'utf8')).toBe('jan kept')
  expect(await readFile(join(janHome, 'skills', 'writer', 'SKILL.md'), 'utf8')).toBe('source writer')
  expect(await readdir(join(janHome, 'skills', 'writer'))).toEqual(['SKILL.md'])
  expect(await readFile(join(janHome, 'AGENTS.md'), 'utf8')).toBe('omp rules')
})

it('leaves skills in place when Jan reads the source folder through a link', async () => {
  const { home, omp, root, agentsHome } = await fixture()
  const janHome = join(root, 'linked-jan')
  await mkdir(janHome)
  await symlink(join(omp, 'skills'), join(janHome, 'skills'), 'junction')
  const scan = await readSkillSource('omp', { home, env: {}, janHome, agentsHome })
  expect(scan.skills.every((row: { status: string }) => row.status === 'already here')).toBe(true)
  expect((await importSkills(scan, { skills: true, instructions: false })).imported).toEqual([])
})
