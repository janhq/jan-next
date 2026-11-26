# Jan motion standard

## Summary

Choose motion by what it helps the user notice, not by the duration of a neighboring declaration. This standard covers CSS in Jan Web, Desktop, and their client plugins.

## Table of Contents

- [Choose a token](#choose-a-token)
- [Enter, exit and change state](#enter-exit-and-change-state)
- [Respect reduced motion](#respect-reduced-motion)
- [Review exceptions](#review-exceptions)

## Choose a token

[`ui-theme`'s `base.css`](../packages/client/ui-theme/src/styles/base.css) defines the shared values. The [Web UI style reference](web-styling.md) defines general styling ownership.

| Duration token | Default | Role and Jan examples |
|---|---|---|
| `--ds-transition-duration-fast` | 100 ms | Hover, press and focus feedback; attachment actions and session row controls |
| `--ds-transition-duration` | 200 ms | Menus, tooltips, popovers, expanding controls, inserted rows and toast entrances |
| `--ds-transition-duration-slow` | 300 ms | Whole surfaces such as dialogs, onboarding steps and side panels |
| `--ds-transition-duration-loop` | 1 s | Constant rotation of sending, sign-in and update spinners |
| `--ds-transition-duration-ambient` | 2 s | Skeleton pulses, chat activity indicators and the paired rotation and breathing arc of the ongoing state glyph |

| Curve token | Value | Role and Jan examples |
|---|---|---|
| `--ds-ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Enter promptly; tooltips, menus and toasts |
| `--ds-ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Exit without holding up the next interaction; toggletips and onboarding |
| `--ds-ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Change state or move between two visible positions; switches and segmented controls |
| `--ds-ease-emphasized` | `cubic-bezier(0.22, 1, 0.36, 1)` | Settle new content in place; welcome content and onboarding illustrations |
| `--ds-ease-pulse` | `cubic-bezier(0.36, 0, 0.64, 1)` | Symmetric breathing and pulses; loading skeletons and the pending composer dot |

Use the `linear` keyword for constant rotation or progress; it does not need a token. A plugin that can run without `ui-theme` may use a matching fallback inside `var()`. Do not copy those fallbacks into package stylesheets.

## Enter, exit and change state

Use ease-out for an entrance and ease-in for a shorter exit. A popover can enter at 200 ms and exit at 100 ms; an onboarding step can enter at 300 ms and exit at 200 ms. Use ease-in-out for a state change on an element that stays on screen, including fast color and opacity feedback. Keep the pointer interaction available while feedback settles.

Name the properties that transition instead of writing `transition: all`. Prefer `transform` and `opacity` for motion. Do not animate dimensions or position (`height`, `width`, `top`, or margins) when transform or opacity achieves the same result. When layout genuinely has to reflow during a transition, keep that change scoped and short.

## Respect reduced motion

The shared duration tokens resolve to `0.01ms` under `prefers-reduced-motion: reduce`, not zero, so finite transitions can still fire completion events. Keep component rules that remove spatial motion and remove or replace repeating animations with a static indicator. Do not run a spinner or pulse at `0.01ms` indefinitely. Cancel decorative delays when their animation is removed, and keep the final visual state and any lifecycle cleanup intact. Verify the same interaction with reduced motion enabled.

## Review exceptions

The [motion stylesheet test](../packages/client/ui-theme/tests/style-literals.client.spec.ts) scans package source and Web CSS and plugin CSS, including strings in `client*.js`. It rejects new literals and stale exceptions. Use `0s` or `0ms` when disabling a duration or delay; an immediate change is not an additional motion tier.

If a shared token cannot express the behavior, hand-edit the [motion exception file](../packages/client/ui-theme/tests/expected/motion-exceptions.json). Record the exact repository-relative `file`, `selector`, and `declaration` reported by the test, plus one `reason` explaining why the component owns that timing. Examples include a stagger among onboarding elements, an opacity hold coupled to unmount, and a drawing that runs before the theme can load. Never regenerate the list. Remove an exception when its declaration is removed or tokenized.
