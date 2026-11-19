/**
 * Agent loop settings, node half. The browser half ships via exports["./client"];
 * the Host work lives in `@janhq/jan-llm-fallback` (namespace `model-fallback`)
 * and `@janhq/jan-compaction-basic/settings` (namespace `compaction-settings`).
 */

/** Host plugin body: no Host behavior for this UI plugin. */
export function apply(): void {}
