/**
 * Registry tests for `@janhq/jan-shell-env`: built-in facts, contributor
 * ownership and validation, collection ordering, effect-scoped disposal, and
 * the explicit disposer contract.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@janhq/cordis'
import { ToolCallId } from '@janhq/jan-llm'
import type { Agent } from '@janhq/jan-agent'
import { SESSION_FORMAT_VERSION } from '@janhq/jan-session'
import type { ToolExecution } from '@janhq/jan-tools'
import { ShellEnvRegistry } from '@janhq/jan-shell-env'
import * as BashEnvPlugin from '@janhq/jan-shell-env'

const testToolSignal = new AbortController().signal

afterEach(() => vi.unstubAllEnvs())

function execution(sessionId?: string): ToolExecution {
  return {
    signal: testToolSignal,
    token: Symbol('bash-env-test') as ToolExecution['token'],
    callId: ToolCallId('bash-env-call'),
    rootCallId: ToolCallId('bash-env-call'),
    name: 'bash',
    arguments: { command: 'true' },
    ...(sessionId === undefined
      ? {}
      : {
        agent: {
          session: {
            header: { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 0, isSeeded: false },
          },
        } as unknown as Agent,
      }),
  }
}

describe('ShellEnvRegistry', () => {
  it('collects unconditional shell facts and the current agent session id', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { janHome: './test-jan-home' })

    expect(registry.collect(execution())).toEqual({
      JAN_HOME: resolve('./test-jan-home'),
      JAN_SHELL: '1',
    })
    expect(registry.collect(execution('session-a'))).toEqual({
      JAN_HOME: resolve('./test-jan-home'),
      JAN_SESSION_ID: 'session-a',
      JAN_SHELL: '1',
    })
  })

  it('collects the launcher-provided profile name and directory when a profile context exists', () => {
    const ctx = new Context()
    ctx.provide('profileContext', {
      name: 'web', dir: '/profiles/web', patchPath: '/profiles/web/cordis.patch.yml', installAnchor: '/jan/package.json',
      cwd: '/work', home: '/home', startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
    })
    const registry = new ShellEnvRegistry(ctx, { janHome: './test-jan-home' })
    expect(registry.collect(execution())).toMatchObject({ JAN_PROFILE: 'web', JAN_PROFILE_DIR: '/profiles/web' })
    expect(() => registry.register({
      name: 'profile-claimer',
      variables: { JAN_PROFILE: { description: 'Reserved key.' } },
      resolve: () => ({}),
    })).toThrow(/reserved key "JAN_PROFILE"/)
  })

  it('resolves JAN_HOME from the ambient override or the user-home default', () => {
    vi.stubEnv('JAN_HOME', './ambient-jan-home')
    const fromEnvironment = new ShellEnvRegistry(new Context())
    expect(fromEnvironment.collect(execution()).JAN_HOME).toBe(resolve('./ambient-jan-home'))

    vi.stubEnv('JAN_HOME', undefined)
    const fromDefault = new ShellEnvRegistry(new Context())
    expect(fromDefault.collect(execution()).JAN_HOME).toBe(join(homedir(), '.jan'))
  })

  it('collects declared contributor variables and omits unavailable values', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { janHome: './test-jan-home' })
    registry.register({
      name: 'optional-session-fact',
      variables: {
        JAN_SESSION_OPTIONAL: { description: 'Optional session-scoped test fact.' },
      },
      resolve: exec => exec.agent === undefined ? {} : { JAN_SESSION_OPTIONAL: exec.agent.session.header.id },
    })
    registry.register({
      name: 'always-available-fact',
      variables: {
        JAN_ALWAYS_AVAILABLE: { description: 'Always-available test fact.' },
      },
      resolve: () => ({ JAN_ALWAYS_AVAILABLE: 'yes' }),
    })

    expect(registry.collect(execution())).not.toHaveProperty('JAN_SESSION_OPTIONAL')
    expect(registry.collect(execution()).JAN_ALWAYS_AVAILABLE).toBe('yes')
    expect(registry.collect(execution('session-b')).JAN_SESSION_OPTIONAL).toBe('session-b')
    expect(registry.list()).toEqual([
      {
        contributor: 'always-available-fact',
        description: 'Always-available test fact.',
        key: 'JAN_ALWAYS_AVAILABLE',
      },
      {
        contributor: 'optional-session-fact',
        description: 'Optional session-scoped test fact.',
        key: 'JAN_SESSION_OPTIONAL',
      },
    ])
  })

  it('rejects duplicate variable ownership at registration time', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { janHome: './test-jan-home' })
    registry.register({
      name: 'first',
      variables: { JAN_SHARED: { description: 'First owner.' } },
      resolve: () => ({ JAN_SHARED: 'first' }),
    })

    expect(() => registry.register({
      name: 'second',
      variables: { JAN_SHARED: { description: 'Second owner.' } },
      resolve: () => ({ JAN_SHARED: 'second' }),
    })).toThrow(/JAN_SHARED.*first.*second|JAN_SHARED.*second.*first/)
  })

  it('rejects duplicate contributor names and malformed declarations', () => {
    const registry = new ShellEnvRegistry(new Context(), { janHome: './test-jan-home' })
    registry.register({
      name: 'declared',
      variables: { JAN_DECLARED: { description: 'Declared fact.' } },
      resolve: () => ({}),
    })

    expect(() => registry.register({
      name: 'declared',
      variables: { JAN_ANOTHER: { description: 'Another fact.' } },
      resolve: () => ({}),
    })).toThrow(/already registered/)
    expect(() => registry.register({
      name: ' ',
      variables: { JAN_BLANK_NAME: { description: 'Blank owner.' } },
      resolve: () => ({}),
    })).toThrow(/name must be non-empty/)
    expect(() => registry.register({
      name: 'invalid-key',
      variables: { jan_invalid: { description: 'Invalid key.' } } as unknown as Record<'JAN_INVALID', { description: string }>,
      resolve: () => ({}),
    })).toThrow(/invalid key/)
    expect(() => registry.register({
      name: 'reserved-key',
      variables: { JAN_HOME: { description: 'Reserved key.' } },
      resolve: () => ({}),
    })).toThrow(/reserved key/)
    expect(() => registry.register({
      name: 'blank-description',
      variables: { JAN_BLANK_DESCRIPTION: { description: ' ' } },
      resolve: () => ({}),
    })).toThrow(/must describe/)
  })

  it('rejects undeclared variables returned by a contributor', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { janHome: './test-jan-home' })
    registry.register({
      name: 'drifted-provider',
      variables: { JAN_DECLARED: { description: 'Declared fact.' } },
      resolve: () => ({ JAN_UNDECLARED: 'bad' }),
    })

    expect(() => registry.collect(execution())).toThrow(/drifted-provider.*JAN_UNDECLARED/)
  })

  it('rejects non-string values returned by a contributor', () => {
    const registry = new ShellEnvRegistry(new Context(), { janHome: './test-jan-home' })
    registry.register({
      name: 'wrong-value-type',
      variables: { JAN_STRING: { description: 'String fact.' } },
      resolve: () => ({ JAN_STRING: 42 }) as unknown as Record<'JAN_STRING', string>,
    })

    expect(() => registry.collect(execution())).toThrow(/wrong-value-type.*non-string.*JAN_STRING/)
  })

  it('removes an effect-scoped contributor when its plugin is disposed', async () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { janHome: './test-jan-home' })
    const fiber = await ctx.plugin({
      inject: ['shellEnv'],
      apply(inner: Context) {
        inner.shellEnv.register({
          name: 'temporary',
          variables: { JAN_TEMPORARY: { description: 'Temporary fact.' } },
          resolve: () => ({ JAN_TEMPORARY: 'present' }),
        })
      },
    })

    expect(registry.collect(execution()).JAN_TEMPORARY).toBe('present')
    await fiber.dispose()
    expect(registry.collect(execution())).not.toHaveProperty('JAN_TEMPORARY')
  })

  it('returns an explicit contributor disposer', () => {
    const registry = new ShellEnvRegistry(new Context(), { janHome: './test-jan-home' })
    const dispose = registry.register({
      name: 'explicit-disposal',
      variables: { JAN_EXPLICIT_DISPOSAL: { description: 'Explicitly disposed fact.' } },
      resolve: () => ({ JAN_EXPLICIT_DISPOSAL: 'present' }),
    })

    expect(registry.collect(execution()).JAN_EXPLICIT_DISPOSAL).toBe('present')
    dispose()
    expect(registry.collect(execution())).not.toHaveProperty('JAN_EXPLICIT_DISPOSAL')
  })

  it('the plugin registers the service with no contributors on load', async () => {
    const ctx = new Context()
    await ctx.plugin(BashEnvPlugin)
    expect(ctx.shellEnv).toBeInstanceOf(ShellEnvRegistry)
    expect(ctx.shellEnv.list()).toEqual([])
  })
})
