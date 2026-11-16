import { getServiceHub } from '@/hooks/useServiceHub'
import { useModelProvider } from '@/hooks/useModelProvider'
import { ACCENT_COLORS, useInterfaceSettings } from '@/hooks/useInterfaceSettings'
import { useTheme } from '@/hooks/useTheme'
import type { DshShellSetup } from '@/services/dsh/types'

/**
 * What the DSH shell takes over from the Jan UI: every active endpoint with a
 * base URL (keys stay in the keyring; Rust reads them by name), the selected
 * model, the accent and the theme.
 */
function shellSetup(): DshShellSetup {
  const { providers, selectedProvider, selectedModel } =
    useModelProvider.getState()
  const endpoints = providers
    .filter((p) => p.active && p.provider !== 'llamacpp' && p.base_url)
    .map((p) => ({
      name: p.provider,
      baseUrl: p.base_url!,
      models: p.models.map((m) => m.id),
    }))
  const accent = ACCENT_COLORS.find(
    (c) => c.value === useInterfaceSettings.getState().accentColor
  )
  const theme = useTheme.getState().activeTheme
  return {
    providers: endpoints,
    defaultModel: selectedModel ? [selectedProvider, selectedModel.id] : null,
    look: accent ? { primary: accent.primary, sidebar: accent.sidebar } : null,
    theme: theme === 'auto' ? 'system' : theme,
  }
}

/** Starts the DSH shell and moves the main window onto it. */
export function openDshShell(): Promise<void> {
  return getServiceHub().dsh().webStart(shellSetup())
}
