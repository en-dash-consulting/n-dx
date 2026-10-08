import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeProductStatus, HEALTH_VALUES, INTENT_STATUSES, type ProductStatus } from "../../../src/core/product-status.js";
import { specHash, type RuleNode, type V2Tree } from "../../../src/schema/v2-rules.js";
import type { Amendment, CheckResult, Criterion } from "../../../src/schema/v2.js";
import { loadPrdModel } from "../../../src/store/prd-model-reader.js";
import { copyV2Fixture } from "../../helpers/v2-fixture.js";

const node = (fields: Record<string, unknown>): RuleNode => ({ title: fields.id as string, slug: fields.id as string, ...fields }) as RuleNode;
const criteria: Criterion[] = [{ id: "c1", text: "works" }];
const statement = "does the thing";
const MET = specHash({ statement, criteria });
const requirement = (id: string) => ({ id, title: id, category: "technical", validationType: "automated", acceptanceCriteria: [] });
const requirements = [requirement("r1")];
const cap = (id: string, extra: Record<string, unknown> = {}) =>
  node({ id, type: "capability", statement, criteria, metAt: MET, requirements, ...extra });
const change = (id: string, extra: Record<string, unknown> = {}) => node({ id, type: "change", ...extra });
const amend = (target: string, delta: Amendment["delta"]): Amendment => ({ target, delta, summary: "s" });
const check = (result: CheckResult["result"], requirementId = "r1", at = "2026-10-01T00:00:00.000Z"): CheckResult => ({ requirementId, result, at });

/** One node per status and health value, with the changes that put it there. */
const fixture = (): V2Tree => ({
  product: [
    node({
      id: "area",
      type: "area",
      children: [
        cap("met", { checks: [check("pass"), check("skipped")] }),
        cap("proposed", { metAt: undefined }),
        cap("changing"),
        cap("revised", { statement: "does another thing" }),
        cap("check-fails", { checks: [check("fail")] }),
        cap("retired", { status: "deleted" }),
        cap("fixing", { checks: [check("pass")] }),
        cap("fix-amended"),
        cap("applied-fix"),
        cap("cancelled-amend"),
      ],
    }),
    node({ id: "con-met", type: "constraint", statement, metAt: specHash({ statement }) }),
    node({ id: "con-defective", type: "constraint", statement, metAt: specHash({ statement }), requirements, checks: [check("fail")] }),
  ],
  changes: [
    change("open-amend", { amends: [amend("changing", "modified")] }),
    change("applied-removal", { status: "completed", appliedAt: "2026-10-01T00:00:00.000Z", amends: [amend("retired", "removed")] }),
    change("open-fix", { fix: true, touches: ["fixing"] }),
    change("open-fix-amend", { fix: true, amends: [amend("fix-amended", "modified")] }),
    change("applied-fix", { fix: true, status: "completed", appliedAt: "2026-10-01T00:00:00.000Z", touches: ["applied-fix"] }),
    change("cancelled", { status: "cancelled", amends: [amend("cancelled-amend", "modified")] }),
  ],
});

