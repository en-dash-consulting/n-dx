import { describe, expect, it } from "vitest";
import { appendAgentPrompt, buildSystemPrompt } from "../../../src/agent/planning/prompt.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/v1.js";

const SECTION = "## Project instructions from .ndx/agent-prompt.md\nThe project's operator wrote these.\n\nNever touch dist/.";
const project = { name: "p", validateCommand: "npm run typecheck", testCommand: "npm test" };

describe("appendAgentPrompt", () => {
  it("appends the section after a blank line", () => {
    expect(appendAgentPrompt("base", SECTION)).toBe(`base\n\n${SECTION}`);
  });

  it("returns the prompt unchanged for a missing or empty section", () => {
    expect(appendAgentPrompt("base", undefined)).toBe("base");
    expect(appendAgentPrompt("base", "")).toBe("base");
  });
});

describe("buildSystemPrompt agent prompt", () => {
  for (const provider of ["cli", "api"] as const) {
    it(`ends the ${provider} provider's system prompt with the section`, () => {
      const config = { ...DEFAULT_HENCH_CONFIG(), provider };
      const without = buildSystemPrompt(project, config);
      const withPrompt = buildSystemPrompt({ ...project, agentPrompt: SECTION }, config);
      expect(withPrompt).toBe(`${without}\n\n${SECTION}`);
    });
  }

  it("adds nothing when the project carries no agent prompt", () => {
    expect(buildSystemPrompt(project, DEFAULT_HENCH_CONFIG())).not.toContain("Project instructions from");
  });

  // The envelope route (CLI loop) is covered end to end by shared-lifecycle.test.ts's prepareBrief case.
});
