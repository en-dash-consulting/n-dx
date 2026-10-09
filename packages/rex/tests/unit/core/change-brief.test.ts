/**
 * The agent brief built from a change and the product nodes it affects.
 *
 * ## Why snapshots
 *
 * The brief is prose assembled from a dozen sources, and almost everything that
 * can go wrong with it is invisible to an assertion on parsed output: a section
 * in the wrong place, a capability's inherited criteria missing, "acceptance
 * criteria" creeping back in where the vocabulary says "capability criteria" or
 * "done when". The snapshot is the artifact under test, so a reviewer reads the
 * whole brief rather than a list of claims about it.
 *
 * Three are recorded, one per shape the brief has to handle: a feature change
 * (an `added` amendment creates a capability that does not exist yet), a fix
 * (no amendment at all, and the capability it touches reads defective), and a
 * task-less change (the change is itself the unit of work, so there is no task
 * and no sibling list).
 */

import { describe, it, expect } from "vitest";
import {
  BRIEF_SECTIONS,
  BRIEF_TOKEN_BUDGET,
  buildChangeBrief,
  changeBriefSections,
  renderChangeBrief,
  RETENTION_ORDER,
  type BriefLogEntry,
  type ChangeBriefOptions,
} from "../../../src/core/change-brief.js";
import { findNextWork, resolveWorkById, type WorkUnit } from "../../../src/core/change-selection.js";
import { specHash, type RuleNode, type V2Tree } from "../../../src/schema/v2-rules.js";
import type { Amendment, Criterion } from "../../../src/schema/v2.js";
import type { Realization } from "../../../src/core/product-edges.js";

const node = (fields: Record<string, unknown>): RuleNode =>
  ({ title: fields.id as string, slug: fields.id as string, ...fields }) as RuleNode;

const criterion = (id: string, text: string): Criterion => ({ id, text });
const requirement = (id: string, title: string, acceptanceCriteria: string[] = []) => ({
  id,
  title,
  category: "technical" as const,
  validationType: "automated" as const,
  acceptanceCriteria,
});
const amend = (target: string, delta: Amendment["delta"], summary: string, extra: Partial<Amendment> = {}): Amendment => ({
  target,
  delta,
  summary,
  ...extra,
});

const STORE_CRITERIA = [criterion("c1", "Every PRD mutation writes the folder tree and nothing else")];
const TREE_CRITERIA = [criterion("c2", "An item is one directory with an index.md")];
const SEARCH_STATEMENT = "Items are searchable by title and tag.";
const SEARCH_CRITERIA = [criterion("c5", "A tag query returns every item carrying the tag")];

/**
 * One tree carrying every shape the brief renders: a capability that inherits
 * its parent's criteria, a reviewed spec and an unreviewed one, a constraint
 * bound to a subtree and one bound to everything, both `dependsOn` directions,
 * and four changes — a feature, a fix, a task-less change and an applied one
 * that only exists to be the brief's history.
 */
