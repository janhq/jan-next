---
name: migrate
description: Bring chats and settings over from the earlier Jan app, Claude Code, Codex or OMP. Scans this computer, asks what to bring, imports after the user approves, then reports what came over.
license: MIT
---

# Migrate to Jan

Help the user bring their history into Jan with as few steps as possible. The person may not know where their old chats live or what can come over; you find out, recommend, and do the work. Source folders are only read, never changed, and you never copy files yourself.

## 1. Look first

Call `migrate_scan` with no arguments before saying anything else. It checks the earlier Jan app, Claude Code, Codex and OMP and returns, per app: whether it was found, how many chats are ready, how many are already in Jan, a few example titles, and for Jan the model providers, MCP servers and assistants it holds.

If the user named one app ("migrate from Claude Code"), still scan all four, but focus on the one they named.

## 2. Say what you found and ask once

In two to four short lines, tell the user what is on this computer, by app, in plain words: "The earlier Jan app: 160 chats, 3 model providers with keys, 2 MCP servers. Claude Code: 42 sessions in the last 30 days." Skip apps that were not found, unless nothing was found at all.

Then ask one question with `ask_user_question`, offering the sensible choices as options, with your recommendation first:
- Everything ready from every app found (recommended when the counts are modest).
- Only one app, when the user named it or one app clearly dominates.
- For Claude Code, Codex and OMP with many sessions, the last 30 days; mention that older sessions can come over later.

Jan settings (model providers and their keys, MCP servers, assistants) are part of "everything" for the earlier Jan app. Say that keys are read from the earlier app's keychain and the system may ask to allow it.

If nothing was found, say so, name where Jan looked (the folders in the scan result), and offer to scan a different time window. Stop there.

## 3. Import

Call `migrate_import` once per app the user chose. Jan shows the user an approval card for each call; if they decline, do not retry it, and ask whether they want something smaller instead.

Pass only `source` plus the choices: `days` for coding agents when not the default, and for the earlier Jan app `providers`, `mcp` and `assistants` set to true when the user chose settings. Do not pass `ids` unless the user picked specific chats.

## 4. Report

Finish with a short report:
- How many chats came over per app, and how many were already here.
- Settings that came over, and any key that could not be read, with the reason.
- Every failure with its reason, in plain words, and what the user can do about it.
- Where to find the chats: they are in the Chats list, newest first; coding-agent sessions open in the folder they ran in.

Do not claim anything the tool results do not show. If an import failed as a whole, say so and quote the reason.

## Rules

- Never use shell, file or desktop tools to read or copy another app's data; only `migrate_scan` and `migrate_import`.
- Never ask the user to paste an API key; keys move through the importer.
- Running `/migrate` again is safe: chats already here are skipped.
