# Downloads

Open Downloads beside the sidebar toggle to see model, app update, backend, plugin, voice, and file transfers. The ring combines active progress; a dot marks an unseen completion or failure. Open the inbox to acknowledge the dot, or use Clear finished to remove terminal rows. Supported actions appear beside each transfer. The full Downloads page in the More menu still manages local model downloads and stored files. Pausing a model transfer keeps its partial file; discarding it requires confirmation.

## Report a transfer

Producers optionally look up `ctx.get('downloads')` on the Host. Call `start({ kind, name, actions? })` once per logical transfer, report cumulative bytes, percent, speed or state with `handle.update()`, and call `handle.finish('done' | 'failed' | 'cancelled', error?, actions?)` when settled. Only expose actions currently supported by that attempt. For a resumable operation, a stable namespaced `id` lets the next attempt replace the original row without accepting stale reports from its handle. Do not report cache hits as downloads.

The Host retains terminal rows until cleared or restarted. The authenticated owner-only `/api/downloads.inbox` route streams snapshots and dispatches supported actions; no callback or local filesystem path is serialized as a structured field. The Desktop bridge reports transfers owned by Electron's main process to the same Host store. The deployed Web and Desktop composition supplies this plugin; producers continue to work when it is not installed.
