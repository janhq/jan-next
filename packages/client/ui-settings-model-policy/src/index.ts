/**
 * Model policy settings, node half. The browser half ships via exports["./client"];
 * the Host work lives in `@janhq/jan-llm-fallback` (namespace `model-fallback`)
 * and `@janhq/jan-compaction-basic` (namespace `compaction-basic`).
 */

/** Host plugin body: no Host behavior for this UI plugin. */
export function apply(): void {}
