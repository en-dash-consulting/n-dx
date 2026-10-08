import { describe, it, expect } from "vitest";
import {
  checkV2Rules,
  indexTree,
  isAppliedChange,
  isOpenChange,
  specHash,
  titleReleaseToken,
  RULE_SEVERITY,
  V2_RULE_IDS,
  type RuleNode,
  type V2RuleId,
  type V2Tree,
} from "../../../src/schema/v2-rules.js";
import { RETIRED_STATE_FIELDS, type Criterion } from "../../../src/schema/v2.js";

const NOW = new Date("2026-10-06T00:00:00Z");
let seq = 0;

function node(type: RuleNode["type"], fields: Record<string, unknown> = {}, children: RuleNode[] = []): RuleNode {
  seq += 1;
  const id = (fields.id as string | undefined) ?? `${type}-${seq}`;
  return { id, type, title: `${type} ${seq}`, slug: id, children, ...fields } as RuleNode;
}

/** A capability that passes every capability rule, reviewed at its own spec unless `fields` says otherwise. */
function cap(fields: Record<string, unknown> = {}, children: RuleNode[] = []): RuleNode {
  const spec = { statement: "Users can do a thing", criteria: [{ id: "c1", text: "It works" }], ...fields } as { statement?: string; criteria?: Criterion[] };
  return node("capability", { reviewedHash: specHash(spec), ...spec }, children);
}

function check(rule: V2RuleId, tree: Partial<V2Tree>, now = NOW) {
  return checkV2Rules({ product: [], changes: [], ...tree }, { now }, [rule]);
}

const ids = (findings: { nodeId: string }[]) => findings.map((f) => f.nodeId);

describe("rule table", () => {
  it("errors precede warnings and every rule has a severity", () => {
    const severities = V2_RULE_IDS.map((id) => RULE_SEVERITY[id]);
    expect(severities.indexOf("warning")).toBe(severities.lastIndexOf("error") + 1);
    expect(V2_RULE_IDS).toHaveLength(22);
  });

  it("a healthy tree has no findings", () => {
    const area = (n: number) => node("area", {}, Array.from({ length: n }, () => cap()));
    const tree: V2Tree = {
      product: [area(2), area(2), node("area", {}, [cap({ id: "x" }), cap()])],
      changes: [node("change", { touches: ["x"] }, [node("task", {}, [node("subtask")])])],
    };
    expect(checkV2Rules(tree, { now: NOW })).toEqual([]);
  });

  it("ignores deleted nodes", () => {
    const tree = { changes: [node("change", { status: "deleted", title: "Ship 0.8.0" })] };
    expect(checkV2Rules({ product: [], ...tree }, { now: NOW, releases: ["0.8.0"] })).toEqual([]);
  });
});

describe("change-has-target", () => {
  it("passes a change that amends, touches, or is a spike", () => {
    const changes = [
      node("change", { amends: [{ target: "a", delta: "modified", summary: "s" }] }),
      node("change", { touches: ["a"] }),
      node("change", { spike: true }),
    ];
    expect(check("change-has-target", { changes })).toEqual([]);
  });

  it("fails a change with no target", () => {
    const bare = node("change", { amends: [], touches: [] });
    const findings = check("change-has-target", { changes: [bare] });
    expect(ids(findings)).toEqual([bare.id]);
    expect(findings[0].severity).toBe("error");
  });

  it("passes an Inbox change, whose targets a person has yet to confirm", () => {
    expect(check("change-has-target", { changes: [node("change", { needsPlacement: true })] })).toEqual([]);
  });
});

describe("change-placed-at-close", () => {
  it("passes an open Inbox change and a completed placed change", () => {
    const changes = [
      node("change", { needsPlacement: true, status: "in_progress" }),
      node("change", { status: "completed", touches: ["a"] }),
      node("change", { status: "completed", needsPlacement: false, touches: ["a"] }),
    ];
    expect(check("change-placed-at-close", { changes })).toEqual([]);
  });

  it("fails a completed change still needing placement, and says when it also has no target", () => {
    const placedTargets = node("change", { status: "completed", needsPlacement: true, touches: ["a"] });
    const spike = node("change", { status: "completed", needsPlacement: true, spike: true });
    const untargeted = node("change", { status: "completed", needsPlacement: true });
    const findings = check("change-placed-at-close", { changes: [placedTargets, spike, untargeted] });
    expect(ids(findings)).toEqual([placedTargets.id, spike.id, untargeted.id]);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).not.toContain("must also amend or touch");
    expect(findings[1].message).not.toContain("must also amend or touch");
    expect(findings[2].message).toContain("must also amend or touch");
  });

  it("fails an applied change still needing placement, whatever its status", () => {
    const applied = node("change", { status: "in_progress", appliedAt: "2026-10-05T00:00:00.000Z", needsPlacement: true, touches: ["a"] });
    const findings = check("change-placed-at-close", { changes: [applied] });
    expect(ids(findings)).toEqual([applied.id]);
    expect(findings[0].message).toContain("is applied but still needs placement");
  });

  it("leaves a completed untargeted change that needs no placement to change-has-target", () => {
    const bare = node("change", { status: "completed" });
    const tree: V2Tree = { product: [], changes: [bare] };
    const findings = checkV2Rules(tree, { now: NOW }, ["change-has-target", "change-placed-at-close"]);
    expect(findings.map((f) => [f.rule, f.nodeId])).toEqual([["change-has-target", bare.id]]);
  });
});

