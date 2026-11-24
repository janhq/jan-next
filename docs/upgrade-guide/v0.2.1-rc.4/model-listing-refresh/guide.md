---
kind: upgrade-guide
description: "ModelSelectInjected requires a resolveText callback."
---
# Model selector text resolution

## Change

`ModelSelectInjected` requires a `resolveText` callback.

## Migration

1. Code that constructs `ModelSelectInjected` must provide `resolveText: text => ctx.locale.resolveText(text)` from its owning locale service. Test doubles can use `text => typeof text === 'string' ? text : text.en` when they intentionally render English.
2. Confirm that the model selector renders localized model labels in the active interface language.
