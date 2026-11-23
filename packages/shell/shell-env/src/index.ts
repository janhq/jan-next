/**
 * Tool-independent shell environment plugin: owns the `ctx.shellEnv` registry of
 * trusted, per-execution `JAN_*` variables consumed by the model-facing shell
 * tools (`jan-tool-bash`, `jan-tool-pwsh`). Built-in shell facts are owned by
 * the registry itself while plugins can register additional, enumerable facts
 * with effect-scoped disposal.
 * Trusted plugins may also scope ordinary environment overrides to a shell call.
 *
 * @module @janhq/jan-shell-env
 */

import { Service, type Context } from '@janhq/cordis'
import z from '@janhq/schemastery'
import { JAN_ENV_PREFIX } from '@janhq/jan-shell'
import type { JanEnvironment, JanEnvironmentKey } from '@janhq/jan-shell'
import { JAN_HOME_ENV, resolveJanHome } from '@janhq/jan-home-paths'
import type { ToolExecution } from '@janhq/jan-tools'
// Declares `Context.profileContext`, the launcher-provided profile the built-ins read.
import type {} from '@janhq/jan-app-boot'

declare module '@janhq/cordis' {
  interface Context {
    shellEnv: ShellEnvRegistry
  }
}

export const name = 'shell-env'
export const inject: string[] = []

/** Plugin config (all optional — the built-in facts resolve without defaults). */
export interface Config {
  /** Jan home directory exposed as `JAN_HOME`; defaults to `$JAN_HOME` or `~/.config/jan-alpha`. */
  janHome?: string
}

/** Runtime configuration schema for the shell-env plugin. */
export const Config: z<Config> = z.object({
  janHome: z.string(),
})

/** Model-visible metadata for one managed `JAN_*` environment variable. */
export interface BashEnvVariable {
  /** Concise description of the environment fact represented by the variable. */
  description: string
}

/**
 * A plugin contribution to the managed environment of each model shell call.
 * Declared keys make ownership conflicts detectable before the first command;
 * `resolve` computes only the values available for the current execution.
 */
export interface BashEnvContributor {
  /** Stable contributor name used in diagnostics and duplicate detection. */
  name: string
  /** Complete set of `JAN_*` keys this contributor may return. */
  variables: Readonly<Record<JanEnvironmentKey, BashEnvVariable>>
  /**
   * Resolve this contributor's available values for one tool execution.
   * @param execution - the shell tool execution and its optional calling agent.
   * @returns a partial map containing only keys declared in {@link variables}.
   */
  resolve(execution: ToolExecution): Readonly<Partial<Record<JanEnvironmentKey, string>>>
}

/** An enumerable declaration returned by {@link ShellEnvRegistry.list}. */
export interface BashEnvVariableInfo extends BashEnvVariable {
  /** Contributor that owns the variable. */
  contributor: string
  /** Declared `JAN_*` environment variable name. */
  key: JanEnvironmentKey
}

const JAN_SHELL_KEY = `${JAN_ENV_PREFIX}SHELL` as const
const JAN_SESSION_ID_KEY = `${JAN_ENV_PREFIX}SESSION_ID` as const
const JAN_PROFILE_KEY = `${JAN_ENV_PREFIX}PROFILE` as const
const JAN_PROFILE_DIR_KEY = `${JAN_ENV_PREFIX}PROFILE_DIR` as const
const RESERVED_BASH_ENV_KEYS = new Set<JanEnvironmentKey>([
  JAN_HOME_ENV,
  JAN_SHELL_KEY,
  JAN_SESSION_ID_KEY,
  JAN_PROFILE_KEY,
  JAN_PROFILE_DIR_KEY,
])
const BASH_ENV_KEY_SUFFIX = /^[A-Z][A-Z0-9_]*$/

/**
 * Registry (`ctx.shellEnv`) for trusted, per-execution `JAN_*` variables.
 * The namespace is rebuilt for every model shell call: ambient `JAN_*` values
 * are discarded by the executor, then the registry's current snapshot is
 * injected. Built-in shell facts remain owned by the registry itself while
 * plugins can register additional, enumerable facts with effect-scoped
 * disposal.
 */
export class ShellEnvRegistry extends Service {
  private readonly contributors = new Map<string, BashEnvContributor>()
  private readonly overrides = new Set<{ resolve: (execution: ToolExecution) => Readonly<NodeJS.ProcessEnv> | undefined }>()
  private readonly keyOwners = new Map<JanEnvironmentKey, string>()
  private readonly janHome: string

