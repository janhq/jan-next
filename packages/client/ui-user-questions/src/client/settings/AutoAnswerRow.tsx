/** Agent loop Settings row for automatic answers to agent questions. */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime, InjectFace } from '@janhq/jan-client-ui-slots'
import type { ConfigForm, ConfigFormSnapshot } from '@janhq/jan-client-ui-settings/client'
import { IconChevronDownOutlineRegular, Menu } from '@janhq/jan-client-ui-primitives'
import { AUTO_ANSWER_SECONDS, DEFAULT_AUTO_ANSWER_SECONDS, type AutoAnswerSeconds, type QuestionSettings } from '../../question-settings.ts'
import type { QuestionKey } from '../locales.ts'
import css from './AutoAnswerRow.module.css'

/** Settings row counterpart of the Host configuration form. */
export interface AutoAnswerRowInjected {
  hooks: { questionSettings: Pick<ConfigForm<QuestionSettings>, 'getSnapshot' | 'subscribe'> }
  setAutoAnswerSeconds(seconds: AutoAnswerSeconds): Promise<boolean>
}

type AutoAnswerRowProps = PropsRuntime<'settings.agentLoop.item'> & PropsLocale<'question'> & InjectFace<AutoAnswerRowInjected>

const LABELS = {
  0: 'settings.autoAnswer.off',
  30: 'settings.autoAnswer.30',
  60: 'settings.autoAnswer.60',
  120: 'settings.autoAnswer.120',
  300: 'settings.autoAnswer.300',
} satisfies Record<AutoAnswerSeconds, QuestionKey>

/** Render the automatic question deadline selector. */
export function AutoAnswerRow({ useQuestionSettings, setAutoAnswerSeconds, t }: AutoAnswerRowProps) {
  const { value, writable }: ConfigFormSnapshot<QuestionSettings> = useQuestionSettings(snapshot => snapshot)
  const seconds = value?.autoAnswerSeconds ?? DEFAULT_AUTO_ANSWER_SECONDS
  const [open, setOpen] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.autoAnswer.title')}</div>
        <div className={css.desc}>{t('settings.autoAnswer.description')}</div>
        {saveFailed && <div className={css.desc} role="alert">{t('settings.autoAnswer.saveFailed')}</div>}
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={AUTO_ANSWER_SECONDS.map(option => ({ id: String(option), label: t(LABELS[option]) }))}
        selectedId={String(seconds)}
        onSelect={(id) => {
          setOpen(false)
          const option = AUTO_ANSWER_SECONDS.find(item => String(item) === id)
          if (option === undefined || option === seconds) return
          setSaveFailed(false)
          void setAutoAnswerSeconds(option).then((accepted) => { setSaveFailed(!accepted) }, () => { setSaveFailed(true) })
        }}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className={css.selector}
            aria-label={`${t('settings.autoAnswer.title')}: ${t(LABELS[seconds])}`}
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={!writable}
            onClick={() => { setOpen(value => !value) }}
          >
            {t(LABELS[seconds])}
            <IconChevronDownOutlineRegular className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
