/**
 * Virtual root of the worker host's in-memory filesystem. Kept
 * in one module so the process shim, the path/os shims, and the VFS image
 * collector cannot drift apart.
 */

/** Virtual filesystem root; `process.cwd()` and every absolute path start here. */
export const JAN_ROOT = '/jan'

/** `$JAN_HOME`: durable-state directory inside the image. */
export const JAN_HOME = `${JAN_ROOT}/home`

/** Flat, symlink-free package tree resolved by the worker module loader. */
export const JAN_NODE_MODULES = `${JAN_ROOT}/node_modules`

/** Image configuration directory: the VFS manifest and the shipped agent presets. */
export const JAN_CONFIG = `${JAN_ROOT}/config`

/** Default (empty) workspace directory. */
export const JAN_WORKSPACE = `${JAN_ROOT}/workspace`

/** Temporary directory reported by `os.tmpdir()`. */
export const JAN_TMP = `${JAN_ROOT}/tmp`
