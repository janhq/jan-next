// @vitest-environment node
import { describe, expect, it } from "vitest";
import { inlinePrompt } from "../src/prompt.ts";
import { skillBody } from "../src/skill.ts";

describe("teaching $dsh/ui", () => {
  it("names the kit and counts it in the closed set of imports, with or without host capabilities", () => {
    const bare = inlinePrompt();
    expect(bare).toContain('from "$dsh/ui"');
    expect(bare).toContain("These three are the whole set — `chat`, `state`, `ui` —");
    const full = inlinePrompt({ fs: true, ai: true, exec: true, web: true });
    expect(full).toContain("These seven are the whole set — `fs`, `ai`, `exec`, `web`, `chat`, `state`, `ui` —");
  });

  it("indexes the kit reference in the skill and ships its text", () => {
    const body = skillBody(undefined, undefined);
    expect(body).toContain("[kit.md](references/kit.md)");
    expect(body).toContain("# The `$dsh/ui` component kit");
  });
});
