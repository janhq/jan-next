---
kind: upgrade-guide
description: "The bundle lists and profile templates move from @janhq/jan-app-boot to @janhq/jan-official-bundles."
---

# Import bundle lists from `@janhq/jan-official-bundles`

## Change

`@janhq/jan-app-boot` no longer exports `PROFILE_TEMPLATES`, `ProfileTemplate`, `DEFAULT_PROFILE_BUNDLES`, `OPTIONAL_BUNDLES`, `ON_DEMAND_BUNDLES`, `OFFICIAL_ON_DEMAND_CATALOG`, or `OfficialBundleCatalogEntry`. The new published package `@janhq/jan-official-bundles` exports them with unchanged values and types. Code that imports any of these names from `@janhq/jan-app-boot` fails to compile or load. The `jan` launcher, profiles, and bundle selection behave as before.

## Migration

1. Add `@janhq/jan-official-bundles` to the `dependencies` of each package that imports one of these names.
2. Change those imports from `@janhq/jan-app-boot` to `@janhq/jan-official-bundles`, for example `import { PROFILE_TEMPLATES } from '@janhq/jan-official-bundles'`. Keep importing every other name, such as `initProfile` or `loadProfile`, from `@janhq/jan-app-boot`.
3. Run your type check or build; it succeeds when no import of a moved name from `@janhq/jan-app-boot` remains. See the [package README](../../../../packages/util/official-bundles/README.md) for each list.
