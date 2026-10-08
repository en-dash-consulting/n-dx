import { describe, it, expect } from "vitest";
import { computeEdges, deriveChangeKind, productIndex, resolveNode, type ChangeKind } from "../../../src/core/product-edges.js";
import type { RuleNode, V2Tree } from "../../../src/schema/v2-rules.js";
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
  const index = productIndex(tree(product, []));
  const kind = (c: RuleNode) => deriveChangeKind(c as ChangeNode, index);

  const rows: [string, RuleNode, ChangeKind | undefined][] = [
    ["amends · added", change("c", { amends: [amend("cap-a", "added")] }), "feature"],
    ["amends · modified", change("c", { amends: [amend("cap-a", "modified")] }), "enhancement"],
    ["amends · removed", change("c", { amends: [amend("cap-a", "removed")] }), "retirement"],
    ["fix: true, touches", change("c", { fix: true, touches: ["cap-a"] }), "fix"],
    ["fix: true, amends · modified", change("c", { fix: true, amends: [amend("cap-a", "modified")] }), "fix"],
    ["fix: true, amends a constraint · modified", change("c", { fix: true, amends: [amend("con", "modified")] }), "fix"],
    ["fix: true, amends · added", change("c", { fix: true, amends: [amend("cap-a", "added")] }), "feature"],
    ["fix: true, amends · removed", change("c", { fix: true, amends: [amend("cap-a", "removed")] }), "retirement"],
    ["touches", change("c", { touches: ["cap-a"] }), "refactor"],
    ["amends a constraint", change("c", { amends: [amend("con", "modified")] }), "policy-change"],
    ["neither, spike", change("c", { spike: true }), "spike"],
    ["neither, not a spike", change("c", {}), undefined],
  ];
  it.each(rows)("%s", (_name, c, expected) => {
    expect(kind(c)).toBe(expected);
  });

  it("reads the type of an added amendment: a new constraint is a policy change, a capability or no type a feature", () => {
    const added = (type?: Amendment["type"]): Amendment => ({ target: "new", delta: "added", summary: "s", under: "area", ...(type ? { type } : {}) });
    expect(kind(change("c", { amends: [added("constraint")] }))).toBe("policy-change");
    expect(kind(change("c", { amends: [added("capability")] }))).toBe("feature");
    expect(kind(change("c", { amends: [added()] }))).toBe("feature");
  });

  it("ranks a constraint above other amendments, and amendments above touches", () => {
    expect(kind(change("c", { amends: [amend("cap-a", "added"), amend("con", "modified")] }))).toBe("policy-change");
    expect(kind(change("c", { amends: [amend("cap-a", "removed"), amend("cap-b", "added")] }))).toBe("feature");
    expect(kind(change("c", { amends: [amend("cap-a", "modified")], touches: ["cap-b"] }))).toBe("enhancement");
  });

  it("reads a target through an alias, and a refused ref as no relationship", () => {
    const aliased = productIndex(tree([node({ id: "con", type: "constraint", aliases: ["old-con"] })], []));
    expect(deriveChangeKind(change("c", { amends: [amend("old-con", "modified")] }) as ChangeNode, aliased)).toBe("policy-change");
    expect(deriveChangeKind(change("c", { touches: ["nowhere"] }) as ChangeNode, aliased)).toBeUndefined();
  });
});

describe("history after a retirement", () => {
  const APPLIED = "2026-10-01T00:00:00.000Z";
  /** As apply leaves it: `old-con` and `cap-old` are deleted, and the change that removed each is applied. */
  const retired = tree(
    [
      node({ id: "area", type: "area", children: [cap("cap-live"), cap("cap-old", { status: "deleted", aliases: ["folded-old"] })] }),
      node({ id: "old-con", type: "constraint", status: "deleted", aliases: ["con-alias"] }),
    ],
    [
      change("tighten", { appliedAt: APPLIED, amends: [amend("con-alias", "modified")] }),
      change("drop-con", { appliedAt: APPLIED, amends: [amend("old-con", "removed")] }),
      change("improve", { appliedAt: APPLIED, amends: [amend("folded-old", "modified")], touches: ["cap-live"] }),
      change("drop-cap", { appliedAt: APPLIED, amends: [amend("cap-old", "removed")] }),
    ],
  );

  it("deriveChangeKind keeps an earlier change to a since-retired constraint a policy change", () => {
    const kind = (id: string) => deriveChangeKind(retired.changes.find((c) => c.id === id) as ChangeNode, productIndex(retired));
    expect(kind("tighten")).toBe("policy-change");
    expect(kind("drop-con")).toBe("policy-change");
    expect(kind("improve")).toBe("enhancement");
  });

  it("computeEdges keeps changedBy and coChanges on retired nodes", () => {
    const edges = computeEdges(retired);
    expect(edges.changedBy["old-con"]).toEqual(["tighten", "drop-con"]);
    expect(edges.changedBy["cap-old"]).toEqual(["improve", "drop-cap"]);
    expect(edges.coChanges["cap-live"]).toEqual([{ id: "cap-old", changes: 1 }]);
  });

  it("a retired constraint binds nothing, and a retired capability is bound by nothing", () => {
    const edges = computeEdges(tree(
      [
        node({ id: "area", type: "area", children: [cap("cap-live"), cap("cap-old", { status: "deleted" })] }),
        node({ id: "con-all", type: "constraint", appliesTo: "all" }),
        node({ id: "con-area", type: "constraint", appliesTo: ["area"] }),
        node({ id: "old-con", type: "constraint", status: "deleted", appliesTo: "all" }),
      ],
      [],
    ));
    expect(edges.boundBy).toEqual({ area: ["con-area"], "cap-live": ["con-all", "con-area"] });
  });

  it("resolveNode finds a retired node through its id or alias, live nodes first", () => {
    expect(resolveNode(retired, "folded-old")?.id).toBe("cap-old");
    expect(resolveNode(retired, "old-con")?.id).toBe("old-con");
    const shadowed = tree([cap("gone", { status: "deleted", aliases: ["live"] }), cap("live")], []);
    expect(resolveNode(shadowed, "live")).toBe(shadowed.product[1]);
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
