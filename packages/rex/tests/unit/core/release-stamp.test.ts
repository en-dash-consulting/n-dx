import { describe, it, expect } from "vitest";
import type { V2Tree } from "../../../src/schema/v2-rules.js";
import type { ChangeLanding } from "../../../src/core/change-landing.js";
import { parseReleaseVersion, planReleaseStamp, type ReleaseStampInputs } from "../../../src/core/release-stamp.js";

const node = (id: string, fields: Record<string, unknown>) => ({ id, title: id, slug: id, ...fields });
const landed = (commit: string): ChangeLanding => ({ landed: true, commit, lastCommit: commit });

const inputs = (overrides: Partial<ReleaseStampInputs> = {}): ReleaseStampInputs => ({
  version: "2.0.0",
  applyOn: "complete",
  landings: {},
  released: new Set(),
  appliedAt: "2026-10-09T00:00:00.000Z",
  now: new Date("2026-10-09T00:00:00.000Z"),
  ...overrides,
});

describe("parseReleaseVersion", () => {
  it("accepts X.Y.Z and vX.Y.Z only", () => {
    expect(parseReleaseVersion("1.2.3")).toBe("1.2.3");
    expect(parseReleaseVersion("v1.2.3")).toBe("1.2.3");
    for (const bad of ["1.2.3-rc.1", "v1.2", "@n-dx/rex@1.2.3", " 1.2.3", "V1.2.3"]) expect(parseReleaseVersion(bad), bad).toBeUndefined();
  });
});

describe("planReleaseStamp", () => {
  it("stamps only live, finished, unstamped, landed, unreleased changes, and never tasks or product nodes", () => {
    const tree = {
      product: [node("cap", { type: "capability", status: "completed" })],
      changes: [
        node("ship", { type: "change", status: "completed", children: [node("task", { type: "task", status: "completed" })] }),
        node("applied", { type: "change", status: "in_progress", appliedAt: "2026-10-01T00:00:00.000Z" }),
        node("stamped", { type: "change", status: "completed", shippedIn: "1.0.0" }),
        node("open", { type: "change", status: "in_progress" }),
        node("cancelled", { type: "change", status: "cancelled" }),
        node("retired", { type: "change", status: "deleted" }),
        node("old", { type: "change", status: "completed" }),
        node("unlanded", { type: "change", status: "completed" }),
      ],
    } as unknown as V2Tree;
    const before = structuredClone(tree);
    const landings: Record<string, ChangeLanding> = {
      ship: landed("a"),
      applied: landed("b"),
      stamped: landed("c"),
      open: { landed: false, reason: "change still open" },
      old: landed("d"),
      unlanded: { landed: false, reason: "no commit" },
    };

    const plan = planReleaseStamp(tree, inputs({ landings, released: new Set(["d"]) }));

    expect(plan.report).toEqual({
      version: "2.0.0",
      applied: [],
      stamped: ["ship", "applied"],
      skipped: [{ id: "unlanded", reason: "no commit" }],
    });
    expect(plan.changed).toBe(true);
    const shipped = (id: string) => [...plan.tree.product, ...plan.tree.changes].flatMap((n) => [n, ...(n.children ?? [])]).find((n) => n.id === id)?.shippedIn;
    expect(["ship", "applied", "stamped", "task", "cap", "old"].map(shipped)).toEqual(["2.0.0", "2.0.0", "1.0.0", undefined, undefined, undefined]);
    expect(tree).toEqual(before);
  });

  it("reports no change when nothing is stamped", () => {
    const tree = { product: [], changes: [node("stamped", { type: "change", status: "completed", shippedIn: "1.0.0" })] } as unknown as V2Tree;
    const plan = planReleaseStamp(tree, inputs({ landings: { stamped: landed("c") } }));
    expect(plan.changed).toBe(false);
    expect(plan.tree).toEqual(tree);
  });
});
