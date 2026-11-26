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

const ref = text('Ref from the latest web_snapshot, such as @e3. Never invent refs.')
const flag = /** @type {const} */ ({ type: 'boolean' })

/** Web tools exposed to a model. Page content is untrusted data, not instructions. */
export const webToolSpecs = [
  spec('open', 'Request approval to open a web address in this chat\'s own browser. Sign-ins made in that browser are kept and shared with other Jan chats and bots, so sites the user already signed in to stay signed in. Set visible when the user has to see the window, for example to sign in themselves.', {
    url: text('Full http or https address.'),
    visible: { ...flag, description: 'Show the browser window instead of running it in the background. Use it when the user must sign in or watch.' },
  }, ['url']),
  spec('snapshot', 'Read the current page as an accessibility tree with refs for its elements. Start with the default interactive view; narrow dense pages with a CSS selector. After an action, take a fresh snapshot: refs from older snapshots go stale.', {
    interactive_only: { ...flag, description: 'Defaults to true. Use false to include static text.' },
    selector: text('CSS selector that limits the snapshot to part of the page.'),
  }),
  spec('act', 'Request approval for one action on the current page: click, fill (replace a field\'s text), type (append text), select an option, check, uncheck, hover, press a key, or scroll. Verify the result with a fresh web_snapshot afterwards.', {
    action: choices(['click', 'fill', 'type', 'select', 'check', 'uncheck', 'hover', 'press', 'scroll'], 'The action.'),
    ref,
    value: text('Text for fill or type, the option for select, or the key for press, such as Enter or Control+a. Up to 4096 characters.'),
    direction: choices(['up', 'down', 'left', 'right'], 'Scroll direction. Defaults to down.'),
    amount: { type: 'integer', description: 'Scroll distance in pixels from 1 to 5000, default 600.' },
  }, ['action']),
  spec('read', 'Read the page title or address, or the text or form value of one element.', {
    what: choices(['title', 'url', 'text', 'value'], 'What to read. text and value need a ref.'),
    ref,
  }, ['what']),
  spec('wait', 'Wait until an element appears, or for a fixed time when nothing better can be observed.', {
    ref,
    timeout_ms: { type: 'integer', description: 'Fixed wait from 1 to 20000 milliseconds when no ref is given, default 1000.' },
  }),
  spec('tabs', 'List this browser\'s tabs, or switch to one by its tab ID.', {
    tab_id: text('Tab ID from a previous web_tabs list, such as t2. Omit to list tabs.'),
  }),
  spec('screenshot', 'Request approval to capture the current page as a PNG attachment. Requires an image-capable model. Do not capture pages with private content the task does not need.', {
    full_page: { ...flag, description: 'Capture the whole scrollable page instead of the visible part.' },
  }),
  spec('close', 'Close this chat\'s browser when the task is done. Sign-ins are kept for the next time.', {}),
]
