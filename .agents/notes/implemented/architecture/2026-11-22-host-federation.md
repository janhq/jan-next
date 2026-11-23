# Agent Note: Federate other computers at the local Host

Status: implemented

## Problem

Connecting a saved SSH Host opened that Jan's own web page in the browser. The owner wanted another computer's projects in this window's sidebar, next to this computer's, with their chats opened and continued in place, as Orca lists projects from several machines in one list.

## Decision

The local Host federates. The Hosts plugin keeps one signed-in link per connected Jan (`plugins/hosts/link.mjs`: HTTP for unary calls, the `api/remote.mux` WebSocket for streams) and registers the Gateway's carrier-level forwarder (`registerForwarder`). Ids from another Jan are qualified as `<hostId>~<id>`; the forwarder sends any call whose arguments name one to that Jan with plain ids and qualifies the answer. `workspace/follow`, `session/control`, `session/list`, `session/search` and `$events` merge this Host's items with each connected Jan's. `workspace/create` takes an optional `hostId`. The Client is unchanged apart from reading `hostName` and `hostState` on Workspace rows and opening the folder chooser on the other computer's folders.

Qualified ids stay ordinary branded `SessionId` and `WorkspaceId` strings, so tabs, maps and selection work without a second id space. Remote events are limited to `api-session/*` and the interaction waterfalls, because settings, plugins and providers belong to each computer.

## Alternatives considered

**One Client tree per Host.** Every Client service is bound to one `ctx.remote`, and the browser cannot sign in to a second origin: Jan's cookie is `HttpOnly; SameSite=Strict`, API requests must be same-origin, and the desktop rewrites Origin and cookies only for the Host it owns.

**Federation inside each controller.** Teaching the Workspace, Session and query controllers to forward their own methods touches every method that takes an id and every future one. One forwarder at the wire sees every endpoint, including ones added later, and keeps the controllers single-Host.

## Consequences

The owner browses connected computers in one window without a second browser login. If a connection drops, the other Host's projects stay listed as Offline and calls to them fail until it reconnects. The Host that runs a chat still owns its Session log; losing the link neither moves nor deletes it.

### Limits

A chat running on another computer reads only that computer's chats, because only this Host holds links to all. Uplinks are not forwarded, so a stream that reads Client items works only on this computer. Binary results are forwarded; binary uploads are not.
