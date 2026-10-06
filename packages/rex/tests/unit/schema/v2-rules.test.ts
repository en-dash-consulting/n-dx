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
  return checkV2Rules({ map: [], changes: [], ...tree }, { now }, [rule]);
}

const ids = (findings: { nodeId: string }[]) => findings.map((f) => f.nodeId);

describe("rule table", () => {
  it("errors precede warnings and every rule has a severity", () => {
    const severities = V2_RULE_IDS.map((id) => RULE_SEVERITY[id]);
    expect(severities.indexOf("warning")).toBe(severities.lastIndexOf("error") + 1);
    expect(V2_RULE_IDS).toHaveLength(11);
  });

  it("a healthy tree has no findings", () => {
    const area = (n: number) => node("area", {}, Array.from({ length: n }, () => cap()));
    const tree: V2Tree = {
      map: [area(2), area(2), area(2)],
      changes: [node("change", { touches: ["x"] }, [node("task", {}, [node("subtask")])])],
    };
    expect(checkV2Rules(tree, { now: NOW })).toEqual([]);
  });

  it("ignores deleted nodes", () => {
    const tree = { changes: [node("change", { status: "deleted", title: "Ship 0.8.0" })] };
    expect(checkV2Rules({ map: [], ...tree }, { now: NOW })).toEqual([]);
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
  it.each(["0.8.0 release audit", "Ship v1.2.3", "Cut 1.0.0-beta.1", "Patch the 0.8.x line", "Prepare v1.0", "PR 12 follow-up", "Land PR #12", "pr-12 fixes", "Review pull request 7"])(
    "flags %j",
    (title) => {
      expect(titleReleaseToken(title)).toBeDefined();
    },
  );

  it.each(["Add the v2 node types and fields", "Dashboard landing page", "Keep cohesion above 0.5", "Fix issue #12", "PRD storage", "Python 3.12 support"])(
    "accepts %j",
    (title) => {
      expect(titleReleaseToken(title)).toBeUndefined();
    },
  );

  it("checks every node in both layers", () => {
    const capability = cap({ title: "PR 12 capability" });
    const task = node("task", { title: "Prep 0.8.0" });
    const plain = cap({ title: "Plain" });
    const findings = check("title-release-token", { map: [node("area", {}, [capability, plain])], changes: [node("change", { touches: ["x"] }, [task])] });
    expect(ids(findings)).toEqual([capability.id, task.id]);
    expect(findings[0].message).toContain('"PR 12"');
  });
});

describe("layer-nesting", () => {
  it("passes nodes under a parent of their own layer", () => {
    const map = [node("area", {}, [cap({}, [cap()]), node("constraint")])];
    const changes = [node("change", {}, [node("task", {}, [node("subtask")])])];
    expect(check("layer-nesting", { map, changes })).toEqual([]);
  });

  it("fails a change-layer node under a map node, and the reverse", () => {
    const task = node("task");
    const capability = cap();
    const findings = check("layer-nesting", { map: [node("area", {}, [task])], changes: [node("change", {}, [capability])] });
    expect(ids(findings)).toEqual([task.id, capability.id]);
  });

  it("fails a root loaded under the other layer's root", () => {
    const change = node("change");
    const area = node("area");
    expect(ids(check("layer-nesting", { map: [change], changes: [area] }))).toEqual([change.id, area.id]);
  });
});

describe("capability-depth", () => {
  it("passes one level of capability nesting", () => {
    expect(check("capability-depth", { map: [node("area", {}, [cap({}, [cap()])])] })).toEqual([]);
  });

  it("fails a capability two levels deep", () => {
    const deep = cap();
    expect(ids(check("capability-depth", { map: [node("area", {}, [cap({}, [cap({}, [deep])])])] }))).toEqual([deep.id]);
  });
});

describe("depends-on-acyclic", () => {
  it("passes a dependency chain, resolving display ids and aliases", () => {
    const a = cap({ id: "a", displayId: "A1.1" });
    const b = cap({ id: "b", aliases: ["old-b"], dependsOn: ["A1.1"] });
    const c = cap({ id: "c", dependsOn: ["old-b", "a", "missing"] });
    expect(check("depends-on-acyclic", { map: [node("area", {}, [a, b, c])] })).toEqual([]);
  });

  it("fails a cycle once, naming its path", () => {
    const a = cap({ id: "a", title: "A", dependsOn: ["b"] });
    const b = cap({ id: "b", title: "B", dependsOn: ["c"] });
    const c = cap({ id: "c", title: "C", dependsOn: ["a"] });
    const findings = check("depends-on-acyclic", { map: [node("area", {}, [a, b, c])] });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toBe('dependsOn cycle: "A" → "B" → "C" → "A"');
  });

  it("fails a self-dependency", () => {
    const a = cap({ id: "a", dependsOn: ["a"] });
    expect(ids(check("depends-on-acyclic", { map: [a] }))).toEqual(["a"]);
  });
});

describe("removed-target-live", () => {
  const removes = (target: string, fields: Record<string, unknown> = {}) =>
    node("change", { amends: [{ target, delta: "removed", summary: "retire" }], ...fields });

  it("passes a removal of a live map node", () => {
    expect(check("removed-target-live", { map: [cap({ id: "a" })], changes: [removes("a")] })).toEqual([]);
  });

  it("fails a removal of a missing, deleted or change-layer node", () => {
    const missing = removes("nope");
    const gone = removes("gone");
    const task = node("task", { id: "t" });
    const wrongLayer = removes("t");
    const findings = check("removed-target-live", {
      map: [cap({ id: "gone", status: "deleted" })],
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
    expect(check("capability-statement", { map: [cap()] })).toEqual([]);
  });

  it("fails a missing or blank statement", () => {
    const none = cap({ statement: undefined });
    const blank = cap({ statement: "  " });
    expect(ids(check("capability-statement", { map: [none, blank] }))).toEqual([none.id, blank.id]);
  });
});

describe("capability-criteria", () => {
  it("passes a capability with criteria", () => {
    expect(check("capability-criteria", { map: [cap()] })).toEqual([]);
  });

  it("warns on missing or empty criteria", () => {
    const none = cap({ criteria: undefined });
    const empty = cap({ criteria: [] });
    const findings = check("capability-criteria", { map: [none, empty] });
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
    cap({ id: "r", metAt: specHash(met), lastModified: "2026-09-01T00:00:00Z", ...fields });

  it("passes met, proposed, recently revised, and amended nodes", () => {
    const map = [
      cap({ ...met, metAt: specHash(met), lastModified: "2026-01-01T00:00:00Z" }),
      cap({ lastModified: "2026-01-01T00:00:00Z" }),
      cap({ metAt: specHash(met), lastModified: "2026-10-01T00:00:00Z" }),
      cap({ metAt: specHash(met) }),
    ];
    expect(check("long-revised", { map })).toEqual([]);
    const amending = node("change", { amends: [{ target: "r", delta: "modified", summary: "s" }] });
    expect(check("long-revised", { map: [revised()], changes: [amending] })).toEqual([]);
  });

  it("warns on a node revised past the threshold with no open change", () => {
    const closed = node("change", { status: "completed", amends: [{ target: "r", delta: "modified", summary: "s" }] });
    const findings = check("long-revised", { map: [revised()], changes: [closed] });
    expect(ids(findings)).toEqual(["r"]);
    expect(findings[0].message).toContain("35 days");
  });

  it("covers constraints and honours the threshold option", () => {
    const constraint = node("constraint", { statement: "New", metAt: specHash({ statement: "Old" }), lastModified: "2026-10-01T00:00:00Z" });
    const tree = { map: [constraint], changes: [] };
    expect(checkV2Rules(tree, { now: NOW }, ["long-revised"])).toEqual([]);
    expect(ids(checkV2Rules(tree, { now: NOW, longRevisedDays: 3 }, ["long-revised"]))).toEqual([constraint.id]);
  });
});

describe("area-balance", () => {
  const area = (n: number, fields: Record<string, unknown> = {}) =>
    node("area", fields, Array.from({ length: n }, () => cap()));

  it("passes balanced areas, counting nested capabilities", () => {
    const map = [area(3), area(3), node("area", {}, [cap({}, [cap()]), cap()])];
    expect(check("area-balance", { map })).toEqual([]);
  });

  it("warns on an area with fewer than two capabilities", () => {
    const small = area(1);
    const empty = area(0);
    expect(ids(check("area-balance", { map: [area(2), area(2), area(2), small, empty] }))).toEqual([small.id, empty.id]);
  });

  it("warns on an area over 40 percent of capabilities", () => {
    const big = area(5);
    const findings = check("area-balance", { map: [big, area(3), area(2)] });
    expect(ids(findings)).toEqual([big.id]);
    expect(findings[0].message).toContain("50 percent");
  });

  it("does not apply the share check with two areas or fewer", () => {
    expect(check("area-balance", { map: [area(5), area(2)] })).toEqual([]);
  });

  it("counts a sub-area's capabilities toward the sub-area only", () => {
    const parent = node("area", {}, [cap(), cap(), area(2)]);
    expect(check("area-balance", { map: [parent, area(2), area(2)] })).toEqual([]);
  });
});

describe("unreviewed-spec", () => {
  it("passes reviewed capabilities and constraints", () => {
    expect(check("unreviewed-spec", { map: [cap(), node("constraint", { specReviewed: true })] })).toEqual([]);
  });

  it("warns on an unreviewed capability or constraint", () => {
    const capability = cap({ specReviewed: false });
    const constraint = node("constraint");
    expect(ids(check("unreviewed-spec", { map: [capability, constraint, node("area")] }))).toEqual([capability.id, constraint.id]);
  });
});
