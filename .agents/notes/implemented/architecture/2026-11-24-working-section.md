# Agent Note: Repeat running chats in a Working section

Status: implemented

## Problem

A running chat can be hard to find when its project is collapsed or its regular row has scrolled out of view. Moving it to a temporary section would make its normal position depend on when a turn finishes.

## Decision

The [Workspace sidebar](../../../../packages/client/ui-workspace/README.md#working-section) repeats visible top-level chats with running turns or subagents above the normal list, newest first. It reuses the normal chat row in a separate tree labelled Working, so the main tree contains no duplicate rows. Blank or archived chats and a pending user interaction alone do not qualify. The section is absent when empty, in the collapsed rail, and during a search.

Settings > General > **Show running chats at the top** controls the volatile `workingSection` field on the Host's `ui-workspace` entry. It is on by default, and changing it updates all windows on that Host without changing their local view options.

## Alternatives considered

**Move running chats to the top instead of repeating them.** Moving them would disturb project membership as presented in the sidebar or the order of a flat list. Repeating them leaves both views stable as activity starts and stops.

**Keep the switch in browser-local view options.** Each window would have a separate preference, and users would not find the feature next to other sidebar switches in General settings.

## Consequences

A chat in Working can be opened from either row. Dragging and the scroll target for a search result stay in the regular list.