describe("computeProductStatus", () => {
  const result = computeProductStatus(fixture());

  const rows: [string, ProductStatus][] = [
    ["met", { status: "met", health: "ok" }],
    ["proposed", { status: "proposed", health: "ok" }],
    ["changing", { status: "changing", health: "ok" }],
    ["revised", { status: "revised", health: "ok" }],
    ["check-fails", { status: "met", health: "defective" }],
    ["retired", { status: "retired", health: "ok" }],
    ["fixing", { status: "met", health: "defective" }],
    ["fix-amended", { status: "changing", health: "defective" }],
    ["applied-fix", { status: "met", health: "ok" }],
    ["cancelled-amend", { status: "met", health: "ok" }],
    ["con-met", { status: "met", health: "ok" }],
    ["con-defective", { status: "met", health: "defective" }],
  ];
  it.each(rows)("%s", (id, expected) => {
    expect(result[id]).toEqual(expected);
  });

  it("covers every status and health value", () => {
    const values = Object.values(result);
    expect(new Set(values.map((v) => v.status))).toEqual(new Set(INTENT_STATUSES));
    expect(new Set(values.map((v) => v.health))).toEqual(new Set(HEALTH_VALUES));
  });

  it("reports capabilities and constraints only", () => {
    expect(result.area).toBeUndefined();
    expect(result["open-amend"]).toBeUndefined();
  });

  it("ranks changing over proposed and revised", () => {
    const tree: V2Tree = {
      product: [cap("a", { metAt: undefined }), cap("b", { statement: "edited" })],
      changes: [change("x", { amends: [amend("a", "modified"), amend("b", "modified")] })],
    };
    const out = computeProductStatus(tree);
    expect([out.a.status, out.b.status]).toEqual(["changing", "changing"]);
  });

  describe("retired", () => {
    const APPLIED = "2026-10-01T00:00:00.000Z";

    it("reports a deleted node an applied change removed, as apply leaves it", () => {
      const tree: V2Tree = {
        product: [cap("gone", { status: "deleted" }), node({ id: "old-con", type: "constraint", statement, status: "deleted" })],
        changes: [change("z", { appliedAt: APPLIED, amends: [amend("gone", "removed"), amend("old-con", "removed")] })],
      };
      const out = computeProductStatus(tree);
      expect(out.gone).toEqual({ status: "retired", health: "ok" });
      expect(out["old-con"]).toEqual({ status: "retired", health: "ok" });
    });

    it("resolves the removal through an alias of the deleted node", () => {
      const tree: V2Tree = {
        product: [cap("gone", { status: "deleted", aliases: ["was-gone"] })],
        changes: [change("z", { appliedAt: APPLIED, amends: [amend("was-gone", "removed")] })],
      };
      expect(computeProductStatus(tree).gone.status).toBe("retired");
    });

    it("omits a deleted node no applied change removed", () => {
      const tree: V2Tree = {
        product: [cap("dropped", { status: "deleted" }), cap("pending-removal", { status: "deleted" })],
        changes: [change("open", { amends: [amend("pending-removal", "removed")] })],
      };
      expect(computeProductStatus(tree)).toEqual({});
    });

    it("omits the descendants of a retired node", () => {
      const tree: V2Tree = {
        product: [node({ id: "area", type: "area", status: "deleted", children: [cap("child")] }), cap("kept")],
        changes: [change("z", { appliedAt: APPLIED, amends: [amend("area", "removed")] })],
      };
      expect(Object.keys(computeProductStatus(tree))).toEqual(["kept"]);
    });

    it("lets a live id win over a retired node's alias", () => {
      const tree: V2Tree = {
        product: [cap("gone", { status: "deleted", aliases: ["live"] }), cap("live")],
        changes: [
          change("z", { appliedAt: APPLIED, amends: [amend("gone", "removed")] }),
          change("y", { amends: [amend("live", "modified")] }),
        ],
      };
      const out = computeProductStatus(tree);
      expect([out.gone.status, out.live.status]).toEqual(["retired", "changing"]);
    });

    it("does not read a deleted change as applying its removal", () => {
      const tree: V2Tree = {
        product: [cap("gone", { status: "deleted" })],
        changes: [change("z", { status: "deleted", appliedAt: APPLIED, amends: [amend("gone", "removed")] })],
      };
      expect(computeProductStatus(tree)).toEqual({});
    });
  });

  describe("building changes", () => {
    const draft = (extra: Record<string, unknown> = {}) => change("draft", { needsPlacement: true, amends: [amend("r", "modified")], ...extra });
    const statusOf = (c: RuleNode) => computeProductStatus({ product: [cap("r", { statement: "edited" })], changes: [c] }).r.status;

    it("leaves a node revised while an untouched Inbox draft amends it", () => {
      expect(statusOf(draft())).toBe("revised");
    });

    it("reads changing once the draft is placed or started", () => {
      expect(statusOf(draft({ needsPlacement: undefined }))).toBe("changing");
      expect(statusOf(draft({ status: "in_progress" }))).toBe("changing");
      expect(statusOf(draft({ status: "blocked", startedAt: "2026-10-01T00:00:00.000Z" }))).toBe("changing");
      expect(statusOf(draft({ status: "completed" }))).toBe("changing");
    });

    it("does not count a cancelled started change", () => {
      expect(statusOf(draft({ status: "cancelled", startedAt: "2026-10-01T00:00:00.000Z" }))).toBe("revised");
    });
  });

  describe("children follow an amended parent", () => {
    const tree = (c: RuleNode): V2Tree => ({
      product: [cap("parent", { children: [cap("child", { children: [cap("grandchild", { metAt: undefined })] })] }), cap("sibling")],
      changes: [c],
    });

    it("marks every sub-capability of a capability a building change amends changing", () => {
      const out = computeProductStatus(tree(change("x", { amends: [amend("parent", "modified")] })));
      expect([out.parent.status, out.child.status, out.grandchild.status, out.sibling.status]).toEqual(["changing", "changing", "changing", "met"]);
    });

    it("leaves sub-capabilities alone while the parent's change is an untouched draft", () => {
      const out = computeProductStatus(tree(change("x", { needsPlacement: true, amends: [amend("parent", "modified")] })));
      expect([out.parent.status, out.child.status]).toEqual(["met", "met"]);
    });

    it("does not mark the parent of an amended sub-capability changing", () => {
      const out = computeProductStatus(tree(change("x", { amends: [amend("child", "modified")] })));
      expect([out.parent.status, out.child.status, out.grandchild.status]).toEqual(["met", "changing", "changing"]);
    });
  });

  describe("checks", () => {
    const healthOf = (checks: CheckResult[]) => computeProductStatus({ product: [cap("c", { checks })], changes: [] }).c.health;

    it("ignores a result for a requirement the node no longer has", () => {
      expect(healthOf([check("fail", "gone"), check("pass")])).toBe("ok");
    });

    it("ignores every result when the node has no requirements", () => {
      const out = computeProductStatus({ product: [cap("c", { requirements: undefined, checks: [check("fail")] })], changes: [] });
      expect(out.c.health).toBe("ok");
    });

    it("lets the latest result per requirement win, whatever the order", () => {
      const older = check("fail", "r1", "2026-10-01T00:00:00.000Z");
      const newer = check("pass", "r1", "2026-10-02T00:00:00.000Z");
      expect(healthOf([older, newer])).toBe("ok");
      expect(healthOf([newer, older])).toBe("ok");
      expect(healthOf([check("pass", "r1", "2026-10-01T00:00:00.000Z"), check("fail", "r1", "2026-10-03T00:00:00.000Z")])).toBe("defective");
    });
  });

  describe("a retired node's health", () => {
    const APPLIED = "2026-10-01T00:00:00.000Z";

    it("is ok despite a last failing check and an open fix still aimed at it", () => {
      const tree: V2Tree = {
        product: [cap("gone", { status: "deleted", checks: [check("fail")] })],
        changes: [
          change("z", { appliedAt: APPLIED, amends: [amend("gone", "removed")] }),
          change("f", { fix: true, touches: ["gone"] }),
        ],
      };
      expect(computeProductStatus(tree).gone).toEqual({ status: "retired", health: "ok" });
    });
  });

  it("does not read an open touching change as a fix without fix: true", () => {
    const tree = fixture();
    const openFix = tree.changes.find((c) => c.id === "open-fix") as RuleNode & { fix?: boolean };
    delete openFix.fix;
    expect(computeProductStatus(tree).fixing).toEqual({ status: "met", health: "ok" });
  });

  it("resolves aliases on amendment targets", () => {
    const tree: V2Tree = { product: [cap("new", { aliases: ["old"] })], changes: [change("x", { amends: [amend("old", "modified")] })] };
    expect(computeProductStatus(tree).new.status).toBe("changing");
  });

  it("does not mutate the tree", () => {
    const tree = fixture();
    const before = structuredClone(tree);
    computeProductStatus(tree);
    expect(tree).toEqual(before);
  });
});

describe("computeProductStatus over the v2 fixture", () => {
  const snapshot = async (dir: string): Promise<Record<string, string>> => {
    const out: Record<string, string> = {};
    for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) out[join(entry.parentPath, entry.name)] = await readFile(join(entry.parentPath, entry.name), "utf-8");
    }
    return out;
  };

  it("derives status from the loaded tree and never writes intent or state files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rex-product-status-"));
    try {
      const rexDir = await copyV2Fixture(join(dir, "rex"), "lf");
      const before = await snapshot(rexDir);
      const model = await loadPrdModel(rexDir);
      const result = computeProductStatus(model.tree);
      // "Pay by card" is amended by the open "Add Apple Pay" change.
      expect(result["a0000000-0000-4000-8000-000000000002"]).toEqual({ status: "changing", health: "ok" });
      expect(await snapshot(rexDir)).toEqual(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
