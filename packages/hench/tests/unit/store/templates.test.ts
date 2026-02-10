import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  listTemplates,
  getTemplate,
  saveTemplate,
  deleteTemplate,
  applyTemplate,
  isValidTemplateId,
} from "../../../src/store/templates.js";
import { BUILT_IN_TEMPLATES } from "../../../src/schema/templates.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/v1.js";
import type { WorkflowTemplate } from "../../../src/schema/templates.js";

let henchDir: string;

beforeEach(async () => {
  const tmpBase = await mkdtemp(join(tmpdir(), "hench-templates-test-"));
  henchDir = tmpBase;
  await mkdir(henchDir, { recursive: true });
});

afterEach(async () => {
  await rm(henchDir, { recursive: true, force: true });
});

describe("listTemplates", () => {
  it("returns built-in templates when no user templates exist", async () => {
    const templates = await listTemplates(henchDir);
    expect(templates.length).toBe(BUILT_IN_TEMPLATES.length);
    expect(templates.every((t) => t.builtIn)).toBe(true);
  });

  it("includes user templates after built-in ones", async () => {
    const userTemplate: WorkflowTemplate = {
      id: "my-template",
      name: "My Template",
      description: "Test template",
      useCases: ["testing"],
      tags: ["test"],
      config: { maxTurns: 10 },
      builtIn: false,
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    await writeFile(
      join(henchDir, "templates.json"),
      JSON.stringify([userTemplate]),
      "utf-8",
    );

    const templates = await listTemplates(henchDir);
    expect(templates.length).toBe(BUILT_IN_TEMPLATES.length + 1);
    expect(templates[templates.length - 1].id).toBe("my-template");
  });

  it("excludes user templates with built-in IDs", async () => {
    const collision: WorkflowTemplate = {
      id: "quick-iteration",
      name: "Overridden",
      description: "Should be excluded",
      useCases: [],
      tags: [],
      config: {},
      builtIn: false,
    };
    await writeFile(
      join(henchDir, "templates.json"),
      JSON.stringify([collision]),
      "utf-8",
    );

    const templates = await listTemplates(henchDir);
    const quickIteration = templates.find((t) => t.id === "quick-iteration");
    expect(quickIteration).toBeDefined();
    expect(quickIteration!.builtIn).toBe(true);
    expect(quickIteration!.name).toBe("Quick Iteration");
  });
});

describe("getTemplate", () => {
  it("returns built-in template by ID", async () => {
    const t = await getTemplate(henchDir, "quick-iteration");
    expect(t).not.toBeNull();
    expect(t!.builtIn).toBe(true);
  });

  it("returns user template by ID", async () => {
    const userTemplate: WorkflowTemplate = {
      id: "custom",
      name: "Custom",
      description: "Custom template",
      useCases: [],
      tags: [],
      config: { maxTurns: 5 },
      builtIn: false,
    };
    await writeFile(
      join(henchDir, "templates.json"),
      JSON.stringify([userTemplate]),
      "utf-8",
    );

    const t = await getTemplate(henchDir, "custom");
    expect(t).not.toBeNull();
    expect(t!.name).toBe("Custom");
  });

  it("returns null for non-existent ID", async () => {
    const t = await getTemplate(henchDir, "nonexistent");
    expect(t).toBeNull();
  });

  it("prefers built-in over user template with same ID", async () => {
    const collision: WorkflowTemplate = {
      id: "quick-iteration",
      name: "Overridden",
      description: "Should not appear",
      useCases: [],
      tags: [],
      config: {},
      builtIn: false,
    };
    await writeFile(
      join(henchDir, "templates.json"),
      JSON.stringify([collision]),
      "utf-8",
    );

    const t = await getTemplate(henchDir, "quick-iteration");
    expect(t!.name).toBe("Quick Iteration");
    expect(t!.builtIn).toBe(true);
  });
});

describe("saveTemplate", () => {
  it("creates templates.json on first save", async () => {
    const template: WorkflowTemplate = {
      id: "new-template",
      name: "New Template",
      description: "First template",
      useCases: [],
      tags: [],
      config: { maxTurns: 10 },
      builtIn: false,
    };

    await saveTemplate(henchDir, template);

    const raw = await readFile(join(henchDir, "templates.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("new-template");
    expect(parsed[0].createdAt).toBeTruthy();
  });

  it("appends to existing templates", async () => {
    const first: WorkflowTemplate = {
      id: "first",
      name: "First",
      description: "First",
      useCases: [],
      tags: [],
      config: {},
      builtIn: false,
    };
    const second: WorkflowTemplate = {
      id: "second",
      name: "Second",
      description: "Second",
      useCases: [],
      tags: [],
      config: {},
      builtIn: false,
    };

    await saveTemplate(henchDir, first);
    await saveTemplate(henchDir, second);

    const templates = await listTemplates(henchDir);
    const userTemplates = templates.filter((t) => !t.builtIn);
    expect(userTemplates).toHaveLength(2);
  });

  it("overwrites existing template with same ID", async () => {
    const original: WorkflowTemplate = {
      id: "my-template",
      name: "Original",
      description: "Original",
      useCases: [],
      tags: [],
      config: { maxTurns: 10 },
      builtIn: false,
    };
    const updated: WorkflowTemplate = {
      ...original,
      name: "Updated",
      config: { maxTurns: 20 },
    };

    await saveTemplate(henchDir, original);
    await saveTemplate(henchDir, updated);

    const t = await getTemplate(henchDir, "my-template");
    expect(t!.name).toBe("Updated");
    expect(t!.config.maxTurns).toBe(20);

    const templates = await listTemplates(henchDir);
    const user = templates.filter((t) => !t.builtIn);
    expect(user).toHaveLength(1);
  });

  it("rejects overwriting built-in template", async () => {
    const template: WorkflowTemplate = {
      id: "quick-iteration",
      name: "Override",
      description: "Override",
      useCases: [],
      tags: [],
      config: {},
      builtIn: false,
    };

    await expect(saveTemplate(henchDir, template)).rejects.toThrow(
      /built-in/i,
    );
  });

  it("forces builtIn to false when saving", async () => {
    const template: WorkflowTemplate = {
      id: "pretend-builtin",
      name: "Pretend",
      description: "Pretend",
      useCases: [],
      tags: [],
      config: {},
      builtIn: true, // Should be forced to false
    };

    await saveTemplate(henchDir, template);
    const t = await getTemplate(henchDir, "pretend-builtin");
    expect(t!.builtIn).toBe(false);
  });
});

describe("deleteTemplate", () => {
  it("deletes an existing user template", async () => {
    const template: WorkflowTemplate = {
      id: "to-delete",
      name: "To Delete",
      description: "Will be deleted",
      useCases: [],
      tags: [],
      config: {},
      builtIn: false,
    };

    await saveTemplate(henchDir, template);
    const deleted = await deleteTemplate(henchDir, "to-delete");
    expect(deleted).toBe(true);

    const t = await getTemplate(henchDir, "to-delete");
    expect(t).toBeNull();
  });

  it("returns false when template not found", async () => {
    const deleted = await deleteTemplate(henchDir, "nonexistent");
    expect(deleted).toBe(false);
  });

  it("rejects deleting built-in template", async () => {
    await expect(deleteTemplate(henchDir, "quick-iteration")).rejects.toThrow(
      /built-in/i,
    );
  });
});

describe("applyTemplate", () => {
  it("merges top-level config values", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const result = applyTemplate(config, { maxTurns: 15, tokenBudget: 50000 });

    expect(result.maxTurns).toBe(15);
    expect(result.tokenBudget).toBe(50000);
    // Untouched fields preserved
    expect(result.model).toBe("sonnet");
    expect(result.provider).toBe("cli");
  });

  it("deep merges retry config", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const result = applyTemplate(config, {
      retry: { maxRetries: 5, baseDelayMs: 1000, maxDelayMs: 60000 },
    });

    expect(result.retry.maxRetries).toBe(5);
    expect(result.retry.baseDelayMs).toBe(1000);
    expect(result.retry.maxDelayMs).toBe(60000);
  });

  it("deep merges guard config", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const result = applyTemplate(config, {
      guard: { commandTimeout: 15000 },
    });

    expect(result.guard.commandTimeout).toBe(15000);
    // Untouched guard fields preserved
    expect(result.guard.maxFileSize).toBe(config.guard.maxFileSize);
    expect(result.guard.allowedCommands).toEqual(config.guard.allowedCommands);
  });

  it("preserves schema field", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const result = applyTemplate(config, { maxTurns: 10 });
    expect(result.schema).toBe(config.schema);
  });

  it("does not mutate original config", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const originalMaxTurns = config.maxTurns;
    applyTemplate(config, { maxTurns: 999 });
    expect(config.maxTurns).toBe(originalMaxTurns);
  });

  it("applies quick-iteration template correctly", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const quickIter = BUILT_IN_TEMPLATES.find((t) => t.id === "quick-iteration")!;
    const result = applyTemplate(config, quickIter.config);

    expect(result.maxTurns).toBe(15);
    expect(result.tokenBudget).toBe(50000);
    expect(result.loopPauseMs).toBe(500);
    expect(result.retry.maxRetries).toBe(2);
  });
});

describe("isValidTemplateId", () => {
  it("accepts valid IDs", () => {
    expect(isValidTemplateId("my-template")).toBe(true);
    expect(isValidTemplateId("quick-iteration")).toBe(true);
    expect(isValidTemplateId("ab")).toBe(true);
    expect(isValidTemplateId("template123")).toBe(true);
  });

  it("rejects invalid IDs", () => {
    expect(isValidTemplateId("")).toBe(false);
    expect(isValidTemplateId("a")).toBe(false); // Too short
    expect(isValidTemplateId("A-template")).toBe(false); // Uppercase
    expect(isValidTemplateId("1-template")).toBe(false); // Starts with number
    expect(isValidTemplateId("my template")).toBe(false); // Space
    expect(isValidTemplateId("my_template")).toBe(false); // Underscore
    expect(isValidTemplateId("a".repeat(51))).toBe(false); // Too long
  });
});