  /**
   * Create and install the `ctx.shellEnv` service.
   * @param ctx - Cordis context that owns the service and registrations.
   * @param config - home-directory configuration for the built-in variables.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'shellEnv')
    this.janHome = resolveJanHome(config.janHome)
  }

  /**
   * Register one environment contributor. Names and keys are unique; built-in
   * keys are reserved. Registration is disposed with the calling plugin fiber.
   * @param contributor - declared key ownership and per-execution resolver.
   * @returns the disposer that unregisters the contribution.
   */
  register(contributor: BashEnvContributor): () => void {
    const dispose = this.ctx.effect(function* (this: ShellEnvRegistry) {
      if (contributor.name.trim().length === 0) {
        throw new Error('bash env contributor name must be non-empty')
      }
      if (this.contributors.has(contributor.name)) {
        throw new Error(`bash env contributor "${contributor.name}" is already registered`)
      }

      const variables = Object.entries(contributor.variables) as [JanEnvironmentKey, BashEnvVariable][]
      for (const [key, variable] of variables) {
        if (!key.startsWith(JAN_ENV_PREFIX)
          || !BASH_ENV_KEY_SUFFIX.test(key.slice(JAN_ENV_PREFIX.length))) {
          throw new Error(`bash env contributor "${contributor.name}" declared invalid key "${key}"`)
        }
        if (RESERVED_BASH_ENV_KEYS.has(key)) {
          throw new Error(`bash env contributor "${contributor.name}" cannot own reserved key "${key}"`)
        }
        if (variable.description.trim().length === 0) {
          throw new Error(`bash env contributor "${contributor.name}" must describe "${key}"`)
        }
        const owner = this.keyOwners.get(key)
        if (owner !== undefined) {
          throw new Error(`bash env key "${key}" is already owned by contributor "${owner}"; contributor "${contributor.name}" cannot also own it`)
        }
      }

      this.contributors.set(contributor.name, contributor)
      for (const [key] of variables) this.keyOwners.set(key, contributor.name)
      yield () => {
        this.contributors.delete(contributor.name)
        for (const [key] of variables) this.keyOwners.delete(key)
      }
    }.bind(this), 'bashEnv.register()')
    return () => void dispose()
  }

  /**
   * Register trusted subprocess environment overrides for matching shell calls.
   * @param resolve - returns ordinary environment entries or tombstones for a call; returns undefined to leave it unchanged.
   * @returns the disposer, also invoked automatically with the registering plugin.
   */
  registerOverrides(resolve: (execution: ToolExecution) => Readonly<NodeJS.ProcessEnv> | undefined): () => void {
    const entry = { resolve }
    const dispose = this.ctx.effect(() => {
      this.overrides.add(entry)
      return () => { this.overrides.delete(entry) }
    }, 'shellEnv.registerOverrides()')
    return () => void dispose()
  }

  /**
   * Collect ordinary environment overrides without changing the managed `JAN_*` snapshot.
   * @param execution - the current tool execution.
   * @returns a caller-owned overlay, or undefined if no resolver supplied one.
   */
  collectOverrides(execution: ToolExecution): NodeJS.ProcessEnv | undefined {
    let env: NodeJS.ProcessEnv | undefined
    for (const entry of this.overrides) {
      const resolved = entry.resolve(execution)
      if (resolved !== undefined) env = { ...env, ...resolved }
    }
    return env
  }

  /**
   * Build the trusted `JAN_*` snapshot for one shell tool execution.
   * @param execution - the current tool execution.
   * @returns an immutable environment overlay containing built-ins and current contributions.
   */
  collect(execution: ToolExecution): JanEnvironment {
    const values: Record<JanEnvironmentKey, string> = {
      [JAN_HOME_ENV]: this.janHome,
      [JAN_SHELL_KEY]: '1',
    }
    if (execution.agent !== undefined) {
      values[JAN_SESSION_ID_KEY] = execution.agent.session.header.id
    }
    const profile = this.ctx.get('profileContext')
    if (profile !== undefined) {
      values[JAN_PROFILE_KEY] = profile.name
      values[JAN_PROFILE_DIR_KEY] = profile.dir
    }

    for (const contributor of [...this.contributors.values()].sort((left, right) => left.name.localeCompare(right.name))) {
      const resolved = contributor.resolve(execution)
      for (const [rawKey, value] of Object.entries(resolved)) {
        const key = rawKey as JanEnvironmentKey
        if (!Object.hasOwn(contributor.variables, key)) {
          throw new Error(`bash env contributor "${contributor.name}" returned undeclared key "${key}"`)
        }
        if (typeof value !== 'string') {
          throw new Error(`bash env contributor "${contributor.name}" returned a non-string value for "${key}"`)
        }
        values[key] = value
      }
    }

    return Object.freeze(Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right))))
  }

  // TODO(bash-env-list-builtins): Include registry-owned built-ins before diagnostics,
  // prompt, or UI code treats list() as an exhaustive environment catalog.
  /**
   * Enumerate plugin-contributed variables without executing their resolvers.
   * @returns declarations sorted by environment variable name.
   */
  list(): BashEnvVariableInfo[] {
    return [...this.contributors.values()]
      .flatMap(contributor => Object.entries(contributor.variables).map(([key, variable]) => ({
        contributor: contributor.name,
        description: variable.description,
        key: key as JanEnvironmentKey,
      })))
      .sort((left, right) => left.key.localeCompare(right.key))
  }
}

/**
 * Load the shell-env plugin: register the `ctx.shellEnv` registry service.
 * @param ctx - Cordis context that owns the service and registrations.
 * @param config - home-directory configuration for the built-in variables.
 */
export function apply(ctx: Context, config: Config = {}): void {
  new ShellEnvRegistry(ctx, config)
}
