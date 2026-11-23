---
description: "The local credential store: OS keychain storage, private YAML, password-manager references, and environment fallbacks."
kind: "package-reference"
---

# @janhq/jan-credentials-local

## Summary

`jan-credentials-local` keeps API keys and other secrets in a private store under your harness home. Jan Desktop saves new and rewritten values in the OS keychain when available. The managed store wins over the launch environment, the project's `.env`, and the harness-home `.env`, in that order. You can also save a 1Password or Bitwarden reference instead of saving the secret itself.

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

This package gives a composition a local credential store: save API keys and other secrets once, and every request that names them uses them. The common path is explicit: load the store, save keys through the configuration UI or `ctx.credentials`, and let the product resolve them when needed.

### When to use it

Use it as the default local store: the product's base composition loads it, and a key you save through a configuration UI takes effect immediately. File permissions do not isolate secrets from tool processes running as your OS user.

### Setting it up

```yaml
- name: '@janhq/jan-credentials-local'
  config:
    path: /absolute/path/to/.credentials.yaml
```

| Field | Default | Meaning |
|---|---|---|
| `path` | `<harness home>/.credentials.yaml` | Where the credential file lives |
| `janHome` | `$JAN_HOME` or `~/.config/jan-alpha` | Harness home used when `path` is omitted |
| `watch` | `true` | Reload the file automatically when it changes on disk |
| `debounceMs` | `100` | Wait this long after a change before reloading, in milliseconds |
| `keychain` | `false` (`true` in Jan Desktop) | Put new or rewritten values in the OS keychain. Existing keychain entries stay readable regardless of this setting. |

