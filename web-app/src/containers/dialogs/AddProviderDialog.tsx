import { useState, useRef } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogClose,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface AddProviderDialogProps {
  onCreateProvider: (name: string, baseUrl: string, apiKey: string) => void
  children: React.ReactNode
}

const URL_PATTERN = /^https?:\/\/[^\s]+$/i

export function AddProviderDialog({
  onCreateProvider,
  children,
}: AddProviderDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setName('')
    setBaseUrl('')
    setApiKey('')
    setError(null)
  }

  const handleCreate = () => {
    const trimmedName = name.trim()
    const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, '')
    const trimmedApiKey = apiKey.trim()
    if (!trimmedName || !trimmedBaseUrl || !trimmedApiKey) return
    if (!URL_PATTERN.test(trimmedBaseUrl)) {
      setError(t('provider:invalidBaseUrl'))
      return
    }
    onCreateProvider(trimmedName, trimmedBaseUrl, trimmedApiKey)
    reset()
    setIsOpen(false)
  }

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (!open) reset()
  }

  const canSubmit =
    name.trim().length > 0 &&
    baseUrl.trim().length > 0 &&
    apiKey.trim().length > 0
  const baseUrlPlaceholder = t('provider:baseUrlPlaceholder')

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        data-testid="add-provider-dialog"
        className="sm:max-w-[460px] max-w-[90vw]"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          nameInputRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('provider:addOpenAIProvider')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 mt-2">
          <Input
            data-testid="provider-name-input"
            ref={nameInputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('provider:enterNameForProvider')}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">
              {t('provider:baseUrlLabel')}
            </label>
            <Input
              data-testid="provider-base-url-input"
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value)
                if (error) setError(null)
              }}
              placeholder={baseUrlPlaceholder}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">
              {t('provider:apiKeyLabel')}
            </label>
            <Input
              data-testid="provider-api-key-input"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t('provider:apiKeyPlaceholder')}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && canSubmit) {
                  e.preventDefault()
                  handleCreate()
                }
              }}
            />
          </div>
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-2">
          <DialogClose asChild>
            <Button
              variant="link"
              size="sm"
              className="hover:no-underline w-full sm:w-auto"
            >
              {t('common:cancel')}
            </Button>
          </DialogClose>
          <Button
            data-testid="add-provider-submit"
            disabled={!canSubmit}
            onClick={handleCreate}
            className="w-full sm:w-auto"
            size="sm"
            aria-label={t('common:create')}
          >
            {t('common:create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
