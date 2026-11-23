/** Locale-owned zip listing labels. */
export const zh = {
  title: '压缩包内容',
  summary: '{count} 个文件 · {size}',
  more: '还有 {count} 个',
  failed: '无法读取这个压缩包',
} satisfies Record<string, string>

/** Archive renderer dictionary keys. */
export type ArchivePreviewKey = keyof typeof zh

/** English dictionary with the same keys as the Chinese dictionary. */
export const en = {
  title: 'Archive contents',
  summary: '{count} files · {size}',
  more: 'and {count} more',
  failed: 'This archive could not be read.',
} satisfies Record<ArchivePreviewKey, string>

declare module '@janhq/jan-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Zip listing name, summary, and failure text. */
    sidebarArchive: ArchivePreviewKey
  }
}

/** Japanese copy, checked against the English keys. */
export const ja = {
  title: 'アーカイブの内容',
  summary: '{count} 個のファイル · {size}',
  more: 'ほか {count} 件',
  failed: 'このアーカイブを読み取れませんでした。',
} satisfies Record<keyof typeof en, string>

/** Spanish dictionary, checked against the English keys. */
export const es = {
  title: 'Contenido del archivo comprimido',
  summary: '{count} archivos · {size}',
  more: 'y {count} más',
  failed: 'No se pudo leer este archivo comprimido.',
} satisfies Record<keyof typeof en, string>

/** French dictionary, checked against the English keys. */
export const fr = {
  title: "Contenu de l'archive",
  summary: '{count} fichiers · {size}',
  more: 'et {count} de plus',
  failed: "Cette archive n'a pas pu être lue.",
} satisfies Record<keyof typeof en, string>

/** German dictionary, checked against the English keys. */
export const de = {
  title: 'Archivinhalt',
  summary: '{count} Dateien · {size}',
  more: 'und {count} weitere',
  failed: 'Dieses Archiv konnte nicht gelesen werden.',
} satisfies Record<keyof typeof en, string>

/** Russian dictionary, checked against the English keys. */
export const ru = {
  title: 'Содержимое архива',
  summary: 'Файлов: {count} · {size}',
  more: 'и ещё {count}',
  failed: 'Не удалось прочитать этот архив.',
} satisfies Record<keyof typeof en, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  title: 'Conteúdo do arquivo compactado',
  summary: '{count} arquivos · {size}',
  more: 'e mais {count}',
  failed: 'Não foi possível ler este arquivo compactado.',
} satisfies Record<keyof typeof en, string>
