import { describe, it, expect } from "vitest";
import type { ItemLevel, ItemStatus, PRDItem } from "../../../../src/schema/v1.js";
import {
  classifyV1Tree,
  hasWorkToken,
  isDeliveryEpic,
  isJobShaped,
  releaseToken,
  type PlanEntry,
} from "../../../../src/migrations/v1-to-v2/migration-plan.js";

let seq = 0;
function item(level: ItemLevel, title: string, children: PRDItem[] = [], status: ItemStatus = "completed", extra: Partial<PRDItem> = {}): PRDItem {
  seq += 1;
  return { id: `${level}-${seq}`, level, title, status, children, ...extra };
}

function ids(items: readonly PRDItem[]): string[] {
  return items.flatMap((i) => [i.id, ...ids(i.children ?? [])]);
}

function byTitle(entries: readonly PlanEntry[], title: string): PlanEntry {
  const entry = entries.find((e) => e.title === title);
  if (!entry) throw new Error(`no entry titled ${title}`);
  return entry;
}

describe("title tokens", () => {
  it("reads a release version", () => {
    expect(releaseToken("ndx 0.9.0")).toBe("0.9.0");
    expect(releaseToken("0.6.0 / PR 4 · Vendor CLI spawns")).toBe("0.6.0");
    expect(releaseToken("ndx 0.7.1 · Trust and measurement")).toBe("0.7.1");
    expect(releaseToken("Release v1.2")).toBe("1.2");
    expect(releaseToken("Cross-OS Behavioral Parity")).toBeUndefined();
    expect(releaseToken("Wave 1 of 2")).toBeUndefined();
  });

  it("does not read a dependency or runtime version as a release", () => {
    expect(releaseToken("Python 3.12 support")).toBeUndefined();
    expect(releaseToken("Upgrade to Vitest 4.1")).toBeUndefined();
    expect(releaseToken("Node 22.1 runtime")).toBeUndefined();
    expect(releaseToken("n-dx 1.0 · Launch")).toBe("1.0");
  });

  it("classifies a version-numbered epic that is not a release as an area", () => {
    for (const title of ["Python 3.12 support", "Upgrade to Vitest 4.1"]) {
      expect(isDeliveryEpic(title)).toBe(false);
      const plan = classifyV1Tree([item("epic", title, [item("feature", "Something", [item("task", "Do it")])])]);
      expect(plan.entries.find((e) => e.title === title)?.target).toBe("area");
      expect(plan.entries.some((e) => e.plannedRelease !== undefined)).toBe(false);
    }
  });

  it("reads the caller's product name as a release prefix", () => {
    expect(releaseToken("Acme 2.0")).toBeUndefined();
    expect(releaseToken("Acme 2.0", ["acme"])).toBe("2.0");
    expect(releaseToken("MyApp 2.0 launch", ["acme", "myapp"])).toBe("2.0");
    expect(releaseToken("Python 3.12 support", ["acme"])).toBeUndefined();
    const plan = classifyV1Tree([item("epic", "Acme 2.0", [item("feature", "Billing", [item("task", "Do it")])])], { productNames: ["acme"] });
    expect(plan.entries.find((e) => e.title === "Acme 2.0")?.target).toBe("release");
    const billing = plan.entries.find((e) => e.title === "Billing");
    expect(billing?.target).toBe("change");
    expect(billing?.plannedRelease).toBe("2.0");
  });

  it("escapes regex metacharacters in a product name", () => {
    expect(() => releaseToken("C++ 2.0", ["c++", "(", "[x"])).not.toThrow();
    expect(releaseToken("C++ 2.0", ["c++"])).toBe("2.0");
    expect(releaseToken("Cxx 2.0", ["c++"])).toBeUndefined();
  });

  it("reads a PR or issue token", () => {
    expect(hasWorkToken("0.8.0 / PR 15 · Hub admission gate")).toBe(true);
    expect(hasWorkToken("Hotfix · #499 MCP servers")).toBe(true);
    expect(hasWorkToken("Phase 2 PR #3 · run settings")).toBe(true);
    expect(hasWorkToken("Product map and change layer")).toBe(false);
    expect(hasWorkToken("C# support")).toBe(false);
  });

  it("names job-shaped area titles", () => {
    expect(isJobShaped("Plan work")).toBe(true);
    expect(isJobShaped("Running agents")).toBe(true);
    expect(isJobShaped("Rex")).toBe(false);
    expect(isJobShaped("Web Dashboard")).toBe(false);
  });
});

