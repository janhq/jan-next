/** Tool schemas and role checks for coordinator and worker chats. */
import { defineTool } from '@janhq/jan-tools'

const string = (description, required) => ({ type: 'string', description, ...(required && { required: true }) })
const strings = description => ({ type: 'array', items: { type: 'string' }, description })
const choice = (values, required) => ({ type: 'string', enum: values, ...(required && { required: true }) })
const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }

// tool-jobs waits cap at 270s to stay inside the prompt-cache window. Orchestration
// never waits for a worker's turn or task to finish: reports wake the coordinator asynchronously.
/** Build role-scoped tool definitions and matching execution guards.
 * @param {object} runtime - orchestration operations.
 * @returns {object[]} definitions paired with their activation predicates.
 */
export function orchestrationTools(runtime) {
  const coordinatorWhen = ({ agent }) => agent.session.header.origin !== 'subagent' && !runtime.workerForSession(agent.id)
  const workerWhen = ({ agent }) => Boolean(runtime.workerForSession(agent.id))
  const tool = (when, role, name, description, parameters, run) => ({ when,
    def: defineTool({ name: `orchestration_${name}`, description, parameters, output,
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        if (!when(exec)) throw new Error(`This tool is available only in ${role} chats.`)
        return JSON.stringify(await run(args, exec.agent.id, exec.signal))
      },
    }),
  })
  const control = (...args) => tool(coordinatorWhen, 'coordinator', ...args)
  const work = (...args) => tool(workerWhen, 'worker', ...args)
  const task = string('Task id.', true)
  const limit = { type: 'integer', description: 'Number of messages, up to 50.' }
  return [
    control('targets', 'List computers (this one and connected Jan Hosts) and their projects that orchestration_start can place worker chats on.',
      {}, (_args, _sessionId, signal) => runtime.targets(signal)),
    control('start', 'Start worker chats, one per task. Each worker is a full chat (visible in the sidebar) that works in the background in its own git worktree by default and reports back here; you are woken when a worker reports, asks or finishes. Use orchestration_tasks to see state and orchestration_send to reply. Split work so workers touch disjoint files.', {
      tasks: { type: 'array', required: true, description: 'One to twenty tasks.', items: { type: 'object', additionalProperties: false, properties: {
        title: string('Short worker chat title.', true),
        spec: string('Task brief, including scope and expected result.', true),
        depends_on: strings('Exact titles in this call or task ids from this chat. All must complete before this task starts.'),
        host: string('Local by default; use local or a computer id or name from orchestration_targets.'),
        project: string('Exact project title or path. Defaults to the coordinator project locally or the remote default project.'),
        worktree: { ...choice(['new', 'current']), default: 'new' },
        mode: string('Agent mode preset id.'),
        agent: string('Agent profile id.'),
        retry_of: string('Task id of a failed, completed or stopped task to retry.'),
      } } },
    }, (args, sessionId, signal) => runtime.start(sessionId, args.tasks, signal)),
    control('tasks', 'List this chat’s tasks, current dispatches and latest worker updates.', {
      status: choice(['pending', 'dispatched', 'completed', 'failed', 'stopped']),
      include_messages: { type: 'boolean', description: 'Include the last 20 updates and sends per task.' },
    }, (args, sessionId) => runtime.tasks(sessionId, args)),
    control('send', 'Send a follow-up or answer to a worker. Use reply_to with the question id to answer a worker question.', {
      to: string('Task id, @all for all active workers, or @idle for idle workers.', true),
      message: string('Message for the worker.', true),
      reply_to: string('Question id, if answering a question.'),
      urgent: { type: 'boolean', description: 'Steer the current turn rather than queueing the message.' },
    }, (args, sessionId, signal) => runtime.send(sessionId, args, signal)),
    control('read', 'Read the current worker chat’s recent user and assistant messages.', { task, limit },
      (args, sessionId, signal) => runtime.read(sessionId, args.task, args.limit, signal)),
    control('stop', 'Stop a worker without deleting its chat, branch or worktree. Use orchestration_start with retry_of to try again.',
      { task }, (args, sessionId, signal) => runtime.stop(sessionId, args.task, signal)),
    work('report', 'Send a short progress update to the coordinator at a meaningful milestone.', { message: string('Progress update.', true) },
      ({ message }, sessionId, signal) => runtime.update(sessionId, { type: 'status', body: message }, signal)),
    work('ask', 'Ask the coordinator for a decision, then end your turn. The answer arrives as a new message.', {
      question: string('Decision needed from the coordinator.', true), options: strings('Possible answers.'),
    }, ({ question, options }, sessionId, signal) => runtime.update(sessionId, { type: 'question', body: question, options }, signal)),
    work('done', 'Report the outcome to the coordinator once, when you finish or cannot finish the task.', {
      outcome: choice(['succeeded', 'failed'], true),
      summary: string('What you did, what you found and what remains.', true),
      files_modified: strings('Files you changed.'),
    }, ({ outcome, summary, files_modified: filesModified }, sessionId, signal) => runtime.update(sessionId,
      { type: 'done', outcome, body: summary, filesModified: filesModified ?? [] }, signal)),
  ]
}
