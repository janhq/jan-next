// @vitest-environment node
import { describe, expect, it } from "vitest";
import { briefPrompt, inlinePrompt } from "../src/prompt.ts";
import { skillBody } from "../src/skill.ts";

describe("teaching $dsh/ui", () => {
  it("names the kit and counts it in the closed set of imports, with or without host capabilities", () => {
    const bare = inlinePrompt();
    expect(bare).toContain('from "$dsh/ui"');
    expect(bare).toContain("These three are the whole set — `chat`, `state`, `ui` —");
    const full = inlinePrompt({ fs: true, ai: true, exec: true, web: true });
    expect(full).toContain("These seven are the whole set — `fs`, `ai`, `exec`, `web`, `chat`, `state`, `ui` —");
  });

  it("keeps the brief section to the skill trigger, the block syntax and the mounted capabilities", () => {
    const brief = briefPrompt({ fs: true, ai: false, exec: false, web: false });
    expect(brief).toContain("Load the `generative-ui` skill before drafting");
    expect(brief).toContain("**four backticks** and the info string `ui4a/tsx`");
    expect(brief).toContain("Only `fs`, `chat`, `state`, `ui` exist here.");
    expect(brief.length).toBeLessThan(inlinePrompt().length / 20);
  });

  it("indexes the kit reference in the skill and ships its text", () => {
    const body = skillBody(undefined, undefined);
    expect(body).toContain("[kit.md](references/kit.md)");
    expect(body).toContain("# The `$dsh/ui` component kit");
  });
});
