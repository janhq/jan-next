/** Cordis name of the Host-only settings tools. */
export const name = 'jan-agent-settings'
export const inject = ['tools', 'settings', 'agents', 'llm']

const READ = 'jan_settings_read'
const CHANGE = 'jan_settings_change'
const SCOPE = { chat: 'this chat only', saved: 'saved for all chats' }
const BLOCKED_NAMESPACE = /(?:agent-settings|approval|permissions?|mcp|market|llm-pi-ai|provider|credentials?|secrets?|tokamak-account|authorization)/i
const BLOCKED_PATH = /(?:approval|permissions?|(?:agent|default)[-_]?preset|tool[-_]?policy|sandbox[-_]?mode|mcp|market|^providers?$|provider[-_]?(?:definitions?|config)|credentials?|secrets?|passwords?|api[-_]?keys?|private[-_]?keys?|token(?:ref|env)?$|^tokens$|^auth(?:entication|orization)?$|headers?)/i
const MAX_CHANGES = 4
const MAX_PATH_DEPTH = 8
const COMP = 'compaction-settings'
// The preferences schema leaves these unset so a backend can supply its defaults.
const COMPACTION_FIELDS = {
  auto: { label: 'automatic compaction', default: true, description: 'Compact the chat automatically near its context limit.' },
  thresholdRatio: { label: 'compaction threshold', default: 0.8, min: 0, max: 1, description: 'Fraction of the context window that triggers automatic compaction.' },
  summarizationProvider: { label: 'summary provider', default: '', description: 'Provider for compaction summaries. An empty value uses the chat model.' },
  summarizationModel: { label: 'summary model', default: '', description: 'Model for compaction summaries. An empty value uses the chat model.' },
}
const SETTINGS_LOCATIONS = {
  [COMP]: 'Settings > Agent loop > Context',
  'model-fallback': 'Settings > Agent loop > Fallback models',
  'jan-notifications': 'Settings > General > Desktop notifications',
  'agent-loop': 'Settings > Built-in plugins > Agent loop',
  'bash-sandbox': 'Settings > Built-in plugins > Shell',
  'pwsh-sandbox': 'Settings > Built-in plugins > Shell',
  'web': 'Settings > Built-in plugins > Web search and fetch',
  'subagent': 'Settings > Built-in plugins > Subagent',
  'subagent-model-selection-settings': 'Settings > Built-in plugins > Subagent',
}
const messageOf = error => error instanceof Error ? error.message : String(error)
const label = value => value === undefined ? 'not set' : JSON.stringify(value)
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const scalar = value => value === null || ['string', 'number', 'boolean'].includes(typeof value)
const safeSegment = value => typeof value === 'string' && value.length > 0
  && !['__proto__', 'constructor', 'prototype', '__jsExpr'].includes(value)
const member = (value, key) => value !== null && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined
const at = (value, path) => path.reduce(member, value)
const described = ctx => ctx.settings.describe({ redactSecrets: true })
const schemaNode = (row, ref) => member(row.schema?.refs, ref)
const publicNode = node => node !== undefined && !['secret', 'credential-ref'].includes(node.meta?.role) && node.meta?.hidden !== true
const publicKey = key => safeSegment(key) && !BLOCKED_PATH.test(key)

function childRef(node, key) {
  if (node.type === 'object') return member(node.dict, key)
  if (node.type === 'dict') return node.inner
  if (node.type === 'array' && /^(0|[1-9][0-9]*)$/.test(key)) return node.inner
  if (node.type === 'tuple' && /^(0|[1-9][0-9]*)$/.test(key)) return member(node.list, key)
}

function schemaAt(row, path) {
  let node = schemaNode(row, row.schema?.uid)
  for (const key of path) {
    if (!publicNode(node) || !publicKey(key)) return undefined
    node = schemaNode(row, childRef(node, key))
  }
  return publicNode(node) ? node : undefined
}

