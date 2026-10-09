import { describe, it, expect } from "vitest";
import type { ItemLevel, ItemStatus, PRDItem } from "../../../../src/schema/v1.js";
import { RequirementSchema } from "../../../../src/schema/validate.js";
import { CapabilityIntentSchema } from "../../../../src/schema/v2.js";
import { classifyV1Tree } from "../../../../src/migrations/v1-to-v2/migration-plan.js";
import { draftCapabilitySpecs, isPresentTenseStatement, isProcessCriterion, toEars, type CapabilitySpecDraft } from "../../../../src/migrations/v1-to-v2/capability-spec.js";

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

  it("gives a verb-led criterion its subject in the base form", () => {
    expect(toEars("removes dead exports")).toBe("The system shall remove dead exports.");
    expect(toEars("Records the transition (test)")).toBe("The system shall record the transition.");
    expect(toEars("applies the plan once")).toBe("The system shall apply the plan once.");
    expect(toEars("matches criteria to tests")).toBe("The system shall match criteria to tests.");
  });

  it("treats a capitalised verb-led criterion, as v1 criteria are written, the same way", () => {
    expect(toEars("Removes dead exports")).toBe("The system shall remove dead exports.");
    expect(toEars("Applies patch updates automatically")).toBe("The system shall apply patch updates automatically.");
    expect(toEars("Shows why a task was skipped")).toBe("The system shall show why a task was skipped.");
    expect(toEars("Skips invalid entries (test)")).toBe("The system shall skip invalid entries.");
  });

  it("keeps a capitalised plural subject followed by a relative, preposition, participle or auxiliary", () => {
    expect(toEars("Runs that fail are retried")).toBe("The system shall ensure that runs that fail are retried.");
    expect(toEars("Runs from other worktrees appear")).toBe("The system shall ensure that runs from other worktrees appear.");
    expect(toEars("Records written before the fix still load")).toBe("The system shall ensure that records written before the fix still load.");
    expect(toEars("Log entries are kept")).toBe("The system shall ensure that log entries are kept.");
  });

  it("keeps a plural subject that looks like a verb as the subject", () => {
    expect(toEars("Logs are kept for a week")).toBe("The system shall ensure that logs are kept for a week.");
    expect(toEars("Runs show their model")).toBe("The system shall ensure that runs show their model.");
    expect(toEars("Claims expire after an hour")).toBe("The system shall ensure that claims expire after an hour.");
  });
});

describe("isPresentTenseStatement", () => {
  // Statements the 2026-10-09 full-tree live run rejected; the task records three verbatim,
  // the rest are written in the same shape (product vocabulary, or an opening code span).
  const VALID = [
    "Hench refuses to mark a task completed while the task's work is still uncommitted",
    "`ndx self-heal` persists its recommendations into the PRD as tagged items",
    "Rex stores each PRD item at a readable, title-only slug path",
    "Rex reports the change a run made as a diff against the PRD tree",
    "`ndx work` picks the next item whose dependencies are completed",
    "The dashboard links each task to the PR that closed it",
    "`rex status` prints the completion tree for every epic",
    "Hench commits the item's files after the task gate passes",
  ];

  it.each(VALID)("accepts %s", (s) => {
    expect(isPresentTenseStatement(s)).toBe(true);
  });

  it.each([
    "This feature will add X",
    "We need to support Y",
    "Add a Z",
    "TODO: wire the gateway",
    "This task adds the gateway to every package",
    "The dashboard should list every run",
  ])("rejects work- or wish-shaped %s", (s) => {
    expect(isPresentTenseStatement(s)).toBe(false);
  });

  it.each(["# Heading about the dashboard runs", "- a list item about runs", "| a | table | row | here |", "Severity: high for every run", "**Severity:** high for every run"])(
    "rejects metadata %s",
    (s) => {
      expect(isPresentTenseStatement(s)).toBe(false);
    },
  );

  it("rejects an undefined sentence", () => {
    expect(isPresentTenseStatement(undefined)).toBe(false);
  });
});

describe("isProcessCriterion", () => {
  it("recognises tests passing, docs updated, a changeset, a clean build and review", () => {
    for (const text of [
      "All tests pass",
      "Existing tests pass (test)",
      "pnpm typecheck passes",
      "Docs are updated",
      "README updated with the new flag",
      "Changeset added",
      "Add a changeset",
      "Add unit tests for the parser",
      "No type errors",
      "PR is reviewed",
      "The system shall ensure that all tests pass.",
    ]) {
      expect(isProcessCriterion(text), text).toBe(true);
    }
  });

  it("leaves product behaviour that mentions tests or docs alone", () => {
    for (const text of ["The test gate runs the affected suites", "Failing tests block completion", "The docs view lists every page"]) {
      expect(isProcessCriterion(text), text).toBe(false);
    }
  });
});

