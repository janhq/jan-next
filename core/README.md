## @janhq/core

Shared type definitions for the web app: threads, messages, models,
assistants, settings and the rest of the data the UI and the Rust backend
exchange, plus a few enums and route-name constants.

```ts
import type { Thread, ThreadMessage } from '@janhq/core'
```

Rebuild it with `yarn build:core` after editing, because the web app imports
the built `dist/`.
