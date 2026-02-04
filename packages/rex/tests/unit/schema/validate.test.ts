import { describe, it, expect } from "vitest";
import {
  validateDocument,
  validateConfig,
  validateLogEntry,
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
