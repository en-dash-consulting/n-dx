import { describe, it, expect } from "vitest";
import { formatDiff } from "../../../src/analyze/diff.js";
import type { Proposal } from "../../../src/analyze/propose.js";
import type { PRDItem } from "../../../src/schema/v1.js";

function makeItem(overrides: Partial<PRDItem> & { title: string; level: PRDItem["level"] }): PRDItem {
  return {
    id: "test-id",
    status: "pending",
    ...overrides,
  };
}

describe("formatDiff", () => {
  it("shows all proposals as additions when PRD is empty", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Auth", source: "file-import" },
        features: [
          {
            title: "Login",
            source: "file-import",
            tasks: [
              { title: "Validate email", source: "file-import", sourceFile: "spec.json" },
            ],
          },
        ],
      },
    ];

    const diff = formatDiff(proposals, []);

    expect(diff).toContain("+ [epic] Auth");
    expect(diff).toContain("+   [feature] Login");
    expect(diff).toContain("+     [task] Validate email");
  });

  it("marks existing epics that match proposals", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Auth", source: "file-import" },
        features: [
          {
            title: "Login",
            source: "file-import",
            tasks: [
              { title: "Validate email", source: "file-import", sourceFile: "spec.json" },
            ],
          },
        ],
      },
    ];

    const existing: PRDItem[] = [
      makeItem({
        title: "Auth",
        level: "epic",
        children: [],
      }),
    ];

    const diff = formatDiff(proposals, existing);

    // Epic exists but will get new children added under it
    expect(diff).toContain("~ [epic] Auth");
    expect(diff).toContain("+   [feature] Login");
    expect(diff).toContain("+     [task] Validate email");
  });

  it("marks existing features under existing epics", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Auth", source: "file-import" },
        features: [
          {
            title: "Login",
            source: "file-import",
            tasks: [
              { title: "New task", source: "file-import", sourceFile: "spec.json" },
            ],
          },
          {
            title: "Signup",
            source: "file-import",
            tasks: [],
          },
        ],
      },
    ];

    const existing: PRDItem[] = [
      makeItem({
        title: "Auth",
        level: "epic",
        children: [
          makeItem({
            title: "Login",
            level: "feature",
            children: [],
          }),
        ],
      }),
    ];

    const diff = formatDiff(proposals, existing);

    expect(diff).toContain("~ [epic] Auth");
    expect(diff).toContain("~   [feature] Login");
    expect(diff).toContain("+     [task] New task");
    expect(diff).toContain("+   [feature] Signup");
  });

  it("marks existing tasks as unchanged", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Auth", source: "file-import" },
        features: [
          {
            title: "Login",
            source: "file-import",
            tasks: [
              { title: "Validate email", source: "file-import", sourceFile: "spec.json" },
              { title: "New task", source: "file-import", sourceFile: "spec.json" },
            ],
          },
        ],
      },
    ];

    const existing: PRDItem[] = [
      makeItem({
        title: "Auth",
        level: "epic",
        children: [
          makeItem({
            title: "Login",
            level: "feature",
            children: [
              makeItem({ title: "Validate email", level: "task" }),
            ],
          }),
        ],
      }),
    ];

    const diff = formatDiff(proposals, existing);

    expect(diff).toContain("=     [task] Validate email");
    expect(diff).toContain("+     [task] New task");
  });

  it("shows summary counts", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Auth", source: "file-import" },
        features: [
          {
            title: "Login",
            source: "file-import",
            tasks: [
              { title: "Validate email", source: "file-import", sourceFile: "spec.json" },
            ],
          },
        ],
      },
      {
        epic: { title: "Dashboard", source: "file-import" },
        features: [
          {
            title: "Charts",
            source: "file-import",
            tasks: [],
          },
        ],
      },
    ];

    const diff = formatDiff(proposals, []);

    // 2 epics + 2 features + 1 task = 5 additions
    expect(diff).toContain("5 to add");
  });

  it("handles case-insensitive matching", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "auth", source: "file-import" },
        features: [
          {
            title: "login flow",
            source: "file-import",
            tasks: [],
          },
        ],
      },
    ];

    const existing: PRDItem[] = [
      makeItem({
        title: "Auth",
        level: "epic",
        children: [
          makeItem({ title: "Login Flow", level: "feature", children: [] }),
        ],
      }),
    ];

    const diff = formatDiff(proposals, existing);

    // Both exist, no new children → both marked as unchanged
    expect(diff).toContain("= [epic] auth");
    expect(diff).toContain("=   [feature] login flow");
    expect(diff).toContain("2 unchanged");
  });

  it("shows priority on tasks when present", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Auth", source: "file-import" },
        features: [
          {
            title: "Login",
            source: "file-import",
            tasks: [
              {
                title: "Validate email",
                source: "file-import",
                sourceFile: "spec.json",
                priority: "high",
              },
            ],
          },
        ],
      },
    ];

    const diff = formatDiff(proposals, []);

    expect(diff).toContain("+     [task] Validate email [high]");
  });

  it("returns empty diff for empty proposals", () => {
    const diff = formatDiff([], []);

    expect(diff).toContain("No changes");
  });

  it("handles multiple epics with mixed existing/new", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Auth", source: "file-import" },
        features: [
          { title: "Login", source: "file-import", tasks: [] },
        ],
      },
      {
        epic: { title: "Billing", source: "file-import" },
        features: [
          { title: "Payments", source: "file-import", tasks: [] },
        ],
      },
    ];

    const existing: PRDItem[] = [
      makeItem({ title: "Auth", level: "epic", children: [] }),
    ];

    const diff = formatDiff(proposals, existing);

    expect(diff).toContain("~ [epic] Auth");
    expect(diff).toContain("+ [epic] Billing");
    expect(diff).toContain("+   [feature] Login");
    expect(diff).toContain("+   [feature] Payments");
  });

  it("counts unchanged items separately from additions", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Auth", source: "file-import" },
        features: [
          {
            title: "Login",
            source: "file-import",
            tasks: [
              { title: "Existing task", source: "file-import", sourceFile: "spec.json" },
              { title: "New task", source: "file-import", sourceFile: "spec.json" },
            ],
          },
        ],
      },
    ];

    const existing: PRDItem[] = [
      makeItem({
        title: "Auth",
        level: "epic",
        children: [
          makeItem({
            title: "Login",
            level: "feature",
            children: [
              makeItem({ title: "Existing task", level: "task" }),
            ],
          }),
        ],
      }),
    ];

    const diff = formatDiff(proposals, existing);

    expect(diff).toContain("1 to add");
    expect(diff).toContain("1 unchanged");
  });
});
