import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../../../src/agent/planning/prompt.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/v1.js";
import type { TaskBriefProject } from "../../../src/schema/v1.js";

describe("buildSystemPrompt", () => {
  const project: TaskBriefProject = {
    name: "test-project",
    validateCommand: "npm run typecheck",
    testCommand: "npm test",
  };

  it("includes agent identity", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const prompt = buildSystemPrompt(project, config);
    expect(prompt).toContain("Hench");
    expect(prompt).toContain("autonomous AI agent");
  });

  it("includes project info", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const prompt = buildSystemPrompt(project, config);
    expect(prompt).toContain("test-project");
    expect(prompt).toContain("npm run typecheck");
    expect(prompt).toContain("npm test");
  });

  it("includes rules", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const prompt = buildSystemPrompt(project, config);
    expect(prompt).toContain("Read existing code");
    expect(prompt).toContain("minimal, focused changes");
  });

  it("handles project without commands", () => {
    const minProject: TaskBriefProject = { name: "bare-project" };
    const config = DEFAULT_HENCH_CONFIG();
    const prompt = buildSystemPrompt(minProject, config);
    expect(prompt).toContain("bare-project");
    expect(prompt).not.toContain("Validate command:");
    expect(prompt).not.toContain("Test command:");
  });

  // ── Plan Mode Invariant regression ──────────────────────────────────────────
  // These tests are the canary: if the no-plan-mode rule is ever removed from
  // buildSystemPrompt, the first test will fail. Do not skip or weaken them.
  describe("plan mode invariant", () => {
    it("cli provider system prompt includes no-plan-mode section", () => {
      const config = { ...DEFAULT_HENCH_CONFIG(), provider: "cli" as const };
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).toContain("Plan Mode Invariant");
      expect(prompt).toContain("ExitPlanMode");
      expect(prompt).toContain("plan-only responses");
    });

    it("plan-mode section absent from api provider (different interaction model)", () => {
      const config = { ...DEFAULT_HENCH_CONFIG(), provider: "api" as const };
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).not.toContain("Plan Mode Invariant");
    });
  });

  describe("cli provider", () => {
    it("omits rex tools from workflow", () => {
      const config = { ...DEFAULT_HENCH_CONFIG(), provider: "cli" as const };
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).not.toContain("rex_update_status");
      expect(prompt).not.toContain("rex_append_log");
    });

    it("omits tool notes section", () => {
      const config = { ...DEFAULT_HENCH_CONFIG(), provider: "cli" as const };
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).not.toContain("## Tool Notes");
      expect(prompt).not.toContain("[GUARD]");
    });

    it("includes simplified workflow", () => {
      const config = { ...DEFAULT_HENCH_CONFIG(), provider: "cli" as const };
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).toContain("Explore the codebase");
      expect(prompt).toContain("Implement the changes");
      expect(prompt).toContain("Provide a summary");
    });
  });

  describe("api provider", () => {
    it("includes rex tools in workflow", () => {
      const config = { ...DEFAULT_HENCH_CONFIG(), provider: "api" as const };
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).toContain("rex_update_status");
      expect(prompt).toContain("in_progress");
      expect(prompt).toContain("completed");
    });

    it("distinguishes blocked from deferred in guidance", () => {
      const config = { ...DEFAULT_HENCH_CONFIG(), provider: "api" as const };
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).toContain("blocked");
      expect(prompt).toContain("deferred");
    });

    it("includes allowed commands in tool notes", () => {
      const config = { ...DEFAULT_HENCH_CONFIG(), provider: "api" as const };
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).toContain("## Tool Notes");
      expect(prompt).toContain("npm");
      expect(prompt).toContain("git");
      expect(prompt).toContain("tsc");
    });

    it("includes guard error notes", () => {
      const config = { ...DEFAULT_HENCH_CONFIG(), provider: "api" as const };
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).toContain("[GUARD]");
      expect(prompt).toContain("[ERROR]");
    });
  });
});
