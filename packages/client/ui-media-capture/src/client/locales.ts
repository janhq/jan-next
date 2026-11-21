/** All shipped dictionaries for the inline media capture card. */
import de from '#capture-copy/de.json'
import en from '#capture-copy/en.json'
import es from '#capture-copy/es.json'
import fr from '#capture-copy/fr.json'
import ja from '#capture-copy/ja.json'
import pt from '#capture-copy/pt.json'
import ru from '#capture-copy/ru.json'
import zh from '#capture-copy/zh.json'

/** Keys owned by media capture, using English as the reference dictionary. */
export type CaptureKey = keyof typeof en

/** Complete dictionaries registered with the standard locale service. */
export const dictionaries = { de, en, es, fr, ja, pt, ru, zh } satisfies Record<string, Record<CaptureKey, string>>

declare module '@janhq/jan-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Inline media request, capture, preview, and review UI. */
    mediaCapture: CaptureKey
  }
}
