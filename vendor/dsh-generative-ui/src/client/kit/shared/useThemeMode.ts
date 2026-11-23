"use client";

import { useSyncExternalStore } from "react";
import { useIntelligentTheme } from "../components/ThemeProvider";

// Jan marks its dark theme on <body>; a card has no library ThemeProvider around it, so outside one
// the kit follows that attribute instead of upstream's fixed "light".
const DARK_ATTRIBUTE = "data-ds-dark-theme";

function subscribe(onChange: () => void) {
  if (typeof document === "undefined") return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { attributes: true, attributeFilter: [DARK_ATTRIBUTE] });
  return () => observer.disconnect();
}

const pageMode = (): "light" | "dark" =>
  typeof document !== "undefined" && document.body.hasAttribute(DARK_ATTRIBUTE) ? "dark" : "light";

/** Light or dark, from the nearest library ThemeProvider; Jan's theme outside one. */
export function useThemeMode(): "light" | "dark" {
  const provided = useIntelligentTheme()?.mode;
  const page = useSyncExternalStore(subscribe, pageMode, () => "light" as const);
  return provided === undefined ? page : provided === "dark" ? "dark" : "light";
}
