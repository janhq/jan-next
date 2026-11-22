/** Locale-owned font renderer labels and sample text. */
export const zh = {
  title: '字体',
  sample: '敏捷的棕色狐狸跳过了懒狗',
  failed: '无法加载这个字体',
} satisfies Record<string, string>

/** Font renderer dictionary keys. */
export type FontPreviewKey = keyof typeof zh

/** English dictionary with the same keys as the Chinese dictionary. */
export const en = {
  title: 'Font',
  sample: 'The quick brown fox jumps over the lazy dog',
  failed: 'This font could not be loaded.',
} satisfies Record<FontPreviewKey, string>

declare module '@janhq/jan-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Font preview name, sample sentence, and failure text. */
    sidebarFont: FontPreviewKey
  }
}

/** Japanese copy, checked against the English keys. */
export const ja = {
  title: 'フォント',
  sample: 'いろはにほへと ちりぬるを わかよたれそ つねならむ',
  failed: 'このフォントを読み込めませんでした。',
} satisfies Record<keyof typeof en, string>

/** Spanish dictionary, checked against the English keys. */
export const es = {
  title: 'Fuente',
  sample: 'El veloz murciélago hindú comía feliz cardillo y kiwi',
  failed: 'No se pudo cargar esta fuente.',
} satisfies Record<keyof typeof en, string>

/** French dictionary, checked against the English keys. */
export const fr = {
  title: 'Police',
  sample: 'Portez ce vieux whisky au juge blond qui fume',
  failed: "Cette police n'a pas pu être chargée.",
} satisfies Record<keyof typeof en, string>

/** German dictionary, checked against the English keys. */
export const de = {
  title: 'Schrift',
  sample: 'Franz jagt im komplett verwahrlosten Taxi quer durch Bayern',
  failed: 'Diese Schrift konnte nicht geladen werden.',
} satisfies Record<keyof typeof en, string>

/** Russian dictionary, checked against the English keys. */
export const ru = {
  title: 'Шрифт',
  sample: 'Съешь же ещё этих мягких французских булок, да выпей чаю',
  failed: 'Не удалось загрузить этот шрифт.',
} satisfies Record<keyof typeof en, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  title: 'Fonte',
  sample: 'Um pequeno jabuti xereta viu dez cegonhas felizes',
  failed: 'Não foi possível carregar esta fonte.',
} satisfies Record<keyof typeof en, string>
