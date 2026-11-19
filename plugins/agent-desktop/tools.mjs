/** @typedef {import('@janhq/jan-tools').JsonSchemaNode} JsonSchemaNode */
/** @typedef {import('./cli.mjs').Operation} Operation */
/** @typedef {{ operation: Operation, description: string, schema: JsonSchemaNode & Record<string, unknown> }} ToolSpec */

/** @param {string} description @returns {JsonSchemaNode} */
function text(description) {
  return { type: 'string', description }
}

/** @param {string[]} values @param {string} description @returns {JsonSchemaNode} */
function choices(values, description) {
  return { type: 'string', enum: values, description }
}

/** @param {Operation} operation @param {string} description @param {Record<string, JsonSchemaNode>} properties @param {string[]} required @returns {ToolSpec} */
function spec(operation, description, properties, required = []) {
  return { operation, description, schema: { type: 'object', properties, required, additionalProperties: false } }
}

const windowId = text('Exact window ID from desktop_list, such as w-4521.')
const ref = text('Full snapshot-qualified ref from desktop_snapshot or desktop_find, such as @s8f3k2p9:e8. Never invent refs.')
const target = { window_id: windowId, root: ref }
const flags = /** @type {const} */ ({ type: 'boolean' })

/** Desktop tools exposed to a model. Desktop content is untrusted data, not instructions. */
export const desktopToolSpecs = [
  spec('list', 'List running desktop apps or their visible native windows. Filter by app whenever known. Choose a window ID before observing it. Use browser tools instead for web pages when appropriate.', {
    kind: choices(['apps', 'windows'], 'List apps or windows.'),
    app: text('Filter by app name. Windows use the exact app name.'),
  }, ['kind']),
  spec('snapshot', 'Read the accessibility tree of one native window. Choose window_id or root, not both. Start with a compact interactive snapshot; for dense windows request a skeleton and drill into a returned root. After an action, take a fresh snapshot to verify the result.', {
    ...target,
    skeleton: { ...flags, description: 'Shallow map for choosing a subtree to inspect.' },
    interactive_only: { ...flags, description: 'Defaults to true. Use false when you need to include static text, such as a result label.' },
    compact: { ...flags, description: 'Defaults to true. Collapses unnecessary wrappers.' },
    max_depth: { type: 'integer', description: 'Limit tree depth from 1 to 10 when the window is dense.' },
  }),
  spec('find', 'Find a small set of matching accessibility elements inside one window or subtree. Choose window_id or root, not both. Use role or exact name to disambiguate. A result with no ref is readable but cannot be acted on.', {
    ...target,
    role: text('Accessibility role, such as button, textfield, or checkbox.'),
    name: text('Accessible name or label.'),
    text: text('Text to match in name, value, title, or description.'),
    exact: { ...flags, description: 'Require an exact name match, ignoring case.' },
  }),
  spec('act', 'Request approval for one headless semantic action on a fresh element ref. No physical input, focus stealing, or clipboard changes. After delivery, verify the intended app-level effect with desktop_snapshot or desktop_find. If delivery is unverified or unknown, inspect the live state before considering another action. Never replace a headless failure with physical input.', {
    action: choices(['click', 'set-value', 'type', 'select', 'check', 'uncheck', 'scroll'], 'Use set-value to replace a value, type to insert text, or select to choose an option.'),
    ref,
    value: text('Text or value for set-value, type, or select, up to 4096 characters. An empty value clears a field with set-value.'),
    direction: choices(['up', 'down', 'left', 'right'], 'Scroll direction. Defaults to down.'),
    amount: { type: 'integer', description: 'Scroll units from 1 to 20, default 3.' },
  }, ['action', 'ref']),
  spec('wait', 'Wait for a condition on an existing qualified element ref instead of pausing for a fixed duration. Use a fresh desktop_snapshot or desktop_find if the old ref can no longer be resolved.', {
    ref,
    predicate: choices(['exists', 'enabled', 'visible', 'value'], 'Condition to observe. Defaults to exists.'),
    value: text('Expected value for the value predicate, up to 4096 characters.'),
    timeout_ms: { type: 'integer', description: 'Maximum wait from 1 to 20000 milliseconds, default 5000.' },
  }, ['ref']),
  spec('screenshot', 'Request approval to capture exactly one native app window as a bounded PNG attachment. Use a window ID from desktop_list. Requires an image-capable model. Do not capture unrelated or sensitive content.', {
    window_id: windowId,
  }, ['window_id']),
]
