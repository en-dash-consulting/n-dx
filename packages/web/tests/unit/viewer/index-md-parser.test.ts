/**
 * Unit tests for index.md markdown parser.
 */

import { describe, it, expect } from "vitest";
import {
  parseIndexMd,
  type IndexMdSections,
} from "../../../src/viewer/utils/index-md-parser.js";

describe("index-md-parser", () => {
  describe("parseIndexMd", () => {
    it("parses complete index.md with all sections", () => {
      const markdown = `---
id: "test-id"
level: feature
title: "Test Feature"
---

# Test Feature

[completed]

## Summary

This is a test summary about the feature.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Child 1 | task | completed | 2026-04-30 |
| Child 2 | task | in_progress | 2026-04-29 |

## Commits

- \`abc123\` — Initial implementation (2026-04-28)
- \`def456\` — Bug fix (2026-04-29)

## Changes

- **Status changed:** in_progress → completed (2026-04-30T10:00:00Z)

## Info

- **Status:** completed
- **Level:** feature
- **Started:** 2026-04-28T10:00:00Z

## Subtask: Important subtask

**ID:** \`subtask-id\`
**Status:** completed
**Priority:** high

This is a subtask description.

**Acceptance Criteria**

- Criterion 1
- Criterion 2
`;

      const sections = parseIndexMd(markdown);

      expect(sections.summary).toBe("This is a test summary about the feature.");
      expect(sections.progress).toHaveLength(2);
      expect(sections.progress?.[0].title).toBe("Child 1");
      expect(sections.progress?.[0].status).toBe("completed");
      expect(sections.commits).toHaveLength(2);
      expect(sections.commits?.[0].hash).toBe("abc123");
      expect(sections.changes).toHaveLength(1);
      expect(sections.info).toHaveLength(3);
      expect(sections.subtasks).toHaveLength(1);
      expect(sections.subtasks?.[0].title).toBe("Important subtask");
    });

    it("handles missing sections gracefully", () => {
      const markdown = `# Test Item

## Summary

Just a summary, no other sections.
`;

      const sections = parseIndexMd(markdown);

      expect(sections.summary).toBe("Just a summary, no other sections.");
      expect(sections.progress).toBeUndefined();
      expect(sections.commits).toBeUndefined();
      expect(sections.changes).toBeUndefined();
    });

    it("parses progress table correctly", () => {
      const markdown = `## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Task Alpha | task | completed | 2026-04-30 |
| Task Beta | task | pending | 2026-04-29 |
| Task Gamma | feature | in_progress | 2026-04-28 |
`;

      const sections = parseIndexMd(markdown);

      expect(sections.progress).toHaveLength(3);
      expect(sections.progress?.[0]).toEqual({
        title: "Task Alpha",
        level: "task",
        status: "completed",
        lastUpdated: "2026-04-30",
      });
    });

    it("parses commits list correctly", () => {
      const markdown = `## Commits

- \`abc1234567890\` — First commit (2026-04-25)
- \`def9876543210\` — Second commit (2026-04-26)
`;

      const sections = parseIndexMd(markdown);

      expect(sections.commits).toHaveLength(2);
      expect(sections.commits?.[0]).toEqual({
        hash: "abc1234567890",
        message: "First commit",
        date: "2026-04-25",
      });
    });

    it("parses changes section correctly", () => {
      const markdown = `## Changes

- **Status changed:** pending → in_progress (2026-04-29T14:30:00Z)
- **Priority updated:** medium → high (2026-04-30T08:15:00Z)
`;

      const sections = parseIndexMd(markdown);

      expect(sections.changes).toHaveLength(2);
      expect(sections.changes?.[0]).toEqual({
        label: "Status changed",
        description: "pending → in_progress",
        timestamp: "2026-04-29T14:30:00Z",
      });
    });

    it("parses info section correctly", () => {
      const markdown = `## Info

- **Status:** completed
- **Priority:** high
- **Tags:** web, ui, prd
- **Level:** feature
`;

      const sections = parseIndexMd(markdown);

      expect(sections.info).toHaveLength(4);
      expect(sections.info?.[0]).toEqual({
        label: "Status",
        value: "completed",
      });
    });

    it("handles subtask sections with all fields", () => {
      const markdown = `## Subtask: Implement API endpoint

**ID:** \`sub-task-id-123\`
**Status:** in_progress
**Priority:** critical

This is the subtask description with details.

**Acceptance Criteria**

- API returns 200 OK
- Response includes required fields
- Error handling works correctly
`;

      const sections = parseIndexMd(markdown);

      expect(sections.subtasks).toHaveLength(1);
      const subtask = sections.subtasks?.[0];
      expect(subtask?.title).toBe("Implement API endpoint");
      expect(subtask?.status).toBe("in_progress");
      expect(subtask?.priority).toBe("critical");
      expect(subtask?.description).toContain("This is the subtask description");
      expect(subtask?.acceptanceCriteria).toHaveLength(3);
    });

    it("handles multiple subtasks", () => {
      const markdown = `## Subtask: First task

**ID:** \`id1\`
**Status:** completed

First description.

---

## Subtask: Second task

**ID:** \`id2\`
**Status:** pending

Second description.
`;

      const sections = parseIndexMd(markdown);

      expect(sections.subtasks).toHaveLength(2);
      expect(sections.subtasks?.[0].title).toBe("First task");
      expect(sections.subtasks?.[1].title).toBe("Second task");
    });

    it("provides fallback for malformed markdown", () => {
      const markdown = "This is not valid markdown";

      const sections = parseIndexMd(markdown);

      // Should include rawMarkdown as fallback
      expect(sections.rawMarkdown).toBe("This is not valid markdown");
    });

    it("handles empty markdown gracefully", () => {
      const markdown = "";

      const sections = parseIndexMd(markdown);

      expect(Object.keys(sections).length).toBe(0);
    });

    it("handles sections with trailing whitespace", () => {
      const markdown = `## Summary

This is a summary with trailing spaces.

## Info

- **Status:** completed
`;

      const sections = parseIndexMd(markdown);

      expect(sections.summary?.trim()).toBe("This is a summary with trailing spaces.");
      expect(sections.info).toBeDefined();
    });
  });
});