function fixture(): V2Tree {
  return {
    product: [
      node({
        id: "platform",
        type: "area",
        title: "Platform",
        summary: "PRD storage and the tools over it",
        children: [
          node({
            id: "prd-store",
            type: "capability",
            title: "PRD storage",
            displayId: "A1",
            statement: "The PRD is stored as a folder tree that git can diff.",
            criteria: STORE_CRITERIA,
            requirements: [requirement("r1", "No JSON backend", ["No PRD mutation writes prd.json"])],
            metAt: specHash({ statement: "The PRD is stored as a folder tree that git can diff.", criteria: STORE_CRITERIA }),
            reviewedHash: specHash({ statement: "The PRD is stored as a folder tree that git can diff.", criteria: STORE_CRITERIA }),
            children: [
              node({
                id: "folder-tree",
                type: "capability",
                title: "Folder tree layout",
                displayId: "A1.1",
                statement: "Each item is a directory with an index.md.",
                criteria: TREE_CRITERIA,
                requirements: [requirement("r2", "Slugs are frozen", ["A rename keeps the original slug"])],
                dependsOn: ["slug-registry"],
              }),
            ],
          }),
          node({
            id: "slug-registry",
            type: "capability",
            title: "Slug registry",
            statement: "Slugs are allocated once and never reused.",
            criteria: [criterion("c3", "A freed slug is never handed out again")],
          }),
          node({
            id: "bundle-export",
            type: "capability",
            title: "Bundle export",
            statement: "The PRD exports to a single transport JSON file.",
            criteria: [criterion("c4", "The bundle is never written inside .rex/")],
            dependsOn: ["folder-tree"],
          }),
          node({
            id: "search",
            type: "capability",
            title: "PRD search",
            statement: SEARCH_STATEMENT,
            criteria: SEARCH_CRITERIA,
            // Met, but a failing check makes it defective: the pair the fix
            // brief has to show, since neither value alone explains the work.
            metAt: specHash({ statement: SEARCH_STATEMENT, criteria: SEARCH_CRITERIA }),
            requirements: [requirement("r3", "Search is case-insensitive")],
            checks: [{ requirementId: "r3", result: "fail", at: "2026-10-01T00:00:00.000Z", detail: "uppercase tags miss" }],
          }),
        ],
      }),
      node({
        id: "no-legacy-writes",
        type: "constraint",
        title: "No legacy PRD writes",
        statement: "No mutation writes prd.md or prd.json.",
        appliesTo: ["prd-store"],
        requirements: [requirement("r4", "Legacy paths are refused", ["An export path inside .rex/ is refused"])],
      }),
      node({
        id: "cross-os",
        type: "constraint",
        title: "Cross-OS parity",
        statement: "Every command behaves the same on Linux, macOS and Windows.",
        appliesTo: "all",
      }),
    ],
    changes: [
      node({
        id: "ch-history",
        type: "change",
        title: "Freeze slugs at creation",
        displayId: "CH-100",
        status: "completed",
        appliedAt: "2026-09-01T00:00:00.000Z",
        shippedIn: "0.7.0",
        amends: [amend("folder-tree", "modified", "Slugs stop tracking the title")],
      }),
      node({
        id: "ch-feature",
        type: "change",
        title: "Import a PRD bundle",
        displayId: "CH-142",
        status: "in_progress",
        plannedRelease: "0.9.0",
        intent: "A bundle exported from one checkout can be imported into another.",
        lastModified: "2026-10-05T00:00:00.000Z",
        amends: [
          amend("bundle-import", "added", "Importing a bundle rebuilds the folder tree", {
            type: "capability",
            under: "prd-store",
            title: "Bundle import",
            proposed: "A bundle written by export rebuilds the folder tree through the normal store write path.",
            criteria: { add: [criterion("c1", "Import runs inside store.withTransaction")] },
          }),
          amend("folder-tree", "modified", "The layout accepts items created by an import", {
            criteria: { add: [criterion("c3", "An imported item is indistinguishable from an authored one")] },
          }),
        ],
        touches: ["bundle-export"],
        children: [
          node({
            id: "t-reader",
            type: "task",
            title: "Read a bundle into the store",
            displayId: "CH-142.1",
            status: "pending",
            priority: "high",
            description: "Parse the bundle and write every item through the store write path.",
            acceptanceCriteria: ["Round-trips an exported bundle", "Refuses a bundle with a schema stamp it cannot read"],
            tags: ["pr-19"],
          }),
          node({ id: "t-cli", type: "task", title: "Wire up the import command", status: "pending" }),
          node({ id: "t-done", type: "task", title: "Decide the bundle schema stamp", status: "completed" }),
        ],
      }),
      node({
        id: "ch-fix",
        type: "change",
        title: "Tag search misses uppercase tags",
        displayId: "CH-150",
        status: "pending",
        fix: true,
        intent: "A tag query must match regardless of case.",
        touches: ["search"],
        children: [
          node({
            id: "t-fold",
            type: "task",
            title: "Case-fold tags on both sides of the query",
            status: "pending",
            description: "Normalise the stored tag and the query before comparing.",
            acceptanceCriteria: ["An uppercase query matches a lowercase tag"],
          }),
        ],
      }),
      node({
        id: "ch-taskless",
        type: "change",
        title: "Move the export writer behind the store",
        displayId: "CH-160",
        status: "pending",
        intent: "The export writer reaches past the store today; route it through.",
        touches: ["bundle-export", "folder-tree"],
      }),
    ],
  };
}

