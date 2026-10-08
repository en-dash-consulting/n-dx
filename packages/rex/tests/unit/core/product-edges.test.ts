import { describe, it, expect } from "vitest";
import { computeEdges, deriveChangeKind, resolveNode, type ChangeKind } from "../../../src/core/product-edges.js";
import { indexTree, type RuleNode, type V2Tree } from "../../../src/schema/v2-rules.js";
import type { Amendment, ChangeNode } from "../../../src/schema/v2.js";

const node = (fields: Record<string, unknown>): RuleNode => ({ title: fields.id as string, slug: fields.id as string, ...fields }) as RuleNode;
const cap = (id: string, extra: Record<string, unknown> = {}) => node({ id, type: "capability", ...extra });
const change = (id: string, extra: Record<string, unknown> = {}) => node({ id, type: "change", ...extra });
const amend = (target: string, delta: Amendment["delta"]): Amendment => ({ target, delta, summary: "s" });

const tree = (product: RuleNode[], changes: RuleNode[]): V2Tree => ({ product, changes });

describe("deriveChangeKind (design table)", () => {
  const product = [
    node({ id: "area", type: "area", children: [cap("cap-a"), cap("cap-b")] }),
    node({ id: "con", type: "constraint", appliesTo: "all" }),
  ];
  const index = indexTree(tree(product, []));
  const kind = (c: RuleNode, fixed?: string[]) => deriveChangeKind(c as ChangeNode, index, { fixed: new Set(fixed) });

  const rows: [string, RuleNode, ChangeKind | undefined, string[]?][] = [
    ["amends · added", change("c", { amends: [amend("cap-a", "added")] }), "feature"],
    ["amends · modified", change("c", { amends: [amend("cap-a", "modified")] }), "enhancement"],
    ["amends · removed", change("c", { amends: [amend("cap-a", "removed")] }), "retirement"],
    ["touches, capability went failing to met", change("c", { touches: ["cap-a"] }), "fix", ["cap-a"]],
    ["touches, no status change", change("c", { touches: ["cap-a"] }), "refactor"],
    ["touches a capability another change fixed", change("c", { touches: ["cap-a"] }), "refactor", ["cap-b"]],
    ["amends a constraint", change("c", { amends: [amend("con", "modified")] }), "policy-change"],
    ["neither, spike", change("c", { spike: true }), "spike"],
    ["neither, not a spike", change("c", {}), undefined],
  ];
  it.each(rows)("%s", (_name, c, expected, fixed) => {
    expect(kind(c, fixed)).toBe(expected);
  });

  it("ranks a constraint above other amendments, and amendments above touches", () => {
    expect(kind(change("c", { amends: [amend("cap-a", "added"), amend("con", "modified")] }))).toBe("policy-change");
    expect(kind(change("c", { amends: [amend("cap-a", "removed"), amend("cap-b", "added")] }))).toBe("feature");
    expect(kind(change("c", { amends: [amend("cap-a", "modified")], touches: ["cap-b"] }), ["cap-b"])).toBe("enhancement");
  });

  it("reads a target through an alias, and a refused ref as no relationship", () => {
    const aliased = indexTree(tree([node({ id: "con", type: "constraint", aliases: ["old-con"] })], []));
    expect(deriveChangeKind(change("c", { amends: [amend("old-con", "modified")] }) as ChangeNode, aliased)).toBe("policy-change");
    expect(deriveChangeKind(change("c", { touches: ["nowhere"] }) as ChangeNode, aliased)).toBeUndefined();
  });
});

describe("computeEdges", () => {
  const t = tree(
    [
      node({
        id: "area",
        type: "area",
        children: [cap("cap-a", { aliases: ["folded-a"] }), cap("cap-b"), cap("cap-c")],
      }),
      node({ id: "con-all", type: "constraint", appliesTo: "all" }),
      node({ id: "con-some", type: "constraint", appliesTo: ["folded-a", "area"] }),
      node({ id: "con-none", type: "constraint" }),
    ],
    [
      change("ch-1", { amends: [amend("folded-a", "modified"), amend("cap-b", "modified")] }),
      change("ch-2", { amends: [amend("cap-a", "modified")], touches: ["cap-b", "cap-c"] }),
      change("ch-gone", { status: "deleted", amends: [amend("cap-a", "modified")] }),
      change("ch-cancelled", { status: "cancelled", amends: [amend("cap-a", "modified")], touches: ["cap-c"] }),
      change("ch-dangling", { amends: [amend("nowhere", "modified")] }),
    ],
  );
  const edges = computeEdges(t);

  it("changedBy inverts amends, resolving aliases and skipping deleted changes and unresolved targets", () => {
    expect(edges.changedBy).toEqual({ "cap-a": ["ch-1", "ch-2"], "cap-b": ["ch-1", "ch-2"], "cap-c": ["ch-2"] });
  });

  it("changedBy also inverts touches, and a cancelled change adds no edge", () => {
    expect(edges.changedBy["cap-c"]).toEqual(["ch-2"]);
    expect(edges.changedBy["cap-a"]).not.toContain("ch-cancelled");
    expect(edges.coChanges["cap-c"]?.find((c) => c.id === "cap-a")?.changes).toBe(1);
  });

  it("a constraint on an area binds its descendant capabilities", () => {
    expect(edges.boundBy["cap-c"]).toEqual(["con-all", "con-some"]);
    const nested = computeEdges(tree([
      node({ id: "a", type: "area", children: [node({ id: "k", type: "capability", children: [cap("k2")] })] }),
      node({ id: "con", type: "constraint", appliesTo: ["k"] }),
    ], []));
    expect(nested.boundBy).toEqual({ k: ["con"], k2: ["con"] });
  });

  it("boundBy inverts appliesTo: all binds capabilities, ids resolve through aliases", () => {
    expect(edges.boundBy["cap-a"]).toEqual(["con-all", "con-some"]);
    expect(edges.boundBy["cap-b"]).toEqual(["con-all", "con-some"]);
    expect(edges.boundBy["area"]).toEqual(["con-some"]);
    expect(edges.boundBy["con-all"]).toBeUndefined();
  });

  it("coChanges counts shared amended or touched changes, most shared first", () => {
    expect(edges.coChanges["cap-a"]).toEqual([
      { id: "cap-b", changes: 2 },
      { id: "cap-c", changes: 1 },
    ]);
    expect(edges.coChanges["cap-c"]).toEqual([
      { id: "cap-a", changes: 1 },
      { id: "cap-b", changes: 1 },
    ]);
  });
});

describe("resolveNode", () => {
  const t = tree([cap("cap-a", { displayId: "A4.1", aliases: ["folded-a"] })], []);

  it("returns the node an aliased id was folded into", () => {
    expect(resolveNode(t, "folded-a")?.id).toBe("cap-a");
    expect(resolveNode(t, "A4.1")?.id).toBe("cap-a");
    expect(resolveNode(t, "cap-a")?.id).toBe("cap-a");
    expect(resolveNode(t, "unknown")).toBeUndefined();
  });
});