function publicLeaf(row, node) {
  if (!publicNode(node)) return false
  if (['number', 'string', 'boolean'].includes(node.type)) return true
  if (node.type === 'const') return scalar(node.value)
  return node.type === 'union' && Array.isArray(node.list) && node.list.length > 0 && node.list.every(ref => {
    const choice = schemaNode(row, ref)
    return publicNode(choice) && choice.type === 'const' && scalar(choice.value)
  })
}

function compactionField(row, path) {
  return row.ns === COMP && path.length === 1 ? member(COMPACTION_FIELDS, path[0]) : undefined
}

function defaultFor(row, path, node) {
  return scalar(node.meta?.default) ? node.meta.default : compactionField(row, path)?.default
}

function fieldDetails(row, path, node) {
  const field = compactionField(row, path)
  const effective = at(row.value, path)
  const meta = node.meta ?? {}
  const defaultValue = defaultFor(row, path, node)
  const desc = typeof meta.description === 'string' ? meta.description : meta.description?.en ?? meta.description?.['']
  const base = at(row.base, path)
  const min = meta.min ?? field?.min
  const max = meta.max ?? field?.max
  return {
    path, value: effective === undefined ? defaultValue ?? null : effective, type: node.type,
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    ...(node.type === 'union' ? { enum: node.list.map(ref => schemaNode(row, ref).value) } : {}),
    ...(typeof (desc ?? field?.description) === 'string' ? { description: desc ?? field.description } : {}),
    source: at(row.user, path) !== undefined ? 'saved' : base !== undefined && base !== defaultValue ? 'inherited' : 'default',
  }
}

function fields(row) {
  const results = []
  function visit(ref, path) {
    const node = schemaNode(row, ref)
    if (!publicNode(node)) return
    if (publicLeaf(row, node)) {
      const current = at(row.value, path)
      if (current === undefined || scalar(current)) results.push(fieldDetails(row, path, node))
      return
    }
    if (path.length === MAX_PATH_DEPTH) return
    let keys
    if (node.type === 'object') keys = Object.keys(node.dict ?? {})
    else if (['array', 'dict', 'tuple'].includes(node.type)) {
      const current = at(row.value, path)
      if (current !== null && typeof current === 'object') keys = Object.keys(current)
    }
    if (keys) for (const key of keys) if (publicKey(key)) visit(childRef(node, key), [...path, key])
  }
  visit(row.schema?.uid, [])
  return results
}

function humanize(text) {
  return text.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').toLowerCase()
}

function settingLabel(row, path) {
  return compactionField(row, path)?.label ?? `${humanize(row.ns)}: ${path.map(humanize).join(' > ')}`
}

function settingValue(row, path, value) {
  if (row.ns === COMP && path.length === 1 && path[0].startsWith('summarization') && value === '') return 'model default'
  return label(value)
}

function requireAgent(ctx, agent) {
  if (!agent || ctx.agents.get(agent.id) !== agent) throw new Error('This chat is no longer available.')
}

function prepareChat(ctx, args, agent) {
  requireAgent(ctx, agent)
  for (const key of Object.keys(args)) {
    if (!['scope', 'provider', 'model', 'reasoningEffort'].includes(key)) throw new Error('Chat changes only accept a model and reasoning effort.')
    if (key !== 'scope' && !(key === 'reasoningEffort' && args[key] === null)
      && (typeof args[key] !== 'string' || !args[key].trim())) throw new Error(`Name a valid ${humanize(key)} for this chat.`)
  }
  if (args.provider === undefined && args.model === undefined && args.reasoningEffort === undefined) throw new Error('Name a model or reasoning effort for this chat.')
  const before = agent.model.current()
  const provider = args.provider ?? before?.provider
  const model = args.model ?? before?.model
  if (!provider || !model) throw new Error('Provide a model and provider for this chat.')
  const sameRoute = before?.provider === provider && before?.model === model
  const effort = args.reasoningEffort === null ? undefined : args.reasoningEffort ?? (sameRoute ? before.reasoningEffort : undefined)
  const after = { provider, model, ...(effort === undefined ? {} : { reasoningEffort: effort }) }
  const field = sameRoute ? 'reasoning effort' : 'chat model and reasoning effort'
  const delta = `${describeSelection(before)} -> ${describeSelection(after)}`
  return { scope: 'chat', before, after, field, delta, unchanged: sameSelection(before, after), reason: `Change ${field}: ${delta} (${SCOPE.chat})?` }
}

