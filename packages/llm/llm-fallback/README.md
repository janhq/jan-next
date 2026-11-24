---
description: "The model fallback chain for users and maintainers who want a reply to continue on another model when the chosen one is rate-limited, out of quota, refuses, or keeps failing."
kind: "package-reference"
---

# @janhq/jan-llm-fallback

## Summary

Mount `@janhq/jan-llm-fallback` so a failed model request continues on the next model in an ordered chain inside the same turn, instead of ending the reply with an error. Rate limits, quota exhaustion and refusals switch right away; server, timeout and transport failures switch after the provider retry policy gives up. The model the user chose comes back at a later turn start, once its cooldown passed and the conversation is small enough that dropping the prompt cache costs little. Every field is live-editable from **Settings > Agent loop > Fallback models**.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it next to [llm-retry](../llm-retry/README.md) in any composition that runs the agent loop. Order does not matter: the plugin prepends its recovery listener.

```yaml
- id: model-fallback
  name: '@janhq/jan-llm-fallback'
  config:
    chain:
      - provider: tokamak
        model: openai/gpt-6.1
      - provider: llama-cpp
        model: default
    cooldownSeconds: 300
    switchBackBelowPercent: 30
```

| Field | Default | Meaning |
|---|---|---|
| `chain` | `[]` | Ordered fallback models. Empty turns fallback off. |
| `cooldownSeconds` | `300` | How long a failed model rests before Jan tries it again or switches back to it. A longer provider `Retry-After` wins. |
| `switchBackBelowPercent` | `30` | Return to the chosen model at a turn start only while the conversation uses less than this percent of that model's context window. `100` returns as soon as the cooldown ends. |

All three are `.volatile()`: the [Settings](../../settings/settings/README.md) form for entry `model-fallback` edits them without a reload, and [ui-settings-model-policy](../../client/ui-settings-model-policy/README.md) renders that form on the Models page.

### What you can observe

When the selected model fails with `RATE_LIMIT`, `QUOTA`, `ACCOUNT_QUOTA` or `REFUSAL`, the plugin records the next usable chain model with `agent.model.select()` and asks the loop to retry; the loop closes the failed step and continues in a fresh step on the new model, in the same turn. The core model-selection notice tells the model and the transcript that the model changed. Any other failure first goes to the rest of the `agent/request-error` waterfall (llm-retry, compaction, image offload); only when nothing there recovers does the chain move on. `CONTEXT_WINDOW_EXCEEDED` and `IMAGE_OFFLOAD_REQUIRED` never switch: compaction owns them on the same route.

The next usable model is the first of the chosen model followed by the chain that is not the failing model and not resting. A model the user picks while a fallback is active becomes the new choice; the plugin stops tracking the old one.

### Failures and recovery

When every model in the chain is resting, the failure goes to the rest of the waterfall and ends the turn as before. A context window the chosen model's adapter does not declare skips the size check, so the model returns as soon as its cooldown ends.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals - click to expand</summary>

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The function plugin: recovery listener, cooldowns, switch-back on `agent/status` |

Two listeners do the work. The `agent/request-error` waterfall listener is prepended so fast-switch codes reach it before same-route retries; slower codes call `next()` first and switch only on an `undefined` result. The `agent/status` listener runs when an agent enters `running`, which the loop emits synchronously before the first step reads the selection, so a switch back prices the whole turn on the chosen model. Pressure comes from `ctx.tokenMeter.measure(session).totalTokens`; the chosen model's window comes from `ctx.llm.resolveModelInfo()` once, when the fallback starts.

Cooldowns are keyed by provider and model and shared across agents, because a rate-limited account is rate-limited for every conversation. Per-agent fallback state lives in memory.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [llm-retry](../llm-retry/README.md) - same-route retries this plugin runs ahead of or after.
- [compaction-basic](../../compaction/compaction-basic/README.md) - compacts history when a fallback model has a smaller window.
- [LLM streaming subsystem](../../../docs/subsystems/llm-streaming.md) - failure codes and the adapter contract.

-----

<a id="model-experience"></a>
## Model Experience

### Model fallback

#### What the model sees

The failed attempt's partial output never reaches the model. The new step carries the core model-change notice before the request, `[model changed: assistant turns above this point were generated by <previous>; the session continues with <next>]`, so the fallback model knows earlier turns came from another model. Switching back adds the same notice in the other direction.

#### Token effect

The fallback request re-sends the whole conversation to the new model, so it bills the full input once. The model-change notice adds a few tokens.

#### KV Cache effect

Switching models starts a new provider prompt cache. That is why the switch back waits until the conversation uses less than `switchBackBelowPercent` of the chosen model's window: the cache it drops is small.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Fallback state is in memory** - after a restart a session stays on the model it last used; the user picks the original again.
- **Fallback models use their default reasoning effort** - the chosen model's effort is restored when it comes back.
- **Trigger codes are fixed** - a deployment cannot add or remove failure codes from the fast-switch set.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers - click to expand</summary>

The same-step retry after a route change is an agent-loop contract (`agent/request-error` docs in `@janhq/jan-agent` runtime types); keep it when changing the loop.

</details>
