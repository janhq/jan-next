/** Release family discovery, publish order, tag naming, and the bump judgements. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { officialClientBuildEnvironment, writeClientBuildRecord } from '../client-build-environment.ts'
import { ON_DEMAND_BUNDLES } from '../../packages/util/official-bundles/src/bundles.ts'
import { releaseFamily, type ReleaseMember } from './families.ts'
import { compareVersions, nextVendorVersion, planShared, reachesPayload } from './bump.ts'

/**
 * A release member standing in for a manifest on disk.
 * @param directory - repository-relative package directory.
 * @param name - package name.
 * @param manifest - manifest fields the subject reads.
 * @returns The member.
 */
function member(directory: string, name: string, manifest: Record<string, unknown> = {}): ReleaseMember {
  return { directory, name, version: '0.0.1', manifest }
}

const roots: string[] = []

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function buildFixture(environment: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'jan-release-build-'))
  roots.push(root)
  write(join(root, 'package.json'), `${JSON.stringify({ version: environment.JAN_CLIENT_VERSION ?? '0.0.1' })}\n`)
  write(join(root, 'apps/web/dist/index.html'), '<main></main>')
  write(join(root, 'packages/client/example/lib/client.js'), 'module.exports = {}\n')
  writeClientBuildRecord(root, environment)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe('release families', () => {
  it('publishes all current experimental packages', () => {
    const members = releaseFamily('jan').members(resolve(import.meta.dirname, '../..'))

    expect(members
      .filter(member => member.directory.startsWith('packages/experimental/'))
      .map(member => member.name)).toEqual([
      '@janhq/jan-action-cards',
      '@janhq/jan-experimental-api-speech-to-text',
      '@janhq/jan-experimental-auto-review',
      '@janhq/jan-experimental-badge-skill-bundle',
      '@janhq/jan-experimental-browser-use-chrome-devtools-mcp',
      '@janhq/jan-experimental-browser-use-playwright-mcp',
      '@janhq/jan-experimental-browser-use-runtime',
      '@janhq/jan-experimental-browser-use-stagehand-native',
      '@janhq/jan-experimental-claude-code-mods',
      '@janhq/jan-client-ui-action-cards',
      '@janhq/jan-experimental-client-ui-claude-code-mods',
      '@janhq/jan-experimental-client-ui-cot-translation',
      '@janhq/jan-client-ui-creation-recommendations',
      '@janhq/jan-experimental-client-ui-forge',
      '@janhq/jan-client-ui-plugin-recommendations',
      '@janhq/jan-experimental-client-ui-stats',
      '@janhq/jan-experimental-client-ui-voice-input',
      '@janhq/jan-experimental-computer-use-cua-driver-mcp',
      '@janhq/jan-experimental-computer-use-cua-driver-native',
      '@janhq/jan-experimental-cot-translation-bundle',
      '@janhq/jan-creation-recommendations',
      '@janhq/jan-cua-bundle',
      '@janhq/jan-experimental-cua-macos',
      '@janhq/jan-cua',
      '@janhq/jan-experimental-forge-bundle',
      '@janhq/jan-experimental-forge-github',
      '@janhq/jan-experimental-forge-session',
      '@janhq/jan-experimental-forge',
      '@janhq/jan-hook-protocol',
      '@janhq/jan-hooks-claude-code',
      '@janhq/jan-hooks-codex',
      '@janhq/jan-experimental-inspector-profile',
      '@janhq/jan-experimental-inspector',
      '@janhq/jan-experimental-liveshare-protocol',
      '@janhq/jan-experimental-liveshare',
      '@janhq/jan-personalized-recommendations',
      '@janhq/jan-experimental-plugin-market-bundle',
      '@janhq/jan-plugin-recommendations',
      '@janhq/jan-experimental-ptc-runtime-python',
      '@janhq/jan-experimental-ralph-bundle',
      '@janhq/jan-experimental-session-inspector',
      '@janhq/jan-experimental-session-search',
      '@janhq/jan-session-title-all-prompts-llm',
      '@janhq/jan-experimental-session-titles-bundle',
      '@janhq/jan-skill-badge',
      '@janhq/jan-experimental-speech-to-text-sensevoice',
      '@janhq/jan-experimental-speech-to-text',
      '@janhq/jan-experimental-subagent-oar',
      '@janhq/jan-experimental-terminal-bundle',
      '@janhq/jan-tool-ralph',
      '@janhq/jan-tool-session-query',
      '@janhq/jan-experimental-tool-subagent-oar',
      '@janhq/jan-tool-terminal',
      '@janhq/jan-experimental-tool-worktree',
      '@janhq/jan-experimental-translator',
      '@janhq/jan-experimental-voice-input-bundle',
      '@janhq/jan-webhook-github',
      '@janhq/jan-webhook',
      '@janhq/jan-experimental-webworker-packer',
      '@janhq/jan-experimental-webworker-runtime',
      '@janhq/jan-experimental-worktree',
    ])
  })

  it('excludes private applications from the publish set', () => {
    const root = mkdtempSync(join(tmpdir(), 'jan-release-private-'))
    roots.push(root)
    write(join(root, 'apps/public/package.json'), '{"name":"@janhq/jan-public","version":"0.0.1"}\n')
    write(join(root, 'apps/private/package.json'), '{"name":"@janhq/jan-private","version":"0.0.1","private":true}\n')

    expect(releaseFamily('jan').members(root).map(entry => entry.name)).toEqual(['@janhq/jan-public'])
  })

  it('publishes unlisted experimental packages while retaining private exclusions', () => {
    const root = mkdtempSync(join(tmpdir(), 'jan-release-experimental-'))
    roots.push(root)
    write(join(root, 'packages/experimental/prototype/package.json'), JSON.stringify({
      name: '@janhq/jan-experimental-prototype',
      version: '0.0.1',
      publishConfig: { access: 'public' },
    }))
    write(join(root, 'packages/experimental/inspector/package.json'), JSON.stringify({
      name: '@janhq/jan-experimental-inspector',
      version: '0.0.1',
      private: true,
    }))

    expect(releaseFamily('jan').members(root).map(entry => entry.name)).toEqual([
      '@janhq/jan-experimental-prototype',
    ])
  })

  it('bumps private jan workspaces without adding release tags', () => {
    const root = mkdtempSync(join(tmpdir(), 'jan-release-version-'))
    roots.push(root)
    write(join(root, 'package.json'), '{"version":"0.0.1"}\n')
    write(join(root, 'apps/desktop/package.json'), '{"version":"0.0.1","private":true}\n')
    write(join(root, 'packages/experimental/prototype/package.json'), '{"version":"0.0.1","private":true}\n')
    write(join(root, 'packages/core/unselected/package.json'), '{"version":"0.0.1"}\n')

    const jan = releaseFamily('jan')
    const published = member('packages/core/published', '@janhq/jan-published')
    const { planned } = planShared(jan, root, [published], '0.0.2')

    expect(planned.map(entry => ({ path: entry.manifestPath, tag: entry.tag }))).toEqual([
      { path: 'package.json', tag: undefined },
      { path: 'packages/core/published/package.json', tag: 'jan-v0.0.2' },
      { path: 'apps/desktop/package.json', tag: undefined },
      { path: 'packages/experimental/prototype/package.json', tag: undefined },
    ])
  })

  it.each(['0.0.2-alpha.1', '0.0.2-canary.1', '0.0.2-rc.1'])(
    'accepts the explicit jan prerelease version %s',
    (version) => {
      const root = mkdtempSync(join(tmpdir(), 'jan-release-prerelease-'))
      roots.push(root)
      write(join(root, 'package.json'), '{"version":"0.0.1"}\n')

      const jan = releaseFamily('jan')
      const published = member('packages/core/published', '@janhq/jan-published')
      const plan = planShared(jan, root, [published], version)

      expect(plan.version).toBe(version)
      expect(plan.planned[1]?.tag).toBe(`jan-v${version}`)
    },
  )

  it('names one tag for the whole jan family and one per vendored package', () => {
    const jan = releaseFamily('jan')
    const vendor = releaseFamily('vendor')
    const cli = member('apps/cli', '@janhq/jan')
    const cordis = { ...member('vendor/cordis', '@janhq/cordis'), version: '4.0.1' }

    expect(jan.tagFor(cli)).toBe('jan-v0.0.1')
    expect(vendor.tagFor(cordis)).toBe('vendor-cordis-v4.0.1')
    // The prefix is constructed, not recovered from a tag: a version with a
    // hyphen would defeat any suffix-stripping.
    expect(vendor.tagPrefixFor({ ...cordis, version: '4.0.0-rc.7' })).toBe('vendor-cordis-v')
    expect(vendor.tagFor({ ...cordis, version: '4.0.0-rc.7' })).toBe('vendor-cordis-v4.0.0-rc.7')
  })

  it('assigns alpha and canary dist-tags only to jan releases', () => {
    const jan = releaseFamily('jan')
    const vendor = releaseFamily('vendor')

    expect(jan.distTagForVersion('0.0.2-alpha.1')).toBe('alpha')
    expect(jan.distTagForVersion('0.0.2-canary.1')).toBe('canary')
    expect(jan.distTagForVersion('0.0.2-rc.1')).toBe('next')
    expect(jan.distTagForVersion('0.0.2')).toBeUndefined()
    expect(vendor.distTagForVersion('4.0.1-alpha.1')).toBe('next')
    expect(vendor.distTagForVersion('4.0.1-canary.1')).toBe('next')
  })

  it('rejects a family whose members disagree on the shared version', () => {
    const jan = releaseFamily('jan')
    const members = [member('apps/cli', '@janhq/jan'), { ...member('apps/web', '@janhq/jan-web-frontend'), version: '0.0.2' }]

    expect(() => { jan.verifyVersions(members) }).toThrow(/must share one version/)
    expect(() => { jan.verifyVersions([members[0]!]) }).not.toThrow()
  })

  it('accepts independent vendored versions and rejects an unpublishable one', () => {
    const vendor = releaseFamily('vendor')
    const members = [
      { ...member('vendor/cordis', '@janhq/cordis'), version: '4.0.1' },
      { ...member('vendor/cosmokit', '@janhq/cosmokit'), version: '1.8.2' },
    ]

    expect(() => { vendor.verifyVersions(members) }).not.toThrow()
    expect(() => { vendor.verifyVersions([{ ...members[0]!, version: 'latest' }]) }).toThrow(/unpublishable version/)
  })

  it('requires a current official client build only for jan artifacts', () => {
    const jan = releaseFamily('jan')
    const vendor = releaseFamily('vendor')
    const officialEnvironment = officialClientBuildEnvironment(resolve(import.meta.dirname, '../..'))
    vi.stubEnv('JAN_CLIENT_COMMIT_HASH', officialEnvironment.JAN_CLIENT_COMMIT_HASH)
    const official = buildFixture(officialEnvironment)
    const defaultBuild = buildFixture({})
    const missing = join(defaultBuild, 'missing')
    write(join(missing, 'package.json'), `${JSON.stringify({ version: officialEnvironment.JAN_CLIENT_VERSION })}\n`)

    expect(() => { jan.verifyBuildArtifacts(official) }).not.toThrow()
    expect(() => { jan.verifyBuildArtifacts(defaultBuild) }).toThrow(/JAN_CLIENT_TITLE/)
    expect(() => { jan.verifyBuildArtifacts(missing) }).toThrow(/record.*missing/)
    expect(() => { vendor.verifyBuildArtifacts(missing) }).not.toThrow()

    write(join(official, 'packages/client/example/lib/client.js'), 'module.exports = { changed: true }\n')
    expect(() => { jan.verifyBuildArtifacts(official) }).toThrow(/artifacts differ/)
  })

  it('publishes a dependency before its consumer, and orders ties by name', () => {
    const jan = releaseFamily('jan')
    const members = [
      member('packages/a/consumer', '@janhq/jan-consumer', { dependencies: { '@janhq/jan-library': 'workspace:^' } }),
      member('packages/a/library', '@janhq/jan-library'),
      member('packages/a/zebra', '@janhq/jan-zebra'),
    ]

    expect(jan.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@janhq/jan-library',
      '@janhq/jan-consumer',
      '@janhq/jan-zebra',
    ])
  })

  it('publishes on-demand catalog members before jan without adding installed dependencies', () => {
    const jan = member('apps/cli', '@janhq/jan')
    const providers = ON_DEMAND_BUNDLES.map(name => member(`packages/subagent/${name}`, name))
    const plan = releaseFamily('jan').publishOrder([jan, ...providers])
    expect(plan.order.map(entry => entry.name)).toEqual([...ON_DEMAND_BUNDLES.toSorted(), jan.name])
    expect(jan.manifest).toEqual({})
    expect(plan.droppedPeerEdges).toEqual([])
  })

  it('rejects an advertised provider missing from the public release family', () => {
    expect(() => releaseFamily('jan').publishOrder([member('apps/cli', '@janhq/jan')]))
      .toThrow('Official catalog prerequisite')
  })

  it('keeps catalog prerequisites ahead of a jan peer declaration', () => {
    const jan = member('apps/cli', '@janhq/jan')
    const providers = ON_DEMAND_BUNDLES.map(name => member(`packages/subagent/${name}`, name, {
      peerDependencies: { '@janhq/jan': 'workspace:*' },
    }))
    const plan = releaseFamily('jan').publishOrder([jan, ...providers])
    expect(plan.order.map(entry => entry.name)).toEqual([...ON_DEMAND_BUNDLES.toSorted(), jan.name])
    expect(plan.droppedPeerEdges).toEqual(ON_DEMAND_BUNDLES.toSorted().map(name => ({ consumer: name, peer: jan.name })))
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'])(
    'requires exact packed Jan %s while preserving external ranges', (section) => {
      const pkg = member('packages/example/provider', '@janhq/jan-provider')
      const family = releaseFamily('jan')
      const manifest = { name: pkg.name, version: pkg.version, [section]: { '@janhq/jan-tools': pkg.version, external: '^4.0.0' } }
      expect(() => { family.validatePackedManifest(pkg, manifest) }).not.toThrow()
      for (const range of ['workspace:*', '^0.0.1', '~0.0.1', '0.0.2', '*']) {
        expect(() => { family.validatePackedManifest(pkg, { ...manifest, [section]: { '@janhq/jan-tools': range } }) })
          .toThrow(`packed ${section}.@janhq/jan-tools must equal`)
      }
    },
  )

  it('checks packed identities and preserves independent vendor versions', () => {
    const pkg = member('vendor/example', '@janhq/example')
    const family = releaseFamily('vendor')
    expect(() => { family.validatePackedManifest(pkg, { name: pkg.name, version: pkg.version, dependencies: { '@janhq/jan-tools': '^4.0.0' } }) })
      .not.toThrow()
    expect(() => { family.validatePackedManifest(pkg, { name: '@janhq/other', version: pkg.version }) }).toThrow('packed identity')
    expect(() => { family.validatePackedManifest(pkg, { name: pkg.name, version: '0.0.2' }) }).toThrow('packed identity')
  })

  it('reports a runtime dependency cycle instead of emitting an arbitrary order', () => {
    const jan = releaseFamily('jan')
    const members = [
      member('packages/a/left', '@janhq/jan-left', { dependencies: { '@janhq/jan-right': 'workspace:^' } }),
      member('packages/a/right', '@janhq/jan-right', { dependencies: { '@janhq/jan-left': 'workspace:^' } }),
    ]

    expect(() => { jan.publishOrder(members) }).toThrow(/dependency cycle/)
  })

  it('publishes a peer before its consumer', () => {
    const jan = releaseFamily('jan')
    const members = [
      member('packages/a/consumer', '@janhq/jan-consumer', { peerDependencies: { '@janhq/jan-zebra': 'workspace:^' } }),
      member('packages/a/zebra', '@janhq/jan-zebra'),
    ]

    // Name order alone would place the consumer first; the peer edge moves it.
    expect(jan.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@janhq/jan-zebra',
      '@janhq/jan-consumer',
    ])
  })

  it('orders around a peer cycle rather than refusing to publish, and reports the edge it dropped', () => {
    const jan = releaseFamily('jan')
    const members = [
      member('packages/a/left', '@janhq/jan-left', { peerDependencies: { '@janhq/jan-right': 'workspace:^' } }),
      member('packages/a/right', '@janhq/jan-right', { peerDependencies: { '@janhq/jan-left': 'workspace:^' } }),
    ]

    // Sibling packages declare each other as peers, and npm treats an unmet peer
    // as a warning, so this pair has to publish rather than fail the release.
    const plan = jan.publishOrder(members)
    expect(plan.order.map(entry => entry.name)).toEqual([
      '@janhq/jan-right',
      '@janhq/jan-left',
    ])
    // One of the two edges has to give, and which one it is belongs in the log.
    expect(plan.droppedPeerEdges).toEqual([
      { consumer: '@janhq/jan-right', peer: '@janhq/jan-left' },
    ])
  })

  it('honours an install edge even when a peer cycle surrounds it', () => {
    const jan = releaseFamily('jan')
    const members = [
      member('packages/a/base', '@janhq/jan-base', { peerDependencies: { '@janhq/jan-consumer': 'workspace:^' } }),
      member('packages/a/consumer', '@janhq/jan-consumer', {
        dependencies: { '@janhq/jan-base': 'workspace:^' },
        peerDependencies: { '@janhq/jan-base': 'workspace:^' },
      }),
    ]

    // The install edge is absolute: base publishes first, and the peer edge that
    // would reverse it is the one dropped.
    const plan = jan.publishOrder(members)
    expect(plan.order.map(entry => entry.name)).toEqual([
      '@janhq/jan-base',
      '@janhq/jan-consumer',
    ])
    expect(plan.droppedPeerEdges).toEqual([
      { consumer: '@janhq/jan-base', peer: '@janhq/jan-consumer' },
    ])
  })

  it('refuses an order that would publish a consumer before a dependency it installs', () => {
    const jan = releaseFamily('jan')
    const members = [
      member('packages/a/alpha', '@janhq/jan-alpha', { peerDependencies: { '@janhq/jan-bravo': 'workspace:^' } }),
      member('packages/a/bravo', '@janhq/jan-bravo', { peerDependencies: { '@janhq/jan-charlie': 'workspace:^' } }),
      member('packages/a/charlie', '@janhq/jan-charlie', { dependencies: { '@janhq/jan-alpha': 'workspace:^' } }),
    ]

    // A cycle of two peer edges closed by one install edge: dropping a peer edge
    // would order this, and the traversal drops the install edge instead. That
    // order would publish charlie before the alpha it installs, so it is refused
    // here rather than published.
    expect(() => { jan.publishOrder(members) }).toThrow(/no publish order honours @janhq\/jan-charlie -> @janhq\/jan-alpha/)
  })

  it('ignores devDependencies when ordering', () => {
    const jan = releaseFamily('jan')
    const members = [
      member('packages/a/alpha', '@janhq/jan-alpha', { devDependencies: { '@janhq/jan-zebra': 'workspace:^' } }),
      member('packages/a/zebra', '@janhq/jan-zebra'),
    ]

    // A dev dependency is absent from the published package, so it must not move
    // the consumer behind it.
    expect(jan.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@janhq/jan-alpha',
      '@janhq/jan-zebra',
    ])
  })

  it('applies the harness payload policy to jan and keeps upstream payloads for vendored packages', () => {
    const jan = releaseFamily('jan')
    const vendor = releaseFamily('vendor')
    const harness = member('packages/a/library', '@janhq/jan-library')
    const vendored = member('vendor/cordis', '@janhq/cordis')

    expect(() => { jan.validatePayload(harness, ['package/lib/index.js', 'package/src/index.ts']) })
      .toThrow(/publishes source file/)
    expect(() => { vendor.validatePayload(vendored, ['package/lib/index.js', 'package/src/index.ts']) }).not.toThrow()
    expect(() => { vendor.validatePayload(vendored, []) }).toThrow(/empty tarball/)
  })

  it('drives the installed entry only for the family that publishes one', () => {
    expect(releaseFamily('jan').installedEntry).toEqual({ packageName: '@janhq/jan', binPath: 'lib/bin.js' })
    expect(releaseFamily('vendor').installedEntry).toBeUndefined()
  })

  it('rejects an unknown family identifier', () => {
    expect(() => { releaseFamily('native') }).toThrow(/unknown release family/)
  })
})