describe("fix-not-spike", () => {
  it("passes a fix or a spike alone", () => {
    expect(check("fix-not-spike", { changes: [node("change", { fix: true }), node("change", { spike: true }), node("change", { fix: false, spike: true })] })).toEqual([]);
  });

  it("fails a change that is both", () => {
    const both = node("change", { fix: true, spike: true });
    const findings = check("fix-not-spike", { changes: [both] });
    expect(ids(findings)).toEqual([both.id]);
    expect(findings[0].severity).toBe("error");
  });
});

describe("fix-not-additive", () => {
  const added = { target: "n", delta: "added", summary: "s", under: "area" };
  const removed = { target: "r", delta: "removed", summary: "s" };
  const modified = { target: "m", delta: "modified", summary: "s" };

  it("passes a fix that modifies or touches, and a non-fix that adds or removes", () => {
    const changes = [
      node("change", { fix: true, amends: [modified], touches: ["x"] }),
      node("change", { fix: true }),
      node("change", { amends: [added, removed] }),
      node("change", { fix: false, amends: [added] }),
    ];
    expect(check("fix-not-additive", { changes })).toEqual([]);
  });

  it("fails a fix with an added or a removed amendment", () => {
    const withAdd = node("change", { fix: true, amends: [modified, added] });
    const withRemove = node("change", { fix: true, amends: [removed] });
    const findings = check("fix-not-additive", { changes: [withAdd, withRemove] });
    expect(ids(findings)).toEqual([withAdd.id, withRemove.id]);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain("added");
    expect(findings[1].message).toContain("removed");
  });
});

describe("amendment-type", () => {
  it("passes an added amendment with or without a type (absent means capability)", () => {
    const change = node("change", {
      amends: [
        { target: "new-a", delta: "added", summary: "s", under: "area", type: "constraint" },
        { target: "new-b", delta: "added", summary: "s", under: "area" },
      ],
    });
    expect(check("amendment-type", { changes: [change] })).toEqual([]);
  });

  it("fails a type on a modified or removed amendment, once per amendment", () => {
    const change = node("change", {
      amends: [
        { target: "a", delta: "modified", summary: "s", type: "capability" },
        { target: "b", delta: "removed", summary: "s", type: "constraint" },
        { target: "c", delta: "modified", summary: "s" },
      ],
    });
    const findings = check("amendment-type", { changes: [change] });
    expect(ids(findings)).toEqual([change.id, change.id]);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('modified amendment of "a"');
    expect(findings[1].message).toContain('removed amendment of "b"');
  });
});

describe("ref-unique", () => {
  it("passes distinct refs, and a node repeating its own id as an alias", () => {
    const product = [cap({ id: "a", displayId: "A1.1", aliases: ["a", "old-a"] }), cap({ id: "b", displayId: "A1.2" })];
    expect(check("ref-unique", { product, changes: [node("change", { id: "c", displayId: "CH-1" })] })).toEqual([]);
  });

  it("fails an id, display id or alias claimed twice across layers, naming both nodes", () => {
    const first = cap({ id: "a", title: "First", displayId: "A1.1" });
    const sameId = node("change", { id: "a", title: "Second" });
    const sameDisplay = cap({ id: "b", displayId: "A1.1" });
    const aliasShadow = node("change", { id: "c", aliases: ["a"] });
    const findings = check("ref-unique", { product: [first, sameDisplay], changes: [sameId, aliasShadow] });
    expect(ids(findings)).toEqual([sameDisplay.id, sameId.id, aliasShadow.id]);
    expect(findings[0].severity).toBe("error");
    expect(findings[1].message).toBe('"a" names both capability "First" (a) and change "Second" (a)');
  });

  it("ignores a tombstone whose id a live node keeps as an alias", () => {
    const folded = cap({ id: "folded", status: "deleted" });
    const survivor = cap({ id: "survivor", aliases: ["folded"] });
    expect(check("ref-unique", { product: [folded, survivor] })).toEqual([]);
  });

  it("fails a live node that reuses a tombstone's id, but not its display id or alias", () => {
    const gone = cap({ id: "gone", title: "Gone", displayId: "A1.3", aliases: ["older"], status: "deleted" });
    const reused = node("change", { id: "gone", title: "Reused" });
    const renumbered = cap({ id: "fresh", displayId: "A1.3", aliases: ["older"] });
    const findings = check("ref-unique", { product: [gone, renumbered], changes: [reused] });
    expect(ids(findings)).toEqual([reused.id]);
    expect(findings[0].message).toBe('"gone" names both retired capability "Gone" (gone) and change "Reused" (gone); a retired id is history and cannot be reused');
  });
});

