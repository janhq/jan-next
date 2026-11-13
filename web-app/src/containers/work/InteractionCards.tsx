/**
 * What the agent is waiting on in this chat: an approval for a tool call, a
 * question with options, or a plan to review. Docked above the composer so
 * the answer is one click away while the turn is paused.
 */
import { useMemo, useState } from 'react'
import { IconHelpCircle, IconListCheck, IconShieldQuestion } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { answerApproval, answerQuestion } from '@/lib/dsh-chat-transport'
import { cn } from '@/lib/utils'
import {
  useThreadInteractions,
  type AskAnswer,
  type AskQuestion,
  type DshInteraction,
} from '@/stores/dsh-interaction-store'
import { useOpenThreadMessages } from '@/stores/thread-ui-messages-store'

export function InteractionCards({ threadId }: { threadId: string }) {
  const items = useThreadInteractions(threadId)
  if (items.length === 0) return null
  // One at a time: DSH asks serially, and a queue of cards reads as noise.
  const item = items[0]
  return (
    <div className="mb-2 rounded-xl border bg-card p-3 shadow-sm" role="region" aria-live="polite">
      {item.kind === 'approval' ? (
        <ApprovalCard threadId={threadId} item={item} />
      ) : item.questions[0]?.intent?.kind === 'plan-review' ? (
        <PlanCard requestId={item.requestId} question={item.questions[0]} />
      ) : (
        <QuestionCard requestId={item.requestId} questions={item.questions} />
      )}
    </div>
  )
}

/** What the waiting call acts on: a path for file tools, the command for bash. */
function targetOf(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const v = input as Record<string, unknown>
  const pick = v.file_path ?? v.path ?? v.command
  return typeof pick === 'string' ? pick : undefined
}

function ApprovalCard({
  threadId,
  item,
}: {
  threadId: string
  item: Extract<DshInteraction, { kind: 'approval' }>
}) {
  const { t } = useTranslation()
  const messages = useOpenThreadMessages(threadId)
  // The request names only the tool; its streamed call says what it touches.
  const target = useMemo(() => {
    if (!item.callId) return undefined
    for (const message of messages) {
      for (const part of message.parts as { toolCallId?: string; input?: unknown }[]) {
        if (part.toolCallId === item.callId) return targetOf(part.input)
      }
    }
    return undefined
  }, [messages, item.callId])
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <IconShieldQuestion size={18} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium">{t('work:approval.title', { tool: item.toolName })}</p>
          {target && (
            <p className="mt-0.5 break-all font-mono text-xs text-foreground/80">{target}</p>
          )}
          {item.reason && (
            <p className="mt-0.5 break-words text-xs text-muted-foreground text-pretty">{item.reason}</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => void answerApproval(item.requestId, 'deny')}>
          {t('work:approval.deny')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void answerApproval(item.requestId, 'always')}>
          {t('work:approval.always')}
        </Button>
        <Button size="sm" onClick={() => void answerApproval(item.requestId, 'allow')}>
          {t('work:approval.allow')}
        </Button>
      </div>
    </div>
  )
}

function PlanCard({ requestId, question }: { requestId: string; question: AskQuestion }) {
  const { t } = useTranslation()
  const [feedback, setFeedback] = useState('')
  const approve = question.intent?.kind === 'plan-review' ? question.intent.approve : ''
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <IconListCheck size={18} className="shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">{t('work:ask.planTitle')}</p>
      </div>
      {question.detail && (
        <div className="max-h-72 overflow-y-auto rounded-md border bg-background px-3 py-2 text-sm">
          <RenderMarkdown content={question.detail} />
        </div>
      )}
      <Textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder={t('work:ask.feedbackPlaceholder')}
        className="min-h-16 text-sm"
      />
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void answerQuestion(requestId, [
              { id: question.id, selected: [], custom: feedback.trim() || t('work:ask.keepPlanning') },
            ])
          }
        >
          {t('work:ask.keepPlanning')}
        </Button>
        <Button
          size="sm"
          onClick={() =>
            void answerQuestion(requestId, [
              { id: question.id, selected: [approve], ...(feedback.trim() ? { custom: feedback.trim() } : {}) },
            ])
          }
        >
          {t('work:ask.approvePlan')}
        </Button>
      </div>
    </div>
  )
}

function QuestionCard({ requestId, questions }: { requestId: string; questions: AskQuestion[] }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})

  const toggle = (q: AskQuestion, label: string) =>
    setSelected((s) => {
      const current = s[q.id] ?? []
      if (!q.multiSelect) return { ...s, [q.id]: [label] }
      return {
        ...s,
        [q.id]: current.includes(label) ? current.filter((l) => l !== label) : [...current, label],
      }
    })

  const answered = questions.every(
    (q) => (selected[q.id]?.length ?? 0) > 0 || (custom[q.id] ?? '').trim()
  )

  const submit = () => {
    const answers: AskAnswer[] = questions.map((q) => {
      const text = (custom[q.id] ?? '').trim()
      return { id: q.id, selected: selected[q.id] ?? [], ...(text ? { custom: text } : {}) }
    })
    void answerQuestion(requestId, answers)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <IconHelpCircle size={18} className="shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">{t('work:ask.title')}</p>
      </div>
      {questions.map((q) => (
        <fieldset key={q.id} className="flex flex-col gap-1.5">
          <legend className="text-sm text-pretty">
            {q.header && <span className="mr-1 text-xs text-muted-foreground">{q.header}</span>}
            {q.question}
          </legend>
          {q.detail && <p className="text-xs text-muted-foreground text-pretty">{q.detail}</p>}
          {(q.options ?? []).length > 0 && (
            <div className="flex flex-col gap-1">
              {q.options!.map((option) => {
                const on = selected[q.id]?.includes(option.label) ?? false
                return (
                  <button
                    key={option.label}
                    type="button"
                    role={q.multiSelect ? 'checkbox' : 'radio'}
                    aria-checked={on}
                    onClick={() => toggle(q, option.label)}
                    className={cn(
                      'rounded-md border px-3 py-1.5 text-left text-sm transition-colors',
                      on ? 'border-primary bg-primary/5' : 'hover:bg-accent'
                    )}
                  >
                    <span className="block">{option.label}</span>
                    {option.description && (
                      <span className="block text-xs text-muted-foreground text-pretty">
                        {option.description}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
          <Textarea
            value={custom[q.id] ?? ''}
            onChange={(e) => setCustom((c) => ({ ...c, [q.id]: e.target.value }))}
            placeholder={
              (q.options ?? []).length > 0 ? t('work:ask.other') : t('work:ask.otherPlaceholder')
            }
            className="min-h-10 text-sm"
            rows={1}
          />
        </fieldset>
      ))}
      <div className="flex justify-end">
        <Button size="sm" disabled={!answered} onClick={submit}>
          {t('work:ask.send')}
        </Button>
      </div>
    </div>
  )
}
