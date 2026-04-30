// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { h, render } from "preact";
import { CommitsList } from "../../../src/viewer/components/prd-tree/index-md-sections.js";
import type { CommitRef } from "../../../src/viewer/utils/index-md-parser.js";

describe("CommitsList", () => {
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

  it("renders a table with the correct column headers", () => {
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

  it("renders commit data in table rows", () => {
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
    // Short hash should be present
    expect(root.textContent).toContain("abc1234");
  });

  it("renders short hash (first 7 characters) in table", () => {
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
    expect(hashCells.length).toBeGreaterThan(0);
    expect(hashCells[0].textContent).toContain("abc1234");
    // Full hash should be in title attribute
    expect(hashCells[0].querySelector("code")?.getAttribute("title")).toBe(
      "abc1234567890abcdef1234567890abcdef12345",
    );
  });

  it("renders linked hash when gitRemoteUrl is provided", () => {
    const commits: CommitRef[] = [
      {
        hash: "abc1234567890abcdef1234567890abcdef12345",
        author: "Bob",
        authorEmail: "bob@example.com",
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
    expect(link?.textContent).toBe("abc1234");
  });

  it("handles multiple commits correctly", () => {
    const commits: CommitRef[] = [
      {
        hash: "111111111111111111111111111111111111111",
        author: "Alice",
        authorEmail: "alice@example.com",
        timestamp: "2026-04-30T12:00:00Z",
        message: "First commit",
      },
      {
        hash: "222222222222222222222222222222222222222",
        author: "Bob",
        authorEmail: "bob@example.com",
        timestamp: "2026-04-30T13:00:00Z",
        message: "Second commit",
      },
      {
        hash: "333333333333333333333333333333333333333",
        author: "Charlie",
        authorEmail: "charlie@example.com",
        timestamp: "2026-04-30T14:00:00Z",
      },
    ];

    const root = renderToDiv(h(CommitsList, { commits }));
    const rows = Array.from(root.querySelectorAll("tbody tr"));
    expect(rows.length).toBe(3);

    // Check each row
    expect(rows[0].textContent).toContain("Alice");
    expect(rows[0].textContent).toContain("First commit");

    expect(rows[1].textContent).toContain("Bob");
    expect(rows[1].textContent).toContain("Second commit");

    expect(rows[2].textContent).toContain("Charlie");
    expect(rows[2].textContent).toContain("—"); // No message, should show dash
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

  it("strips .git suffix from remote URL", () => {
    const commits: CommitRef[] = [
      {
        hash: "abc1234567890abcdef1234567890abcdef12345",
        author: "Eve",
        authorEmail: "eve@example.com",
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
    expect(link?.getAttribute("href")).toContain("github.com/example/repo/commit/");
    expect(link?.getAttribute("href")).not.toContain(".git");
  });

  it("provides full hash in title attribute for hover preview", () => {
    const fullHash = "abc1234567890abcdef1234567890abcdef12345";
    const commits: CommitRef[] = [
      {
        hash: fullHash,
        author: "Frank",
        authorEmail: "frank@example.com",
        timestamp: "2026-04-30T12:00:00Z",
      },
    ];

    const root = renderToDiv(h(CommitsList, { commits }));
    const hashElement = root.querySelector("[title]");
    expect(hashElement?.getAttribute("title")).toBe(fullHash);
  });
});
