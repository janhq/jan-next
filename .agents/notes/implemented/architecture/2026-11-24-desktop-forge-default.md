# Agent Note: Select Forge by default on Desktop

Status: implemented

## Problem

Forge already binds pull requests to the chats that work on them, but users have to enable a bundle before they can see review or check status in the sidebar. New and existing Desktop profiles need that signal without requiring setup or making Forge mandatory.

## Decision

The Desktop template selects the whole [Forge bundle](../../../../packages/experimental/forge-bundle/README.md). [App-boot](../../../../packages/boot/app-boot/src/profile.ts) adds it once to existing Desktop profiles and records `.bundle-addition-2026-11-forge` in the profile directory. The marker also records completion for a profile that already selects Forge, so removing it later in Plugins sticks.

[Forge's chat-row contribution](../../../../packages/experimental/client-ui-forge/README.md) uses the state color for every pull request glyph and retains the checks dot. The Host's `forge-panel` entry owns the live `sidebarStatus` setting. Settings > General > **Show pull request status in the sidebar** is on by default. Turning it off hides Forge's trailing icons, not the hover details or the rest of the bundle.

## Alternatives considered

**Enable Forge in onboarding.** Onboarding cannot reach profiles that already finished it. Profile normalization handles both a new profile and the first open of an existing one.

**Mount only the Forge rows in the Desktop application patch.** That makes the rows part of the fixed Desktop composition instead of a bundle users can disable. It also risks mounting the same contributions twice when a profile selects Forge separately.

## Consequences

Desktop users get worktree and review features as well as status icons. Users who want less visual detail can hide the icons; users who do not want Forge can turn off the bundle itself.