function unitFor(tree: V2Tree, ref: string): WorkUnit {
  const unit = resolveWorkById(tree, ref);
  if (!unit) throw new Error(`fixture does not resolve work for "${ref}"`);
  return unit;
}

const LOG: BriefLogEntry[] = [
  { timestamp: "2026-10-08T12:00:00.000Z", event: "status_updated", detail: "Status changed to in_progress" },
  { timestamp: "2026-10-08T12:30:00.000Z", event: "run_started" },
];

const REALIZED: Record<string, Realization> = {
  "folder-tree": {
    commits: ["abc1234"],
    files: ["packages/rex/src/store/folder-tree-store.ts", "packages/rex/src/store/prd-model-writer.ts"],
    zones: ["rex-cli"],
  },
  "bundle-export": { commits: ["def5678"], files: ["packages/rex/src/store/prd-bundle-v2.ts"], zones: ["rex-cli"] },
};

function options(ref: string, overrides: Partial<ChangeBriefOptions> = {}): ChangeBriefOptions {
  const tree = fixture();
  return {
    tree,
    unit: unitFor(tree, ref),
    realizedBy: REALIZED,
    commands: { validate: "pnpm --filter @n-dx/rex run typecheck", test: "pnpm --filter @n-dx/rex exec vitest run" },
    workflow: "Run the scoped suite before committing.\nNever weaken a test to get green.",
    recentLog: LOG,
    ...overrides,
  };
}

describe("buildChangeBrief — golden briefs", () => {
  it("renders a feature change's task", () => {
    expect(renderChangeBrief(options("t-reader"))).toMatchSnapshot();
  });

  it("renders a fix", () => {
    expect(renderChangeBrief(options("t-fold"))).toMatchSnapshot();
  });

  it("renders a task-less change", () => {
    expect(renderChangeBrief(options("ch-taskless"))).toMatchSnapshot();
  });
});

describe("buildChangeBrief — what each shape carries", () => {
  it("names the work and labels a work item's criteria 'done when'", () => {
    const text = renderChangeBrief(options("t-reader"));
    expect(text).toContain("## Current task");
    expect(text).toContain("Done when:");
    expect(text).toContain("Round-trips an exported bundle");
    // The two vocabularies must stay apart: a capability promises, a task finishes.
    expect(text).not.toContain("Acceptance Criteria");
  });

  it("carries a capability's own and inherited criteria, labelled 'capability criteria'", () => {
    const text = renderChangeBrief(options("t-reader"));
    expect(text).toContain("Capability criteria:");
    expect(text).toContain("c2: An item is one directory with an index.md");
    // Inherited from the parent capability, and attributed to it.
    expect(text).toContain("c1: Every PRD mutation writes the folder tree and nothing else _(inherited from PRD storage)_");
  });

  it("reports health and whether the spec was reviewed", () => {
    const feature = renderChangeBrief(options("t-reader"));
    expect(feature).toContain("amended · changing · health ok · spec reviewed: no");

    // The touched capability has a failing check, so it reads defective.
    const fix = renderChangeBrief(options("t-fold"));
    expect(fix).toContain("touched · met · health defective · spec reviewed: no");
  });

  it("shows an added amendment's proposed text, since its target does not exist yet", () => {
    const text = renderChangeBrief(options("t-reader"));
    expect(text).toContain("**added** Bundle import under PRD storage (new capability)");
    expect(text).toContain("A bundle written by export rebuilds the folder tree through the normal store write path.");
    expect(text).toContain("add capability criterion c1: Import runs inside store.withTransaction");
  });

  it("lists the constraints binding the affected capabilities, including an appliesTo-all one", () => {
    const text = renderChangeBrief(options("t-reader"));
    expect(text).toContain("## Constraints that apply");
    expect(text).toContain("No legacy PRD writes");
    expect(text).toContain("Cross-OS parity");
    expect(text).toContain("_Binds every capability._");
  });

  it("lists depends-on neighbours one hop out, in both directions", () => {
    const text = renderChangeBrief(options("t-reader"));
    expect(text).toContain("Slug registry — this work depends on it");
    // bundle-export is itself touched by this change, so it is a capability,
    // not a neighbour; slug-registry is the only one hop away.
    expect(text).not.toContain("Bundle export — it depends on this work");

    const taskless = renderChangeBrief(options("ch-taskless"));
    expect(taskless).toContain("Slug registry — this work depends on it");
  });

  it("shows where the capabilities live in code", () => {
    const text = renderChangeBrief(options("t-reader"));
    expect(text).toContain("## Where these capabilities live in code");
    expect(text).toContain("packages/rex/src/store/folder-tree-store.ts");
    expect(text).toContain("Zones: rex-cli");
  });

  it("omits the realized-by section when no realizations were computed", () => {
    const brief = buildChangeBrief(options("t-reader", { realizedBy: undefined }));
    expect(brief.sections.map((s) => s.name)).not.toContain("realizedBy");
    expect(brief.text).not.toContain("## Where these capabilities live in code");
  });

  it("lists other changes to the same nodes, this one excluded, newest first", () => {
    const text = renderChangeBrief(options("t-reader"));
    expect(text).toContain("Move the export writer behind the store");
    expect(text).toContain("Freeze slugs at creation (CH-100)");
    expect(text).not.toContain("Import a PRD bundle (CH-142) —");
  });

  it("lists sibling tasks for a task, and none for a task-less change", () => {
    expect(renderChangeBrief(options("t-reader"))).toContain("## Sibling tasks in this change");
    const taskless = buildChangeBrief(options("ch-taskless"));
    expect(taskless.sections.map((s) => s.name)).not.toContain("siblings");
  });

  it("derives the change's kind from how it relates to the map", () => {
    expect(renderChangeBrief(options("t-reader"))).toContain("kind feature");
    expect(renderChangeBrief(options("t-fold"))).toContain("kind fix");
    expect(renderChangeBrief(options("ch-taskless"))).toContain("kind refactor");
  });

  it("briefs the unit autonomous selection would pick", () => {
    const tree = fixture();
    const next = findNextWork(tree);
    expect(next).not.toBeNull();
    const brief = buildChangeBrief({ tree, unit: next as WorkUnit });
    expect(brief.text).toContain(`ID: ${(next as WorkUnit).node.id}`);
  });
});

