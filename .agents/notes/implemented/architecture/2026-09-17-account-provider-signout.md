# Agent Note: Account provider and active request cancellation

Status: implemented

## Problem

Selecting credentials from login state changes the billing identity of an existing provider route. Sign-out also needs to stop account-dependent work without classifying requests from settings that may have changed while a request or tool is still running.

## Decision

The account provider names the model route whose requests authenticate with its credential through its `modelProvider` configuration, `tokamak` by default. The account service retains the origin and issuer validation of its sign-in flow.

Account cancellation reads each running Agent’s latest `Session.requestContext()` instead of maintaining another provider field. This logged value remains through tools and retries and follows the next bound request. Idle Agents are excluded. During a new turn’s first preparation it can still name the previous turn’s account route, so sign-out can also interrupt an API-key turn that has not bound its new request yet. A missing account credential rejects a first request without a previous context before transport.

Successful local sign-out publishes an account event. The platform account provider installs the account module’s listener, which enumerates the Agent registry and cancels matching account routes through `Agent.cancel`, preserving inboxes. The account controller shares its predicate for sign-out confirmation. Each registered child is classified independently; existing parent-owned cancellation still applies to children whose lifetime is attached to a cancelled parent. The existing HTTP signal carries cancellation to transport.

## Alternatives considered

A historical set of providers wrongly cancels a turn after it switches to an API-key route. Current settings misclassify an older in-flight request. A second provider field or module-global map duplicates information already recorded in request context. A login-level cancellation signal duplicates the existing Agent and HTTP cancellation chain.

## Consequences

Cancellation preserves queued input without waking it automatically. The recorded hook reason produces a localized conversation notice without changing durable event types.

Behavior tests cover first preparation, tool-stage cancellation, and route replacement. The SDK account-provider-signout scenario boots the shipped profile and records interrupted output plus the cancellation cause.
