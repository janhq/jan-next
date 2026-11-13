import { APIs } from '@/lib/service'
import { FileStat } from '@janhq/core'

/**
 * Writes data to a file at the specified path.
 * @returns {Promise<any>} A Promise that resolves when the file is written successfully.
 */
const writeFileSync = (...args: any[]) => APIs.writeFileSync({ args })

/**
 * Reads the contents of a file at the specified path.
 * @returns {Promise<any>} A Promise that resolves with the contents of the file.
 */
const readFileSync = (...args: any[]) => APIs.readFileSync({ args })
/**
 * Check whether the file exists
 * @param {string} path
 * @returns {boolean} A boolean indicating whether the path is a file.
 */
const existsSync = (...args: any[]) => APIs.existsSync({ args })
/**
 * List the directory files
 * @returns {Promise<any>} A Promise that resolves with the contents of the directory.
 */
const readdirSync = (...args: any[]) => APIs.readdirSync({ args })
/**
 * Creates a directory at the specified path.
 * @returns {Promise<any>} A Promise that resolves when the directory is created successfully.
 */
const mkdir = (...args: any[]) => APIs.mkdir({ args })

/**
 * Removes a directory at the specified path.
 * @returns {Promise<any>} A Promise that resolves when the directory is removed successfully.
 */
const rm = (...args: any[]) => APIs.rm({ args })

/**
 * Moves a file from the source path to the destination path.
 * @returns {Promise<any>} A Promise that resolves when the file is moved successfully.
 */
const mv = (...args: any[]) => APIs.mv({ args })

/**
 * Gets the file's stats.
 *
 * @param path - The path to the file.
 * @param outsideJanDataFolder - Whether the file is outside the Jan data folder.
 * @returns {Promise<FileStat>} - A promise that resolves with the file's stats.
 */
const fileStat: (path: string) => Promise<FileStat> = (path) =>
  APIs.fileStat({ args: path })

/**
 * Reads a YAML file and returns it parsed.
 *
 * The Rust side (`core::filesystem::commands::read_yaml`) resolves the path
 * within the Jan data folder, so a path escaping it is rejected there.
 *
 * @param path - The path to the YAML file.
 */
const readYaml: <T = unknown>(path: string) => Promise<T> = (path) =>
  APIs.readYaml({ path })

/**
 * Serializes `data` as YAML to `savePath`.
 *
 * @param savePath - Destination path, resolved within the Jan data folder.
 * @param data - The value to serialize.
 */
const writeYaml: (savePath: string, data: unknown) => Promise<void> = (savePath, data) =>
  APIs.writeYaml({ data, savePath })

/**
 * Unpacks an archive into `outputDir`.
 *
 * @param path - The archive to unpack.
 * @param outputDir - Destination directory, resolved within the Jan data folder.
 */
const decompress: (path: string, outputDir: string) => Promise<void> = (path, outputDir) =>
  APIs.decompress({ path, outputDir })

export const fs = {
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  mkdir,
  rm,
  mv,
  fileStat,
  readYaml,
  writeYaml,
  decompress,
}