function describeSelection(selection) {
  return selection === undefined ? 'not set' : `${selection.provider}/${selection.model}, reasoning ${selection.reasoningEffort ?? 'model default'}`
}

function sameSelection(left, right) {
  return left?.provider === right?.provider && left?.model === right?.model && left?.reasoningEffort === right?.reasoningEffort
}

function validateCompaction(row, ops) {
  if (row.ns !== COMP) return
  const changed = new Map(ops.filter(op => op.path.length === 1).map(op => [op.path[0], op.value]))
  const threshold = changed.get('thresholdRatio')
  // The live preference's Host schema checks only number type. The shipped backend also checks its retention ratio.
  if (changed.has('thresholdRatio') && (threshold === null || typeof threshold === 'number' && (threshold <= 0.16 || threshold > 1))) {
    throw new Error('The compaction threshold must be a number in (0, 1] and above 0.16 with the built-in retention policy.')
  }
  if (changed.has('summarizationProvider') || changed.has('summarizationModel')) {
    const provider = changed.has('summarizationProvider') ? changed.get('summarizationProvider') : row.value?.summarizationProvider
    const model = changed.has('summarizationModel') ? changed.get('summarizationModel') : row.value?.summarizationModel
    if (typeof provider === 'string' && typeof model === 'string' && Boolean(provider) === Boolean(model)) {
      return provider && model ? { provider, model } : undefined
    }
    throw new Error('Set the summary provider and model together, or clear both with empty strings.')
  }
}

function prepareSaved(ctx, args) {
  const { namespace, path, value, changes } = args
  if (typeof namespace !== 'string' || !namespace || Object.keys(args).some(key => !['scope', 'namespace', 'path', 'value', 'changes'].includes(key))) {
    throw new Error('Name a settings namespace and a field path and value, or a batch of changes.')
  }
  if (BLOCKED_NAMESPACE.test(namespace)) throw new Error('Jan cannot change permissions, MCP servers, provider definitions or credentials, market indexes, or this plugin using settings tools.')
  if (changes !== undefined && (path !== undefined || value !== undefined || !Array.isArray(changes))) {
    throw new Error('Use either a field path and value or a batch of changes, not both.')
  }
  const input = changes ?? [{ path, value }]
  if (!input.length || input.length > MAX_CHANGES) throw new Error(`Choose one to ${MAX_CHANGES} saved changes in a namespace.`)
  const row = described(ctx).find(item => item.ns === namespace)
  if (!row) throw new Error(`Setting namespace ${label(namespace)} is not available.`)
  const seen = new Set()
  const ops = []
  const preview = []
  const previous = []
  for (const entry of input) {
    if (!record(entry) || Object.keys(entry).some(key => key !== 'path' && key !== 'value')
      || !Array.isArray(entry.path) || !entry.path.length || entry.path.length > MAX_PATH_DEPTH || !entry.path.every(safeSegment)) {
      throw new Error('Name a valid field path for the saved change.')
    }
    if (!scalar(entry.value) || typeof entry.value === 'number' && !Number.isFinite(entry.value)) {
      throw new Error('A saved change must use a literal string, number, boolean or null, not an object, array or expression.')
    }
    const node = schemaAt(row, entry.path)
    const current = at(row.value, entry.path)
    if (!publicLeaf(row, node) || current !== undefined && !scalar(current)) {
      throw new Error(`Setting ${namespace}.${entry.path.join('.')} is not available for model changes.`)
    }
    const key = JSON.stringify(entry.path)
    if (seen.has(key)) throw new Error('Name each saved setting only once.')
    seen.add(key)
    const before = current === undefined ? defaultFor(row, entry.path, node) : current
    ops.push({ op: 'set', path: entry.path, value: entry.value })
    previous.push(before)
    preview.push(`${settingLabel(row, entry.path)}: ${settingValue(row, entry.path, before)} -> ${settingValue(row, entry.path, entry.value)}`)
  }
  const summaryModel = validateCompaction(row, ops)
  const unchanged = ops.every((op, index) => Object.is(op.value, previous[index]))
  return { scope: 'saved', namespace, revision: row.revision, ops, previous, summaryModel, unchanged,
    reason: `Change ${preview.join('; ')} (${SCOPE.saved})?` }
}