describe('vendored version baseline', () => {
  it('drops an upstream prerelease segment and increments the patch', () => {
    expect(nextVendorVersion('4.0.0-rc.7', undefined)).toBe('4.0.1')
    expect(nextVendorVersion('1.0.0-rc.5', undefined)).toBe('1.0.1')
    expect(nextVendorVersion('1.8.1', undefined)).toBe('1.8.2')
  })

  it('increments from the last published version when a re-sync restored a lower one', () => {
    // Upstream moved rc.7 -> rc.8 after this repository published 4.0.1;
    // incrementing the manifest alone would name 4.0.1 a second time.
    expect(nextVendorVersion('4.0.0-rc.8', '4.0.1')).toBe('4.0.2')
    expect(nextVendorVersion('4.1.0', '4.0.1')).toBe('4.1.1')
  })

  it('appends a rehearsal prerelease without consuming its release numbers', () => {
    // A rehearsal burns 4.0.1-rc.1 and leaves 4.0.1 free, so the stable release
    // that follows takes those same numbers instead of skipping to 4.0.2.
    expect(nextVendorVersion('4.0.0-rc.7', undefined, 'rc.1')).toBe('4.0.1-rc.1')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1-rc.1', 'rc.2')).toBe('4.0.1-rc.2')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1-rc.1')).toBe('4.0.1')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1')).toBe('4.0.2')
  })
})