describe("ref-resolves", () => {
  it("passes references to live nodes, by id, display id or alias, and to tombstones", () => {
    const product = [
      node("area", { id: "area" }, [
        cap({ id: "a", displayId: "A1.1", aliases: ["old-a"] }),
        cap({ id: "b", dependsOn: ["A1.1", "old-a"] }),
        cap({ id: "gone", status: "deleted" }),
      ]),
      node("constraint", { id: "k", appliesTo: ["a"] }),
      node("constraint", { id: "everything", appliesTo: "all" }),
    ];
    const changes = [
      node("change", {
        touches: ["a"],
        blockedBy: ["CH-2"],
        amends: [
          { target: "b", delta: "modified", summary: "s" },
          { target: "gone", delta: "removed", summary: "s" },
          { target: "new", delta: "added", summary: "s", under: "area" },
          { target: "new-child", delta: "added", summary: "s", under: "new" },
        ],
        appliedAt: "2026-10-05T00:00:00.000Z",
      }),
      node("change", { id: "c2", displayId: "CH-2", touches: ["a"] }),
    ];
    expect(check("ref-resolves", { product, changes })).toEqual([]);
  });

  it("fails each dangling reference, once per field and ref", () => {
    const capability = cap({ id: "a", dependsOn: ["missing-dep"], blockedBy: ["missing-blocker"] });
    const constraint = node("constraint", { appliesTo: ["missing-scope"] });
    const change = node("change", {
      touches: ["missing-touch"],
      amends: [
        { target: "missing-modified", delta: "modified", summary: "s" },
        { target: "missing-removed", delta: "removed", summary: "s" },
        { target: "new", delta: "added", summary: "s", under: "missing-parent" },
      ],
    });
    const findings = check("ref-resolves", { product: [capability, constraint], changes: [change] });
    expect(findings.map((f) => [f.nodeId, f.message.match(/"([^"]+)" names no node/)?.[1]])).toEqual([
      ["a", "missing-blocker"],
      ["a", "missing-dep"],
      [constraint.id, "missing-scope"],
      [change.id, "missing-touch"],
      [change.id, "missing-modified"],
      [change.id, "missing-removed"],
      [change.id, "missing-parent"],
    ]);
    expect(findings[0].severity).toBe("error");
  });

  it("does not check an added amendment's target, which exists only after apply", () => {
    const change = node("change", { amends: [{ target: "not-yet", delta: "added", summary: "s" }] });
    expect(check("ref-resolves", { changes: [change] })).toEqual([]);
  });

  it("fails an unapplied change adding a target some node already claims by id, display id or alias, live or retired", () => {
    const product = [
      node("area", { id: "area" }, [
        cap({ id: "a", title: "Live A", displayId: "A1.1", aliases: ["old-a"] }),
        cap({ id: "gone", title: "Gone", status: "deleted" }),
      ]),
    ];
    const adds = (target: string, fields: Record<string, unknown> = {}) =>
      node("change", { amends: [{ target, delta: "added", summary: "s", under: "area" }], ...fields });
    const byId = adds("a");
    const byDisplayId = adds("A1.1");
    const byAlias = adds("old-a");
    const retired = adds("gone");
    const applied = adds("a", { appliedAt: "2026-10-05T00:00:00.000Z" });
    const twice = node("change", { amends: [{ target: "a", delta: "added", summary: "s" }, { target: "a", delta: "added", summary: "s" }] });
    const findings = check("ref-resolves", { product, changes: [byId, byDisplayId, byAlias, retired, applied, twice] });
    expect(findings.map((f) => [f.nodeId, f.message.match(/adds "([^"]+)", which already names (.+?) "([^"]+)"/)?.slice(1)])).toEqual([
      [byId.id, ["a", "a capability", "Live A"]],
      [byDisplayId.id, ["A1.1", "a capability", "Live A"]],
      [byAlias.id, ["old-a", "a capability", "Live A"]],
      [retired.id, ["gone", "a capability", "Gone"]],
      [twice.id, undefined],
      [twice.id, ["a", "a capability", "Live A"]],
    ]);
    expect(findings[4].message).toContain('adds "a" more than once');
  });

  describe("same-change parents of an unapplied change", () => {
    const adds = (...pairs: [target: string, under?: string, type?: string][]) =>
      node("change", { amends: pairs.map(([target, under, type]) => ({ target, delta: "added", summary: "s", under, type })) });

    it("passes additions that form a tree ending at an existing node or the root", () => {
      const change = adds(["new-a", "area"], ["new-b", "new-a"], ["new-c"], ["new-d", "new-c"], ["rule", "new-d", "constraint"]);
      expect(check("ref-resolves", { product: [node("area", { id: "area" })], changes: [change] })).toEqual([]);
    });

    it("fails an addition placed under itself", () => {
      const change = adds(["new-a", "new-a"]);
      const findings = checkV2Rules({ product: [], changes: [change] }, { now: NOW });
      expect(findings.map((f) => [f.rule, f.nodeId])).toEqual([["ref-resolves", change.id]]);
      expect(findings[0].message).toContain('"new-a" under itself');
    });

    it("fails a cycle once, naming its amendments, and an addition under the cycle", () => {
      const change = adds(["new-a", "new-b"], ["new-b", "new-a"], ["new-c", "new-a"]);
      const findings = checkV2Rules({ product: [], changes: [change] }, { now: NOW });
      expect(findings.map((f) => f.rule)).toEqual(["ref-resolves", "ref-resolves"]);
      expect(findings[0].message).toContain('adds "new-a" under "new-b", "new-b" under "new-a"');
      expect(findings[1].message).toContain('adds "new-c" under "new-a", whose same-change parents never reach');
    });

    it("fails a same-change parent that cannot hold the added type", () => {
      const change = adds(["rule", "area", "constraint"], ["new-cap", "rule"], ["top", "area"], ["mid", "top"], ["deep", "mid"]);
      const findings = check("ref-resolves", { product: [node("area", { id: "area" })], changes: [change] });
      expect(findings.map((f) => f.message.match(/under "([^"]+)" names (.+?) the same change/)?.slice(1))).toEqual([
        ["rule", "a constraint"],
        ["mid", "a capability nested in a capability"],
      ]);
    });

    it("fails a target added twice, once per target, in open and applied changes", () => {
      const open = adds(["dup", "area"], ["dup", "dup"], ["dup"], ["ok", "area"]);
      const applied = node("change", {
        appliedAt: "2026-10-05T00:00:00.000Z",
        amends: [
          { target: "x", delta: "added", summary: "s" },
          { target: "x", delta: "added", summary: "s" },
        ],
      });
      const findings = check("ref-resolves", { product: [node("area", { id: "area" })], changes: [open, applied] });
      expect(findings.map((f) => f.nodeId)).toEqual([open.id, applied.id]);
      expect(findings[0].message).toContain('adds "dup" more than once');
    });

    it("keeps the first addition when judging same-change parents", () => {
      const change = adds(["dup", "area"], ["dup", "dup"], ["child", "dup"]);
      const findings = check("ref-resolves", { product: [node("area", { id: "area" })], changes: [change] });
      expect(findings).toHaveLength(1);
    });

    it("leaves an applied change's same-change parents to the materialized tree", () => {
      const change = node("change", {
        appliedAt: "2026-10-05T00:00:00.000Z",
        amends: [{ target: "new-a", delta: "added", summary: "s", under: "new-a" }],
      });
      expect(check("ref-resolves", { changes: [change] })).toEqual([]);
    });
  });

  describe("destination kind", () => {
    it("fails the reproduction: touches and an added capability under a task", () => {
      const change = node("change", {
        touches: ["task-1"],
        amends: [{ target: "new-cap", delta: "added", summary: "s", under: "task-1" }],
      }, [node("task", { id: "task-1", title: "Task one" })]);
      const findings = checkV2Rules({ product: [], changes: [change] }, { now: NOW });
      expect(findings.map((f) => [f.rule, f.message])).toEqual([
        ["ref-resolves", `change "${change.title}" touches "task-1" names a task "Task one", not a product-layer node`],
        ["ref-resolves", `change "${change.title}" added amendment under "task-1" names a task "Task one", not an area or a capability not nested in another, which can hold a capability`],
      ]);
    });

    it("fails each field naming the wrong kind, naming the field, the reference and the kind found", () => {
      const task = node("task", { id: "t" });
      const product = [
        node("area", { id: "area" }, [
          cap({ id: "top" }, [cap({ id: "nested" })]),
          cap({ id: "a", dependsOn: ["area"], blockedBy: ["top"] }),
          node("constraint", { id: "k", appliesTo: ["t"] }),
        ]),
        node("constraint", { id: "gone-task-ref", appliesTo: ["gone-task"] }),
      ];
      const change = node("change", {
        touches: ["t"],
        amends: [
          { target: "t", delta: "modified", summary: "s" },
          { target: "t", delta: "removed", summary: "s" },
          { target: "n1", delta: "added", summary: "s", under: "nested" },
          { target: "n2", delta: "added", summary: "s", under: "k" },
          { target: "n3", delta: "added", summary: "s", under: "t", type: "constraint" },
        ],
      }, [task, node("task", { id: "gone-task", status: "deleted" })]);
      const findings = check("ref-resolves", { product, changes: [change] });
      expect(findings.map((f) => [f.nodeId, f.message.match(/ (\S+(?: amendment \S+)?) "([^"]+)" names (an? [a-z ]+?) "/)?.slice(1)])).toEqual([
        ["a", ["blockedBy", "top", "a capability"]],
        ["a", ["dependsOn", "area", "an area"]],
        ["k", ["appliesTo", "t", "a task"]],
        ["gone-task-ref", ["appliesTo", "gone-task", "a task"]],
        [change.id, ["touches", "t", "a task"]],
        [change.id, ["modified amendment target", "t", "a task"]],
        [change.id, ["removed amendment target", "t", "a task"]],
        [change.id, ["added amendment under", "nested", "a capability nested in a capability"]],
        [change.id, ["added amendment under", "k", "a constraint"]],
        [change.id, ["added amendment under", "t", "a task"]],
      ]);
    });

    it("passes a constraint added under any product node", () => {
      const product = [node("area", { id: "area" }, [cap({ id: "top" }, [cap({ id: "nested" })]), node("constraint", { id: "k" })])];
      const change = node("change", {
        amends: ["area", "top", "nested", "k"].map((under) => ({ target: `rule-${under}`, delta: "added", summary: "s", under, type: "constraint" })),
      });
      expect(check("ref-resolves", { product, changes: [change] })).toEqual([]);
    });
  });
});

