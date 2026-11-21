import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orcaCommand, orcaWorkspaces, workspaceOf } from '../orca.mjs'

const reply = result => ({ stdout: JSON.stringify({ ok: true, result }) })

test('Orca workspaces carry their project name and leave out archived and remote ones', async () => {
  const exec = async (_command, args) => args[0] === 'repo'
    ? reply({ repos: [{ id: 'r1', displayName: 'jan-next' }] })
    : reply({
      worktrees: [
        { repoId: 'r1', path: '/code/jan-next', displayName: 'main', hostId: 'local' },
        { repoId: 'r1', path: '/code/jan-next-ui', displayName: 'feature/ui' },
        { repoId: 'r1', path: '/code/old', displayName: 'old', isArchived: true },
        { repoId: 'r1', path: '/srv/x', displayName: 'remote box', hostId: 'remote-1' },
      ]
    })
  const found = await orcaWorkspaces(exec, 'orca')
  assert.deepEqual(found.map(({ name, project }) => [name, project]), [['main', 'jan-next'], ['feature/ui', 'jan-next']])
})

test('a missing Orca CLI says how to get one', async () => {
  const exec = async () => { throw Object.assign(new Error('spawn orca ENOENT'), { code: 'ENOENT' }) }
  await assert.rejects(orcaWorkspaces(exec, 'orca'), /not on PATH/)
})

test('an Orca error reply is reported, not read as an empty list', async () => {
  const exec = async () => ({ stdout: JSON.stringify({ ok: false, error: { message: 'Orca is not running' } }) })
  await assert.rejects(orcaWorkspaces(exec, 'orca'), /Orca is not running/)
})

for (const platform of ['linux', 'darwin', 'win32']) {
  test(`on ${platform} the CLI name follows Orca's own rule`, () => {
    assert.equal(orcaCommand({ ORCA_CLI_COMMAND: 'orca-dev' }, platform), 'orca-dev')
    assert.equal(orcaCommand({}, platform), platform === 'linux' ? 'orca-ide' : 'orca')
  })
}

test('a session belongs to the innermost workspace holding its folder', () => {
  const workspaces = [{ path: '/code' }, { path: '/code/jan-next' }, { path: '/code/jan-next-ui' }]
  assert.equal(workspaceOf(workspaces, '/code/jan-next/packages/a', 'linux').path, '/code/jan-next')
  assert.equal(workspaceOf(workspaces, '/code/jan-next-ui', 'linux').path, '/code/jan-next-ui')
  assert.equal(workspaceOf(workspaces, '/code/other', 'linux').path, '/code')
  assert.equal(workspaceOf(workspaces, '/elsewhere', 'linux'), undefined)
  assert.equal(workspaceOf(workspaces, undefined, 'linux'), undefined)
})

test('Windows folder case does not split a session from its workspace', { skip: process.platform !== 'win32' && 'needs Windows path resolution' }, () => {
  const workspaces = [{ path: 'C:\\Users\\me\\Code\\jan-next' }]
  assert.equal(workspaceOf(workspaces, 'c:\\users\\me\\code\\Jan-Next\\src', 'win32')?.path, 'C:\\Users\\me\\Code\\jan-next')
})
