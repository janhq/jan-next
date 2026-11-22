/**
 * The part of `@openuidev/react-components` the kit draws with, and nothing else.
 *
 * The kit's files import `@openuidev/react-components`; the bundle and the tests alias that name
 * to this file, and a name missing here fails the bundle. The typecheck skips this file and reads
 * the package itself (tsconfig.json): reached through this file's relative paths, the package's
 * declarations cannot find their own dependencies.
 * The package root is not bundled, for two reasons:
 * - its index is marked side-effectful, so bundling it keeps every component (charts, markdown,
 *   syntax highlighting): about 515 KB gzipped against about 210 KB for these files;
 * - its `OptionCards` renders titles through the full Markdown renderer, so the kit's
 *   `RadioGroup` draws its "cards" variant itself (see `components/RadioGroup`).
 *
 * The paths are relative because the package's `exports` map lists only its root.
 * `styles/defaults` writes react-components' light tokens on `:root`, in a cascade layer; the
 * surface maps the colour tokens to Jan's on `.ui4a-root` (see `jan-theme.ts`).
 */
import "../../../node_modules/@openuidev/react-components/dist/styles/defaults.mjs";

export { css, keyframes } from "../../../node_modules/@openuidev/react-components/dist/styles/css.mjs";
export { IconWrapper } from "../../../node_modules/@openuidev/react-components/dist/components/_shared/icons/IconWrapper.mjs";
export { Button } from "../../../node_modules/@openuidev/react-components/dist/components/Button/Button.mjs";
export {
  Carousel,
  CarouselContent,
  CarouselNext,
  CarouselPrevious,
} from "../../../node_modules/@openuidev/react-components/dist/components/Carousel/Carousel.mjs";
export { CheckBoxItem } from "../../../node_modules/@openuidev/react-components/dist/components/CheckBoxItem/CheckBoxItem.mjs";
export { IconButton } from "../../../node_modules/@openuidev/react-components/dist/components/IconButton/IconButton.mjs";
export { RadioGroup } from "../../../node_modules/@openuidev/react-components/dist/components/RadioGroup/RadioGroup.mjs";
export { RadioItem } from "../../../node_modules/@openuidev/react-components/dist/components/RadioItem/RadioItem.mjs";
export { Tag } from "../../../node_modules/@openuidev/react-components/dist/components/Tag/Tag.mjs";
export { ThemeProvider, useTheme } from "../../../node_modules/@openuidev/react-components/dist/components/ThemeProvider/ThemeProvider.mjs";
export { defaultDarkTheme } from "../../../node_modules/@openuidev/react-components/dist/components/ThemeProvider/defaultTheme.mjs";
export type { Theme, ThemeMode } from "../../../node_modules/@openuidev/react-components/dist/components/ThemeProvider/types.mjs";
