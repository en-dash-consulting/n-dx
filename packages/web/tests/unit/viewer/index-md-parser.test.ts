// @vitest-environment jsdom
/**
 * Unit tests for index.md markdown parser.
 */

import { describe, it, expect } from "vitest";
import { h, render } from "preact";
import {
  parseIndexMd,
  type IndexMdSections,
} from "../../../src/viewer/utils/index-md-parser.js";
import { CommitsList } from "../../../src/viewer/components/prd-tree/index-md-sections.js";
import type { CommitRef } from "../../../src/viewer/utils/index-md-parser.js";

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

| Author | Hash | Message | Timestamp |
|--------|------|---------|-----------|
| Alice | \`abc123\` | Initial implementation | 2026-04-28T10:00:00Z |
| Bob | \`def456\` | Bug fix | 2026-04-29T11:00:00Z |

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
      expect(sections.commits?.[0].author).toBe("Alice");
      expect(sections.commits?.[0].message).toBe("Initial implementation");
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

    it("parses commits list correctly (legacy bullet format)", () => {
      const markdown = `## Commits

- \`abc1234567890\` — First commit (2026-04-25)
- \`def9876543210\` — Second commit (2026-04-26)
`;

      const sections = parseIndexMd(markdown);

      expect(sections.commits).toHaveLength(2);
      expect(sections.commits?.[0].hash).toBe("abc1234567890");
      expect(sections.commits?.[0].message).toBe("First commit");
      expect(sections.commits?.[0].timestamp).toBe("2026-04-25");
      expect(sections.commits?.[0].author).toBe("unknown"); // Legacy format
    });

    it("parses commits table format correctly", () => {
      const markdown = `## Commits

| Author | Hash | Message | Timestamp |
|--------|------|---------|-----------|
| John Doe | \`abc1234\` | Add feature | 2026-04-30T12:00:00Z |
| Jane Smith | \`def5678\` | Fix bug | 2026-04-30T13:00:00Z |
`;

      const sections = parseIndexMd(markdown);

      expect(sections.commits).toHaveLength(2);
      expect(sections.commits?.[0].author).toBe("John Doe");
      expect(sections.commits?.[0].hash).toBe("abc1234");
      expect(sections.commits?.[0].message).toBe("Add feature");
      expect(sections.commits?.[0].timestamp).toBe("2026-04-30T12:00:00Z");
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

    it("handles commits with short hashes", () => {
      const markdown = `## Commits

| Author | Hash | Message | Timestamp |
|--------|------|---------|-----------|
| Charlie | \`cc3333\` | Fix issue | 2026-04-30T15:00:00Z |
`;

      const sections = parseIndexMd(markdown);

      expect(sections.commits).toBeDefined();
      expect(sections.commits).toHaveLength(1);
      expect(sections.commits?.[0].author).toBe("Charlie");
      expect(sections.commits?.[0].hash).toBe("cc3333");
    });

    it("returns undefined for non-table commit content", () => {
      const markdown = `## Commits

No commits recorded
`;

      const sections = parseIndexMd(markdown);

      // When commits content doesn't match expected formats, no commits are returned
      expect(sections.commits).toBeUndefined();
    });
  });
});

