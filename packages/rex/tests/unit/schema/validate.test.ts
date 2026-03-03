import { describe, it, expect } from "vitest";
import {
  validateDocument,
  validateConfig,
  validateLogEntry,
  formatValidationErrors,
} from "../../../src/schema/validate.js";

describe("validateDocument", () => {
  it("accepts a valid minimal document", () => {
    const result = validateDocument({
      schema: "rex/v1",
      title: "Test",
      items: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.title).toBe("Test");
    }
  });

  it("accepts a document with nested items", () => {
    const result = validateDocument({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "e1",
          title: "Epic 1",
          status: "pending",
          level: "epic",
          children: [
            {
              id: "f1",
              title: "Feature 1",
              status: "in_progress",
              level: "feature",
              children: [
                {
                  id: "t1",
                  title: "Task 1",
                  status: "completed",
                  level: "task",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("preserves unknown fields via passthrough", () => {
    const result = validateDocument({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "e1",
          title: "Epic 1",
          status: "pending",
          level: "epic",
          customField: "preserved",
        },
      ],
      myMeta: 42,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as Record<string, unknown>).myMeta).toBe(42);
      expect((result.data.items[0] as Record<string, unknown>).customField).toBe(
        "preserved",
      );
    }
  });

  it("rejects document missing schema", () => {
    const result = validateDocument({
      title: "Test",
      items: [],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a document with blocked status", () => {
    const result = validateDocument({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "t1",
          title: "Blocked Task",
          status: "blocked",
          level: "task",
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects document with invalid item status", () => {
    const result = validateDocument({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "e1",
          title: "Epic 1",
          status: "invalid_status",
          level: "epic",
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects document with invalid item level", () => {
    const result = validateDocument({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "e1",
          title: "Epic 1",
          status: "pending",
          level: "milestone",
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects document with invalid priority", () => {
    const result = validateDocument({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "t1",
          title: "Task",
          status: "pending",
          level: "task",
          priority: "urgent",
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts items with all optional fields", () => {
    const result = validateDocument({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "t1",
          title: "Task",
          status: "pending",
          level: "task",
          description: "A task",
          acceptanceCriteria: ["criterion 1"],
          priority: "high",
          tags: ["auth"],
          source: "manual",
          blockedBy: ["t0"],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts items without optional fields (legacy format)", () => {
    const result = validateDocument({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "t1",
          title: "Minimal Task",
          status: "pending",
          level: "task",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const item = result.data.items[0] as Record<string, unknown>;
      expect(item.description).toBeUndefined();
      expect(item.priority).toBeUndefined();
      expect(item.tags).toBeUndefined();
      expect(item.blockedBy).toBeUndefined();
    }
  });

  it("accepts all valid status values", () => {
    const statuses = ["pending", "in_progress", "completed", "deferred", "blocked", "deleted"];
    for (const status of statuses) {
      const result = validateDocument({
        schema: "rex/v1",
        title: "Test",
        items: [{ id: "t1", title: "Task", status, level: "task" }],
      });
      expect(result.ok).toBe(true);
    }
  });

  it("accepts all valid priority values", () => {
    const priorities = ["critical", "high", "medium", "low"];
    for (const priority of priorities) {
      const result = validateDocument({
        schema: "rex/v1",
        title: "Test",
        items: [
          { id: "t1", title: "Task", status: "pending", level: "task", priority },
        ],
      });
      expect(result.ok).toBe(true);
    }
  });

  it("accepts all valid level values", () => {
    const levels = ["epic", "feature", "task", "subtask"];
    for (const level of levels) {
      const result = validateDocument({
        schema: "rex/v1",
        title: "Test",
        items: [{ id: "t1", title: "Item", status: "pending", level }],
      });
      expect(result.ok).toBe(true);
    }
  });

  it("rejects document missing title", () => {
    const result = validateDocument({
      schema: "rex/v1",
      items: [],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects document missing items", () => {
    const result = validateDocument({
      schema: "rex/v1",
      title: "Test",
    });
    expect(result.ok).toBe(false);
  });
});

describe("validateConfig", () => {
  it("accepts a valid config", () => {
    const result = validateConfig({
      schema: "rex/v1",
      project: "myproject",
      adapter: "file",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts config with optional fields", () => {
    const result = validateConfig({
      schema: "rex/v1",
      project: "myproject",
      adapter: "file",
      validate: "npm run validate",
      test: "npm test",
      sourcevision: "auto",
      future: { flag1: true },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts config with model field", () => {
    const result = validateConfig({
      schema: "rex/v1",
      project: "myproject",
      adapter: "file",
      model: "claude-sonnet-4-6",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.model).toBe("claude-sonnet-4-6");
    }
  });

  it("accepts config with valid budget", () => {
    const result = validateConfig({
      schema: "rex/v1",
      project: "myproject",
      adapter: "file",
      budget: {
        tokens: 500000,
        cost: 10.0,
        warnAt: 80,
        abort: false,
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.budget).toEqual({
        tokens: 500000,
        cost: 10.0,
        warnAt: 80,
        abort: false,
      });
    }
  });

  it("accepts config with partial budget (optional fields)", () => {
    const result = validateConfig({
      schema: "rex/v1",
      project: "myproject",
      adapter: "file",
      budget: { tokens: 100000 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.budget!.tokens).toBe(100000);
      expect(result.data.budget!.cost).toBeUndefined();
      expect(result.data.budget!.warnAt).toBeUndefined();
    }
  });

  it("accepts config with budget tokens of 0 (unlimited)", () => {
    const result = validateConfig({
      schema: "rex/v1",
      project: "myproject",
      adapter: "file",
      budget: { tokens: 0 },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects config with negative budget tokens", () => {
    const result = validateConfig({
      schema: "rex/v1",
      project: "myproject",
      adapter: "file",
      budget: { tokens: -100 },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects config with negative budget cost", () => {
    const result = validateConfig({
      schema: "rex/v1",
      project: "myproject",
      adapter: "file",
      budget: { cost: -5 },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects config with warnAt above 100", () => {
    const result = validateConfig({
      schema: "rex/v1",
      project: "myproject",
      adapter: "file",
      budget: { warnAt: 150 },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects config with negative warnAt", () => {
    const result = validateConfig({
      schema: "rex/v1",
      project: "myproject",
      adapter: "file",
      budget: { warnAt: -10 },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts config with valid loe settings", () => {
    const result = validateConfig({
      schema: "rex/v1",
      project: "myproject",
      adapter: "file",
      loe: {
        taskThresholdWeeks: 3,
        maxDecompositionDepth: 2,
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.loe).toEqual({
        taskThresholdWeeks: 3,
        maxDecompositionDepth: 2,
      });
    }
  });

  it("accepts config with partial loe (only threshold)", () => {
    const result = validateConfig({
      schema: "rex/v1",
      project: "myproject",
      adapter: "file",
      loe: { taskThresholdWeeks: 1 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.loe!.taskThresholdWeeks).toBe(1);
      expect(result.data.loe!.maxDecompositionDepth).toBeUndefined();
    }
  });

  it("accepts config with fractional loe threshold", () => {
    const result = validateConfig({
      schema: "rex/v1",
      project: "myproject",
      adapter: "file",
      loe: { taskThresholdWeeks: 0.5 },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects config with negative loe threshold", () => {
    const result = validateConfig({
      schema: "rex/v1",
      project: "myproject",
      adapter: "file",
      loe: { taskThresholdWeeks: -1 },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects config with zero loe threshold", () => {
    const result = validateConfig({
      schema: "rex/v1",
      project: "myproject",
      adapter: "file",
      loe: { taskThresholdWeeks: 0 },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects config with negative decomposition depth", () => {
    const result = validateConfig({
      schema: "rex/v1",
      project: "myproject",
      adapter: "file",
      loe: { maxDecompositionDepth: -1 },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects config with non-integer decomposition depth", () => {
    const result = validateConfig({
      schema: "rex/v1",
      project: "myproject",
      adapter: "file",
      loe: { maxDecompositionDepth: 1.5 },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts config without loe (backward compat)", () => {
    const result = validateConfig({
      schema: "rex/v1",
      project: "myproject",
      adapter: "file",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.loe).toBeUndefined();
    }
  });

  it("accepts config without budget (backward compat)", () => {
    const result = validateConfig({
      schema: "rex/v1",
      project: "myproject",
      adapter: "file",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.budget).toBeUndefined();
    }
  });

  it("accepts config without model (backward compat)", () => {
    const result = validateConfig({
      schema: "rex/v1",
      project: "myproject",
      adapter: "file",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.model).toBeUndefined();
    }
  });

  it("preserves unknown config fields", () => {
    const result = validateConfig({
      schema: "rex/v1",
      project: "myproject",
      adapter: "file",
      customSetting: "yes",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as Record<string, unknown>).customSetting).toBe("yes");
    }
  });

  it("rejects config missing project", () => {
    const result = validateConfig({
      schema: "rex/v1",
      adapter: "file",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects config missing adapter", () => {
    const result = validateConfig({
      schema: "rex/v1",
      project: "myproject",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects config missing schema", () => {
    const result = validateConfig({
      project: "myproject",
      adapter: "file",
    });
    expect(result.ok).toBe(false);
  });
});

describe("validateLogEntry", () => {
  it("accepts a valid log entry", () => {
    const result = validateLogEntry({
      timestamp: "2024-01-01T00:00:00Z",
      event: "item_added",
      itemId: "t1",
      detail: "Added task",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts minimal log entry", () => {
    const result = validateLogEntry({
      timestamp: "2024-01-01T00:00:00Z",
      event: "session_start",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects log entry missing timestamp", () => {
    const result = validateLogEntry({
      event: "item_added",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects log entry missing event", () => {
    const result = validateLogEntry({
      timestamp: "2024-01-01T00:00:00Z",
    });
    expect(result.ok).toBe(false);
  });

  it("preserves unknown log fields", () => {
    const result = validateLogEntry({
      timestamp: "2024-01-01T00:00:00Z",
      event: "custom",
      extraField: { nested: true },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as Record<string, unknown>).extraField).toEqual({
        nested: true,
      });
    }
  });
});

describe("formatValidationErrors", () => {
  it("formats field-level errors with path", () => {
    const result = validateConfig({
      schema: "rex/v1",
      adapter: "file",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const messages = formatValidationErrors(result.errors);
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0]).toContain("project");
    }
  });

  it("includes nested paths for item validation errors", () => {
    const result = validateDocument({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "t1",
          title: "Task",
          status: "bad_status",
          level: "task",
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const messages = formatValidationErrors(result.errors);
      expect(messages.some((m) => m.includes("status"))).toBe(true);
    }
  });

  it("provides actionable messages for budget validation", () => {
    const result = validateConfig({
      schema: "rex/v1",
      project: "test",
      adapter: "file",
      budget: { tokens: -1 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const messages = formatValidationErrors(result.errors);
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.some((m) => m.includes("budget"))).toBe(true);
    }
  });
});
