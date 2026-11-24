/** Locale-owned audio and video renderer labels and status text. */
export const zh = {
  video: '视频',
  audio: '音频',
  failed: '无法播放这个文件',
  unsupportedCodec: 'Jan 无法在这里播放这种格式，请用其他应用打开',
  waiting: '正在获取文件位置...',
} satisfies Record<string, string>

/** Media renderer dictionary keys. */
export type MediaPreviewKey = keyof typeof zh

/** English dictionary with the same keys as the Chinese dictionary. */
export const en = {
  video: 'Video',
  audio: 'Audio',
  failed: 'This file could not be played.',
  unsupportedCodec: 'Jan cannot play this format here. Open it in another app.',
  waiting: 'Waiting for the file location...',
} satisfies Record<MediaPreviewKey, string>

declare module '@janhq/jan-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Audio and video preview names and playback status text. */
    sidebarMedia: MediaPreviewKey
  }
}

/** Japanese copy, checked against the English keys. */
export const ja = {
  video: '動画',
  audio: '音声',
  failed: 'このファイルを再生できませんでした。',
  unsupportedCodec: 'この形式は Jan では再生できません。別のアプリで開いてください。',
  waiting: 'ファイルの場所を待っています...',
} satisfies Record<keyof typeof en, string>

/** Spanish dictionary, checked against the English keys. */
export const es = {
  video: 'Vídeo',
  audio: 'Audio',
  failed: 'No se pudo reproducir este archivo.',
  unsupportedCodec: 'Jan no puede reproducir este formato aquí. Ábralo en otra aplicación.',
  waiting: 'Esperando la ubicación del archivo...',
} satisfies Record<keyof typeof en, string>

/** French dictionary, checked against the English keys. */
export const fr = {
  video: 'Vidéo',
  audio: 'Audio',
  failed: "Ce fichier n'a pas pu être lu.",
  unsupportedCodec: 'Jan ne peut pas lire ce format ici. Ouvrez-le dans une autre application.',
  waiting: "En attente de l'emplacement du fichier...",
} satisfies Record<keyof typeof en, string>

/** German dictionary, checked against the English keys. */
export const de = {
  video: 'Video',
  audio: 'Audio',
  failed: 'Diese Datei konnte nicht abgespielt werden.',
  unsupportedCodec: 'Jan kann dieses Format hier nicht abspielen. Öffnen Sie es in einer anderen App.',
  waiting: 'Warte auf den Dateispeicherort...',
} satisfies Record<keyof typeof en, string>

/** Russian dictionary, checked against the English keys. */
export const ru = {
  video: 'Видео',
  audio: 'Аудио',
  failed: 'Не удалось воспроизвести этот файл.',
  unsupportedCodec: 'Jan не может воспроизвести этот формат здесь. Откройте его в другом приложении.',
  waiting: 'Ожидание расположения файла...',
} satisfies Record<keyof typeof en, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  video: 'Vídeo',
  audio: 'Áudio',
  failed: 'Não foi possível reproduzir este arquivo.',
  unsupportedCodec: 'O Jan não consegue reproduzir este formato aqui. Abra-o em outro aplicativo.',
  waiting: 'Aguardando a localização do arquivo...',
} satisfies Record<keyof typeof en, string>
