/** Load the Host's model list when a policy card appears. */
import { useEffect, useState } from 'react'
import type { ModelCatalog } from '@janhq/jan-api-remotes/client'

/** Reads the Host model catalog; resolves to the catalog or the failure it reported. */
export type CatalogLoader = () => Promise<{ ok: true; value: ModelCatalog } | { ok: false; error: unknown }>

/** Catalog load state plus a retry that clears the error and reloads. */
export interface CatalogState {
  catalog: ModelCatalog | null
  error: boolean
  retry: () => void
}

/**
 * Load the catalog once per mount and again on each retry; a failed or thrown load surfaces as `error`.
 * @param load - catalog reader; a new function identity reloads.
 * @returns the loaded catalog (null while loading or after a failure), the error flag, and a retry callback.
 */
export function useCatalog(load: CatalogLoader): CatalogState {
  const [state, setState] = useState<Omit<CatalogState, 'retry'>>({ catalog: null, error: false })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    void load().then((response) => {
      if (active) setState(response.ok ? { catalog: response.value, error: false } : { catalog: null, error: true })
    }).catch(() => {
      if (active) setState({ catalog: null, error: true })
    })
    return () => { active = false }
  }, [load, attempt])
  return { ...state, retry: () => { setState({ catalog: null, error: false }); setAttempt(value => value + 1) } }
}