The generated [configuration catalog](../../../docs/config-catalog.md#janhqjan-credentials-local) is the exhaustive source for every accepted field and its JSDoc.

### Storing and removing keys

Save a key with `set`, remove it with `unset`, and check whether a key is configured with `describe` — the same operations the credential API provides:

```ts
import type { Context } from '@janhq/cordis'
import { credentialRef } from '@janhq/jan-credentials'

declare const ctx: Context

const ref = credentialRef('TOKAMAK_API_KEY')
await ctx.credentials.set(ref, 'sk-…')          // save
await ctx.credentials.describe(ref)             // { configured, source?, writable } — never the value
await ctx.credentials.unset(ref)                // remove
```

A key you save is usable by the next request that names it. `describe` reports configuration without reading the keychain or running a CLI. Records use the same store, addressed by `<owner>/<id>` and managed with `readRecord`, `describeRecord`, `listRecords`, `modifyRecord`, and `deleteRecord`.

### Where keys come from

Keys are resolved in one fixed order — the first place that has a value wins:

| Place | Writable? | Wins over |
|---|---|---|
| The managed store (YAML and keychain) | yes (`set`/`unset`) | everything |
| The environment you launched in (`TOKAMAK_API_KEY=… jan`) | not here | both `.env` files |
| Your project's `.env` (`<invocation cwd>/.env`) | not here | your home `.env` |
| Your home `.env` (`$JAN_HOME/.env`) | not here | nothing |

The stored file wins because a credential explicitly saved through the product must take effect consistently for every provider ([decision](../../../.agents/notes/implemented/architecture/2026-10-09-stored-credential-precedence.md)). The launching environment — `TOKAMAK_API_KEY=… jan`, a CI secret, or a container `-e` — is the fallback when no stored value exists; a project `.env` then outranks the harness-home `.env`. A save always writes the winning layer, so `describe` reports `writable: true` for every reference, and its `source` names the place that currently supplies the value. The environment layer is the launcher's snapshot taken at launch ([environment snapshot](../../util/launch-environment/README.md)), so a variable exported after startup is not seen.

### OS keychain

Jan Desktop uses macOS Keychain, Windows Credential Manager, or Linux Secret Service. An indexed value is stored in the keychain; `.credentials.yaml` keeps only its entry ID and, for a record, its kind. Existing plaintext entries stay readable and are moved only when you save that entry again. If a new keychain write fails, Jan warns once and saves through its private file for the rest of the run (`0600` on POSIX). An unreadable keychain entry is not treated as absent: unlock the keychain or save the credential again.

Use Jan to replace or unset a keychain-backed value. Manually deleting or changing a marker can leave the old native entry behind. Copying `.credentials.yaml` does not transfer keychain-backed values to another machine, OS account, or Jan home. Earlier builds that do not understand markers reject documents that contain them.

### 1Password and Bitwarden references

In place of a key, save a reference such as `op://Private/Jan/credential`, `op://Private/Jan/Provider Keys/credential`, or `bw://Engineering%20API/password`. Jan looks up the value on each use and never saves the result. `describe` does not unlock or contact either manager. References are supported only in saved `refs`, not in ambient environment values or opaque records. Paired-host copy and sync skip these machine-specific references.

- **1Password:** Install `op` on your launch `PATH`, then sign in to its CLI or enable its desktop integration. Copy a secret reference from 1Password; use IDs for segments that contain unsupported characters. Jan accepts the vault, item, optional section, and field form, without query parameters or templates.
- **Bitwarden:** Install `bw` on your launch `PATH`, sign in, and launch Jan with the `BW_SESSION` from `bw unlock`. For Vaultwarden, first configure the server using `bw config server`. A reference uses an exact item name or item ID and a field (`password`, `username`, `notes`, `totp`, or the exact custom field name). Percent-encode `/` and other URI delimiters inside a segment. Use the ID if the name is ambiguous.

Jan does not install, sign in to, unlock, or synchronize a vault. Keep the CLI credentials in the launch environment, not a project `.env` file. On Windows, Jan needs `op.exe` or `bw.exe` rather than a `.cmd` shim.

### The credential file

A versioned YAML document with one section per key space, and nothing else:

```yaml
version: 1

refs:
  TOKAMAK_API_KEY: sk-…
  OPENAI_API_KEY: sk-…

records:
  llm-pi-ai/openai-codex:
    kind: grant
    payload:                    # written verbatim; this provider does not interpret it
      type: oauth
      access: eyJhbGciOi…
      refresh: rft_9f8e7d…
      expires: 1786000000000
  llm-pi-ai/amazon-bedrock:
    kind: api-key               # environment values, no key: this route uses an AWS profile
    env:
      AWS_PROFILE: prod
  llm-pi-ai/amazon-bedrock-dev:
    kind: api-key               # neither: the owner confirmed the ambient credential chain
```

When enabled, the watcher reloads direct edits to the file. `refs` holds values by environment-variable name and `records` holds per-plugin credentials by `<owner>/<id>`. The provider preserves comments and formatting on untouched entries. Unknown top-level keys are preserved but resolve nothing; malformed entries fail at startup. An invalid live edit leaves the last good snapshot in place and logs a warning.

A key's value can be any text, multi-line values included — no quoting tricks needed. An empty value means "no key", which is why an empty string in the file is rejected: removing a key deletes it, it does not blank it. A `grant` payload must survive a JSON round trip, enforced on the way in and on the way out, so the store refuses a value it could not read back exactly as written. If the file on disk no longer parses, saving fails instead of overwriting content the product could not read.

### Who can read the file

Only your OS user can read the file: the product creates it with owner-only permissions, and on POSIX it refuses to load a file that any other user can read — the error tells you to run `chmod 600`. Windows has no mode to inspect, so the check is skipped there rather than faked. The agent is not another user: its tool processes run as you, so they can read the file like any other file you own. The product never hands the agent the file's path and never loads the file into the environment, so reaching a value takes a deliberate read of a path the agent was not given. That is discretion, not a boundary: a deployment that must keep provider keys away from its own agent cannot get there with file permissions.

### What can go wrong

- **A key the launching environment supplies is a fallback** - saving a value stores a higher-priority credential; removing it with `unset` reveals the launch environment again.
- **An empty value cannot be saved** — storing an empty string is refused; remove the key instead.
- **The store refuses to load a file it cannot trust** — a file any other user can read, malformed YAML, or an unreachable path fails at startup; on a live reload the last good content keeps serving with a warning.
- **Changes made at the same time are both kept** — if you edit the file while the product writes, your change is folded in rather than overwritten.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **One honest precedence.** The managed store wins for every provider; launch environment, project `.env`, and harness-home `.env` are deterministic fallbacks in that order.
- **The document holds only credentials.** A foreign top-level key is tolerated but resolves nothing. A versioned document with `refs` and `records` sections rather than a dotenv file: a store the harness owns and never materializes into the environment cannot also serve as the user's environment layer, which would shadow non-secret entries behind its precedence.
- **Writes patch, reloads replace.** Line edits preserve comments and untouched entries under the cross-process writer lock; reloads swap the parsed snapshot wholesale so a deleted entry never lingers in memory.
- **Fail loud where trust is at stake.** Boot and reload reject a document that is unreadable, invalid, or readable beyond its owner; a live reload that fails keeps the last good snapshot and warns rather than taking the process down.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Provider: layer resolution, strict document parse, reference and record write paths under the writer lock, watcher lifecycle, permissions check |
| [`src/keychain.ts`](src/keychain.ts) | Lazy native adapter, per-document namespace, and Windows chunk storage |
| [`src/password-manager.ts`](src/password-manager.ts) | Reference parsing, bounded CLI execution, and sanitized errors |

### Resolution and write paths

`resolve` picks the first source, reads a keychain marker if needed, and resolves a password-manager reference only in the managed layer. `set`/`unset` queue onto the same exclusive operation chain. Under the writer lock, a native write stages a fresh entry, commits its marker to YAML, and then removes the old native entry. A failed YAML commit discards the staged entry. Removing an entry publishes its deletion before attempting native cleanup.

`modifyRecord` runs on the same chain and lock: it re-reads the document, passes the record as it stands to the mutation, admits the result — a non-empty API key, a grant payload that survives a JSON round trip — renders the record wholesale, and commits, firing `credentials/record-updated` once. A composition the product CLI did not boot has only the inherited environment as its layer.

### Reload lifecycle

A watcher event or the ready-time reconciliation queues a refresh behind the same chain. `reconcileFromDisk` re-checks permissions, re-reads the text, replaces both snapshots wholesale when the text differs, and publishes one event per changed reference or record; content equal to the text cache — including the provider's own writes — is a no-op. Disposal sets the closed flag, stops accepting events, closes the watcher, and waits out queued operations so nothing publishes after teardown.

### Document versioning

The document carries `version: 1`, stamped on every write. A boot that recognizes the pre-release flat layout — a bare mapping of reference names with no `version` — upgrades the document in place under the writer lock, nesting the original lines under `refs:` so values, comments, and spellings survive byte for byte; any other unversioned shape is refused by name rather than read as an empty store. A live reload never migrates: a flat document restored mid-run keeps the last good snapshot until the next boot.

### Diagnostics never quote a value

The YAML parser's own message quotes the offending source line, which in this document is the secret itself. Every diagnostic therefore carries only the error code and position — a key name is safe to print, a value is not.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the provider-level contract is not enough. They move from the seam contract to the environment snapshot, the atomic-write primitive, and the boot-time environment layers.

- [Credential-reference seam](../credentials/README.md) — `resolve`, `describe`, `set`, `unset`, the record operations, and the seam's update events.
- [Credentials subsystem reference](../../../docs/subsystems/credentials.md) — `CredentialRef`, per-operation resolution, UI-safe `CredentialInfo`, provider layers.
- [Launch environment snapshot](../../util/launch-environment/README.md) — the frozen layer snapshot resolution reads instead of `process.env`.
- [Atomic write](../../util/atomic-write/README.md) — the writer lock and atomic replacement every write uses.
- [App boot and Harness-home layers](../../boot/app-boot/README.md) — how the product CLI loads `.env` into the snapshot and `process.env`.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the consumers of `ctx.credentials`, which own any model-facing behavior a stored value enables.

#### KV Cache effect

No direct invalidation; stored values never enter a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the provider is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **Same-reference concurrent writes are last-write-wins** — the writer lock and the read-modify-write keep concurrent writers from dropping each other's entries, but two writers editing one reference still resolve to the later write; there is no revision check.
- **A same-UID process can read the YAML** - the file-effect sandbox modes do not deny reads, and using the OS keychain is not a guarantee that tools running as your OS user cannot access its entries.
- **Environment changes are invisible** — the snapshot is frozen at launch, so a variable exported after startup reaches neither resolution nor `describe`; changing an environment-sourced credential takes a restart.
- **Atomic, not crash-durable** — inherited from `jan-atomic-write`; the store re-reads on boot.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

The seam leaves room for other deployment-specific storage providers, such as a managed KMS.

</details>
