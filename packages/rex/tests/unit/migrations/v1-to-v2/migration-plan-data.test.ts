import { describe, it, expect } from "vitest";
import type { ItemLevel, ItemStatus, PRDItem } from "../../../../src/schema/v1.js";
import { nodeSpec, specHash } from "../../../../src/schema/v2-rules.js";
import type { CapabilitySpecDraft } from "../../../../src/migrations/v1-to-v2/capability-spec.js";
import { isWindowsSafeSegment, resolveSiblingSlugs } from "../../../../src/store/folder-tree-serializer.js";
import { classifyV1Tree } from "../../../../src/migrations/v1-to-v2/migration-plan.js";
import {
  buildPlanData,
  type PlanDataOptions,
  dropCorrupt,
  legacyLoeRationale,
} from "../../../../src/migrations/v1-to-v2/migration-plan-data.js";

let seq = 0;
function item(level: ItemLevel, title: string, extra: Partial<PRDItem> = {}, children: PRDItem[] = [], status: ItemStatus = "completed"): PRDItem {
  seq += 1;
  return { id: `${level}-${seq}`, level, title, status, children, ...extra };
}

const CUT = "2026-10-08T00:00:00Z";
const dataFor = (tree: PRDItem[], options: Partial<PlanDataOptions> = {}) => buildPlanData(tree, classifyV1Tree(tree), { cutAt: CUT, ...options });

describe("criteria ids and aliases", () => {
  it("numbers criteria c1..cn in source order", () => {
    const task = item("task", "Do it", { acceptanceCriteria: ["first", "second"] });
    const data = dataFor([item("epic", "Area", {}, [item("feature", "Thing", {}, [task])])]);
    expect(data.items[task.id]!.criteria).toEqual([
      { id: "c1", text: "first" },
      { id: "c2", text: "second" },
    ]);
  });

  it("aliases a dissolved release umbrella to its first child change", () => {
    const child = item("feature", "Keep the thing");
    const umbrella = item("epic", "ndx 0.9.0", {}, [child, item("feature", "Other")]);
    const data = dataFor([umbrella]);
    expect(data.items[child.id]!.aliases).toEqual([umbrella.id]);
  });
});

describe("shippedIn backfill", () => {
  const releases = [
    { version: "0.8.0", date: "2026-09-01T00:00:00Z" },
    { version: "0.7.0", date: "2026-08-01T00:00:00Z" },
  ];
  const mk = () => item("task", "Ship", { completedAt: "2026-08-15T00:00:00Z" });

  it("takes the first release tagged after completion", () => {
    const t = mk();
    expect(dataFor([t], { releases }).items[t.id]!.shippedIn).toEqual({ version: "0.8.0", source: "release-tag" });
  });

  it("lets PR merge data override the tag", () => {
    const t = mk();
    const data = dataFor([t], { releases, prMerges: { [t.id]: "0.7.1" } });
    expect(data.items[t.id]!.shippedIn).toEqual({ version: "0.7.1", source: "pr-merge" });
  });

  it("leaves an item completed after the last tag unshipped", () => {
    const t = item("task", "Late", { completedAt: "2026-10-01T00:00:00Z" });
    expect(dataFor([t], { releases }).items[t.id]!.shippedIn).toBeUndefined();
  });
});

describe("data problem flags", () => {
  it("flags each class and counts it", () => {
    const tagged = item("task", "Tagged", { tags: ["ac: it works"] });
    const dupA = item("task", "Same");
    const dupB = item("task", "same");
    const parent = item("task", "Parented", { parentId: "x" });
    const stale = item("task", "Stale", { description: "TODO: wire this later" });
    const data = dataFor([item("epic", "Area", {}, [item("feature", "Thing", {}, [tagged, dupA, dupB, parent, stale])])]);
    expect(data.items[tagged.id]!.flags).toContain("criteria-in-tags");
    expect(data.items[dupA.id]!.flags).toContain("duplicate-title");
    expect(data.items[dupB.id]!.flags).toContain("duplicate-title");
    expect(data.items[parent.id]!.flags).toContain("legacy-parent-id");
    expect(data.items[stale.id]!.flags).toContain("stale-description");
    expect(data.flagCounts).toEqual({ "criteria-in-tags": 1, "duplicate-title": 2, "legacy-parent-id": 1, "slug-clash": 0, "stale-description": 1, "unsafe-slug": 0 });
  });

  it("does not flag an unrelated item", () => {
    const t = item("task", "Clean", { tags: ["web"], description: "Does a thing." });
    expect(dataFor([t]).items[t.id]!.flags).toEqual([]);
  });
});

