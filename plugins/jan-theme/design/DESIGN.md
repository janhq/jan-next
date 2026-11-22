# Jan design contract

Jan's look follows Mimi's Figma file [Jan - Desktop v04](https://www.figma.com/design/YA2ZFuuatxKCGLrh0OXxzs). This folder turns that file into values the code can check:

| File | Role |
|---|---|
| [`mimi-tokens.json`](mimi-tokens.json) | Snapshot of the file: color roles (light and dark), accent sidebar stops, radii, text styles, effects, and the spacing and radius scales |
| [`extract-figma.mjs`](extract-figma.mjs) | Rebuilds the snapshot from Figma |
| [`jan-design-contract.client.spec.tsx`](../../../packages/client/ui-theme/tests/jan-design-contract.client.spec.tsx) | Fails when the Jan theme drifts from the snapshot |

Jan's theme plugin ([`client.js`](../client.js)) owns the values. It overrides the shell's `--dsw-*` tokens through `ctx.theme.overrideTokens`; the upstream `ui-theme` sheets stay untouched. Feature code keeps following [Web styling](../../../docs/web-styling.md) and uses `--dsw-alias-*` tokens, never literal colors.

## When you build or change UI

1. Find the frame in Figma first. Most screens live on the pages "Chat + Cowork · merged", "Settings", "Onboarding" and "Themes".
2. Use a token from the tables below. When Mimi's frame uses a value that is not in them, add it to the snapshot (step 4) instead of writing a literal in CSS.
3. Text sizes and corner radii in `client.js` must come from Mimi's scales. The contract spec reads every `font-size` and `border-radius` in the file and rejects any value off the scale.
4. When Mimi changes the file, regenerate the snapshot and let the spec show what moved:

   ```sh
   FIGMA_TOKEN=figd_... node plugins/jan-theme/design/extract-figma.mjs
   pnpm exec vitest run packages/client/ui-theme/tests/jan-design-contract.client.spec.tsx
   ```

   The token needs file read access only. Never commit it. On the free Figma plan the API rate-limits after a few calls; wait a minute and run it again.
5. Compare the result against Mimi's frame on screen, light and dark, and attach both screenshots to the PR.
6. Before handing the UI over, check it against the list below. Each item is a correction that came back more than once.

### Before you hand it over

- **Alignment:** text starts and icon boxes line up with the row above and below, and with Mimi's frame. Compare a screenshot of yours beside the frame instead of judging the CSS.
- **Spacing:** every gap, padding and height is a step from [Shape and space](#shape-and-space). A value between steps is a bug, not a tweak.
- **Color:** `--dsw-alias-*` tokens only, checked in light and dark and with the default yellow accent, where text on accent fills is dark.
- **Icons:** reuse the shared icon set (`IconXxxRegular` / `Medium` from `@janhq/jan-client-ui-primitives`), same weight as the neighbors; draw a new glyph in that set rather than importing another style. Icon-only buttons get a tooltip ([icons](../../../.agents/skills/jan-client-ui-ux/references/icons.md)).
- **Motion:** every control that reacts to hover or press, and every surface that appears, animates with the [Motion](#motion) tokens, and stops under reduced motion.
- **Visible actions:** an action the user needs is shown, not revealed only on hover, unless the row has no room for it.

## Color roles

Each role reads one named layer in Figma; `extract-figma.mjs` lists the node ids.

| Role | Light | Dark | Shell token |
|---|---|---|---|
| Window background | `#FFFFFF` | `#111111` | `--dsw-alias-bg-base` |
| Raised surface (composer, menus) | `#FFFFFF` | `#1B1B1B` | `--dsw-alias-bg-layer-1`, `--dsw-alias-bg-overlay` |
| Recessed surface (sidebar, bubble) | `#F7F7F7` | `#151515` | `--dsw-alias-bg-layer-2` |
| Primary text | `#3D3D3D` | white 80% | `--dsw-alias-label-primary` |
| Secondary text (section headings) | `#808080` | white 40% | `--dsw-alias-label-secondary` |
| Tertiary text (shortcuts) | `#999999` | `#999999` | `--dsw-alias-label-tertiary` |
| Hairline | `#222222` 5% | white 8% | `--dsw-alias-border-l1` |
| Divider | `#222222` 10% | not drawn | `--dsw-alias-border-l2` |
| Hover fill | black 4% | white 8% | `--dsw-alias-interactive-bg-hover`, sidebar row hover |
| Selected sidebar row | black 6% | not drawn | `--dsw-specific-sidebar-nav-item-active` |
| Input placeholder | `#999999` | `#828282` | none yet: inputs use tertiary text |

"Not drawn" roles keep Jan's earlier dark value until Mimi draws them.

## Accents

The accent swatch sets the brand color, and the sidebar fades from the stop below to the window background. Jan yellow, the logo's color, is the default. Its fills are light enough that text and icons on them are dark (`#222222`) instead of white, and text drawn in the accent uses a deeper shade.

| Accent | Brand | Sidebar light | Sidebar dark |
|---|---|---|---|
| Red | `#F0614B` | `#F3CBC4` | `#5E1308` |
| Orange | `#E9A23F` | `#F3DFC4` | `#5C3A0A` |
| Yellow (default) | `#FFC928` | `#F3E6C4` | `#5C4A0A` |
| Green | `#88BA42` | `#DFF3C4` | `#374B1B` |
| Emerald | `#38AB51` | `#C4F3CE` | `#194D24` |
| Teal | `#38AB8D` | `#C4F3E6` | `#194D3F` |
| Cyan | `#45BBDE` | `#C4E8F3` | `#0F4657` |
| Blue | `#456BDE` | `#C4D0F3` | `#0F2157` |
| Purple | `#865EEA` | `#D2C4F3` | `#220C5A` |
| Pink | `#D55EF3` | `#E9C4F3` | `#4D075F` |
| Rose | `#F655B8` | `#FFDAE9` | `#61053E` |

Gray has no Themes frame; it stays Jan's own.

## Type

Inter, with tight tracking. Studio Feixen Sans is for the welcome title only.

| Style | Size / line | Weight | Tracking | Used for |
|---|---|---|---|---|
| `3xl/medium` | 24 / 32 | Studio Feixen | -0.72 | Welcome and page titles |
| `l/medium` | 16 / 24 | 500 | -0.32 | Dialog titles |
| `m/regular`, `m/medium` | 14 / 20 | 400, 500 | -0.28 | Body text, sidebar rows, messages |
| `s/regular`, `s/medium` | 13 / 18 | 400, 500 | -0.13 | Section headings, secondary text |
| `xs/regular`, `xs/medium` | 12 / 16 | 400, 500 | -0.12 | Captions, metadata |
| `2xs/medium` | 10 / 14 | 500 | -0.1 | Shortcut hints, badges |

## Shape and space

| | Values |
|---|---|
| Radii | 4, 8, 10, 12, 16, 20, 24 and full round. Mimi names four of them: sidebar row 12, sidebar card 20, user bubble 20, composer 24. [Radius roles](../../../docs/ui-radius.md#radius-scale) maps every other component onto this scale through the `--dsw-radius-*` tokens. |
| Spacing steps | 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 36 |
| Sidebar rows | 38 high on a 40 pitch; icons at x 19 and labels at x 46 inside the card |

The theme publishes `--jt-sidebar-radius` (20) and `--dsw-radius-panel` (24).

## Shadows

| Effect | Layers |
|---|---|
| `button-tertiary` | 0 1 2 black 8%, 0 0 1 black 4%, ring 1 black 4% |
| `chatbox` | 0 4 12 black 4%, 0 1 2 black 6%, ring 1 black 4% |
| `dropdown` | 0 10 12 black 8%, 0 4 12 black 4%, 0 1 2 black 6%, ring 1 black 4% |
| `elevation/md` | 0 1 2 black 4%, 0 6 16 -4 black 6% |
| `switch` | inset 0 1 4 black 4% |

The shell's elevation tokens (`--dsw-elevation-*`) are not mapped to these yet.

## Motion

Mimi's file has no motion; Jan uses the shell's motion tokens from `ui-theme`. Feature CSS writes these tokens, never a literal duration or curve.

| Token | Value | Use for |
|---|---|---|
| `--ds-transition-duration-fast` | 100 ms | Hover, press and focus changes of color, opacity or a small icon |
| `--ds-transition-duration` | 200 ms | Menus, popovers and tooltips opening; expand and collapse; tabs and panes moving |
| `--ds-transition-duration-slow` | 300 ms | A whole surface entering: dialogs, onboarding steps, side panels |
| `--ds-ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Anything that enters or answers the pointer, so the response reads at once |
| `--ds-ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Something moving between two resting places on screen |

- Animate `transform` and `opacity`; a change of width, height or position that the layout has to follow uses the 200 ms token at most.
- Every animation has a `@media (prefers-reduced-motion: reduce)` rule that removes the movement and keeps the end state.
- Loops of half a second or longer (spinners, shimmer, pulses) are drawings and keep their own timing.

[`style-literals.client.spec.ts`](../../../packages/client/ui-theme/tests/style-literals.client.spec.ts) fails when a feature stylesheet adds a literal duration, curve or color. The literals already in the tree are listed in its `expected/style-literals.expected.json` and are left until their owners touch them; regenerate that file with `vitest -u` only for a deliberate exception, and say why in the commit.

## Known gaps

- Figma variable names are not available. The Variables API needs an Enterprise plan, so the snapshot keeps each value's variable id instead.
- Shadows, spacing and line heights are recorded but not enforced. Motion and color literals are enforced for feature stylesheets under `packages/`, not for `client.js` or other plugin CSS written in JavaScript.
- Mimi has not drawn dark mode for dividers or the selected sidebar row.
