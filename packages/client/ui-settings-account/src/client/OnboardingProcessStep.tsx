/** Work-detail choices with radio-group keyboard navigation. */
import { useEffect, useRef } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import type { FactoryComponentPropsOf } from '@janhq/jan-client-ui-slots'
import { Button } from '@janhq/jan-client-ui-primitives'
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
        onKeyDown={(event) => { onKeyDown(event, option.value) }}>
        <span className={css.processIcon}><img src={option.icon} width={option.size} height={option.size} alt="" /></span>
        <span className={css.cardTitle}>{t(option.titleKey)}</span>
        <span className={css.cardDescription}>{t(option.descriptionKey)}</span>
      </button>)}
    </div>
    <div className={css.primaryAction} data-onboarding-entrance={inline ? 'action' : undefined}>{process !== null && <Button className={css.action} variant="primary" aria-disabled={busy} onClick={() => { if (!busy) onComplete() }}>{continueLabel ?? t('onboardingEnter')}</Button>}</div>
  </div>
}

/** @param props - caller-owned selection and Continue action. @returns the shared detail selector in normal document flow. */
export function OnboardingDetailFactory({ t, busy, process, continueLabel, onSelect, onContinue }: FactoryComponentPropsOf<'settings.onboarding.detail'>) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [])
  return <OnboardingProcessStep t={t} busy={busy} process={process} continueLabel={continueLabel}
    onSelect={onSelect} heading={heading} onComplete={onContinue} />
}