describe("legacy loe", () => {
  it("drops the numeric loe and prefixes loeRationale with the bucket", () => {
    const t = item("task", "Sized", { loe: "xl" });
    const data = dataFor([t]);
    expect(data.items[t.id]!.legacyLoe).toEqual({ bucket: "xl", loeRationale: "Legacy estimate: xl" });
    expect(data.legacyLoe).toBe(1);
  });

  it("keeps an existing rationale after the prefix and never maps to weeks", () => {
    expect(legacyLoeRationale("m", "touches three files")).toBe("Legacy estimate: m. touches three files");
    const t = item("task", "Sized", { loe: "M", loeRationale: "why" });
    const legacy = dataFor([t]).items[t.id]!.legacyLoe!;
    expect(legacy.loeRationale.startsWith("Legacy estimate: m")).toBe(true);
    expect(JSON.stringify(legacy)).not.toMatch(/week/i);
  });

  it("ignores a numeric loe", () => {
    const t = item("task", "Sized", { loe: 2 });
    expect(dataFor([t]).items[t.id]!.legacyLoe).toBeUndefined();
  });
});

describe("appliedAt and reviewedHash", () => {
  const tree = (extra: Partial<PRDItem>, status: ItemStatus = "completed") => {
    const task = item("task", "Do it", extra, [], status);
    const feature = item("feature", "Capability", {}, [task], status);
    return { task, feature, items: [item("epic", "Area", {}, [feature])] };
  };

  it("stamps an applied change with its completion time", () => {
    const { feature, items } = tree({ completedAt: "2026-09-01T00:00:00Z" });
    const plan = classifyV1Tree(items);
    const applied = plan.entries.filter((e) => e.target === "change" && e.applied);
    expect(applied.length).toBeGreaterThan(0);
    const data = buildPlanData(items, plan, { cutAt: CUT });
    for (const e of applied) {
      const expected = e.id === feature.id ? CUT : "2026-09-01T00:00:00Z";
      expect(data.items[e.id]!.appliedAt).toBe(expected);
    }
  });

  it("uses the cut time when completedAt is empty or unparsable", () => {
    for (const completedAt of ["", "yesterday"]) {
      const { task, items } = tree({ completedAt });
      const plan = classifyV1Tree(items);
      const applied = plan.entries.filter((e) => e.target === "change" && e.applied);
      expect(applied.map((e) => e.id)).toContain(task.id);
      expect(dataFor(items).items[task.id]!.appliedAt).toBe(CUT);
    }
  });

  it("does not stamp an unfinished change", () => {
    const { items } = tree({}, "pending");
    const data = dataFor(items);
    expect(Object.values(data.items).some((d) => d.appliedAt !== undefined)).toBe(false);
  });

  it("stamps reviewedHash only on listed capabilities, from the drafted spec", () => {
    const { items } = tree({});
    const plan = classifyV1Tree(items);
    const caps = plan.entries.filter((e) => e.target === "capability");
    expect(caps.length).toBeGreaterThan(0);
    const specs = caps.map((c) => ({ capability: c.id, statement: "It works.", criteria: [{ id: "c1", text: "When x, y." }] }) as unknown as CapabilitySpecDraft);
    const [first, ...rest] = caps;
    const data = buildPlanData(items, plan, { cutAt: CUT, specs, reviewed: [first!.id] });
    expect(data.items[first!.id]!.reviewedHash).toBe(specHash({ statement: "It works.", criteria: [{ id: "c1", text: "When x, y." }] }));
    for (const c of rest) expect(data.items[c.id]?.reviewedHash).toBeUndefined();
  });

  it("takes a capability's criteria only from its draft, so a reviewed node hashes to reviewedHash", () => {
    const { feature, items } = tree({});
    feature.acceptanceCriteria = ["Add X"];
    const plan = classifyV1Tree(items);
    const cap = plan.entries.find((e) => e.target === "capability")!;
    const draft = { capability: cap.id, statement: "It adds X.", criteria: [{ id: "c1", text: "When asked, X is added." }] } as unknown as CapabilitySpecDraft;
    const data = buildPlanData(items, plan, { cutAt: CUT, specs: [draft], reviewed: [cap.id] });
    expect(data.items[cap.id]!.criteria).toBeUndefined();
    const node = { type: "capability" as const, statement: draft.statement, criteria: draft.criteria };
    expect(data.items[cap.id]!.reviewedHash).toBe(specHash(nodeSpec(node as never)));
  });

  it("gives a reviewed capability without a draft no hash", () => {
    const { items } = tree({});
    const plan = classifyV1Tree(items);
    const cap = plan.entries.find((e) => e.target === "capability")!;
    expect(buildPlanData(items, plan, { cutAt: CUT, reviewed: [cap.id] }).items[cap.id]?.reviewedHash).toBeUndefined();
  });
});

describe('"[object Object]" values', () => {
  it("counts recommendationMeta and item log values and drops them", () => {
    const t = item("task", "Rec", { recommendationMeta: "[object Object]" });
    const u = item("task", "Rec2", { recommendationMeta: { a: "[object Object]", b: "ok" } });
    // The shape on disk: an item's front matter `log:` list holding the literal string.
    const logged = item("task", "Logged", { log: ["[object Object]", "kept"] });
    const data = dataFor([t, u, logged]);
    expect(data.corrupt).toEqual({ recommendationMeta: 2, logEntries: 1 });
    expect(data.items[t.id]!.droppedMeta).toBe(1);
    expect(data.items[logged.id]!.droppedLog).toBe(1);

    expect(dropCorrupt(u.recommendationMeta)).toEqual({ b: "ok" });
    expect(dropCorrupt(t.recommendationMeta)).toBeUndefined();
    expect(dropCorrupt(logged.log)).toEqual(["kept"]);
  });
});

