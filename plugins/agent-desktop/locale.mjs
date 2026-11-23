import de from './locale/de.json' with { type: 'json' }
import en from './locale/en.json' with { type: 'json' }
import es from './locale/es.json' with { type: 'json' }
import fr from './locale/fr.json' with { type: 'json' }
import ja from './locale/ja.json' with { type: 'json' }
import pt from './locale/pt.json' with { type: 'json' }
import ru from './locale/ru.json' with { type: 'json' }
import zh from './locale/zh.json' with { type: 'json' }

const locales = { de, en, es, fr, ja, pt, ru, zh }

/** @param {'action' | 'screenshot'} kind - approval subject. @returns {{en: string, [locale: string]: string}} Copy for Jan's approval request. */
export function approvalReason(kind) {
  return { ...Object.fromEntries(Object.entries(locales).map(([key, locale]) => [key, locale.approval[kind]])), en: en.approval[kind] }
}
