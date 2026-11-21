/** Settings namespace owned by the question UI Host entry. */
export const QUESTION_SETTINGS_NAMESPACE = 'ui-user-questions'

/** Field carrying the automatic answer deadline in seconds. */
export const AUTO_ANSWER_SECONDS_FIELD = 'autoAnswerSeconds'

/** Supported durations in seconds; zero keeps questions blocking. */
export const AUTO_ANSWER_SECONDS = [0, 30, 60, 120, 300] as const

/** Supported value of the automatic answer preference. */
export type AutoAnswerSeconds = typeof AUTO_ANSWER_SECONDS[number]

/** Default automatic answer preference. */
export const DEFAULT_AUTO_ANSWER_SECONDS: AutoAnswerSeconds = 0

/** The question UI settings section, as presented by the Host form. */
export interface QuestionSettings {
  /** Wait in seconds before automatically submitting an untouched question batch. */
  autoAnswerSeconds: AutoAnswerSeconds
}
