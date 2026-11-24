import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { gitMetadataOf } from '../src/github-owner.ts'

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'jan-github-owner-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  return root
}

function repository(root: string, name: string, config: string): string {
  const path = join(root, name)
  mkdirSync(join(path, '.git'), { recursive: true })
  writeFileSync(join(path, '.git', 'config'), config)
  return path
}

const origin = (url: string) => `[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://github.com/other/repo.git\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "main"]\n\tremote = origin\n`

it.each([
  ['git@github.com:janhq/jan.git', 'janhq'],
  ['ssh://git@github.com/thinhlpg/jan-next', 'thinhlpg'],
  ['https://github.com/Menlo-Research/repo.git', 'Menlo-Research'],
  ['https://gitlab.com/janhq/jan.git', undefined],
  ['https://github.com.evil.example/janhq/jan.git', undefined],
])('reads the origin owner from %s', async (url, owner) => {
  expect((await gitMetadataOf(repository(scratch(), 'repo', origin(url))))?.githubOwner).toBe(owner)
})

it('finds the repository above a project folder and through a linked worktree', async () => {
  const root = scratch()
  const main = repository(root, 'main', origin('git@github.com:janhq/jan.git'))
  const nested = join(main, 'apps', 'web')
  mkdirSync(nested, { recursive: true })
  expect((await gitMetadataOf(nested))?.githubOwner).toBe('janhq')

  const linkedGitDir = join(main, '.git', 'worktrees', 'feature')
  mkdirSync(linkedGitDir, { recursive: true })
  writeFileSync(join(linkedGitDir, 'commondir'), '../..\n')
  const worktree = join(root, 'feature')
  mkdirSync(worktree)
  writeFileSync(join(worktree, '.git'), `gitdir: ${linkedGitDir}\n`)
  const head = join(linkedGitDir, 'HEAD')
  writeFileSync(head, 'ref: refs/heads/topic/feature\n')
  expect(await gitMetadataOf(worktree)).toEqual({
    githubOwner: 'janhq', repository: join(main, '.git'), branch: 'topic/feature',
  })
  writeFileSync(head, '0123456789abcdef0123456789abcdef01234567\n')
  expect(await gitMetadataOf(worktree)).toEqual({
    githubOwner: 'janhq', repository: join(main, '.git'), branch: '0123456',
  })
})

it('has no owner outside Git or without an origin remote', async () => {
  const root = scratch()
  const plain = join(root, 'plain')
  mkdirSync(plain)
  expect(await gitMetadataOf(plain)).toBeUndefined()
  const local = repository(root, 'local', '[core]\n\tbare = false\n')
  expect(await gitMetadataOf(local)).toEqual({ repository: join(local, '.git') })
})

it('ignores an oversized Git config even when the origin appears first', async () => {
  const content = origin('https://github.com/janhq/repo.git') + '#'.repeat(1024 * 1024)
  const path = repository(scratch(), 'oversized', content)
  expect(await gitMetadataOf(path)).toEqual({ repository: join(path, '.git') })
})
