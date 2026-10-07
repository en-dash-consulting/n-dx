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
const cap = (id: string, extra: Record<string, unknown> = {}) => node({ id, type: "capability", statement, criteria, metAt: MET, ...extra });
const change = (id: string, extra: Record<string, unknown> = {}) => node({ id, type: "change", ...extra });
const amend = (target: string, delta: Amendment["delta"]): Amendment => ({ target, delta, summary: "s" });
const check = (result: CheckResult["result"]): CheckResult => ({ requirementId: "r1", result, at: "2026-10-01T00:00:00.000Z" });

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
        cap("failing", { checks: [check("fail")] }),
        cap("retired"),
        cap("fixing"),
        cap("cancelled-amend"),
      ],
    }),
    node({ id: "con-met", type: "constraint", statement, metAt: specHash({ statement }) }),
    node({ id: "con-defective", type: "constraint", statement, metAt: specHash({ statement }), checks: [check("fail")] }),
  ],
  changes: [
    change("open-amend", { amends: [amend("changing", "modified")] }),
    change("applied-removal", { status: "completed", appliedIn: "abc123", amends: [amend("retired", "removed")] }),
    change("open-fix", { touches: ["fixing"] }),
    change("cancelled", { status: "cancelled", amends: [amend("cancelled-amend", "modified")] }),
  ],
});

describe("computeProductStatus", () => {
  const result = computeProductStatus(fixture(), { fixed: new Set(["fixing"]) });

  const rows: [string, ProductStatus][] = [
    ["met", { status: "met", health: "ok" }],
    ["proposed", { status: "proposed", health: "ok" }],
    ["changing", { status: "changing", health: "ok" }],
    ["revised", { status: "revised", health: "ok" }],
    ["failing", { status: "failing", health: "defective" }],
    ["retired", { status: "retired", health: "ok" }],
    ["fixing", { status: "met", health: "defective" }],
    ["cancelled-amend", { status: "met", health: "ok" }],
    ["con-met", { status: "met", health: "ok" }],
    ["con-defective", { status: "failing", health: "defective" }],
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

  it("ranks retired over changing, and changing over proposed and revised", () => {
    const tree: V2Tree = {
      product: [cap("a", { metAt: undefined }), cap("b", { statement: "edited" }), cap("c")],
      changes: [
        change("x", { amends: [amend("a", "modified"), amend("b", "modified")] }),
        change("y", { amends: [amend("c", "modified")] }),
        change("z", { appliedIn: "abc123", amends: [amend("c", "removed")] }),
      ],
    };
    const out = computeProductStatus(tree);
    expect([out.a.status, out.b.status, out.c.status]).toEqual(["changing", "changing", "retired"]);
  });

  it("does not read a touching change as a fix without the fixed ids", () => {
    expect(computeProductStatus(fixture()).fixing).toEqual({ status: "met", health: "ok" });
  });

  it("resolves aliases on amendment targets", () => {
    const tree: V2Tree = { product: [cap("new", { aliases: ["old"] })], changes: [change("x", { amends: [amend("old", "modified")] })] };
    expect(computeProductStatus(tree).new.status).toBe("changing");
  });

  it("does not mutate the tree", () => {
    const tree = fixture();
    const before = structuredClone(tree);
    computeProductStatus(tree, { fixed: new Set(["fixing"]) });
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
