/**
 * Model-facing Consumer of the `ctx.userQuestions` capability seam.
 * The tool pauses until a UI provider returns a human answer, then feeds that
 * answer back into the agent loop as an ordinary tool result.
 *
 * @module @janhq/jan-tool-ask-user
 */

import type { Context } from '@janhq/cordis'
import { defineTool, valueSchemaSpecToJsonSchema } from '@janhq/jan-tools'
import z from '@janhq/schemastery'
import { automaticAnswerNotice, pendingNotice, questionRequest, registerTimedAskUser, skippedAnswerGuidance, validateQuestionIds } from './timed.ts'
import { AUTO_ANSWER_SCHEMA_DESCRIPTION, type TimedUserQuestionResult } from '@janhq/jan-user-questions'

/** Cordis row selecting the tool schema and its default foreground wait. */
export interface Config {
  /** Tool definition selected by this Cordis row. Defaults to the blocking legacy tool. */
  mode?: 'legacy' | 'timed' | 'auto'
  /** Foreground wait before automatic continuation. Defaults to 120 seconds. */
  timeout?: number
}

export const Config: z<Config> = z.object({
  mode: z.union(['legacy', 'timed', 'auto']).default('legacy'),
  timeout: z.union([-1, z.number().step(1).min(1).max(2_147_483)]).default(120),
})

export const name = 'tool-ask-user'
export const inject = ['tools', 'userQuestions']

const description = 'Ask the user a concise question when you need confirmation, a choice, or missing information before proceeding. '
  + skippedAnswerGuidance

const answersSchema = {
  type: 'array',
  required: true,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string', required: true },
      selected: { type: 'array', required: true, items: { type: 'string' } },
      custom: { type: 'string' },
    },
  },
} as const

export function apply(ctx: Context, config: Config = {}): void {
  if (config.mode === 'timed') {
    registerTimedAskUser(ctx, config.timeout)
    return
  }
  const auto = config.mode === 'auto'
  const tool = defineTool({
    name: 'ask_user_question',
    description,
    parameters: {
      questions: {
        type: 'array',
        required: true,
        description: 'Questions to ask the user before continuing.',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: { type: 'string', required: true, description: 'Stable id for this question; echoed in the answer.' },
            question: { type: 'string', required: true, description: 'The specific question to ask the user.' },
            header: {
              type: 'string',
              description: 'Optional short heading for the question, such as "Confirm" or "Choose Mode".',
            },
            options: {
              type: 'array',
              description: 'Optional choices to show the user. If you recommend one, put it first and append "(Recommended)" to that label.',
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  label: { type: 'string', required: true, description: 'Short user-facing option label.' },
                  description: { type: 'string', description: 'One sentence explaining the tradeoff or impact.' },
                },
              },
            },
            multi_select: {
              type: 'boolean',
              description: 'Whether the user may select more than one option. Defaults to false.',
            },
          },
        },
      },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object', additionalProperties: false,
            properties: {
              pending: { type: 'boolean', enum: [true], required: true },
              callId: { type: 'string', required: true },
              message: { type: 'string', required: true },
            },
          },
          {
            type: 'object', additionalProperties: false,
            properties: {
              answers: answersSchema,
              autoSubmitted: { type: 'boolean', enum: [true] },
              message: { type: 'string' },
            },
          },
        ],
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (auto) validateQuestionIds(args.questions)
      const request = questionRequest(args.questions, exec)
      const seconds = auto ? ctx.get('userQuestionSettings')?.autoAnswerSeconds() ?? 0 : 0
      let result: TimedUserQuestionResult
      if (seconds > 0) {
        if (exec.agent === undefined) throw new Error('automatic questions require a live agent')
        result = await ctx.userQuestions.askTimed({ ...request, agent: exec.agent }, exec.callId, seconds * 1000, true)
      } else {
        result = await ctx.userQuestions.ask(request)
      }
      if ('pending' in result) return { ...result, message: pendingNotice }
      return {
        answers: result.answers.map(answer => ({
          id: answer.id,
          selected: [...answer.selected],
          ...answer.custom !== undefined ? { custom: answer.custom } : {},
        })),
        ...(seconds > 0 && result.autoSubmitted === true ? { autoSubmitted: true as const, message: automaticAnswerNotice } : {}),
      }
    },
  })
  ctx.tools.register(auto ? {
    ...tool,
    parameters: { ...tool.parameters, description: AUTO_ANSWER_SCHEMA_DESCRIPTION },
  } : {
    ...tool,
    output: {
      ...tool.output,
      schema: valueSchemaSpecToJsonSchema({ type: 'object', additionalProperties: false, properties: { answers: answersSchema } }),
    },
  })
}