describe("Windows-unsafe v1 slugs", () => {
  it.each(["Con", "AUX", "Nul"])("gives a v1 item titled %s a Windows-safe slug, flagged, with the old name recorded", (title) => {
    const unsafe = item("task", title);
    const data = dataFor([item("epic", "Area", {}, [item("feature", "Thing", {}, [unsafe, item("task", "Fine")])])]);
    const planned = data.items[unsafe.id]!;
    expect(planned.flags).toContain("unsafe-slug");
    expect(planned.slug!.from).toBe(title.toLowerCase());
    expect(isWindowsSafeSegment(planned.slug!.to)).toBe(true);
    expect(planned.slug!.to.startsWith(`${title.toLowerCase()}-`)).toBe(true);
    expect(data.flagCounts["unsafe-slug"]).toBe(1);
  });

  it.each(["Index", "INDEX"])("gives a v1 item titled %s a non-index slug, flagged", (title) => {
    const idx = item("subtask", title);
    const data = dataFor([item("epic", "Area", {}, [item("feature", "Thing", {}, [item("task", "Parent", {}, [idx])])])]);
    const planned = data.items[idx.id]!;
    expect(planned.flags).toContain("unsafe-slug");
    expect(planned.slug!.from).toBe("index");
    expect(planned.slug!.to).not.toBe("index");
    expect(planned.slug!.to.startsWith("index-")).toBe(true);
    expect(data.flagCounts["unsafe-slug"]).toBe(1);
  });

  it("leaves a safe slug alone, including a duplicate title the v1 rule already suffixed", () => {
    const [a, b, ok] = [item("task", "Con"), item("task", "con"), item("task", "Console")];
    const data = dataFor([item("epic", "Area", {}, [item("feature", "Thing", {}, [a, b, ok])])]);
    expect(data.items[a.id]?.slug).toBeUndefined();
    expect(data.items[b.id]?.slug).toBeUndefined();
    expect(data.items[ok.id]?.slug).toBeUndefined();
    expect(data.flagCounts["unsafe-slug"]).toBe(0);
  });
});

describe("determinism", () => {
  it("gives an identical plan data for an unchanged tree", () => {
    const tree = [
      item("epic", "ndx 0.9.0", {}, [item("feature", "A", { acceptanceCriteria: ["x"], loe: "s" }), item("feature", "A")]),
    ];
    const opts = { releases: [{ version: "0.9.0", date: "2026-10-01T00:00:00Z" }] };
    expect(JSON.stringify(dataFor(tree, opts))).toBe(JSON.stringify(dataFor(tree, opts)));
  });
});

describe("slugs against the v2 sibling set", () => {
  const releaseTree = () => [
    item("epic", "ndx 0.9.0", {}, [item("feature", "Docs", {}, [item("task", "Write")]), item("feature", "Fixes")]),
    item("epic", "ndx 0.10.0", {}, [item("feature", "DOCS", {}, [item("task", "Write")]), item("feature", "Fixes")]),
  ];

  it("gives same-titled features under different release epics distinct slugs, flagged", () => {
    const tree = releaseTree();
    const [first, second] = [tree[0]!.children![0]!, tree[1]!.children![0]!];
    const data = dataFor(tree);
    expect(data.items[first.id]?.slug).toBeUndefined();
    expect(data.items[second.id]!.slug).toEqual({ from: "docs", to: `docs-${second.id.slice(0, 6)}` });
    expect(data.items[second.id]!.flags).toContain("slug-clash");
    expect(data.flagCounts["slug-clash"]).toBe(2);
    expect(data.flagCounts["unsafe-slug"]).toBe(0);
  });

  it("freezes a slug unique, ignoring case, within every v2 sibling set", () => {
    const deep = item("epic", "PR 7 rework", {}, [
      item("feature", "Docs", {}, [item("task", "Notes", {}, [item("subtask", "Check")]), item("task", "Check")]),
    ]);
    const tree = [...releaseTree(), deep, item("task", "Docs")];
    const plan = classifyV1Tree(tree);
    const data = buildPlanData(tree, plan, { cutAt: CUT });
    const v1 = new Map<string, string>();
    const walk = (list: PRDItem[]): void => {
      for (const [id, slug] of resolveSiblingSlugs(list)) v1.set(id, slug);
      for (const i of list) walk(i.children ?? []);
    };
    walk(tree);

    const sets = new Map<string, string[]>();
    for (const e of plan.entries.filter((x) => x.target !== "release")) {
      const layer = ["area", "capability", "constraint"].includes(e.target) ? "product" : "changes";
      const key = `${layer}:${e.parent ?? ""}`;
      sets.set(key, [...(sets.get(key) ?? []), (data.items[e.id]?.slug?.to ?? v1.get(e.id)!).toLowerCase()]);
    }
    expect(sets.size).toBeGreaterThan(2);
    for (const slugs of sets.values()) expect(new Set(slugs).size).toBe(slugs.length);
  });
});