describe('version precedence', () => {
  it('orders alpha, canary, and release-candidate versions by semver precedence', () => {
    expect(compareVersions('4.0.1-alpha.1', '4.0.1-canary.1')).toBeLessThan(0)
    expect(compareVersions('4.0.1-canary.1', '4.0.1-rc.1')).toBeLessThan(0)
    expect(compareVersions('4.0.1-rc.1', '4.0.1')).toBeLessThan(0)
  })

  it('ranks a release above the prerelease it follows', () => {
    // git --sort=v:refname disagrees, placing 4.0.1-rc.1 above 4.0.1, which is
    // why the newest published version is chosen here rather than by git.
    expect(compareVersions('4.0.1', '4.0.1-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.1', '4.0.1')).toBeLessThan(0)
  })

  it('compares numeric prerelease fields numerically', () => {
    expect(compareVersions('4.0.1-rc.10', '4.0.1-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.2', '4.0.1-rc.10')).toBeLessThan(0)
  })

  it('ranks a numeric field below an alphanumeric one, and a shorter list below a longer', () => {
    expect(compareVersions('4.0.1-1', '4.0.1-alpha')).toBeLessThan(0)
    expect(compareVersions('4.0.1-rc', '4.0.1-rc.1')).toBeLessThan(0)
    expect(compareVersions('4.0.2', '4.0.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.1', '4.0.1-rc.1')).toBe(0)
  })
})

