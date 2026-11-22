"use client";

import clsx from "clsx";
import katex from "katex";
import { mathStyles, names } from "./math.styles";

export interface MathBlockProps {
  /** A LaTeX formula, e.g. "E = mc^2". */
  tex: string;
  /** Sits in a line of text rather than on its own line. */
  inline?: boolean;
}

// KaTeX's stylesheet is already on the page: Jan's Markdown renderer (ui-primitives `MarkdownText`)
// imports it. Upstream loaded it here with a dynamic import(), which a single-file plugin bundle
// cannot split off.

/** A LaTeX formula, rendered with KaTeX. */
export function MathBlock({ tex, inline }: MathBlockProps) {
  const html = katex.renderToString(tex, {
    displayMode: !inline,
    throwOnError: false,
    trust: false,
    strict: "ignore",
    output: "htmlAndMathml",
  });
  // KaTeX escapes its input and is configured without \href or \includegraphics.
  return inline ? (
    <span className={clsx(mathStyles.root, names.root)} dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <div
      className={clsx(mathStyles.root, names.root, mathStyles.block, names.block)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