describe("title-release-token", () => {
  const RELEASES = ["0.8.0", "1.2.3", "1.0.0-beta.1", "1.0.0"];

  it.each(["0.8.0 release audit", "Ship v1.2.3", "Cut 1.0.0-beta.1", "Patch the 0.8.x line", "Prepare v1.0", "PR 12 follow-up", "Land PR #12", "pr-12 fixes", "Review pull request 7"])(
    "flags %j",
    (title) => {
      expect(titleReleaseToken(title, RELEASES)).toBeDefined();
    },
  );

  it.each([
    "Add the v2 node types and fields",
    "Dashboard landing page",
    "Keep cohesion above 0.5",
    "Fix issue #12",
    "PRD storage",
    "Python 3.12 support",
    "Upgrade zod to 3.25.76",
    "Support Node 22.0.0",
    "Bump vite from 0.7.9 to 6.4.3",
  ])("accepts %j", (title) => {
    expect(titleReleaseToken(title, RELEASES)).toBeUndefined();
  });

  it("finds our release after a dependency version in the same title", () => {
    expect(titleReleaseToken("Upgrade zod to 3.25.76 for 0.8.0", RELEASES)).toBe("0.8.0");
  });

  it("matches a release recorded with a leading v", () => {
    expect(titleReleaseToken("Ship 2.0.0", ["v2.0.0"])).toBe("2.0.0");
  });

  it("flags no version without known releases, but still flags PR tokens", () => {
    expect(titleReleaseToken("0.8.0 release audit")).toBeUndefined();
    expect(titleReleaseToken("PR 12 follow-up")).toBe("PR 12");
  });

  it("checks every node in both layers against options.releases", () => {
    const capability = cap({ title: "PR 12 capability" });
    const task = node("task", { title: "Prep 0.8.0" });
    const dependency = node("task", { title: "Upgrade zod to 3.25.76" });
    const plain = cap({ title: "Plain" });
    const tree: V2Tree = { product: [node("area", {}, [capability, plain])], changes: [node("change", { touches: ["x"] }, [task, dependency])] };
    const findings = checkV2Rules(tree, { now: NOW, releases: RELEASES }, ["title-release-token"]);
    expect(ids(findings)).toEqual([capability.id, task.id]);
    expect(findings[0].message).toContain('"PR 12"');
  });
});

