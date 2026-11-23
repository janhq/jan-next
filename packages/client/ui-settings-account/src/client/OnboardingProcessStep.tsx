/** Work-detail choices with radio-group keyboard navigation and, inline, a live preview of each mode. */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, RefObject } from 'react'
import type { FactoryComponentPropsOf } from '@janhq/jan-client-ui-slots'
import {
  Button, IconChevronRightOutlineRegular, IconDeliverDocRegular, IconImageOutlineRegular, IconLayersOutlineRegular,
  IconSearchOutlineRegular, IconThinkOutlineRegular, IconUsersOutlineRegular,
} from '@janhq/jan-client-ui-primitives'
import type { OnboardingProcess } from '../onboarding-settings.ts'
import type { DesktopOnboardingProps } from './onboarding-contract.ts'
import compactIcon from './assets/onboarding-compact.svg'
import standardIcon from './assets/onboarding-standard.svg'
import detailedIcon from './assets/onboarding-detailed.svg'
import css from './DesktopOnboarding.module.css'

const options = [
  { value: 'compact', titleKey: 'onboardingCompact', descriptionKey: 'onboardingCompactDescription', icon: compactIcon, size: 40 },
  { value: 'standard', titleKey: 'onboardingStandard', descriptionKey: 'onboardingStandardDescription', icon: standardIcon, size: 36 },
  { value: 'detailed', titleKey: 'onboardingDetailed', descriptionKey: 'onboardingDetailedDescription', icon: detailedIcon, size: 36 },
] as const

/** Stops on the sample route; the reply shows them as photos in every mode, since images are part of the result. */
const PHOTOS = ['Ferry Building', 'Pier 39', 'Golden Gate Park'] as const

/**
 * A miniature turn as the transcript draws it in each mode (see ui-chat's display-modes table):
 * Results only folds the work, subagents included, into one summary row; Key details adds the
 * live subagent task and the first reasoning line; Full details lists every step, each subagent
 * and the image search. Remounting per mode replays the turn.
 * @param props - the mode to draw and the translator.
 * @returns a decorative preview; the radio group carries the choice for assistive technology.
 */
function DetailPreview({ mode, t }: Pick<DesktopOnboardingProps, 't'> & { mode: OnboardingProcess }) {
  const rows = mode === 'compact'
    ? [<span key="group" className={css.demoRow}><IconLayersOutlineRegular size={14} />{t('onboardingDemoSummary')}<IconChevronRightOutlineRegular size={12} /></span>]
    : mode === 'standard'
      ? [
        <span key="group" className={css.demoRow}><IconLayersOutlineRegular size={14} /><span className={css.demoClip}>{t('onboardingDemoSummary')}</span><span className={css.demoLive}>{t('onboardingDemoLive')}</span><IconChevronRightOutlineRegular size={12} /></span>,
        <span key="thought" className={css.demoThought}>{t('onboardingDemoThought')}</span>,
      ]
      : [
        <span key="thought" className={css.demoRow}><IconThinkOutlineRegular size={14} /><span className={css.demoThoughtInline}>{t('onboardingDemoThought')}</span></span>,
        <span key="agent-a" className={`${css.demoRow} ${css.demoAgent}`}><IconUsersOutlineRegular size={14} />{t('onboardingDemoAgentA')}</span>,
        <span key="agent-b" className={`${css.demoRow} ${css.demoAgent}`}><IconUsersOutlineRegular size={14} />{t('onboardingDemoAgentB')}</span>,
        <span key="search" className={css.demoRow}><IconSearchOutlineRegular size={14} />{t('onboardingDemoSearch')}</span>,
        <span key="read" className={css.demoRow}><IconDeliverDocRegular size={14} />{t('onboardingDemoRead')}</span>,
        <span key="images" className={css.demoRow}><IconImageOutlineRegular size={14} />{t('onboardingDemoImages')}</span>,
      ]
  return <figure className={css.demo} aria-hidden="true" data-onboarding-entrance="body">
    <figcaption className={css.demoLabel}>{t('onboardingDemoLabel')}</figcaption>
    <div key={mode} className={css.demoTurn}>
      <p className={css.demoUser}>{t('onboardingDemoPrompt')}</p>
      {rows.map((row, i) => <div key={i} className={css.demoStep} style={{ '--i': i } as CSSProperties}>{row}</div>)}
      <p className={css.demoAnswer} style={{ '--i': rows.length } as CSSProperties}>{t('onboardingDemoAnswer')}</p>
      <div className={css.demoPhotos} style={{ '--i': rows.length + 1 } as CSSProperties}>
        {PHOTOS.map((place, i) => <span key={place} className={css.demoPhoto} data-photo={i}><span>{place}</span></span>)}
      </div>
    </div>
  </figure>
}