describe("CommitsList component rendering", () => {
  function renderToDiv(vnode: ReturnType<typeof h>) {
    const root = document.createElement("div");
    render(vnode, root);
    return root;
  }

  it("renders empty state when no commits are provided", () => {
    const root = renderToDiv(h(CommitsList, { commits: [] }));
    expect(root.textContent).toContain("No commits recorded");
    expect(root.querySelector("table")).toBeNull();
  });

  it("renders a table with correct column headers", () => {
    const commits: CommitRef[] = [
      {
        hash: "abc1234567890abcdef1234567890abcdef12345",
        author: "John Doe",
        authorEmail: "john@example.com",
        timestamp: "2026-04-30T12:00:00Z",
        message: "Add feature X",
      },
    ];

    const root = renderToDiv(h(CommitsList, { commits }));
    const table = root.querySelector("table");
    expect(table).not.toBeNull();

    const headers = Array.from(table!.querySelectorAll("thead th")).map((h) => h.textContent);
    expect(headers).toContain("Author");
    expect(headers).toContain("Hash");
    expect(headers).toContain("Message");
    expect(headers).toContain("Timestamp");
  });

  it("renders commit data correctly in table rows", () => {
    const commits: CommitRef[] = [
      {
        hash: "abc1234567890abcdef1234567890abcdef12345",
        author: "John Doe",
        authorEmail: "john@example.com",
        timestamp: "2026-04-30T12:00:00Z",
        message: "Add feature X",
      },
    ];

    const root = renderToDiv(h(CommitsList, { commits }));
    expect(root.textContent).toContain("John Doe");
    expect(root.textContent).toContain("Add feature X");
    expect(root.textContent).toContain("2026-04-30T12:00:00Z");
  });

  it("renders short hash (7 characters) in table", () => {
    const commits: CommitRef[] = [
      {
        hash: "abc1234567890abcdef1234567890abcdef12345",
        author: "Alice",
        authorEmail: "alice@example.com",
        timestamp: "2026-04-30T12:00:00Z",
      },
    ];

    const root = renderToDiv(h(CommitsList, { commits }));
    const hashCells = Array.from(root.querySelectorAll(".commit-hash-cell"));
    expect(hashCells[0].textContent).toContain("abc1234");
  });

  it("provides full hash in title attribute for hover preview", () => {
    const fullHash = "abc1234567890abcdef1234567890abcdef12345";
    const commits: CommitRef[] = [
      {
        hash: fullHash,
        author: "Bob",
        authorEmail: "bob@example.com",
        timestamp: "2026-04-30T12:00:00Z",
      },
    ];

    const root = renderToDiv(h(CommitsList, { commits }));
    const hashElement = root.querySelector("[title]");
    expect(hashElement?.getAttribute("title")).toBe(fullHash);
  });

  it("renders linked hash when gitRemoteUrl is provided", () => {
    const commits: CommitRef[] = [
      {
        hash: "abc1234567890abcdef1234567890abcdef12345",
        author: "Charlie",
        authorEmail: "charlie@example.com",
        timestamp: "2026-04-30T12:00:00Z",
        message: "Fix bug Y",
      },
    ];

    const root = renderToDiv(
      h(CommitsList, {
        commits,
        gitRemoteUrl: "https://github.com/example/repo.git",
      }),
    );

    const link = root.querySelector("a.commit-hash-link");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toContain("abc1234567890abcdef1234567890abcdef12345");
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("handles multiple commits correctly", () => {
    const commits: CommitRef[] = [
      {
        hash: "111111111111111111111111111111111111111",
        author: "User1",
        authorEmail: "user1@example.com",
        timestamp: "2026-04-30T12:00:00Z",
        message: "First commit",
      },
      {
        hash: "222222222222222222222222222222222222222",
        author: "User2",
        authorEmail: "user2@example.com",
        timestamp: "2026-04-30T13:00:00Z",
        message: "Second commit",
      },
    ];

    const root = renderToDiv(h(CommitsList, { commits }));
    const rows = Array.from(root.querySelectorAll("tbody tr"));
    expect(rows.length).toBe(2);
  });

  it("handles commits without messages gracefully", () => {
    const commits: CommitRef[] = [
      {
        hash: "abc1234567890abcdef1234567890abcdef12345",
        author: "David",
        authorEmail: "david@example.com",
        timestamp: "2026-04-30T12:00:00Z",
      },
    ];

    const root = renderToDiv(h(CommitsList, { commits }));
    const messageCell = root.querySelector(".commit-message");
    expect(messageCell?.textContent).toBe("—");
  });
});
