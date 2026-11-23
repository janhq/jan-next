/**
 * Dresses the `$dsh/ui` kit in Jan's theme on every generated surface (`.ui4a-root`).
 *
 * The kit reads two layers of variables: its own `--openui-intelligent-*` tokens, which fall back
 * to react-components' `--openui-*` tokens. Upstream sets them through a ThemeProvider around the
 * app; a card renders in its own React root with none, so react-components' light defaults on
 * `:root` (a cascade layer, see react-components.ts) are all it would see.
 *
 * - Light or dark follows Jan (`body[data-ds-dark-theme]`), with react-components' own dark
 *   palette, so every control the kit borrows (Button, Tag, Checkbox, RadioItem) keeps its contrast.
 * - Identity is Jan's: the text and code fonts, the label and surface colours, the focus ring and
 *   the success/warning/error colours come from Jan's tokens, so a card reads as part of the reply.
 *
 * A card that wraps itself in the kit's ThemeProvider still wins: that provider writes on a scope
 * inside the surface.
 */
import { defaultDarkTheme } from "@openuidev/react-components";
import { UI4A_ROOT_CLASS } from "../runtime/uno.ts";

// react-components' own key conversion (`camelToKebab` in its ThemeProvider utils, not exported):
// `textNeutralPrimary` -> `--openui-text-neutral-primary`.
const cssVar = (key: string) =>
  `--openui-${key.replace(/([a-z])([A-Z])/g, "$1-$2").replace(/([A-Z])([A-Z])/g, "$1-$2").replace(/([a-z])(\d)/g, "$1-$2").toLowerCase()}`;
const themeVars = (theme: object) =>
  Object.entries(theme)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, value]) => `${cssVar(key)}: ${value};`)
    .join(" ");

const ROOT = `.${UI4A_ROOT_CLASS}`;
const DARK = "body[data-ds-dark-theme]";

const identity = `
  --openui-font-body: var(--dsw-font-family);
  --openui-intelligent-font: var(--dsw-font-family);
  --openui-intelligent-mono: var(--ds-font-family-code);
  --openui-foreground: var(--dsw-alias-bg-base);
  --openui-intelligent-canvas: var(--dsw-alias-bg-base);
  --openui-intelligent-on-ink: var(--dsw-alias-bg-base);
  --openui-text-neutral-primary: var(--dsw-alias-label-primary);
  --openui-intelligent-ink: var(--dsw-alias-label-primary);
  --openui-text-neutral-secondary: var(--dsw-alias-label-secondary);
  --openui-intelligent-muted: var(--dsw-alias-label-secondary);
  --openui-text-neutral-tertiary: var(--dsw-alias-label-tertiary);
  --openui-intelligent-faint: var(--dsw-alias-label-tertiary);
  --openui-intelligent-focus: var(--dsw-alias-button-primary-fill);
  --openui-text-success-primary: var(--dsw-alias-state-success-primary);
  --openui-intelligent-success: var(--dsw-alias-state-success-primary);
  --openui-text-alert-primary: var(--dsw-alias-state-warn-primary);
  --openui-intelligent-warning: var(--dsw-alias-state-warn-primary);
  --openui-text-danger-primary: var(--dsw-alias-state-error-primary);
  --openui-intelligent-danger: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);`;

/** The stylesheet, exported for the tests: a wrong selector here is a light card on a dark page. */
export const kitThemeCss = (): string =>
  // Identity comes second under the dark selector too, so it wins over the dark palette's values.
  `${DARK} ${ROOT} { color-scheme: dark; ${themeVars(defaultDarkTheme)} }\n${ROOT}, ${DARK} ${ROOT} {${identity}\n}`;

let installed = false;

/**
 * Installs the stylesheet once. `data-plugin` keeps it with this plugin: the loader removes the
 * plugin's tagged styles when it unloads (see runtime/uno.ts).
 */
export function installKitTheme(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const sheet = document.createElement("style");
  sheet.setAttribute("data-plugin", "dsh-generative-ui");
  sheet.setAttribute("data-plugin-css", "dsh-generative-ui/kit-theme");
  sheet.textContent = kitThemeCss();
  document.head.appendChild(sheet);
}
