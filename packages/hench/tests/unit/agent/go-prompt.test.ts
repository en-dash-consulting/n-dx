import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../../../src/agent/planning/prompt.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/v1.js";
import type { TaskBriefProject } from "../../../src/schema/v1.js";

const project: TaskBriefProject = {
  name: "my-go-service",
  validateCommand: "go vet ./...",
  testCommand: "go test ./...",
};

// ---------------------------------------------------------------------------
// Go-specific prompt content
// ---------------------------------------------------------------------------

describe("buildSystemPrompt — Go language context", () => {
  it("includes Go language heading", () => {
    const config = { ...DEFAULT_HENCH_CONFIG("go") };
    const prompt = buildSystemPrompt(project, config);
    expect(prompt).toContain("## Language: Go");
  });

  describe("toolchain section", () => {
    it("includes go build command", () => {
      const config = DEFAULT_HENCH_CONFIG("go");
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).toContain("`go build ./...`");
    });

    it("includes go test command", () => {
      const config = DEFAULT_HENCH_CONFIG("go");
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).toContain("`go test ./...`");
    });

    it("includes go vet command", () => {
      const config = DEFAULT_HENCH_CONFIG("go");
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).toContain("`go vet ./...`");
    });

    it("includes golangci-lint command", () => {
      const config = DEFAULT_HENCH_CONFIG("go");
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).toContain("`golangci-lint run`");
    });
  });

  describe("naming conventions section", () => {
    it("includes PascalCase for exports", () => {
      const config = DEFAULT_HENCH_CONFIG("go");
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).toContain("PascalCase");
    });

    it("includes camelCase for unexported", () => {
      const config = DEFAULT_HENCH_CONFIG("go");
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).toContain("camelCase");
    });

    it("includes error handling guidance", () => {
      const config = DEFAULT_HENCH_CONFIG("go");
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).toContain("error");
      expect(prompt).toContain("no try/catch");
    });

    it("includes acronym casing rules", () => {
      const config = DEFAULT_HENCH_CONFIG("go");
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).toContain("HTTPClient");
    });
  });

  describe("project structure section", () => {
    it("includes cmd/ directory", () => {
      const config = DEFAULT_HENCH_CONFIG("go");
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).toContain("`cmd/`");
    });

    it("includes internal/ directory", () => {
      const config = DEFAULT_HENCH_CONFIG("go");
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).toContain("`internal/`");
    });

    it("includes pkg/ directory", () => {
      const config = DEFAULT_HENCH_CONFIG("go");
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).toContain("`pkg/`");
    });

    it("includes go.mod / go.sum", () => {
      const config = DEFAULT_HENCH_CONFIG("go");
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).toContain("go.mod");
      expect(prompt).toContain("go.sum");
    });
  });

  describe("test conventions section", () => {
    it("includes _test.go suffix convention", () => {
      const config = DEFAULT_HENCH_CONFIG("go");
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).toContain("_test.go");
    });

    it("includes *testing.T parameter convention", () => {
      const config = DEFAULT_HENCH_CONFIG("go");
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).toContain("*testing.T");
    });

    it("includes table-driven tests guidance", () => {
      const config = DEFAULT_HENCH_CONFIG("go");
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).toContain("table-driven");
    });

    it("includes t.Helper() guidance", () => {
      const config = DEFAULT_HENCH_CONFIG("go");
      const prompt = buildSystemPrompt(project, config);
      expect(prompt).toContain("t.Helper()");
    });
  });

  it("includes project info alongside Go context", () => {
    const config = DEFAULT_HENCH_CONFIG("go");
    const prompt = buildSystemPrompt(project, config);
    expect(prompt).toContain("my-go-service");
    expect(prompt).toContain("`go vet ./...`");
    expect(prompt).toContain("`go test ./...`");
  });

  it("includes Go allowed commands in tool notes for api provider", () => {
    const config = { ...DEFAULT_HENCH_CONFIG("go"), provider: "api" as const };
    const prompt = buildSystemPrompt(project, config);
    expect(prompt).toContain("go");
    expect(prompt).toContain("golangci-lint");
    expect(prompt).toContain("## Tool Notes");
  });
});

// ---------------------------------------------------------------------------
// JS/TS prompt regression guard
// ---------------------------------------------------------------------------

describe("buildSystemPrompt — JS/TS regression guard", () => {
  const jsProject: TaskBriefProject = {
    name: "my-ts-project",
    validateCommand: "npm run typecheck",
    testCommand: "npm test",
  };

  it("does not include Go context when language is not go", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const prompt = buildSystemPrompt(jsProject, config);
    expect(prompt).not.toContain("## Language: Go");
    expect(prompt).not.toContain("go build");
    expect(prompt).not.toContain("go.mod");
    expect(prompt).not.toContain("_test.go");
    expect(prompt).not.toContain("*testing.T");
  });

  it("does not include Go context for typescript language", () => {
    const config = { ...DEFAULT_HENCH_CONFIG("typescript") };
    const prompt = buildSystemPrompt(jsProject, config);
    expect(prompt).not.toContain("## Language: Go");
  });

  it("preserves agent identity", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const prompt = buildSystemPrompt(jsProject, config);
    expect(prompt).toContain("Hench");
    expect(prompt).toContain("autonomous AI agent");
  });

  it("preserves project info", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const prompt = buildSystemPrompt(jsProject, config);
    expect(prompt).toContain("my-ts-project");
    expect(prompt).toContain("npm run typecheck");
    expect(prompt).toContain("npm test");
  });

  it("preserves workflow and error handling sections", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const prompt = buildSystemPrompt(jsProject, config);
    expect(prompt).toContain("## Workflow");
    expect(prompt).toContain("## Error Handling");
  });

  it("preserves JS/TS allowed commands in tool notes for api provider", () => {
    const config = { ...DEFAULT_HENCH_CONFIG(), provider: "api" as const };
    const prompt = buildSystemPrompt(jsProject, config);
    expect(prompt).toContain("npm");
    expect(prompt).toContain("git");
    expect(prompt).toContain("tsc");
  });
});