describe("layer-nesting", () => {
  it("passes nodes under a parent of their own layer", () => {
    const product = [node("area", {}, [cap({}, [cap()]), node("constraint")])];
    const changes = [node("change", {}, [node("task", {}, [node("subtask")])])];
    expect(check("layer-nesting", { product, changes })).toEqual([]);
  });

  it("fails a change-layer node under a product node, and the reverse", () => {
    const task = node("task");
    const capability = cap();
    const findings = check("layer-nesting", { product: [node("area", {}, [task])], changes: [node("change", {}, [capability])] });
    expect(ids(findings)).toEqual([task.id, capability.id]);
  });

  it("fails a root loaded under the other layer's root", () => {
    const change = node("change");
    const area = node("area");
    expect(ids(check("layer-nesting", { product: [change], changes: [area] }))).toEqual([change.id, area.id]);
  });
});

describe("capability-depth", () => {
  it("passes one level of capability nesting", () => {
    expect(check("capability-depth", { product: [node("area", {}, [cap({}, [cap()])])] })).toEqual([]);
  });

  it("fails a capability two levels deep", () => {
    const deep = cap();
    expect(ids(check("capability-depth", { product: [node("area", {}, [cap({}, [cap({}, [deep])])])] }))).toEqual([deep.id]);
  });
});

describe("depends-on-acyclic", () => {
  it("passes a dependency chain, resolving display ids and aliases", () => {
    const a = cap({ id: "a", displayId: "A1.1" });
    const b = cap({ id: "b", aliases: ["old-b"], dependsOn: ["A1.1"] });
    const c = cap({ id: "c", dependsOn: ["old-b", "a", "missing"] });
    expect(check("depends-on-acyclic", { product: [node("area", {}, [a, b, c])] })).toEqual([]);
  });

  it("fails a cycle once, naming its path", () => {
    const a = cap({ id: "a", title: "A", dependsOn: ["b"] });
    const b = cap({ id: "b", title: "B", dependsOn: ["c"] });
    const c = cap({ id: "c", title: "C", dependsOn: ["a"] });
    const findings = check("depends-on-acyclic", { product: [node("area", {}, [a, b, c])] });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toBe('dependsOn cycle: "A" → "B" → "C" → "A"');
  });

  it("fails a self-dependency", () => {
    const a = cap({ id: "a", dependsOn: ["a"] });
    expect(ids(check("depends-on-acyclic", { product: [a] }))).toEqual(["a"]);
  });
});

describe("open-change-refs-live", () => {
  const removes = (target: string, fields: Record<string, unknown> = {}) =>
    node("change", { amends: [{ target, delta: "removed", summary: "retire" }], ...fields });

  it("passes a removal of a live product node", () => {
    expect(check("open-change-refs-live", { product: [cap({ id: "a" })], changes: [removes("a")] })).toEqual([]);
  });

  it("fails a removal of a retired node, and a completed but unapplied change's", () => {
    const gone = removes("gone");
    const completedUnapplied = removes("gone", { status: "completed" });
    const findings = check("open-change-refs-live", {
      product: [cap({ id: "gone", status: "deleted" })],
      changes: [gone, completedUnapplied],
    });
    expect(ids(findings)).toEqual([gone.id, completedUnapplied.id]);
  });

  describe("every product reference of an open change", () => {
    const gone = () => cap({ id: "gone", status: "deleted" });
    const amend = (a: Record<string, unknown>) => node("change", { amends: [{ summary: "s", ...a }] });
    const cases: [string, () => RuleNode][] = [
      ["touches", () => node("change", { touches: ["gone"] })],
      ["a modified target", () => amend({ target: "gone", delta: "modified" })],
      ["an added amendment's under", () => amend({ target: "n", delta: "added", under: "gone" })],
      ["a constraint added under it", () => amend({ target: "n", delta: "added", under: "gone", type: "constraint" })],
    ];

    it.each(cases)("fails %s naming a retired node", (_name, make) => {
      const change = make();
      const findings = check("open-change-refs-live", { product: [gone()], changes: [change] });
      expect(ids(findings)).toEqual([change.id]);
      expect(findings[0].message).toContain('"gone"');
    });

    it.each(cases)("passes %s naming a live node", (_name, make) => {
      const live = cap({ id: "gone" });
      expect(check("open-change-refs-live", { product: [live], changes: [make()] })).toEqual([]);
    });

    it.each(cases)("does not judge an applied change's %s", (_name, make) => {
      const applied = make();
      Object.assign(applied, { appliedAt: "2026-10-05T00:00:00.000Z", status: "completed" });
      expect(check("open-change-refs-live", { product: [gone()], changes: [applied] })).toEqual([]);
    });

    it("lets an added amendment sit under a node the same change adds", () => {
      const change = node("change", {
        amends: [
          { target: "n", delta: "added", summary: "s", under: "gone" },
          { target: "m", delta: "added", summary: "s", under: "n" },
        ],
      });
      expect(ids(check("open-change-refs-live", { product: [gone()], changes: [change] }))).toEqual([change.id]);
    });
  });

  it("leaves a target that names no node, or a change-layer node, to ref-resolves", () => {
    const missing = removes("nope");
    const wrongLayer = removes("t");
    const tree: V2Tree = { product: [], changes: [missing, wrongLayer, node("change", { spike: true }, [node("task", { id: "t" })])] };
    const findings = checkV2Rules(tree, { now: NOW }, ["ref-resolves", "open-change-refs-live"]);
    expect(findings.map((f) => [f.rule, f.nodeId])).toEqual([
      ["ref-resolves", missing.id],
      ["ref-resolves", wrongLayer.id],
    ]);
  });

  it("does not judge applied or abandoned changes", () => {
    const product = [cap({ id: "gone", status: "deleted" })];
    const changes = [removes("gone", { appliedAt: "2026-10-05T00:00:00.000Z", status: "completed" }), removes("gone", { status: "cancelled" }), removes("gone", { status: "deleted" })];
    expect(check("open-change-refs-live", { product, changes })).toEqual([]);
  });
});

