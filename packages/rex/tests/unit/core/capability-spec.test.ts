import { describe, it, expect } from "vitest";
import type { ItemLevel, ItemStatus, PRDItem } from "../../../src/schema/v1.js";
import { RequirementSchema } from "../../../src/schema/validate.js";
import { CapabilityIntentSchema } from "../../../src/schema/v2.js";
import { classifyV1Tree } from "../../../src/core/migration-plan.js";
import { draftCapabilitySpecs, toEars, type CapabilitySpecDraft } from "../../../src/core/capability-spec.js";

let seq = 0;
function item(level: ItemLevel, title: string, children: PRDItem[] = [], status: ItemStatus = "completed", extra: Partial<PRDItem> = {}): PRDItem {
  seq += 1;
  return { id: `${level}-${seq}`, level, title, status, children, ...extra };
}

const TEST_FILES = [
  "packages/rex/tests/unit/core/next-task.test.ts",
  "packages/rex/tests/unit/core/claim-release.test.ts",
  "packages/rex/tests/unit/core/priority-ordering.test.ts",
  "packages/web/tests/unit/live-tab.test.ts",
];

function tree(): PRDItem[] {
  return [
    item("epic", "Rex", [
      item(
        "feature",
        "Task selection",
        [
          item("task", "Add priority ordering", [], "completed", { acceptanceCriteria: ["Tasks are ordered by priority ordering rules (test)"] }),
          item("task", "Release claims on exit", [], "pending", { acceptanceCriteria: ["Claims are released on exit"] }),
          item("task", "Fix stale claims", [item("subtask", "Expire claims", [], "completed", { acceptanceCriteria: ["When a claim is stale, the selector skips it"] })]),
        ],
        "completed",
        {
          description: "Picks the next actionable task by priority and dependencies. More detail follows here.",
          acceptanceCriteria: ["Selection honours blockedBy","tasks are ordered by priority ordering rules"],
        },
      ),
      item("feature", "Live tab", [item("task", "Show runs")], "completed", { description: "Add a live tab to the dashboard." }),
    ]),
  ];
}

function draft(items = tree(), options: Parameters<typeof draftCapabilitySpecs>[2] = { testFiles: TEST_FILES }): CapabilitySpecDraft[] {
  return draftCapabilitySpecs(classifyV1Tree(items), items, options);
}

function spec(specs: readonly CapabilitySpecDraft[], title: string): CapabilitySpecDraft {
  const found = specs.find((s) => s.title === title);
  if (!found) throw new Error(`no spec titled ${title}`);
  return found;
}

describe("toEars", () => {
  it("keeps EARS-shaped text and wraps the rest in the ubiquitous form", () => {
    expect(toEars("When a claim is stale, the selector skips it")).toBe("When a claim is stale, the selector skips it.");
    expect(toEars("The CLI shall exit 0.")).toBe("The CLI shall exit 0.");
    expect(toEars("Every v1 item appears in the plan (test)")).toBe("The system shall ensure that every v1 item appears in the plan.");
    expect(toEars("MCP writes go to the worktree")).toBe("The system shall ensure that MCP writes go to the worktree.");
  });

  it("drops a test marker that ends in punctuation", () => {
    expect(toEars("The task stays claimed (tests).")).toBe("The system shall ensure that the task stays claimed.");
    expect(toEars("Reads agree on a live claim (test);")).toBe("The system shall ensure that reads agree on a live claim.");
  });
});

