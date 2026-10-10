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
      { id: "amend-card", title: "amend-card", status: "in_progress", relation: "amends", open: true, applied: false, release: "1.2.0" },
      { id: "touch-card", title: "touch-card", status: "pending", relation: "touches", open: true, applied: false, release: "1.2.0" },
      { id: "shipped", title: "shipped", status: "completed", relation: "touches", open: false, applied: true, appliedAt: APPLIED, release: "1.0.0" },
    ]);
    expect(report.changeCounts).toMatchObject({ total: 3, open: 2, applied: 1 });
    expect(report.changesPage).toEqual({ matched: 3 });
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

describe("bounded change history", () => {
  const N = 300;
  const stamp = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
  const historyTree = (): V2Tree => {
    const t = tree();
    for (let i = 0; i < N; i++) {
      t.changes.push(change(`old-${i}`, { status: "completed", appliedAt: stamp(i), shippedIn: `1.${i % 50}.0`, touches: ["card"] }));
    }
    return t;
  };
  const ids = (r: { changes: Array<{ id: string }> }) => r.changes.map((c) => c.id);

  it("by default lists open changes and the latest applied ones only, newest first, with counts over all", () => {
    const r = capabilityReport(historyTree(), "card");
    expect(ids(r).slice(0, 2)).toEqual(["amend-card", "touch-card"]);
    // "shipped" was applied in October, after every generated change.
    expect(ids(r).slice(2)).toEqual(["shipped", ...Array.from({ length: 9 }, (_, i) => `old-${N - 1 - i}`)]);
    expect(r.changeCounts).toMatchObject({ total: N + 3, open: 2, applied: N + 1 });
    expect(r.changesPage).toEqual({ matched: 12 });
  });

  it("stays the same size however long the history grows", () => {
    const small = JSON.stringify(capabilityReport(tree(), "card")).length;
    const big = JSON.stringify(capabilityReport(historyTree(), "card")).length;
    expect(big).toBeLessThan(small + 2_500);
  });

  it("pages through the whole history with the cursor, without repeats or gaps", () => {
    const t = historyTree();
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const r = capabilityReport(t, "card", { status: "all", limit: 50, cursor });
      expect(r.changes.length).toBeLessThanOrEqual(50);
      seen.push(...ids(r));
      cursor = r.changesPage.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(Math.ceil((N + 3) / 50));
    expect(new Set(seen).size).toBe(N + 3);
  });

  it("filters by status and by release, and caps the page size", () => {
    const t = historyTree();
    expect(ids(capabilityReport(t, "card", { status: "open" }))).toEqual(["amend-card", "touch-card"]);
    expect(capabilityReport(t, "card", { status: "applied", since: "1.49.0", limit: 100 }).changesPage.matched).toBe(N / 50);
    expect(capabilityReport(t, "card", { status: "all", limit: 10_000 }).changes).toHaveLength(100);
  });

  it("refuses a malformed or foreign cursor, asking for a restart", () => {
    const t = historyTree();
    expect(() => capabilityReport(t, "card", { cursor: "nope" })).toThrow(/Cursor "nope" is not a changesPage.nextCursor.*Restart without a cursor/);
    const other = Buffer.from(JSON.stringify({ hello: 1 })).toString("base64url");
    expect(() => capabilityReport(t, "card", { cursor: other })).toThrow(/Restart without a cursor/);
    const cursor = capabilityReport(t, "card", { status: "all", limit: 2 }).changesPage.nextCursor!;
    expect(() => capabilityReport(t, "card", { status: "applied", limit: 2, cursor })).toThrow(/different capability, status or since/);
    expect(() => capabilityReport(t, "label", { status: "all", limit: 2, cursor })).toThrow(/different capability, status or since/);
  });

  it("the cursor is opaque and encodes the last row's position", () => {
    const r = capabilityReport(historyTree(), "card", { status: "all", limit: 3 });
    const cursor = r.changesPage.nextCursor!;
    expect(cursor).not.toContain("old-");
    expect(JSON.parse(Buffer.from(cursor, "base64url").toString())).toMatchObject({ group: 1, appliedAt: APPLIED, id: "shipped" });
  });

  describe("a change applied between pages", () => {
    // The only changes: open [a, b, c, d], each touching "card".
    const openTree = (): V2Tree => {
      const t = tree();
      t.changes = ["a", "b", "c", "d"].map((id) => change(id, { touches: ["card"] }));
      return t;
    };
    const apply = (t: V2Tree, id: string, at: string) => {
      const c = t.changes.find((x) => x.id === id)!;
      Object.assign(c, { status: "completed", appliedAt: at });
    };

    it("does not skip the rest of the open changes (PR #612 review)", () => {
      const t = openTree();
      const p1 = capabilityReport(t, "card", { status: "all", limit: 2 });
      expect(ids(p1)).toEqual(["a", "b"]);
      apply(t, "b", APPLIED);
      const p2 = capabilityReport(t, "card", { status: "all", limit: 2, cursor: p1.changesPage.nextCursor });
      expect(ids(p2)).toEqual(["c", "d"]);
      expect(p2.changesPage.nextCursor).toBeDefined();
      const p3 = capabilityReport(t, "card", { status: "all", limit: 2, cursor: p2.changesPage.nextCursor });
      expect(ids(p3)).toEqual(["b"]);
      expect(p3.changesPage.nextCursor).toBeUndefined();
    });

    it("lists every change present throughout, whichever change moves group mid-listing", () => {
      for (const moved of ["a", "b", "c", "d"]) {
        for (let pageAt = 1; pageAt <= 3; pageAt++) {
          const t = openTree();
          const seen: string[] = [];
          let cursor: string | undefined;
          let page = 0;
          do {
            if (page === pageAt) apply(t, moved, stamp(page));
            const r = capabilityReport(t, "card", { status: "all", limit: 1, cursor });
            seen.push(...ids(r));
            cursor = r.changesPage.nextCursor;
            page++;
          } while (cursor);
          expect(new Set(seen), `${moved} applied before page ${pageAt}`).toEqual(new Set(["a", "b", "c", "d"]));
        }
      }
    });

    it("continues the recent listing too", () => {
      const t = openTree();
      const p1 = capabilityReport(t, "card", { limit: 2 });
      apply(t, "b", APPLIED);
      expect(ids(capabilityReport(t, "card", { limit: 2, cursor: p1.changesPage.nextCursor }))).toEqual(["c", "d"]);
    });
  });

  it("get_prd_status lists releases with open changes and the newest closed ones; counts still cover all", () => {
    const t = historyTree();
    const r = prdStatusReport(t);
    expect(r.changes.total).toBe(6 + N);
    expect(r.releases.length).toBeLessThanOrEqual(5 + 4);
    expect(r.releasesOmitted).toBeGreaterThan(0);
    expect(r.releases.map((x) => x.release)).toEqual(expect.arrayContaining(["1.2.0", "1.10.0", null]));
    const all = prdStatusReport(t, { allReleases: true });
    expect(all.releasesOmitted).toBe(0);
    expect(all.releases.length).toBe(r.releases.length + r.releasesOmitted);
  });
});
