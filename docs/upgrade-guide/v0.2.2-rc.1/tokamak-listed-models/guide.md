---
kind: upgrade-guide
description: "The `tokamak` model route lists its models from the Tokamak router, and `tokamak/auto` replaces the `tokamak-1-preview` default."
---

# The Tokamak route lists its models from the router

## Change

Before, the `tokamak` route of the `llm-pi-ai` row in the `jan-base` and `jan-sdk-minimal` bundles served a fixed `models` list, and the default model was `tokamak-1-preview` in the `agent-default-model` row, the `acp` row of `jan-acp-app`, the TypeScript SDK's `JanOptions.model`, and the Python SDK's `model`. The router no longer serves `tokamak-1-preview`, so requests for it failed with `404 chat completion request rejected`.

Now the route sets `modelListing` and serves the chat models `GET {baseURL}/models` returns for the stored `TOKAMAK_API_KEY`, without image generation models. The last listing is kept in Jan's storage and refreshed at each launch. While signed out, the model picker asks for a sign-in instead of listing Tokamak models. Every default above is `tokamak/auto`. A saved default that names an unlisted Tokamak model moves to `tokamak/auto` after the first successful listing; an explicit SDK or `acp` model is not moved.

Affected: profile patches that override the `tokamak` route's `models` list, and SDK or ACP callers that pass `tokamak-1-preview`.

## Migration

1. Replace `tokamak-1-preview` with `tokamak/auto` or another listed id wherever you pass it: SDK `model` options, the `acp` row's `model`, and agent rows in your `cordis.patch.yml`.
2. If your profile patch restates the `tokamak` route with a `models` list, either delete that override so the bundle's listing applies, or add `modelListing: {}` to it; its `models` entries then describe only listed models.
3. Confirm: sign in, open the model picker, and check that the Tokamak group lists the router's models; `curl -H "Authorization: Bearer $TOKAMAK_API_KEY" https://api.tokamak.sh/v1/models` shows the same ids.