describe("classifyV1Tree", () => {
  const tree = (): PRDItem[] => [
    item("epic", "ndx 0.9.0", [
      item("feature", "Prepare task: run one task from Work", [item("task", "Build the modal", [item("subtask", "Wire defaults")])]),
      item("task", "The hub sends no per-user token"),
    ]),
    item("epic", "ndx 0.7.2 · Hotfix", [item("feature", "Keep the LoE")]),
    item("epic", "0.6.0 / PR 4 · Vendor CLI spawns run in the project directory", [
      item("feature", "createLLMClient honours cwd", [item("task", "Pass cwd", [item("subtask", "Test it")])]),
    ]),
    item("epic", "Hotfix · #473 forked task sessions refuse to edit", [item("task", "Allow edits")]),
    item("epic", "Rex", [
      item("feature", "Task selection", [item("task", "Add priority ordering"), item("task", "Fix stale claims")]),
      item("feature", "Fix claim leak across worktrees", [item("task", "Release on exit")]),
      item("feature", "Add bulk import", [], "pending"),
      item("feature", "Folder tree storage", [], "pending"),
      item("feature", "Gateway isolation", [item("task", "Enforce boundaries")]),
      item("task", "Task selection skips claimed tasks"),
      item("task", "Selection latency"),
    ]),
    item("epic", "Security & Data Safety", [item("feature", "Token redaction", [item("task", "Redact headers")])]),
    item("epic", "Autonomous run reliability: four defects found", [item("feature", "Runs leak child processes")]),
  ];

  it("gives every v1 item exactly one entry with a target", () => {
    const items = tree();
    const plan = classifyV1Tree(items);
    expect(plan.entries.map((e) => e.id)).toEqual(ids(items));
    for (const e of plan.entries) expect(e.target).toBeTruthy();
    const total = Object.values(plan.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(ids(items).length);
  });

  it("never turns a release-named epic into an area", () => {
    const releaseNamed = [
      "ndx 0.9.0",
      "ndx 0.8.0 · Find your way",
      "ndx 0.7.2 · Hotfix",
      "0.6.0 / PR 1 · ndx start never kills a peer dashboard",
      "0.8.0 / PR 13 · Workspaces Overview view",
      "Hotfix · #499 MCP servers write to the main checkout",
      "Fix · #539 hench runs the full test suite",
      "Release v1.2",
    ];
    for (const title of releaseNamed) {
      expect(isDeliveryEpic(title)).toBe(true);
      const plan = classifyV1Tree([item("epic", title, [item("feature", "Something", [item("task", "Do it")])])]);
      expect(plan.entries.filter((e) => e.target === "area")).toEqual([]);
      expect(plan.areas).toEqual([]);
    }
  });

  it("dissolves a release umbrella and splits it per child, each a change with plannedRelease", () => {
    const plan = classifyV1Tree(tree());
    const epic = byTitle(plan.entries, "ndx 0.9.0");
    expect(epic.target).toBe("release");
    expect(epic.plannedRelease).toBe("0.9.0");

    const feature = byTitle(plan.entries, "Prepare task: run one task from Work");
    expect(feature).toMatchObject({ target: "change", plannedRelease: "0.9.0", applied: true });
    expect(feature.parent).toBeUndefined();
    expect(byTitle(plan.entries, "Build the modal")).toMatchObject({ target: "task", parent: feature.id });
    expect(byTitle(plan.entries, "Wire defaults")).toMatchObject({ target: "subtask" });
    expect(byTitle(plan.entries, "The hub sends no per-user token")).toMatchObject({ target: "change", plannedRelease: "0.9.0" });
  });

  it("turns a PR- or issue-named epic into one change, flattening below the task", () => {
    const plan = classifyV1Tree(tree());
    const epic = byTitle(plan.entries, "0.6.0 / PR 4 · Vendor CLI spawns run in the project directory");
    expect(epic).toMatchObject({ target: "change", plannedRelease: "0.6.0" });
    const feature = byTitle(plan.entries, "createLLMClient honours cwd");
    expect(feature).toMatchObject({ target: "task", parent: epic.id });
    const task = byTitle(plan.entries, "Pass cwd");
    expect(task).toMatchObject({ target: "subtask", parent: feature.id });
    expect(byTitle(plan.entries, "Test it")).toMatchObject({ target: "subtask", parent: feature.id });

    const hotfix = byTitle(plan.entries, "Hotfix · #473 forked task sessions refuse to edit");
    expect(hotfix.target).toBe("change");
    expect(hotfix.plannedRelease).toBeUndefined();
  });

  it("turns other epics into areas and shapes their features", () => {
    const plan = classifyV1Tree(tree());
    const rex = byTitle(plan.entries, "Rex");
    expect(rex.target).toBe("area");

    const selection = byTitle(plan.entries, "Task selection");
    expect(selection).toMatchObject({ target: "capability", parent: rex.id });
    expect(byTitle(plan.entries, "Add priority ordering")).toMatchObject({ target: "change", placement: selection.id, relation: "amends", applied: true });
    expect(byTitle(plan.entries, "Fix stale claims")).toMatchObject({ target: "change", placement: selection.id, relation: "touches" });

    const fix = byTitle(plan.entries, "Fix claim leak across worktrees");
    expect(fix).toMatchObject({ target: "change", relation: "touches", applied: true });
    expect(byTitle(plan.entries, "Release on exit")).toMatchObject({ target: "task", parent: fix.id });

    expect(byTitle(plan.entries, "Add bulk import")).toMatchObject({ target: "change", relation: "amends", applied: false });
    expect(byTitle(plan.entries, "Folder tree storage")).toMatchObject({ target: "change", needsPlacement: true, applied: false });
  });

  it("places a change on a clear rules leader and holds it otherwise", () => {
    const plan = classifyV1Tree(tree());
    const selection = byTitle(plan.entries, "Task selection");
    expect(byTitle(plan.entries, "Task selection skips claimed tasks")).toMatchObject({ target: "change", placement: selection.id });
    // No shared word, and one shared word ("selection"), are both too weak to place.
    for (const title of ["Fix claim leak across worktrees", "Selection latency"]) {
      const held = byTitle(plan.entries, title);
      expect(held.placement).toBeUndefined();
      expect(held.needsPlacement).toBe(true);
    }
  });

  it("proposes constraints from constraint-shaped epics and features", () => {
    const plan = classifyV1Tree(tree());
    const security = byTitle(plan.entries, "Security & Data Safety");
    expect(security.target).toBe("area");
    const isolation = byTitle(plan.entries, "Gateway isolation");
    expect(isolation.target).toBe("constraint");
    expect(plan.constraints).toEqual([
      { source: isolation.id, title: "Gateway isolation", appliesTo: byTitle(plan.entries, "Rex").id },
      { source: security.id, title: "Security & Data Safety", appliesTo: "all" },
    ]);
    expect(byTitle(plan.entries, "Enforce boundaries")).toMatchObject({ target: "change", placement: isolation.id });
  });

  it("proposes the area list with review notes", () => {
    const plan = classifyV1Tree(tree());
    expect(plan.areas.map((a) => a.title)).toEqual(["Rex", "Security & Data Safety", "Autonomous run reliability: four defects found"]);
    const rex = plan.areas[0];
    expect(rex).toMatchObject({ jobShaped: false, productNodes: 2 });
    const defects = plan.areas[2];
    expect(defects.productNodes).toBe(0);
    expect(defects.notes.join(" ")).toMatch(/no capability or constraint/);
  });

  it("does not make a cancelled epic with no release token an area", () => {
    const epic = item("epic", "Legacy importer", [item("task", "Write importer")], "cancelled");
    const plan = classifyV1Tree([epic]);
    expect(byTitle(plan.entries, "Legacy importer")).toMatchObject({ target: "change", applied: false, needsPlacement: true });
    expect(plan.areas).toEqual([]);
    expect(byTitle(plan.entries, "Write importer").target).toBe("task");
  });

  it("does not make a deleted feature with a completed child a capability", () => {
    const feature = item("feature", "Offline cache", [item("task", "Build cache", [], "completed")], "deleted");
    const plan = classifyV1Tree([item("epic", "Storage", [feature])]);
    expect(byTitle(plan.entries, "Offline cache")).toMatchObject({ target: "change", applied: false, needsPlacement: true });
    expect(plan.entries.some((e) => e.target === "capability")).toBe(false);
    expect(byTitle(plan.entries, "Build cache").target).toBe("task");
  });

  it("does not make a pending feature a capability when its only completed work sits under a cancelled task", () => {
    const abandoned = item("task", "Build cache", [item("subtask", "Write store", [], "completed")], "cancelled");
    const feature = item("feature", "Offline cache", [abandoned], "pending");
    const plan = classifyV1Tree([item("epic", "Storage", [feature], "pending")]);
    expect(byTitle(plan.entries, "Offline cache").target).not.toBe("capability");
    expect(plan.entries.some((e) => e.target === "capability")).toBe(false);
  });

  it("still makes a pending feature a capability when a completed task sits beside a cancelled one", () => {
    const feature = item("feature", "Offline cache", [
      item("task", "Build cache", [], "completed"),
      item("task", "Sync cache", [item("subtask", "Write store", [], "completed")], "cancelled"),
    ], "pending");
    const plan = classifyV1Tree([item("epic", "Storage", [feature], "pending")]);
    expect(byTitle(plan.entries, "Offline cache").target).toBe("capability");
  });

  it("is deterministic", () => {
    const items = tree();
    expect(classifyV1Tree(items)).toEqual(classifyV1Tree(structuredClone(items)));
  });
});