describe('payload change judgement', () => {
  const sourceShipping = member('vendor/cosmokit', '@janhq/cosmokit', {
    files: ['lib/index.js', 'lib/types/**/*.d.ts', 'src'],
  })
  const buildOutputOnly = member('vendor/cordis', '@janhq/cordis', {
    files: ['lib/index.js', 'lib/types/**/*.d.ts', 'bin.js'],
  })

  it('counts the manifest and the files npm always publishes', () => {
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/package.json')).toBe(true)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/README.md')).toBe(true)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/src/index.ts')).toBe(true)
  })

  it('counts build inputs for a package whose payload is build output', () => {
    // cordis publishes lib/ only, and lib/ is not tracked: without this, a real
    // source change reads as "nothing changed" and the next publish fails on a
    // version whose bytes moved.
    expect(reachesPayload(buildOutputOnly, 'vendor/cordis/src/context.ts')).toBe(true)
    expect(reachesPayload(buildOutputOnly, 'vendor/cordis/tsconfig.json')).toBe(true)
  })

  it('ignores paths no tarball carries', () => {
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/tests/unit.spec.ts')).toBe(false)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/CHANGELOG.md')).toBe(false)
    // The README pattern is deliberately loose: over-reporting a change costs one
    // unnecessary patch bump, while under-reporting fails the next publish on a
    // version whose bytes moved.
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/README.i18n.yaml')).toBe(true)
    expect(reachesPayload(member('packages/a/library', '@janhq/jan-library', { files: ['lib/index.js'] }),
      'packages/a/library/tests/library.spec.ts')).toBe(false)
  })
})