describe("change predicates", () => {
  const change = (fields: Record<string, unknown>) => node("change", fields);
  const APPLIED = "2026-10-05T00:00:00.000Z";

  it("a change is applied when appliedAt is set, and by nothing else", () => {
    expect(isAppliedChange(change({ appliedAt: APPLIED }))).toBe(true);
    expect(isAppliedChange(change({ status: "completed" }))).toBe(false);
    expect(isAppliedChange(node("task", { appliedAt: APPLIED }))).toBe(false);
  });

  it.each([
    [{}, true],
    [{ status: "in_progress" }, true],
    [{ status: "completed" }, true],
    [{ status: "blocked" }, true],
    [{ status: "completed", appliedAt: APPLIED }, false],
    [{ appliedAt: APPLIED }, false],
    [{ status: "cancelled" }, false],
    [{ status: "deleted" }, false],
  ])("isOpenChange(%j) is %s", (fields, open) => {
    expect(isOpenChange(change(fields))).toBe(open);
  });

  it("only changes are open", () => {
    expect(isOpenChange(node("task"))).toBe(false);
    expect(isOpenChange(cap())).toBe(false);
  });
});

describe("indexTree", () => {
  it("resolves ids and display ids before aliases, whatever the order", () => {
    const shadow = cap({ id: "shadow", aliases: ["real", "A1.9"] });
    const real = cap({ id: "real" });
    const display = cap({ id: "d", displayId: "A1.9" });
    const { resolve } = indexTree({ product: [shadow, real, display], changes: [] });
    expect(resolve("real")).toBe(real);
    expect(resolve("A1.9")).toBe(display);
    expect(resolve("shadow")).toBe(shadow);
  });

  it("skips tombstones and their descendants by default", () => {
    const child = cap({ id: "child" });
    const gone = cap({ id: "gone", status: "deleted" }, [child]);
    const index = indexTree({ product: [gone], changes: [] });
    expect(index.entries).toEqual([]);
    expect(index.resolve("gone")).toBeUndefined();
  });

  it("with includeTombstones, indexes and marks retired nodes, after every live ref", () => {
    const child = cap({ id: "child" });
    const gone = cap({ id: "gone", displayId: "A1.1", status: "deleted" }, [child]);
    const survivor = cap({ id: "survivor", aliases: ["A1.1"] });
    const index = indexTree({ product: [gone, survivor], changes: [] }, { includeTombstones: true });
    expect(index.entries.map((e) => [e.node.id, e.retired])).toEqual([
      ["gone", true],
      ["child", true],
      ["survivor", undefined],
    ]);
    expect(index.resolve("gone")).toBe(gone);
    expect(index.resolve("child")).toBe(child);
    expect(index.resolve("A1.1")).toBe(survivor);
  });
});

describe("capability-statement", () => {
  it("passes a capability with a statement", () => {
    expect(check("capability-statement", { product: [cap()] })).toEqual([]);
  });

  it("fails a missing or blank statement", () => {
    const none = cap({ statement: undefined });
    const blank = cap({ statement: "  " });
    expect(ids(check("capability-statement", { product: [none, blank] }))).toEqual([none.id, blank.id]);
  });
});

describe("capability-criteria", () => {
  it("passes a capability with criteria", () => {
    expect(check("capability-criteria", { product: [cap()] })).toEqual([]);
  });

  it("warns on missing or empty criteria", () => {
    const none = cap({ criteria: undefined });
    const empty = cap({ criteria: [] });
    const findings = check("capability-criteria", { product: [none, empty] });
    expect(ids(findings)).toEqual([none.id, empty.id]);
    expect(findings[0].severity).toBe("warning");
  });
});