function savedResult(ctx, plan) {
  const { namespace, ops, previous } = plan
  const location = member(SETTINGS_LOCATIONS, namespace)
  const where = location ? `See ${location}.` : `In Settings, choose Open configuration file and look for ${namespace}.`
  const unconfirmed = () => ({ ok: true, message: `Saved ${ops.map(({ path }) => settingLabel({ ns: namespace }, path)).join(', ')}, ${SCOPE.saved}. Jan could not confirm the effective values. ${where}` })
  let row
  try { row = described(ctx).find(item => item.ns === namespace) }
  catch { return unconfirmed() }
  const deltas = []
  for (const [index, { path, value }] of ops.entries()) {
    const node = row && schemaAt(row, path)
    if (!row || !publicLeaf(row, node)) return unconfirmed()
    const stored = at(row.value, path)
    const effective = stored === undefined ? defaultFor(row, path, node) : stored
    if (effective !== undefined && !scalar(effective)) return unconfirmed()
    const requested = effective === value ? '' : ` (requested ${settingValue(row, path, value)})`
    deltas.push(`${settingLabel(row, path)}: ${settingValue(row, path, previous[index])} -> ${settingValue(row, path, effective)}${requested}`)
  }
  return { ok: true, message: `Saved ${deltas.join('; ')}, ${SCOPE.saved}. ${where}` }
}

async function requireModel(ctx, selection, signal) {
  if (!ctx.llm.listProviders().some(provider => provider.id === selection.provider)
    || !(await ctx.llm.listModels(selection.provider)).some(model => model.id === selection.model)) {
    throw new Error('That model is not available in the Jan model picker.')
  }
  await ctx.llm.resolveCallConfig(selection, signal)
}

function renderText(_args, value) {
  return [{ type: 'text', text: value.message ?? JSON.stringify(value) }]
}

const pathParameter = { type: 'array', items: { type: 'string' }, description: 'Field path (one to eight segments) from jan_settings_read, for example ["thresholdRatio"].' }
const valueParameter = { description: 'New literal string, number, boolean or null.' }