describe("buildChangeBrief — budget", () => {
  /** A tree whose product layer alone outruns the budget several times over. */
  function crowded(): V2Tree {
    const prose = (seed: string) => `${seed} `.repeat(60).trim();
    const capabilities = Array.from({ length: 14 }, (_, i) =>
      node({
        id: `cap-${i}`,
        type: "capability",
        title: `Capability ${i}`,
        statement: prose(`Capability ${i} promises something at length.`),
        // More than the static per-capability cap, so both trims are exercised.
        criteria: Array.from({ length: 20 }, (_, c) => criterion(`c${c}`, prose(`criterion ${c} of capability ${i}`))),
        requirements: [requirement(`r-${i}`, `Requirement ${i}`, [prose(`criterion for requirement ${i}`)])],
      }),
    );
    return {
      product: [
        node({ id: "area", type: "area", title: "Area", children: capabilities }),
        node({
          id: "big-constraint",
          type: "constraint",
          title: "A long constraint",
          statement: prose("This constraint says a great deal."),
          appliesTo: "all",
        }),
      ],
      changes: [
        node({
          id: "ch-big",
          type: "change",
          title: "Touch everything",
          intent: prose("This change has a long intent."),
          touches: capabilities.map((c) => c.id),
          children: [node({ id: "t-big", type: "task", title: "Do the work", status: "pending" })],
        }),
      ],
    };
  }

  function crowdedOptions(): ChangeBriefOptions {
    const tree = crowded();
    return {
      tree,
      unit: unitFor(tree, "t-big"),
      commands: { validate: "pnpm typecheck", test: "pnpm test" },
      workflow: "workflow line\n".repeat(400),
      recentLog: LOG,
    };
  }

  it("stays under the budget on a tree that dwarfs it", () => {
    const brief = buildChangeBrief(crowdedOptions());
    expect(brief.tokens).toBeLessThanOrEqual(BRIEF_TOKEN_BUDGET);
    expect(brief.overBudget).toBe(false);
  });

  it("trims the capability list in place rather than dropping the section", () => {
    const brief = buildChangeBrief(crowdedOptions());
    expect(brief.sections.map((s) => s.name)).toContain("capabilities");
    expect(brief.omitted).not.toContain("capabilities");
    expect(brief.text).toMatch(/… \d+ more capabilities not shown \(of 14\)/);
  });

  it("keeps capabilities and constraints while the tail goes", () => {
    // Tight enough that the trimmed product sections crowd out the tail.
    const brief = buildChangeBrief({ ...crowdedOptions(), budgetTokens: 1_200 });
    const kept = brief.sections.map((s) => s.name);
    expect(kept).toContain("capabilities");
    expect(kept).toContain("constraints");
    expect(brief.omitted).toContain("workflow");
    expect(brief.tokens).toBeLessThanOrEqual(1_200);
  });

  it("names every capability compactly when not one of them fits in full", () => {
    const brief = buildChangeBrief({ ...crowdedOptions(), budgetTokens: 2_500 });
    expect(brief.tokens).toBeLessThanOrEqual(2_500);
    // All fourteen are named, so the agent knows what is in play…
    for (let i = 0; i < 14; i++) expect(brief.text).toContain(`### Capability ${i}`);
    // …and is told their detail was withheld rather than absent.
    expect(brief.text).toContain("Listed without their detail to fit the budget");
    expect(brief.text).not.toContain("Capability criteria:");
  });

  it("says what it dropped, so a short brief does not read as the whole picture", () => {
    const brief = buildChangeBrief({ ...crowdedOptions(), budgetTokens: 1_200 });
    expect(brief.omitted.length).toBeGreaterThan(0);
    expect(brief.text).toContain("Sections not shown:");
    for (const name of brief.omitted) expect(brief.text).toContain(name);
    expect(brief.sections.at(-1)?.name).toBe("trimmed");
  });

  it("adds no trim note when everything fits", () => {
    const brief = buildChangeBrief(options("t-reader"));
    expect(brief.omitted).toEqual([]);
    expect(brief.text).not.toContain("Sections not shown:");
    expect(brief.tokens).toBeLessThanOrEqual(BRIEF_TOKEN_BUDGET);
  });

  it("honours a caller's budget", () => {
    const brief = buildChangeBrief(options("t-reader", { budgetTokens: 300 }));
    expect(brief.tokens).toBeLessThanOrEqual(300);
    expect(brief.omitted.length).toBeGreaterThan(0);
  });

  it("keeps the work even when it alone exceeds the budget, and says so", () => {
    const brief = buildChangeBrief(options("t-reader", { budgetTokens: 20 }));
    expect(brief.sections.map((s) => s.name)).toContain("task");
    expect(brief.sections.map((s) => s.name)).toContain("change");
    expect(brief.overBudget).toBe(true);
  });

  /**
   * The `change` section is required, so the budget admits it with no allowance
   * and never trims it. Every free-text field and every list inside it is
   * therefore a hole in the budget unless it is bounded: an unbounded one makes
   * the brief exceed its budget *and* crowds out the capabilities section, which
   * is the one the budget exists to protect. The crowded fixture above cannot
   * reach this — its long text all sits in sections the budget may trim.
   */
  describe("a change section that cannot be trimmed stays bounded", () => {
    function withChange(fields: Record<string, unknown>): ChangeBriefOptions {
      const caps = Array.from({ length: 6 }, (_, i) =>
        node({
          id: `cap-${i}`,
          type: "capability",
          title: `Capability ${i}`,
          statement: "A short promise.",
          criteria: [criterion("c1", "A short criterion.")],
        }),
      );
      const tree: V2Tree = {
        product: [node({ id: "area", type: "area", title: "Area", children: caps })],
        changes: [
          node({
            id: "ch-huge",
            type: "change",
            title: "A change with a great deal to say",
            intent: "Short intent.",
            children: [node({ id: "t-huge", type: "task", title: "Do it", status: "pending" })],
            ...fields,
          }),
        ],
      };
      return { tree, unit: unitFor(tree, "t-huge") };
    }

    const inBudget = (options: ChangeBriefOptions): void => {
      const brief = buildChangeBrief(options);
      expect(brief.tokens).toBeLessThanOrEqual(BRIEF_TOKEN_BUDGET);
      expect(brief.overBudget).toBe(false);
      // The section the budget protects survives, with its detail.
      expect(brief.sections.map((s) => s.name)).toContain("capabilities");
    };

    it("bounds an amendment's proposed text", () => {
      inBudget(
        withChange({
          amends: [amend("cap-0", "replaced", "Rewrite the promise", { proposed: "A proposed line.\n".repeat(3_000) })],
        }),
      );
    });

    it("bounds an amendment's summary", () => {
      inBudget(withChange({ amends: [amend("cap-0", "replaced", "s".repeat(40_000))] }));
    });

    it("bounds the criteria one amendment adds, replaces and removes", () => {
      inBudget(
        withChange({
          amends: [
            amend("cap-0", "replaced", "Rework the criteria", {
              criteria: {
                add: Array.from({ length: 400 }, (_, i) => criterion(`a${i}`, "An added criterion at some length. ".repeat(20))),
                replace: Array.from({ length: 400 }, (_, i) => criterion(`r${i}`, "A replacement criterion. ".repeat(20))),
                remove: Array.from({ length: 400 }, (_, i) => `x${i}`),
              },
            }),
          ],
        }),
      );
    });

    it("bounds the number of amendments", () => {
      inBudget(
        withChange({
          amends: Array.from({ length: 300 }, (_, i) =>
            amend(`cap-${i % 6}`, "replaced", `Amendment ${i} says something of ordinary length about the capability.`),
          ),
        }),
      );
    });

    function withTask(fields: Record<string, unknown>): ChangeBriefOptions {
      const options = withChange({ touches: ["cap-0"] });
      const task = options.tree.changes?.[0].children?.[0] as RuleNode;
      Object.assign(task, fields);
      return options;
    }

    it("bounds a task description", () => {
      inBudget(withTask({ description: "A long description paragraph. ".repeat(1_400) }));
    });

    it("bounds the failure reason the previous run wrote", () => {
      // hench writes this one, and a failed run's reason can carry a whole
      // error dump — the likeliest way a required section outgrows the budget.
      inBudget(withTask({ failureReason: "Error: something blew up at line 42.\n".repeat(1_100) }));
    });

    it("bounds the done-when list, the tags and the blockers", () => {
      inBudget(
        withTask({
          acceptanceCriteria: Array.from({ length: 600 }, (_, i) => `Criterion ${i} says something of ordinary length.`),
          tags: Array.from({ length: 300 }, (_, i) => `tag-number-${i}`),
          blockedBy: Array.from({ length: 200 }, (_, i) => `blocker-id-${i}`),
        }),
      );
    });

    it("bounds the touched-without-amending list", () => {
      const options = withChange({ touches: Array.from({ length: 2_000 }, (_, i) => `cap-${i % 6}`) });
      inBudget(options);
      // The count is still reported, so a trimmed list does not read as the whole set.
      expect(renderChangeBrief(options)).toMatch(/and \d+ more \(of 2000\)/);
    });
  });

  it("caps a long list inside a section even when the budget is unlimited", () => {
    const tree = crowded();
    const brief = buildChangeBrief({ tree, unit: unitFor(tree, "t-big"), budgetTokens: 1_000_000 });
    // Twenty criteria per capability, fifteen shown.
    expect(brief.text).toMatch(/… 5 more capability criteria not shown \(of 20\)/);
  });
});

describe("buildChangeBrief — one brief for every vendor", () => {
  // There is no vendor input to vary — `ChangeBriefOptions` has no model,
  // provider or vendor field — so the only way the two runs could diverge is
  // by taking different entry points to the same render. That is what these
  // cover: a CLI loop sending flat text and an API loop sending sections must
  // put the same bytes on the wire.
  it("joins its sections back into exactly the flat brief", () => {
    for (const ref of ["t-reader", "t-fold", "ch-taskless"]) {
      const sections = changeBriefSections(options(ref));
      expect(sections.map((s) => s.text).join("\n\n")).toBe(renderChangeBrief(options(ref)));
    }
  });

  it("renders the same bytes every time", () => {
    expect(renderChangeBrief(options("t-reader"))).toBe(renderChangeBrief(options("t-reader")));
  });
});

describe("brief section tables", () => {
  it("retains every section it renders", () => {
    expect([...RETENTION_ORDER].sort()).toEqual([...BRIEF_SECTIONS].sort());
  });
});
