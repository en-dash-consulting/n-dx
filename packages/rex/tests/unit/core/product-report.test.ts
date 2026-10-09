import { describe, it, expect } from "vitest";
import { capabilityReport, prdStatusReport, productReport, ProductReportError } from "../../../src/core/product-report.js";
import { specHash, type RuleNode, type V2Tree } from "../../../src/schema/v2-rules.js";
import type { Criterion } from "../../../src/schema/v2.js";

const node = (fields: Record<string, unknown>): RuleNode => ({ title: fields.id as string, slug: fields.id as string, ...fields }) as RuleNode;
const criteria: Criterion[] = [{ id: "c1", text: "works" }];
const statement = "does the thing";
const MET = specHash({ statement, criteria });
const cap = (id: string, extra: Record<string, unknown> = {}) => node({ id, type: "capability", statement, criteria, metAt: MET, ...extra });
const change = (id: string, extra: Record<string, unknown> = {}) => node({ id, type: "change", ...extra });
const APPLIED = "2026-10-01T00:00:00.000Z";

const tree = (): V2Tree => ({
  product: [
    node({
      id: "pay",
      type: "area",
      displayId: "A1",
      summary: "Taking payment",
      children: [
        cap("card", { displayId: "A1.1", children: [cap("card-3ds")] }),
        cap("wallet", { metAt: undefined }),
        cap("gone", { status: "deleted" }),
        node({ id: "pci", type: "constraint", statement: "Card data never stored", metAt: specHash({ statement: "Card data never stored" }), appliesTo: ["card"] }),
      ],
    }),
    node({ id: "ship", type: "area", children: [cap("label")] }),
  ],
  changes: [
    change("amend-card", { status: "in_progress", plannedRelease: "1.2.0", amends: [{ target: "card", delta: "modified", summary: "s" }] }),
    change("touch-card", { plannedRelease: "1.2.0", touches: ["card", "label"] }),
    change("fix-label", { fix: true, plannedRelease: "1.10.0", touches: ["label"] }),
    change("shipped", { status: "completed", appliedAt: APPLIED, plannedRelease: "1.1.0", shippedIn: "1.0.0", touches: ["card"] }),
    change("inbox", { needsPlacement: true }),
    change("cancelled", { status: "cancelled", touches: ["label"] }),
    change("deleted", { status: "deleted", touches: ["label"] }),
  ],
});

describe("productReport", () => {
  it("nests live product nodes with status and health; areas carry none, deleted nodes are left out", () => {
    const [pay, ship] = productReport(tree());
    expect(pay).toMatchObject({ id: "pay", displayId: "A1", type: "area", summary: "Taking payment" });
    expect(pay).not.toHaveProperty("status");
    expect(pay.children!.map((c) => c.id)).toEqual(["card", "wallet", "pci"]);
    expect(pay.children![0]).toMatchObject({ id: "card", statement, status: "changing", health: "ok", children: [{ id: "card-3ds", status: "changing" }] });
    expect(pay.children![1]).toMatchObject({ id: "wallet", status: "proposed" });
    expect(ship.children![0]).toMatchObject({ id: "label", health: "defective" });
  });
});

describe("capabilityReport", () => {
  it("returns the node, its chain, children, status, related changes (open first), constraints and co-changes", () => {
    const report = capabilityReport(tree(), "A1.1");
    expect(report.node).toMatchObject({ id: "card", statement });
    expect(report.node).not.toHaveProperty("children");
    expect(report.parentChain).toEqual([{ id: "pay", displayId: "A1", title: "pay", type: "area" }]);
    expect(report.children).toEqual([{ id: "card-3ds", title: "card-3ds", type: "capability" }]);
    expect(report.status).toEqual({ status: "changing", health: "ok" });
    expect(report.changes).toEqual([
      { id: "amend-card", title: "amend-card", status: "in_progress", relation: "amends", open: true, applied: false },
      { id: "touch-card", title: "touch-card", status: "pending", relation: "touches", open: true, applied: false },
      { id: "shipped", title: "shipped", status: "completed", relation: "touches", open: false, applied: true },
    ]);
    expect(report.boundBy).toEqual([{ id: "pci", title: "pci" }]);
    expect(report.coChanges).toEqual([{ id: "label", changes: 1 }]);
  });

  it("reports a constraint", () => {
    expect(capabilityReport(tree(), "pci").status).toEqual({ status: "met", health: "ok" });
  });

  it.each([
    ["an area", "pay", /is an area, not a capability or constraint/],
    ["an unknown ref", "nope", /names no product node/],
    ["a change", "inbox", /is a change/],
    ["a deleted node no change retired", "gone", /no applied change retired it/],
  ])("refuses %s", (_label, ref, message) => {
    expect(() => capabilityReport(tree(), ref)).toThrow(ProductReportError);
    expect(() => capabilityReport(tree(), ref)).toThrow(message);
  });
});

describe("prdStatusReport", () => {
  const report = prdStatusReport(tree());

  it("counts live changes, open and applied, and the Inbox", () => {
    expect(report.changes).toEqual({
      total: 6,
      open: 4,
      applied: 1,
      byStatus: { in_progress: 1, pending: 3, completed: 1, cancelled: 1 },
    });
    expect(report.inbox).toBe(1);
  });

  it("counts a change nested under another change, but not one under a deleted change", () => {
    const t = tree();
    t.changes[0].children = [change("sub-inbox", { needsPlacement: true, plannedRelease: "2.0.0" }), change("sub-touch", { touches: ["label"] })];
    t.changes.find((c) => c.id === "deleted")!.children = [change("under-deleted", { needsPlacement: true })];
    const r = prdStatusReport(t);
    expect(r.changes).toMatchObject({ total: 8, open: 6 });
    expect(r.inbox).toBe(2);
    expect(r.areas.find((a) => a.id === "ship")!.openChanges).toBe(3);
    expect(r.releases.map((x) => x.release)).toContain("2.0.0");
  });

  it("reports product status per area, with the open changes that target it", () => {
    expect(report.areas).toEqual([
      { id: "pay", displayId: "A1", title: "pay", capabilities: 3, constraints: 1, status: { changing: 2, proposed: 1, met: 1 }, defective: 0, openChanges: 2 },
      { id: "ship", title: "ship", capabilities: 1, constraints: 0, status: { met: 1 }, defective: 1, openChanges: 2 },
    ]);
  });

  it("groups changes by shippedIn, else plannedRelease, nearest first and unscheduled last", () => {
    expect(report.releases.map((r) => [r.release, r.changes.total])).toEqual([
      ["1.0.0", 1],
      ["1.2.0", 2],
      ["1.10.0", 1],
      [null, 2],
    ]);
    expect(report.releases[1].changes).toMatchObject({ open: 2, applied: 0 });
  });
});
