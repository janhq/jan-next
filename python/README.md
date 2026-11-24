# Jan Python SDK

Python packages for driving Jan as a subprocess. The client SDK communicates with the bundled runtime over newline-delimited JSON-RPC on stdio.

## Packages

| Directory | Dist / module | Role |
|---|---|---|
| [sdk](sdk/README.md) | `jan-sdk` / `jan` | High-level turns API and lower-level JSON-RPC client |
| [sdk-runtime](sdk-runtime/README.md) | `jan-runtime-bin` / `jan_runtime` | Bundled `jan` CLI executable and native sidecars |

## Behavior

The SDK starts the matching bundled `jan --profile sdk` runtime unless the caller selects another `jan` executable or profile. The runnable minimal example selects the shipped standalone `sdk-minimal` profile; the same runtime also packages `jan web` and its frontend assets for separate CLI use. Every launch requires an explicitly selected Harness home; Python never silently reads `~/.config/jan-alpha`. The [SDK reference](sdk/README.md) and [runtime carrier reference](sdk-runtime/README.md) own runtime selection, profiles, patches, and external plugin management.

## Contributor workflows

The [Python contributor workflows](development.md) cover building runtime artifacts, validating the packages, source-mode development, and distribution.
