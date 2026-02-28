import { describe, it, expect } from "vitest";
import {
  resolveSchedulingPriority,
  extractPriorityFromTags,
} from "../../../src/queue/priority-scheduler.js";
import type { TaskPriorityMetadata } from "../../../src/queue/priority-scheduler.js";

describe("extractPriorityFromTags", () => {
  it("returns undefined when tags is undefined", () => {
    expect(extractPriorityFromTags(undefined)).toBeUndefined();
  });

  it("returns undefined when tags is empty", () => {
    expect(extractPriorityFromTags([])).toBeUndefined();
  });

  it("extracts priority from 'priority:high' tag format", () => {
    expect(extractPriorityFromTags(["priority:high"])).toBe("high");
    expect(extractPriorityFromTags(["priority:critical"])).toBe("critical");
    expect(extractPriorityFromTags(["priority:low"])).toBe("low");
    expect(extractPriorityFromTags(["priority:medium"])).toBe("medium");
  });

  it("maps 'urgent' tag to critical priority", () => {
    expect(extractPriorityFromTags(["urgent"])).toBe("critical");
  });

  it("maps 'important' tag to high priority", () => {
    expect(extractPriorityFromTags(["important"])).toBe("high");
  });

  it("ignores unrelated tags", () => {
    expect(extractPriorityFromTags(["frontend", "refactor", "v2"])).toBeUndefined();
  });

  it("uses first matching tag when multiple priority tags exist", () => {
    expect(extractPriorityFromTags(["priority:high", "priority:low"])).toBe("high");
  });

  it("priority: tag takes precedence over keyword tags", () => {
    expect(extractPriorityFromTags(["priority:low", "urgent"])).toBe("low");
  });

  it("ignores invalid priority:value tags", () => {
    expect(extractPriorityFromTags(["priority:extreme"])).toBeUndefined();
  });

  it("is case-insensitive for tag values", () => {
    expect(extractPriorityFromTags(["priority:HIGH"])).toBe("high");
    expect(extractPriorityFromTags(["URGENT"])).toBe("critical");
    expect(extractPriorityFromTags(["Important"])).toBe("high");
  });
});

describe("resolveSchedulingPriority", () => {
  it("returns medium when no metadata is provided", () => {
    expect(resolveSchedulingPriority({})).toBe("medium");
  });

  it("uses task explicit priority when available", () => {
    const meta: TaskPriorityMetadata = { taskPriority: "high" };
    expect(resolveSchedulingPriority(meta)).toBe("high");
  });

  it("uses tag-derived priority when explicit priority is absent", () => {
    const meta: TaskPriorityMetadata = { tags: ["urgent"] };
    expect(resolveSchedulingPriority(meta)).toBe("critical");
  });

  it("explicit priority takes precedence over tags", () => {
    const meta: TaskPriorityMetadata = {
      taskPriority: "low",
      tags: ["urgent"],
    };
    expect(resolveSchedulingPriority(meta)).toBe("low");
  });

  describe("CLI override", () => {
    it("overrides explicit task priority", () => {
      const meta: TaskPriorityMetadata = {
        taskPriority: "low",
        cliOverride: "critical",
      };
      expect(resolveSchedulingPriority(meta)).toBe("critical");
    });

    it("overrides tag-derived priority", () => {
      const meta: TaskPriorityMetadata = {
        tags: ["urgent"],
        cliOverride: "low",
      };
      expect(resolveSchedulingPriority(meta)).toBe("low");
    });

    it("overrides default when no other metadata", () => {
      const meta: TaskPriorityMetadata = { cliOverride: "high" };
      expect(resolveSchedulingPriority(meta)).toBe("high");
    });

    it("normalizes invalid override to medium", () => {
      const meta: TaskPriorityMetadata = { cliOverride: "super-urgent" };
      expect(resolveSchedulingPriority(meta)).toBe("medium");
    });
  });

  describe("priority resolution order", () => {
    it("follows order: CLI override > task priority > tag priority > default", () => {
      // All present: CLI override wins
      expect(
        resolveSchedulingPriority({
          cliOverride: "low",
          taskPriority: "high",
          tags: ["urgent"],
        }),
      ).toBe("low");

      // No CLI override: task priority wins
      expect(
        resolveSchedulingPriority({
          taskPriority: "high",
          tags: ["urgent"],
        }),
      ).toBe("high");

      // No CLI override, no task priority: tag wins
      expect(
        resolveSchedulingPriority({
          tags: ["important"],
        }),
      ).toBe("high");

      // Nothing: default medium
      expect(resolveSchedulingPriority({})).toBe("medium");
    });
  });

  it("handles undefined priority gracefully", () => {
    const meta: TaskPriorityMetadata = { taskPriority: undefined };
    expect(resolveSchedulingPriority(meta)).toBe("medium");
  });
});