/** Register model-facing reads and approved changes against Host-owned settings and the calling Session. */
export function apply(ctx) {
  // The pipeline passes the same execution from the approval gate to dispatch. A declined call is never dispatched.
  const prepared = new WeakMap()
  const read = {
    name: READ,
    description: 'Read Jan settings from the Host, not desktop screenshots or config files. Omit namespace to list public settings namespaces; pass a namespace to list its public settings and their values, defaults, types and sources. Use this tool before changing a saved setting. Credentials are never shown.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      namespace: { type: 'string', description: 'Settings namespace from jan_settings_read, for example compaction-settings.' },
    } },
    output: { schema: {}, render: renderText },
    async execute(args) {
      const rows = described(ctx)
      if (!args?.namespace) return { namespaces: rows.map(row => row.ns).filter(ns => !BLOCKED_NAMESPACE.test(ns)) }
      const row = rows.find(row => row.ns === args.namespace)
      if (!row || BLOCKED_NAMESPACE.test(row.ns)) return { message: 'This settings namespace is not available for model reads.' }
      return { namespace: row.ns, fields: fields(row) }
    },
    presentCall: () => ({ card: 'generic', title: 'Read Jan settings', kind: 'search' }),
  }
  const change = {
    name: CHANGE,
    description: 'Change a Jan setting through the Host with one approval. Never drive the Settings window or write config files for Jan settings. Use chat scope for the current model and/or reasoning effort; provider is the id of an existing route, not a provider definition. Use saved scope for one field or a small batch from one namespace returned by jan_settings_read. Cannot change permissions, MCP servers, model provider definitions or credentials, market indexes, or this plugin.',
    parameters: { type: 'object', additionalProperties: false, required: ['scope'], properties: {
      scope: { type: 'string', enum: ['chat', 'saved'], description: 'chat changes the current Session only; saved changes the Host plugin setting for all chats.' },
      namespace: { type: 'string', description: 'For saved: the settings namespace.' },
      path: pathParameter,
      value: valueParameter,
      changes: { type: 'array', description: 'For saved: one to four changes instead of path and value.', items: {
        type: 'object', required: ['path', 'value'], additionalProperties: false, properties: { path: pathParameter, value: valueParameter },
      } },
      provider: { type: 'string', description: 'For chat: model provider id; omit to retain the current provider.' },
      model: { type: 'string', description: 'For chat: model id; omit to retain the current model.' },
      reasoningEffort: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'For chat: an effort supported by the model, or null to restore the model default. Omit to retain the effort for the same model.' },
    } },
    output: { schema: { type: 'object', additionalProperties: false, required: ['ok', 'message'], properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }, render: renderText },
    async execute(_args, exec) {
      const plan = prepared.get(exec)
      prepared.delete(exec)
      if (!plan) return { ok: false, message: 'Nothing changed. The request did not pass the settings approval gate.' }
      try {
        exec.signal.throwIfAborted()
        if (plan.unchanged && plan.scope === 'saved') {
          return { ok: true, message: `No change. ${plan.ops.map(({ path }, index) => `${settingLabel({ ns: plan.namespace }, path)} is already ${String(plan.previous[index])}`).join('; ')}.` }
        }
        if (plan.scope === 'saved') {
          if (plan.summaryModel) await requireModel(ctx, plan.summaryModel, exec.signal)
          exec.signal.throwIfAborted()
          await ctx.settings.mutate(plan.namespace, plan.ops, plan.revision)
        } else {
          const { agent, signal } = exec
          requireAgent(ctx, agent)
          await requireModel(ctx, plan.after, signal)
          // Use the picker's Session model-selection event, without the RPC's global default save.
          signal.throwIfAborted()
          requireAgent(ctx, agent)
          if (!sameSelection(agent.model.current(), plan.before)) throw new Error('The chat model changed since approval. Ask again.')
          if (sameSelection(plan.before, plan.after)) return { ok: true, message: `No change. The model picker already has ${describeSelection(plan.after)}.` }
          agent.model.select(plan.after)
          return { ok: true, message: `Changed ${plan.field}: ${plan.delta}, ${SCOPE.chat}. See the model picker in this chat. The saved default did not change.` }
        }
      } catch (error) {
        return { ok: false, message: `Nothing changed. ${messageOf(error)}` }
      }
      // The Host can normalize a setting. Re-read before claiming its effective value.
      return savedResult(ctx, plan)
    },
    presentCall: args => ({ card: 'generic', title: args?.scope === 'chat' ? 'Change this chat model' : 'Change Jan setting', kind: 'edit' }),
  }
  ctx.effect(function* () {
    yield ctx.tools.register(read)
    yield ctx.tools.register(change)
    yield ctx.on('tools/pre-execute', async (exec, next) => {
      const decision = await next()
      if (exec.name !== CHANGE || (decision.kind !== 'allow' && decision.kind !== 'ask')) return decision
      const args = exec.arguments
      try {
        if (!record(args) || (args.scope !== 'chat' && args.scope !== 'saved')) throw new Error('Choose chat or saved scope for the change.')
        const plan = args.scope === 'saved' ? prepareSaved(ctx, args) : prepareChat(ctx, args, exec.agent)
        prepared.set(exec, plan)
        // A change to the value already in force needs no approval; execute reports it without writing.
        if (plan.unchanged) return { kind: 'allow' }
        const approval = ctx.get('approval')
        if (decision.kind === 'allow' && exec.agent && approval
          && (approval.overrideOf(exec.agent.session) ?? approval.config.policy ?? 'ask') === 'never') return decision
        return { kind: 'ask', reason: plan.reason }
      } catch (error) {
        return { kind: 'deny', reason: `Nothing changed. ${messageOf(error)}` }
      }
    })
  }, 'agent-settings.tools')
}