describe("specHash", () => {
  it("hashes trimmed statement and criteria only", () => {
    const base = { statement: "S", criteria: [{ id: "c1", text: "T" }] };
    expect(specHash(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(specHash({ statement: " S ", criteria: [{ id: "c1", text: "T " }] })).toBe(specHash(base));
    expect(specHash({ ...base, statement: "S2" })).not.toBe(specHash(base));
    expect(specHash({ ...base, criteria: [{ id: "c2", text: "T" }] })).not.toBe(specHash(base));
  });
});

describe("criteria-growth", () => {
  const criteria = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `k${i}`, text: `Criterion ${i}` }));
  const run = (product: RuleNode[], maxCriteria?: number) =>
    checkV2Rules({ product, changes: [] }, { now: NOW, maxCriteria }, ["criteria-growth"]);

  it("passes a capability at the default threshold of 15", () => {
    expect(run([cap({ criteria: criteria(15) })])).toEqual([]);
  });

  it("warns past the threshold and names the capability", () => {
    const findings = run([cap({ id: "big", title: "Big one", criteria: criteria(16) })]);
    expect(ids(findings)).toEqual(["big"]);
    expect(findings[0].message).toContain("Big one");
    expect(findings[0].message).toContain("16 criteria");
    expect(findings[0].severity).toBe("warning");
  });

  it("counts criteria inherited from parent capabilities", () => {
    const child = cap({ id: "child", criteria: criteria(6) });
    const parent = cap({ id: "parent", criteria: criteria(10) }, [child]);
    const findings = run([parent]);
    expect(ids(findings)).toEqual(["child"]);
    expect(findings[0].message).toContain("6 own + 10 inherited");
  });

  it("honours a configured threshold", () => {
    expect(ids(run([cap({ id: "a", criteria: criteria(4) })], 3))).toEqual(["a"]);
    expect(run([cap({ criteria: criteria(4) })], 4)).toEqual([]);
  });
});

describe("long-revised", () => {
  const met = { statement: "Old", criteria: [{ id: "c1", text: "It works" }] };
  const revised = (fields: Record<string, unknown> = {}) =>
    cap({ id: "r", metAt: specHash(met), revisedAt: "2026-09-01T00:00:00Z", ...fields });

  it("passes met, proposed, recently revised, and amended nodes", () => {
    const product = [
      cap({ ...met, metAt: specHash(met), revisedAt: "2026-01-01T00:00:00Z" }),
      cap({ revisedAt: "2026-01-01T00:00:00Z" }),
      cap({ metAt: specHash(met), revisedAt: "2026-10-01T00:00:00Z" }),
      cap({ metAt: specHash(met), lastModified: "2026-01-01T00:00:00Z" }),
      cap({ metAt: specHash(met) }),
    ];
    expect(check("long-revised", { product })).toEqual([]);
    const amending = node("change", { amends: [{ target: "r", delta: "modified", summary: "s" }] });
    expect(check("long-revised", { product: [revised()], changes: [amending] })).toEqual([]);
    const completedUnapplied = node("change", { status: "completed", amends: [{ target: "r", delta: "modified", summary: "s" }] });
    expect(check("long-revised", { product: [revised()], changes: [completedUnapplied] })).toEqual([]);
  });

  it("warns on a node revised past the threshold with no open change", () => {
    const applied = node("change", { status: "completed", appliedAt: "2026-09-02T00:00:00Z", amends: [{ target: "r", delta: "modified", summary: "s" }] });
    const cancelled = node("change", { status: "cancelled", amends: [{ target: "r", delta: "modified", summary: "s" }] });
    const findings = check("long-revised", { product: [revised()], changes: [applied, cancelled] });
    expect(ids(findings)).toEqual(["r"]);
    expect(findings[0].message).toContain("35 days");
  });

  it("measures age from revisedAt, not a later state write's lastModified", () => {
    const checked = revised({ revisedAt: "2026-08-07T00:00:00Z", lastModified: "2026-10-05T00:00:00Z" });
    const findings = check("long-revised", { product: [checked] });
    expect(ids(findings)).toEqual(["r"]);
    expect(findings[0].message).toContain("60 days");
  });

  it("covers constraints and honours the threshold option", () => {
    const constraint = node("constraint", { statement: "New", metAt: specHash({ statement: "Old" }), revisedAt: "2026-10-01T00:00:00Z" });
    const tree = { product: [constraint], changes: [] };
    expect(checkV2Rules(tree, { now: NOW }, ["long-revised"])).toEqual([]);
    expect(ids(checkV2Rules(tree, { now: NOW, longRevisedDays: 3 }, ["long-revised"]))).toEqual([constraint.id]);
  });
});

describe("area-balance", () => {
  const area = (n: number, fields: Record<string, unknown> = {}) =>
    node("area", fields, Array.from({ length: n }, () => cap()));

  it("passes balanced areas, counting nested capabilities", () => {
    const product = [area(3), area(3), node("area", {}, [cap({}, [cap()]), cap()])];
    expect(check("area-balance", { product })).toEqual([]);
  });

  it("warns on an area with fewer than two capabilities", () => {
    const small = area(1);
    const empty = area(0);
    expect(ids(check("area-balance", { product: [area(2), area(2), area(2), small, empty] }))).toEqual([small.id, empty.id]);
  });

  it("warns on an area over 40 percent of capabilities", () => {
    const big = area(5);
    const findings = check("area-balance", { product: [big, area(3), area(2)] });
    expect(ids(findings)).toEqual([big.id]);
    expect(findings[0].message).toContain("50 percent");
  });

  it("does not apply the share check with two areas or fewer", () => {
    expect(check("area-balance", { product: [area(5), area(2)] })).toEqual([]);
  });

  it("counts a sub-area's capabilities toward the sub-area only", () => {
    const parent = node("area", {}, [cap(), cap(), area(2)]);
    expect(check("area-balance", { product: [parent, area(2), area(2)] })).toEqual([]);
  });
});