/** @param props - selected detail, localized copy and persistence callbacks. @returns the process step. */
export function OnboardingProcessStep({ t, heading, busy, process, onSelect, onComplete, continueLabel }: Pick<DesktopOnboardingProps, 't'> & {
  heading: RefObject<HTMLHeadingElement>
  busy: boolean
  process: OnboardingProcess | null
  onSelect: (value: OnboardingProcess) => void
  onComplete: () => void
  continueLabel?: string
}) {
  const onKeyDown = (event: KeyboardEvent, value: OnboardingProcess) => {
    if (busy) return
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (direction === 0) return
    event.preventDefault()
    const nextIndex = (options.findIndex(option => option.value === value) + direction + options.length) % options.length
    const next = options[nextIndex as 0 | 1 | 2]
    onSelect(next.value)
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-process="${next.value}"]`)?.focus()
  }
  const inline = continueLabel !== undefined
  // Hovering or focusing a card previews it; leaving falls back to the choice, then Desktop's default.
  const [peek, setPeek] = useState<OnboardingProcess | null>(null)
  return <div className={`${css.content} ${css.process}${inline ? ` ${css.inlineProcess}` : ''}`}>
    <div className={css.copy}>
      <h1 id="desktop-onboarding-title" ref={heading} tabIndex={-1} data-onboarding-entrance={inline ? 'heading' : undefined}>{t('onboardingProcess')}</h1>
      <p className={css.subtitle} data-onboarding-entrance={inline ? 'description' : undefined}>{t('onboardingProcessDescription')}</p>
    </div>
    <div className={css.processCards} role="radiogroup" aria-labelledby="desktop-onboarding-title" data-onboarding-entrance={inline ? 'body' : undefined}>
      {options.map(option => <button type="button" role="radio" key={option.value}
        data-process={option.value} aria-checked={process === option.value}
        tabIndex={process === option.value || (process === null && option.value === 'compact') ? 0 : -1}
        className={`${css.card} ${process === option.value ? css.selected : ''}`}
        aria-disabled={busy} onClick={() => { if (!busy) onSelect(option.value) }}
        onPointerEnter={inline ? () => { setPeek(option.value) } : undefined} onPointerLeave={inline ? () => { setPeek(null) } : undefined}
        onFocus={inline ? () => { setPeek(option.value) } : undefined} onBlur={inline ? () => { setPeek(null) } : undefined}
        onKeyDown={(event) => { onKeyDown(event, option.value) }}>
        {inline
          ? <span className={css.processGlyph} style={{ maskImage: `url("${option.icon}")` }} aria-hidden="true" />
          : <span className={css.processIcon}><img src={option.icon} width={option.size} height={option.size} alt="" /></span>}
        <span className={css.cardTitle}>{t(option.titleKey)}</span>
        <span className={css.cardDescription}>{t(option.descriptionKey)}</span>
      </button>)}
    </div>
    {inline && <DetailPreview mode={peek ?? process ?? 'standard'} t={t} />}
    <div className={css.primaryAction} data-onboarding-entrance={inline ? 'action' : undefined}>
      {inline
        ? <Button variant="primary" disabled={busy || process === null} onClick={onComplete}>{continueLabel}</Button>
        : process !== null && <Button className={css.action} variant="primary" aria-disabled={busy} onClick={() => { if (!busy) onComplete() }}>{t('onboardingEnter')}</Button>}
    </div>
  </div>
}

/** @param props - caller-owned selection and Continue action. @returns the shared detail selector in normal document flow. */
export function OnboardingDetailFactory({ t, busy, process, continueLabel, onSelect, onContinue }: FactoryComponentPropsOf<'settings.onboarding.detail'>) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [])
  return <OnboardingProcessStep t={t} busy={busy} process={process} continueLabel={continueLabel}
    onSelect={onSelect} heading={heading} onComplete={onContinue} />
}