describe("draftCapabilitySpecs", () => {
  it("drafts a statement for every capability in the plan, marked unreviewed", () => {
    const items = tree();
    const plan = classifyV1Tree(items);
    const specs = draftCapabilitySpecs(plan, items, { testFiles: TEST_FILES });
    const capabilities = plan.entries.filter((e) => e.target === "capability").map((e) => e.id);
    expect(capabilities.length).toBe(2);
    expect(specs.map((s) => s.capability)).toEqual(capabilities);
    for (const s of specs) {
      expect(s.statement.trim()).not.toBe("");
      expect(s.specReviewed).toBe(false);
    }
  });

  it("states the capability in present tense from its description, or from its title when the description is work", () => {
    const specs = draft();
    expect(spec(specs, "Task selection").statement).toBe("Picks the next actionable task by priority and dependencies.");
    const live = spec(specs, "Live tab");
    expect(live.statement).toBe("The product provides live tab.");
    expect(live.notes.join(" ")).toMatch(/drafted from the title/);
  });

  it("draws EARS criteria from the capability and its applied history, deduplicated, never from unfinished work", () => {
    const s = spec(draft(), "Task selection");
    expect(s.criteria.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(s.criteria.map((c) => c.text)).toEqual([
      "The system shall ensure that selection honours blockedBy.",
      "The system shall ensure that tasks are ordered by priority ordering rules.",
      "When a claim is stale, the selector skips it.",
    ]);
    expect(s.criteria.map((c) => c.text).join(" ")).not.toMatch(/released on exit/);
    expect(s.sources[0]).toBe(s.capability);
    expect(s.sources.map((id) => id.replace(/-\d+$/, ""))).toEqual(["feature", "task", "task", "subtask"]);
  });

  it("turns a criterion with matching tests into an automated requirement", () => {
    const s = spec(draft(tree(), { testFiles: TEST_FILES, testCommand: "pnpm vitest run" }), "Task selection");
    const ordered = s.criteria[1];
    expect(ordered.requirement).toBeDefined();
    expect(s.requirements).toHaveLength(1);
    const [req] = s.requirements;
    expect(req).toMatchObject({
      id: ordered.requirement,
      validationType: "automated",
      acceptanceCriteria: [ordered.text],
      validationCommand: "pnpm vitest run packages/rex/tests/unit/core/priority-ordering.test.ts",
    });
    expect(RequirementSchema.safeParse(req).success).toBe(true);
    // No test file shares two words with it, so it stays unlinked.
    expect(s.criteria[0].requirement).toBeUndefined();
  });

  it("links on file names only, and not on a wide tie", () => {
    const items = [
      item("epic", "Rex", [
        item("feature", "Claim handling", [], "completed", {
          description: "Holds tasks for one worktree.",
          // Every path holds "packages", "rex", "core" and "unit"; no file name does.
          acceptanceCriteria: ["Rex core packages keep unit coverage", "Claim release frees the claim"],
        }),
      ]),
    ];
    const wide = ["a", "b", "c", "d"].map((d) => `packages/${d}/tests/claim-release.test.ts`);
    const [dirWords] = draft(items, { testFiles: TEST_FILES });
    expect(dirWords.criteria[0].requirement).toBeUndefined();
    expect(dirWords.criteria[1].requirement).toBeDefined();
    const [tied] = draft(items, { testFiles: wide });
    expect(tied.requirements).toEqual([]);
  });

  it("falls back to the title when the description opens with metadata, a reference or a fragment", () => {
    const descriptions = [
      "**Severity:** medium — **Verdict:** should-fix (captured from a review).",
      "Verdict: must-fix. The rest explains.",
      "GitHub #368. Details follow.",
      "## Summary\nPicks tasks.",
    ];
    for (const description of descriptions) {
      const items = [item("epic", "Rex", [item("feature", "Claim handling", [item("task", "Hold claims")], "completed", { description })])];
      const [s] = draft(items);
      expect(s.statement, description).toBe("The product provides claim handling.");
      expect(s.notes.join(" ")).toMatch(/drafted from the title/);
    }
  });

  it("does not cut a statement at an abbreviation", () => {
    const description = "Records the transition in the commit message (e.g. completed or failing) for every run. More text.";
    const items = [item("epic", "Rex", [item("feature", "Commit trailers", [item("task", "Write trailers")], "completed", { description })])];
    expect(draft(items)[0].statement).toBe("Records the transition in the commit message (e.g. completed or failing) for every run.");
  });

  it("keeps a Title Case name as written in a title-drafted statement", () => {
    const items = [item("epic", "Hench", [item("feature", "Runtime Prompt Tightening", [item("task", "Cut sections")])])];
    expect(draft(items)[0].statement).toBe("The product provides Runtime Prompt Tightening.");
  });

  it("leaves the command off when no test command is given, naming the tests instead", () => {
    const [req] = spec(draft(), "Task selection").requirements;
    expect(req.validationCommand).toBeUndefined();
    expect(req.description).toMatch(/priority-ordering\.test\.ts/);
  });

  it("carries sourcevision code evidence and flags a capability with none", () => {
    const items = tree();
    const selection = items[0].children![0].id;
    const specs = draft(items, { testFiles: TEST_FILES, codeFiles: { [selection]: ["packages/rex/src/core/next-task.ts"] } });
    expect(spec(specs, "Task selection").codeFiles).toEqual(["packages/rex/src/core/next-task.ts"]);
    expect(spec(specs, "Live tab").notes.join(" ")).toMatch(/no code or test evidence/);
  });

  it("fits the v2 capability intent shape", () => {
    for (const s of draft(tree(), { testFiles: TEST_FILES, testCommand: "vitest run" })) {
      const parsed = CapabilityIntentSchema.safeParse({
        id: s.capability,
        type: "capability",
        title: s.title,
        slug: "x",
        statement: s.statement,
        criteria: s.criteria,
        requirements: s.requirements,
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("is deterministic", () => {
    const items = tree();
    expect(draft(items)).toEqual(draft(structuredClone(items)));
  });
});
