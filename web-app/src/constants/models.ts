/**
 * Model-related constants
 */

export const JAN_CODE_HF_REPO = 'janhq/Jan-Code-4b-Gguf'
export const DEFAULT_MODEL_QUANTIZATIONS = ['iq4_xs', 'q4_k_m']

/**
 * Quantizations to check for SetupScreen quick start
 * Includes Q8 for higher quality on capable systems
 */
export const SETUP_SCREEN_QUANTIZATIONS = ['q4_k_xl']

export const JAN_V2_VL_MODEL_HF_REPO = 'janhq/Jan-v2-VL-high-gguf'
export const JAN_V2_VL_QUANTIZATIONS = ['q4_k_m', 'q4_k_s', 'q4_0', 'q3_k_m']

/**
 * The one llama.cpp slot Jan pins, and the thread identities that share it.
 *
 * Every surface -- chat and background tasks -- sends `id_slot: 0` plus a
 * `thread_id`. Jan reserves no slot of its own, so the emitted "Parallel
 * Sequences" count is exactly what the user configured (llama.cpp's own default
 * when unset). What keeps the surfaces from destroying each other's KV cache is
 * not a slot each but the engine's per-`thread_id` slot-cache park/restore
 * (`engine/http.rs`'s `SlotHint`): a claim by a different identity saves the
 * outgoing thread's prefix before overwriting it, and restores it on return.
 *
 * Slot 0 specifically, and a fixed index rather than one derived from the
 * sequence count, because upstream *wraps* an out-of-range `id_slot` instead of
 * rejecting it (`get_slot_by_id`: `id_slot = id_slot % slots.size()`) -- so any
 * pin above 0 silently lands back here whenever the resolved count disagrees.
 * Slot 0 is the only index guaranteed to exist.
 *
 * A `thread_id` is required for the park to happen at all: a request without one
 * yields no `SlotHint`, so it overwrites whatever the slot held with no save.
 * That is why background work has an identity of its own instead of no field.
 */
export const CHAT_SLOT_ID = 0

/** Thread identity for background work (title generation) sharing slot 0. */
export const BACKGROUND_THREAD_ID = 'background'

