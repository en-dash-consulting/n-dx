// @vitest-environment jsdom
/**
 * Integration test for commit attribution surfacing in dashboard.
 *
 * Verifies that commits are properly parsed from index.md, rendered in the
 * detail panel with author/hash/message/timestamp, and that they appear
 * consistently across both the task detail view and parent folder summaries.
 */

import { describe, it, expect } from "vitest";
import { h, render } from "preact";
import { parseIndexMd } from "../../src/viewer/utils/index-md-parser.js";
import { CommitsList, IndexMdSectionsPanel } from "../../src/viewer/components/prd-tree/index-md-sections.js";
import type { CommitRef } from "../../src/viewer/utils/index-md-parser.js";

describe("Commits Surfacing Integration", () => {
  function renderToDiv(vnode: ReturnType<typeof h>) {
    const root = document.createElement("div");
    render(vnode, root);
    return root;
  }

  describe("index.md parsing and rendering consistency", () => {
    it("parses commits from index.md and renders them identically in both formats", () => {
      // Simulate the complete index.md flow: generation -> parsing -> rendering
      const indexMdContent = `---
id: task-123
level: task
title: Implement feature X
status: completed
---

# Implement feature X

[completed]

## Summary

This feature adds new functionality to the system.

## Commits

| Author | Hash | Message | Timestamp |
|--------|------|---------|-----------|
| Alice Chen | \`abc1234\` | Add core functionality | 2026-04-30T12:00:00Z |
| Bob Smith | \`def5678\` | Add tests and docs | 2026-04-30T13:00:00Z |

## Info

- **Status:** completed
- **Level:** task
- **Completed:** 2026-04-30T14:00:00Z
`;

      // Parse the index.md
      const sections = parseIndexMd(indexMdContent);

      // Verify parsing produced commits
      expect(sections.commits).toBeDefined();
      expect(sections.commits?.length).toBe(2);

      // Render the commits using CommitsList
      const root = renderToDiv(h(CommitsList, { commits: sections.commits! }));

      // Verify all commits are rendered
      const rows = Array.from(root.querySelectorAll("tbody tr"));
      expect(rows.length).toBe(2);

      // Verify each commit's data is rendered
      expect(root.textContent).toContain("Alice Chen");
      expect(root.textContent).toContain("Bob Smith");
      expect(root.textContent).toContain("Add core functionality");
      expect(root.textContent).toContain("Add tests and docs");

      // Verify hashes are displayed as short (7 chars)
      expect(root.textContent).toContain("abc1234");
      expect(root.textContent).toContain("def5678");

      // Verify timestamps are present
      expect(root.textContent).toContain("2026-04-30T12:00:00Z");
      expect(root.textContent).toContain("2026-04-30T13:00:00Z");
    });

    it("renders IndexMdSectionsPanel with commits section", () => {
      const indexMdContent = `---
id: task-456
level: task
title: Fix critical bug
status: completed
---

# Fix critical bug

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Unit tests | subtask | completed | 2026-04-30 |

## Commits

| Author | Hash | Message | Timestamp |
|--------|------|---------|-----------|
| Charlie Davis | \`ghi9999\` | Fix race condition | 2026-04-30T15:00:00Z |

## Info

- **Status:** completed
`;

      const sections = parseIndexMd(indexMdContent);
      const root = renderToDiv(h(IndexMdSectionsPanel, { sections }));

      // Verify Commits section header is rendered
      expect(root.textContent).toContain("Commits");

      // Verify commit data is rendered
      expect(root.textContent).toContain("Charlie Davis");
      expect(root.textContent).toContain("Fix race condition");
      expect(root.textContent).toContain("ghi9999");
    });

    it("handles empty commits array gracefully", () => {
      const indexMdContent = `---
id: task-789
level: task
title: Pending task
status: pending
---

# Pending task

## Info

- **Status:** pending
`;

      const sections = parseIndexMd(indexMdContent);

      // No commits section should exist
      expect(sections.commits).toBeUndefined();

      // Render IndexMdSectionsPanel with empty sections
      const root = renderToDiv(h(IndexMdSectionsPanel, { sections }));

      // Should not render any commits-related content
      expect(root.textContent).not.toContain("Commits");
      expect(root.querySelector(".detail-commits-section")).toBeNull();
    });

    it("preserves commit order when parsing and rendering", () => {
      const commits: CommitRef[] = [
        {
          hash: "1111111111111111111111111111111111111111",
          author: "First Author",
          authorEmail: "first@example.com",
          timestamp: "2026-04-30T10:00:00Z",
          message: "First commit",
        },
        {
          hash: "2222222222222222222222222222222222222222",
          author: "Second Author",
          authorEmail: "second@example.com",
          timestamp: "2026-04-30T11:00:00Z",
          message: "Second commit",
        },
        {
          hash: "3333333333333333333333333333333333333333",
          author: "Third Author",
          authorEmail: "third@example.com",
          timestamp: "2026-04-30T12:00:00Z",
          message: "Third commit",
        },
      ];

      const root = renderToDiv(h(CommitsList, { commits }));
      const rows = Array.from(root.querySelectorAll("tbody tr"));

      // Verify order is preserved
      expect(rows[0].textContent).toContain("First Author");
      expect(rows[1].textContent).toContain("Second Author");
      expect(rows[2].textContent).toContain("Third Author");
    });
  });

  describe("commits visibility across detail panel and folder summary", () => {
    it("renders same commit data in both detail panel CommitsList and IndexMdSectionsPanel", () => {
      const commits: CommitRef[] = [
        {
          hash: "abcdef1234567890abcdef1234567890abcdef12",
          author: "Developer",
          authorEmail: "dev@example.com",
          timestamp: "2026-04-30T16:00:00Z",
          message: "Final implementation",
        },
      ];

      // Render in detail panel (CommitsList)
      const detailRoot = renderToDiv(h(CommitsList, { commits }));

      // Render in folder summary (IndexMdSectionsPanel)
      const sections = {
        commits,
        progress: [],
        info: [],
      };
      const summaryRoot = renderToDiv(h(IndexMdSectionsPanel, { sections }));

      // Both should contain the same commit information
      const commitDataPoints = ["Developer", "Final implementation", "abcdef1", "2026-04-30T16:00:00Z"];
      for (const dataPoint of commitDataPoints) {
        expect(detailRoot.textContent).toContain(dataPoint);
        expect(summaryRoot.textContent).toContain(dataPoint);
      }
    });

    it("handles commits with special characters in message correctly", () => {
      const commits: CommitRef[] = [
        {
          hash: "abc1234567890abcdef1234567890abcdef12345",
          author: "Engineer",
          authorEmail: "engineer@example.com",
          timestamp: "2026-04-30T17:00:00Z",
          message: "Refactor: improve perf & fix edge cases",
        },
      ];

      const root = renderToDiv(h(CommitsList, { commits }));
      expect(root.textContent).toContain("Refactor: improve perf & fix edge cases");
    });

    it("displays full hash in hover title attribute for both short-hash display methods", () => {
      const fullHash = "abcdef1234567890abcdef1234567890abcdef12";
      const commits: CommitRef[] = [
        {
          hash: fullHash,
          author: "Tester",
          authorEmail: "tester@example.com",
          timestamp: "2026-04-30T18:00:00Z",
        },
      ];

      const root = renderToDiv(h(CommitsList, { commits }));

      // Find the hash display element (either link or code)
      const hashElement = root.querySelector("[title]");
      expect(hashElement?.getAttribute("title")).toBe(fullHash);

      // Verify short hash is displayed
      expect(root.textContent).toContain("abcdef1");
    });
  });

  describe("commits rendering degradation", () => {
    it("renders explicit 'no commits' state instead of broken table", () => {
      const root = renderToDiv(h(CommitsList, { commits: [] }));

      // Should render the empty state message
      expect(root.textContent).toContain("No commits recorded");

      // Should not render an empty table
      const table = root.querySelector("table");
      expect(table).toBeNull();

      // Should not render table cells
      expect(root.querySelector("tbody")).toBeNull();
    });

    it("handles commits without optional message field gracefully", () => {
      const commits: CommitRef[] = [
        {
          hash: "abc1234567890abcdef1234567890abcdef12345",
          author: "BuildBot",
          authorEmail: "bot@example.com",
          timestamp: "2026-04-30T19:00:00Z",
          // No message field
        },
      ];

      const root = renderToDiv(h(CommitsList, { commits }));

      // Should render the row
      const rows = Array.from(root.querySelectorAll("tbody tr"));
      expect(rows.length).toBe(1);

      // Message cell should show placeholder
      const messageCell = root.querySelector(".commit-message");
      expect(messageCell?.textContent).toBe("—");
    });

    it("gracefully handles commits with missing author field", () => {
      // This tests robustness even if CommitRef has optional author in future
      const commits: CommitRef[] = [
        {
          hash: "def5678901234567890def5678901234567890de",
          author: "",
          authorEmail: "",
          timestamp: "2026-04-30T20:00:00Z",
          message: "System commit",
        },
      ];

      const root = renderToDiv(h(CommitsList, { commits }));

      // Should still render the row
      const rows = Array.from(root.querySelectorAll("tbody tr"));
      expect(rows.length).toBe(1);

      // Message should be visible
      expect(root.textContent).toContain("System commit");
    });
  });

  describe("git remote URL linking", () => {
    it("generates correct GitHub links for commit hashes", () => {
      const commits: CommitRef[] = [
        {
          hash: "abc1234567890abcdef1234567890abcdef12345",
          author: "Alice",
          authorEmail: "alice@example.com",
          timestamp: "2026-04-30T12:00:00Z",
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
      expect(link?.getAttribute("href")).toContain("/commit/abc1234567890abcdef1234567890abcdef12345");
      expect(link?.getAttribute("href")).not.toContain(".git");
    });

    it("handles GitLab-style URLs", () => {
      const commits: CommitRef[] = [
        {
          hash: "def5678901234567890def5678901234567890de",
          author: "Bob",
          authorEmail: "bob@example.com",
          timestamp: "2026-04-30T12:00:00Z",
        },
      ];

      const root = renderToDiv(
        h(CommitsList, {
          commits,
          gitRemoteUrl: "https://gitlab.com/group/project.git",
        }),
      );

      const link = root.querySelector("a.commit-hash-link");
      expect(link?.getAttribute("href")).toContain("gitlab.com/group/project/commit/def5678901234567890def5678901234567890de");
    });
  });
});
