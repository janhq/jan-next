---
name: jan-feature-flow
description: Plan and verify Jan features across the layers they touch. Use before implementing or reviewing any user-visible frontend, backend, or cross-layer feature.
---

# Jan feature flow

## Full-flow rule

Start with the user's entry point, intended result, and safe recovery path. A feature is done only when every layer it touches works end to end in the shipped composition. Apply each relevant checklist row; record why a row does not apply rather than adding an unused layer or treating missing evidence as a pass.

## Checklist

| Step | Rule owner | Evidence required |
|---|---|---|
| Host capability | [Architecture](../../../docs/architecture.md#capability-seams), [extension cookbook](../../../docs/cookbook/extension-cookbook.md) | Service Definition, Service Provider, and Consumer connected through the shipped profile. Reuse existing roles where they fit. |
| Wire and Session | [Remote API cookbook](../../../docs/cookbook/adding-a-remote-api.md), [events](../../../docs/architecture.md#events), [Session log](../../../docs/architecture.md#session-log), [session projection](../jan-session-projection/SKILL.md) | Typed wire calls and events where needed. New model-visible input has a typed Session event in the log; replay reconstructs what the model saw. |
| Client plugin | [Client instructions](../../../packages/client/AGENTS.md), [slots](../../../docs/subsystems/slots.md) | Registered slots, declared stores for shared UI state, and injected dependencies where needed. |
| Copy | [Locale registration](../../../packages/client/locale/README.md#registering-a-dictionary), [shipped locales](../../../packages/client/locale/src/locales/index.ts) | Every new label, hint, and error string is translated in every shipped locale. Check `packages/client/locale/src/locales/*.ts` for the current languages. |
| Failure and recovery | [Error handling](../jan-error-handling/SKILL.md), [UI feedback](../jan-client-ui-ux/SKILL.md#feedback-surfaces) | Typed failure -> localized, actionable feedback with a safe recovery action, such as Retry only when retry is safe. Exercise the outcome. |
| UI states | [UI minimum checks](../jan-client-ui-ux/SKILL.md#minimum-checks-for-affected-ui), [responsive UI](../jan-responsive-ui/SKILL.md) | Verify affected empty, loading, disabled, and keyboard focus states, not just success. |
| Guidance | [Primitives catalog](../../../packages/client/ui-primitives/README.md#component-catalog), [guidance choices](#contextual-guidance) | Verify relevant help can be discovered, dismissed, and reopened, or explain why none is needed. |
| Docs | [Documentation standard](../../../docs/AGENTS.md), [prose standard](../jan-prose-standard/SKILL.md#required-coverage-by-prose-location) | Update affected docs, package READMEs, and public JSDoc. |
| Tests | [Testing policy](../../../docs/testing.md), [check selection](../jan-pre-push-checks/SKILL.md) | Behavior unit tests with 100% per-file coverage. Update the owning keyless snapshot for non-trivial model- or user-output changes, and both TypeScript and Python SDK expected outputs when the agent loop, Session lifecycle, or Session events change. |
| Handoff | [Application commands](../../../docs/development.md#application-commands), [UI inspection](../../../docs/cookbook/reviewing-ui-design.md#verify), [GUI PR recording](../record-browser-gif/SKILL.md#every-gui-pull-request-includes-a-gif) | Before handoff, walk the task from its real entry point in the running app using visible controls and normal inputs, including recovery. Attach annotated screenshots of key UI states. Report unverified states; a fixture is not a walkthrough. The GUI PR GIF is separate evidence. |

## Contextual guidance

Reveal help where it answers a question the user has now, not in an up-front interruption. Use `Toggletip` for short explanations the user can pull from a control. Use a dismissible `Coachmark` at the relevant control when a useful next action is hard to discover; keep the help findable after dismissal. Use `@janhq/jan-client-ui-guidance` for an opt-in, replayable tour when a task needs several unfamiliar steps; let users act at each step. Skip guidance if the interface already explains the action.

## Naming conventions

| Name | Convention and evidence |
|---|---|
| Packages | `@janhq/jan-<name>`, client `@janhq/jan-client-<name>`, directory `packages/<group>/<pkg>` ([layout](../../../AGENTS.md#repository-layout), [client instructions](../../../packages/client/AGENTS.md)). |
| Slots and stores | `<domain>.<entry>.<hole>` and `createXxxStore` ([client slot and store rules](../../../packages/client/AGENTS.md#slot-and-props-discipline)). |
| Locale keys | Use typed feature namespaces and follow their key patterns; [Chat](../../../packages/client/ui-chat/src/client/locale.ts) uses dotted keys such as `message.stepProcess.readImage`. Shared words use `common`. |
| Styles | Colocate `*.module.css` with the component ([style reference](../../../docs/web-styling.md#ownership), [sidebar example](../../../packages/client/ui-sidebar/src/client/HeaderLeadingControls.tsx)). |
| Specs | Use `*.spec.ts` for ordinary Host unit specs. Under `packages/client`, use `*.client.spec.ts` or `*.client.spec.tsx` for Client specs and `*.host.spec.ts` for Host specs ([Client](../../../tsconfig.client.json), [Host](../../../tsconfig.host.json) selections). |
| Tour targets | Stable `data-guide="<domain>.<name>"`, lowercase and domain-first, for example `data-guide="sidebar.account-menu"` (guidance target contract). |
| Commit scopes | Use the package or domain as the Conventional Commit scope; see `fix(ui-chat): explain a model service failure plainly and retry it from the failure row` in repository history. |
| English UI copy | Sentence case ([prose standard](../jan-prose-standard/SKILL.md#required-coverage-by-prose-location)). |
| Opaque IDs | Use `Branded<B>` across boundaries ([repository conventions](../../../AGENTS.md#conventions)). |

## Commit and PR slicing

Keep one domain per commit. When a feature spans Host and Client, land the backend or shared contract commit before the UI commit that consumes it. Write each PR description and record its actual evidence with [jan-pr-description](../jan-pr-description/SKILL.md).
