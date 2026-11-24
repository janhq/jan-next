---
kind: upgrade-guide
description: "One web_search call accepts 10 queries and returns 10 sources by default."
---

# Web search defaults

## Change

In `jan-tool-web`, the `searchMaxQueries` default rises from 4 to 10 and the `searchMaxResults` default rises from 8 to 10. The `web_search` schema now advertises `1–10 search queries`, so a call with 5–10 queries runs instead of failing validation, and each call can return up to 10 sources. A call can therefore start more provider searches and add more source text to the context. Values that a deployment already sets are kept.

## Migration

1. To keep the previous limits, set `searchMaxQueries: 4` and `searchMaxResults: 8` in the `tool-web` entry's `config` in `cordis.patch.yml`.
2. Confirm the result by running a task that sends 10 queries in one `web_search` call: it returns results instead of `Error: queries must contain at most 4 queries`. See the [tool-web configuration](../../../../packages/web/tool-web/README.md).
