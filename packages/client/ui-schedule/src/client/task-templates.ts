/** Starter tasks offered on the Templates view; choosing one fills the create form. */
import type { ReactNode } from 'react'
import { createElement } from 'react'
import {
  IconChecklistOutlineRegular, IconCodeOutlineRegular, IconGlobeOutlineRegular, IconLightOutlineRegular,
  IconRefreshOutlineRegular, IconSearchOutlineRegular,
} from '@janhq/jan-client-ui-primitives'
import { defaultTiming } from './editor-timing.ts'
import { formatWeekdays, type FrequencyTranslator } from './schedule-format.ts'
import { newTaskDraft, type TaskEditorDraft } from './TaskEditorFields.tsx'
import type { TaskManagerKey } from './task-manager-locales.ts'

/** Template ids; each owns `template.<id>.title`, `.description`, and `.prompt` copy. */
export type TaskTemplateId = 'briefing' | 'monitor' | 'weeklyReview' | 'contentIdeas' | 'repoHealth' | 'dependencies'

/** One starter task: its glyph and the ISO weekdays and clock time it runs at. */
export interface TaskTemplate {
  readonly id: TaskTemplateId
  readonly icon: () => ReactNode
  /** ISO weekdays (1 = Monday); all seven run daily. */
  readonly weekdays: readonly number[]
  /** Local `HH:MM` run time. */
  readonly time: string
}

const WEEKDAYS = [1, 2, 3, 4, 5]
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7]

/** Templates in display order. */
export const TASK_TEMPLATES: readonly TaskTemplate[] = [
  { id: 'briefing', icon: () => createElement(IconGlobeOutlineRegular, { size: 16 }), weekdays: WEEKDAYS, time: '08:00' },
  { id: 'monitor', icon: () => createElement(IconSearchOutlineRegular, { size: 16 }), weekdays: EVERY_DAY, time: '09:00' },
  { id: 'weeklyReview', icon: () => createElement(IconChecklistOutlineRegular, { size: 16 }), weekdays: [5], time: '16:00' },
  { id: 'contentIdeas', icon: () => createElement(IconLightOutlineRegular, { size: 16 }), weekdays: [1], time: '09:00' },
  { id: 'repoHealth', icon: () => createElement(IconCodeOutlineRegular, { size: 16 }), weekdays: WEEKDAYS, time: '09:30' },
  { id: 'dependencies', icon: () => createElement(IconRefreshOutlineRegular, { size: 16 }), weekdays: [1], time: '10:00' },
]

/**
 * Localized schedule line for a template, worded like a saved task's frequency.
 * @param template - Template whose weekdays and time are described.
 * @param t - Frequency and weekday translations.
 * @returns For example `Daily at 09:00` or `Weekly on Fri at 16:00`.
 */
export function templateSchedule(template: TaskTemplate, t: FrequencyTranslator): string {
  return template.weekdays.length === 7
    ? t('frequency.dailyLocal', { time: template.time })
    : t('frequency.weeklyLocal', { weekdays: formatWeekdays(template.weekdays, t), time: template.time })
}

/**
 * Create-form values for a template in the local time zone.
 * @param template - Template to start from.
 * @param t - Copy for the title and instruction.
 * @returns A complete draft the create form accepts without edits.
 */
export function templateDraft(template: TaskTemplate, t: (key: TaskManagerKey) => string): TaskEditorDraft {
  const timing = defaultTiming()
  const start = `${timing.start.slice(0, 10)}T${template.time}:00`
  return {
    ...newTaskDraft(),
    title: t(`template.${template.id}.title`),
    prompt: t(`template.${template.id}.prompt`),
    ...template.weekdays.length === 7
      ? { frequency: 'daily', dailyTime: template.time, start }
      : { frequency: 'weekly', weekdays: template.weekdays, start, dailyTime: template.time },
  }
}