describe("draftCapabilitySpecs", () => {
  it("drafts a spec for every capability in the plan, with no retired specReviewed field", () => {
    const items = tree();
    const plan = classifyV1Tree(items);
    const specs = draftCapabilitySpecs(plan, items, { testFiles: TEST_FILES });
    const capabilities = plan.entries.filter((e) => e.target === "capability").map((e) => e.id);
    expect(capabilities.length).toBe(2);
    expect(specs.map((s) => s.capability)).toEqual(capabilities);
    for (const s of specs) {
      expect(s).not.toHaveProperty("specReviewed");
      expect(s).not.toHaveProperty("draftedBy");
    }
  });

  it("states the capability in present tense from its description, and asks for a statement when the description is work", () => {
    const specs = draft();
    expect(spec(specs, "Task selection").statement).toBe("Picks the next actionable task by priority and dependencies.");
    const live = spec(specs, "Live tab");
    expect(live.statement).toBeUndefined();
    expect(live.notes.join(" ")).toMatch(/no present-tense statement/);
  });

  it("does not copy a description that describes the work or a wish", () => {
    for (const description of [
      "This feature adds a live view of runs.",
      "Currently the dashboard shows nothing while a run is live.",
      "The dashboard will show live runs as they happen.",
      "Users cannot see which run is live today.",
    ]) {
      const items = [item("epic", "Web", [item("feature", "Live runs", [item("task", "Show runs")], "completed", { description })])];
      expect(draft(items)[0].statement, description).toBeUndefined();
    }
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
    expect(s.criteria.map((c) => c.source.replace(/-\d+$/, ""))).toEqual(["feature", "feature", "subtask"]);
    for (const c of s.criteria) expect(s.sources).toContain(c.source);
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

  it("leaves process criteria out of the spec", () => {
    const items = [
      item("epic", "Rex", [
        item("feature", "Claim handling", [], "completed", {
          description: "Holds tasks for one worktree.",
          acceptanceCriteria: ["Claims expire after an hour", "Existing tests pass", "Docs are updated", "Changeset added"],
        }),
      ]),
    ];
    expect(draft(items)[0].criteria.map((c) => c.text)).toEqual(["The system shall ensure that claims expire after an hour."]);
  });

  it("links tests only in the packages of the capability's code files", () => {
    const items = [
      item("epic", "Hench", [
        item("feature", "Prompt sections", [], "completed", {
          description: "Builds the agent prompt from sections.",
          acceptanceCriteria: ["Workspace prompt sections are trimmed"],
        }),
      ]),
    ];
    const testFiles = ["packages/web/tests/unit/workspace-prompt-sections.test.ts", "packages/hench/tests/unit/prompt-sections.test.ts"];
    const [unscoped] = draft(items, { testFiles });
    expect(unscoped.tests).toEqual(["packages/web/tests/unit/workspace-prompt-sections.test.ts"]);
    const id = items[0].children![0].id;
    const [scoped] = draft(items, { testFiles, codeFiles: { [id]: ["packages/hench/src/agent/prompt.ts"] } });
    expect(scoped.tests).toEqual(["packages/hench/tests/unit/prompt-sections.test.ts"]);
    expect(scoped.criteria[0].tests).toEqual(scoped.tests);
  });

  it("still links repository-level tests for a package with no suite of its own", () => {
    const items = [
      item("epic", "Core", [
        item("feature", "Spawn guard", [], "completed", {
          description: "Guards every child process the CLI spawns.",
          acceptanceCriteria: ["Shell spawn inventory lists every spawn"],
        }),
      ]),
    ];
    const testFiles = ["tests/e2e/shell-spawn-inventory.test.js", "packages/web/tests/unit/shell-spawn-inventory.test.ts"];
    const id = items[0].children![0].id;
    const [s] = draft(items, { testFiles, codeFiles: { [id]: ["packages/core/cli.js"] } });
    expect(s.tests).toEqual(["tests/e2e/shell-spawn-inventory.test.js"]);
  });

  it("has no statement when the description opens with metadata, a reference or a fragment", () => {
    const descriptions = [
      "**Severity:** medium — **Verdict:** should-fix (captured from a review).",
      "Verdict: must-fix. The rest explains.",
      "GitHub #368. Details follow.",
      "## Summary\nPicks tasks.",
    ];
    for (const description of descriptions) {
      const items = [item("epic", "Rex", [item("feature", "Claim handling", [item("task", "Hold claims")], "completed", { description })])];
      const [s] = draft(items);
      expect(s.statement, description).toBeUndefined();
      expect(s.notes.join(" ")).toMatch(/no present-tense statement/);
    }
  });

  it("does not cut a statement at an abbreviation", () => {
    const description = "Records the transition in the commit message (e.g. completed or failing) for every run. More text.";
    const items = [item("epic", "Rex", [item("feature", "Commit trailers", [item("task", "Write trailers")], "completed", { description })])];
    expect(draft(items)[0].statement).toBe("Records the transition in the commit message (e.g. completed or failing) for every run.");
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
