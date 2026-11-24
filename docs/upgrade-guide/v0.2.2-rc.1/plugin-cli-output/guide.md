---
kind: upgrade-guide
description: "Jan now formats JSON output for plugin add, remove, and list, and resolves existing bare local package paths before registry lookup."
---

# Plugin CLI JSON and local package paths

## Change

`jan plugin add`, `remove`, and `list` previously forwarded `--json` to pnpm. They now write one Jan result object to stdout and send pnpm diagnostics to stderr. `add` also treats an existing bare directory or tarball in the invoking directory as a local package.

## Migration

1. Update scripts that parse pnpm output from these commands to read Jan's `ok`, `exitCode`, `packages`, and `bundles` fields. Run `jan plugin --profile <name> list --json` and confirm that stdout parses as a single object.
2. If a local directory shares a registry package's name, use a versioned registry spec such as `widget@1.2.3` to select the registry package explicitly.