describe("run-settings", () => {
  it("passes valid run blocks on changes and tasks", () => {
    const tree = { changes: [node("change", { run: { tier: "light" } }, [node("task", { run: { review: true, maxTurns: 40 } })])] };
    expect(check("run-settings", tree)).toEqual([]);
  });

  it("warns, never errors, on a malformed or newer-version block and leaves the rest of the tree clean", () => {
    const bad = node("task", { run: { tier: "gigantic" } });
    const newer = node("task", { run: { tier: "heavy", futureKey: 1 } });
    const healthy = node("task", { run: { tier: "heavy" } });
    const tree: V2Tree = { product: [], changes: [node("change", { spike: true }, [bad, newer, healthy])] };
    const findings = checkV2Rules(tree, { now: NOW });
    expect(findings.map((f) => [f.rule, f.severity, f.nodeId])).toEqual([
      ["run-settings", "warning", bad.id],
      ["run-settings", "warning", newer.id],
    ]);
    expect(findings[0].message).toContain('run.tier: ');
    expect(findings[1].message).toContain('unknown key "futureKey"');
  });

  it("warns on a run block a subtask or product node carries", () => {
    const subtask = node("subtask", { run: { tier: "heavy" } });
    const capability = cap({ run: {} });
    const findings = checkV2Rules({ product: [node("area", {}, [capability, cap()]), node("area", {}, [cap(), cap()])], changes: [node("change", { touches: ["x"] }, [node("task", {}, [subtask])])] }, { now: NOW }, ["run-settings"]);
    expect(ids(findings)).toEqual([capability.id, subtask.id]);
    expect(findings[1].message).toContain("only changes and tasks");
  });
});

describe("retired-state-field", () => {
  it("warns on a node that still carries stored commits, naming why they are ignored", () => {
    const stale = node("task", { commits: [{ hash: "a".repeat(40), author: "R", authorEmail: "r@x", timestamp: "t" }] });
    const tree: V2Tree = { product: [node("area", { id: "a" }, [cap({ id: "x" }), cap(), cap()])], changes: [node("change", { touches: ["x"] }, [stale, node("task")])] };
    const findings = checkV2Rules(tree, { now: NOW });
    expect(findings.map((f) => [f.rule, f.severity, f.nodeId])).toEqual([["retired-state-field", "warning", stale.id]]);
    expect(findings[0].message).toContain('"commits"');
    expect(findings[0].message).toContain("N-DX-Item");
  });
});

describe("unreviewed-spec", () => {
  const RULE = "No card numbers in logs";

  it("passes capabilities and constraints whose reviewedHash is their current spec hash", () => {
    const constraint = node("constraint", { statement: RULE, reviewedHash: specHash({ statement: RULE }) });
    expect(check("unreviewed-spec", { product: [cap(), constraint] })).toEqual([]);
  });

  it("warns on an unreviewed capability or constraint", () => {
    const capability = cap({ reviewedHash: undefined });
    const constraint = node("constraint", { statement: RULE });
    expect(ids(check("unreviewed-spec", { product: [capability, constraint, node("area")] }))).toEqual([capability.id, constraint.id]);
  });

  it("warns once the spec is edited after review", () => {
    const capability = cap({ reviewedHash: specHash({ statement: "Users can do a thing", criteria: [] }) });
    const constraint = node("constraint", { statement: `${RULE}, ever`, reviewedHash: specHash({ statement: RULE }) });
    expect(ids(check("unreviewed-spec", { product: [capability, constraint] }))).toEqual([capability.id, constraint.id]);
  });

  it("ignores the retired specReviewed flag", () => {
    const capability = cap({ reviewedHash: undefined, specReviewed: true });
    expect(ids(check("unreviewed-spec", { product: [capability] }))).toEqual([capability.id]);
  });
});

describe("check-unique and check-requirement", () => {
  const requirement = (id: string) => ({ id, title: id, category: "technical", validationType: "automated", acceptanceCriteria: [] });
  const result = (requirementId: string, at = "2026-10-05T00:00:00Z") => ({ requirementId, result: "pass", at });

  it("pass one result per current requirement", () => {
    const capability = cap({ requirements: [requirement("r1"), requirement("r2")], checks: [result("r1"), result("r2")] });
    const constraint = node("constraint", { requirements: [requirement("r3")], checks: [result("r3")] });
    expect(checkV2Rules({ product: [capability, constraint], changes: [] }, { now: NOW }, ["check-unique", "check-requirement"])).toEqual([]);
  });

  it("check-unique fails two results for one requirement, once per requirement", () => {
    const capability = cap({ requirements: [requirement("r1")], checks: [result("r1"), result("r1", "2026-10-06T00:00:00Z"), result("r1")] });
    const findings = check("check-unique", { product: [capability] });
    expect(ids(findings)).toEqual([capability.id]);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].message).toContain('3 check results for requirement "r1"');
  });

  it("check-requirement warns once per result whose requirement the node no longer has", () => {
    const capability = cap({ requirements: [requirement("r1")], checks: [result("r1"), result("dropped")] });
    const bare = node("area", { checks: [result("r9")] });
    const findings = check("check-requirement", { product: [capability, bare] });
    expect(findings.map((f) => [f.nodeId, f.severity])).toEqual([
      [capability.id, "warning"],
      [bare.id, "warning"],
    ]);
    expect(findings[0].message).toContain('"dropped"');
  });
});

describe("retired-state-field", () => {
  it("warns once per retired key a node still carries, naming the key", () => {
    const capability = cap({ specReviewed: true });
    const change = node("change", { touches: ["x"], appliedIn: "e3d7052fe" });
    const findings = check("retired-state-field", { product: [capability], changes: [change] });
    expect(ids(findings)).toEqual([capability.id, change.id]);
    expect(findings[0].message).toContain('"specReviewed"');
    expect(findings[0].message).toContain(RETIRED_STATE_FIELDS.specReviewed);
    expect(findings[1].message).toContain('"appliedIn"');
  });

  it("is silent on a tree with no retired keys", () => {
    expect(check("retired-state-field", { product: [cap()], changes: [node("change", { appliedAt: "2026-10-05T00:00:00.000Z" })] })).toEqual([]);
  });
});
