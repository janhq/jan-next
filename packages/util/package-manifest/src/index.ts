/**
 * Public package manifest, plugin display types, and DSH package-name compatibility.
 * @module @janhq/jan-package-manifest
 */

export { janDeclaration, janPackageName, janSpecifier } from './dsh-compat.ts'

export type {
  JanBundleManifest,
  JanClientManifest,
  JanEnginesManifest,
  JanManifest,
  JanPackageManifest,
  JanProfileManifest,
  LocalizedText,
  PluginLocalizedMeta,
} from './types.ts'
