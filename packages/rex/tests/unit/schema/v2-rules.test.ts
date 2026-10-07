import { describe, it, expect } from "vitest";
import {
  checkV2Rules,
  specHash,
  titleReleaseToken,
  RULE_SEVERITY,
  V2_RULE_IDS,
  type RuleNode,
  type V2RuleId,
  type V2Tree,
} from "../../../src/schema/v2-rules.js";

const NOW = new Date("2026-10-06T00:00:00Z");
let seq = 0;

function node(type: RuleNode["type"], fields: Record<string, unknown> = {}, children: RuleNode[] = []): RuleNode {
  seq += 1;
  const id = (fields.id as string | undefined) ?? `${type}-${seq}`;
  return { id, type, title: `${type} ${seq}`, slug: id, children, ...fields } as RuleNode;
}

/** A capability that passes every capability rule. */
function cap(fields: Record<string, unknown> = {}, children: RuleNode[] = []): RuleNode {
  return node("capability", { statement: "Users can do a thing", criteria: [{ id: "c1", text: "It works" }], specReviewed: true, ...fields }, children);
}

function check(rule: V2RuleId, tree: Partial<V2Tree>, now = NOW) {
  return checkV2Rules({ product: [], changes: [], ...tree }, { now }, [rule]);
}

const ids = (findings: { nodeId: string }[]) => findings.map((f) => f.nodeId);

describe("rule table", () => {
  it("errors precede warnings and every rule has a severity", () => {
    const severities = V2_RULE_IDS.map((id) => RULE_SEVERITY[id]);
    expect(severities.indexOf("warning")).toBe(severities.lastIndexOf("error") + 1);
    expect(V2_RULE_IDS).toHaveLength(13);
  });

  it("a healthy tree has no findings", () => {
    const area = (n: number) => node("area", {}, Array.from({ length: n }, () => cap()));
    const tree: V2Tree = {
      product: [area(2), area(2), area(2)],
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

describe("removed-target-live", () => {
  const removes = (target: string, fields: Record<string, unknown> = {}) =>
    node("change", { amends: [{ target, delta: "removed", summary: "retire" }], ...fields });

  it("passes a removal of a live product node", () => {
    expect(check("removed-target-live", { product: [cap({ id: "a" })], changes: [removes("a")] })).toEqual([]);
  });

  it("fails a removal of a missing, deleted or change-layer node", () => {
    const missing = removes("nope");
    const gone = removes("gone");
    const task = node("task", { id: "t" });
    const wrongLayer = removes("t");
    const findings = check("removed-target-live", {
      product: [cap({ id: "gone", status: "deleted" })],
      changes: [missing, gone, wrongLayer, node("change", {}, [task])],
    });
    expect(ids(findings)).toEqual([missing.id, gone.id, wrongLayer.id]);
  });

  it("does not judge applied or closed changes, whose removals already happened", () => {
    const changes = [removes("gone", { appliedIn: "abc123" }), removes("gone", { status: "completed" }), removes("gone", { status: "cancelled" })];
    expect(check("removed-target-live", { changes })).toEqual([]);
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
  });

  it("warns on a node revised past the threshold with no open change", () => {
    const closed = node("change", { status: "completed", amends: [{ target: "r", delta: "modified", summary: "s" }] });
    const findings = check("long-revised", { product: [revised()], changes: [closed] });
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
    const tree: V2Tree = { product: [], changes: [node("change", { touches: ["x"] }, [bad, newer, healthy])] };
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
    const tree: V2Tree = { product: [], changes: [node("change", { touches: ["x"] }, [stale, node("task")])] };
    const findings = checkV2Rules(tree, { now: NOW });
    expect(findings.map((f) => [f.rule, f.severity, f.nodeId])).toEqual([["retired-state-field", "warning", stale.id]]);
    expect(findings[0].message).toContain('"commits"');
    expect(findings[0].message).toContain("N-DX-Item");
  });
});

describe("unreviewed-spec", () => {
  it("passes reviewed capabilities and constraints", () => {
    expect(check("unreviewed-spec", { product: [cap(), node("constraint", { specReviewed: true })] })).toEqual([]);
  });

  it("warns on an unreviewed capability or constraint", () => {
    const capability = cap({ specReviewed: false });
    const constraint = node("constraint");
    expect(ids(check("unreviewed-spec", { product: [capability, constraint, node("area")] }))).toEqual([capability.id, constraint.id]);
  });
});
