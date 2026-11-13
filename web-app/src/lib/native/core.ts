import { APIs } from '@/lib/service'

/**
 * Gets Jan's data folder path.
 *
 * @returns {Promise<string>} A Promise that resolves with Jan's data folder path.
 */
const getJanDataFolderPath = (): Promise<string> => APIs.getJanDataFolderPath()

/**
 * Joins multiple paths together.
 * @param paths - The paths to join.
 * @returns {Promise<string>} A promise that resolves with the joined path.
 */
const joinPath: (args: string[]) => Promise<string> = (args) =>
  APIs.joinPath({ args })

/**
 * Opens an external URL in the default web browser.
 *
 * @param {string} url - The URL to open.
 * @returns {Promise<any>} - A promise that resolves when the URL has been successfully opened.
 */
const openExternalUrl: (url: string) => void = (url) =>
  APIs.openExternalUrl(url)

/**
 * Gets the user's home path.
 * @returns return user's home path
 */
const getUserHomePath = (): Promise<string> => APIs.getUserHomePath()

/**
 * Log to file from browser processes.
 *
 * @param message - Message to log.
 */
const log: (message: string, fileName?: string) => void = (message, fileName) =>
  APIs.log(message, fileName)

/**
 * Functions exports
 */
export {
  getJanDataFolderPath,
  joinPath,
  openExternalUrl,
  log,
  getUserHomePath,
}

/** Keyring key the app stores the Hugging Face access token under. */
export const HUGGINGFACE_TOKEN_SECRET_KEY = 'huggingface'
