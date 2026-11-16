/**
 * First-run model step. Readiness comes from the same
 * provider/settings/credential join as the Models page: any provider the user
 * can already talk to ends the step, and only a user with none is offered the
 * configured onboarding route. The step reuses that page's credential editor in
 * the onboarding plugin's shared modal, so the key is entered once.
 */
import type { TrackProductEvent } from '@deepseek-ai/dsh-client-product-analytics/client'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsRuntime, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelsSettingsState, ModelsSettingsStore } from './store.ts'
import { onboardingReadiness, onboardingRow, type OnboardingRouteMatch } from './store.ts'
import type { ModelsOperations } from './operations.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import { ProviderEditor } from './ProviderEditor.tsx'
import type {} from './slot-contract.ts'
import type { en } from './locales.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import styles from './GetStartedDialog.module.css'

/** Registration-side dependencies of {@link GetStartedDialog}. */
export interface GetStartedInjected {
  /** Desktop-only event collection. */
  track?: TrackProductEvent
  /** Whether first-run setup should show automatically. Explicit requests remain available. */
  automatic: boolean
  /** The provider row this step offers. */
  route: OnboardingRouteMatch
  hooks: {
    /** Shared Models-page join state, bound by the slot renderer. */
    models: SnapshotStore<ModelsSettingsState>
  }
  /** Shared Models-page join controller. */
  controller: ModelsSettingsStore
  /** The Host operations the reused Models credential editor writes through. */
  operations: ModelsOperations
  /** Settings schema and immutable path callbacks. */
  schema: SettingsSchemaOperations
  /** Feature copy. */
  t: (key: keyof typeof en) => string
}

/** Slot owner props plus the feature's injected dependencies. */
export type GetStartedDialogProps =
  PropsRuntime<'settings.onboarding'> & PropsRenderSlots<'settings.models.sign-in' | 'settings.models.local-setup'> & InjectFace<GetStartedInjected>

/* v8 ignore next 3 -- closed-union defaults only defend future source widening */
function assertNever(_value: never): never {
  throw new Error('unexpected onboarding state')
}

/**
 * While no provider can serve requests, offer a first-run user the ways to get one, in this
 * order: a local model (`settings.models.local-setup`, the primary choice when mounted), the
 * account sign-in (`settings.models.sign-in`), or the onboarding route's API key.
 * @param props - settings-shell owner state and Models feature dependencies.
 * @returns the onboarding modal or null when onboarding needs no intervention.
 */
export function GetStartedDialog(props: GetStartedDialogProps): ReactNode {
  const { complete, controller, useModels, operations, schema, t, renderSlot, automatic, explicit = false } = props
  const { route } = props
  const [choice, setChoice] = useState<'choose' | 'account' | 'local' | 'api-key'>(explicit ? 'api-key' : 'choose')
  const state = useModels(snapshot => snapshot)
  const readiness = onboardingReadiness(state, route)

  useEffect(() => {
    if ((automatic || explicit) && state.status === 'idle') void controller.load()
  }, [controller, state.status, automatic, explicit])

  useEffect(() => {
    if (
      (!automatic && !explicit)
      || readiness.kind === 'adapter-absent'
      || (!explicit && readiness.kind === 'provider-ready')
      || readiness.kind === 'unavailable'
    ) complete()
  }, [complete, readiness.kind, explicit, automatic])

  if (!automatic && !explicit) return null

  switch (readiness.kind) {
    case 'loading':
    case 'adapter-absent':
    case 'unavailable':
      return null
    case 'provider-ready':
      if (!explicit) return null
      break
    case 'credential-missing':
      break
    /* v8 ignore next -- every current readiness variant is handled above */
    default:
      return assertNever(readiness)
  }

  const row = onboardingRow(state, route)
  const namespace = row === undefined ? undefined : state.namespaces.get(row.entry.settingsNs)
  /* v8 ignore next 2 -- credential-missing is derived only from this exact joined row. */
  if (row === undefined || namespace === undefined) return null

  const finishCredential = (changed: boolean): void => {
    if (!changed) {
      complete()
      return
    }
    void controller.load()
  }

  const editor = (
    <OnboardingModal title={t('onboardingTitle')}>
      <p className={styles.description}>{t('onboardingDescription')}</p>
      <div className={styles.editor}>
        <ProviderEditor
          provider={row.entry.provider}
          displayName={row.entry.displayName}
          namespace={namespace}
          schema={schema}
          settingsPath={row.entry.settingsPath}
          operations={operations}
          t={t}
          readOnly={false}
          hideTitle
          credentialOnly
          onSubmitCredential={() => { props.track?.('api_key_save_click', {}) }}
          credentialRequired
          autoFocusCredential
          cancelLabelKey="onboardingLater"
          submitLabelKey="onboardingSave"
          submitBusyLabelKey="onboardingSaving"
          onClose={finishCredential}
        />
      </div>
    </OnboardingModal>
  )
  if (choice === 'api-key') return editor
  // The account plugin's sign-in dialog; closing it returns to the chooser, and a stored
  // credential ends the step through readiness.
  if (choice === 'account') {
    return renderSlot('settings.models.sign-in',
      { complete: () => { setChoice('choose') }, useApiKey: () => { setChoice('api-key') } }, { fallback: editor })
  }
  const local = renderSlot('settings.models.local-setup', {
    expanded: choice === 'local',
    expand: () => { setChoice('local') },
    collapse: () => { setChoice('choose') },
    complete,
  }, { fallback: null })
  return (
    <OnboardingModal title={t('onboardingChooseTitle')} focusTitle>
      {choice === 'local' ? local : <>
        <p className={styles.description}>{t('onboardingChooseDescription')}</p>
        <div className={styles.choices}>
          {local}
          <button type="button" className={styles.choice} data-testid="onboarding-choice-account"
            onClick={() => { setChoice('account') }}>
            <span className={styles.choiceTitle}>{t('onboardingTokamak')}</span>
            <span className={styles.choiceDetail}>{t('onboardingTokamakDetail')}</span>
          </button>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="sm" data-testid="onboarding-choice-api-key" onClick={() => { setChoice('api-key') }}>
            {t('onboardingApiKeyInstead')}
          </Button>
          <Button variant="ghost" size="sm" data-testid="onboarding-later" onClick={complete}>{t('onboardingSetUpLater')}</Button>
        </div>
      </>}
    </OnboardingModal>
  )
}
