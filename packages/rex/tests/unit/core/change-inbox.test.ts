import { describe, it, expect } from "vitest";
import { changeAge, listInbox } from "../../../src/core/change-inbox.js";
import type { RuleNode, V2Tree } from "../../../src/schema/v2-rules.js";

const node = (fields: Record<string, unknown>): RuleNode => ({ slug: fields.id as string, ...fields }) as RuleNode;
const NOW = new Date("2026-11-06T12:00:00.000Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

/** Seven capabilities, so a shortlist can overflow the top-5 cap. */
const capabilities = Array.from({ length: 7 }, (_, i) =>
  node({ id: `cap-${i}`, type: "capability", title: `Card payment ${i}`, statement: "A shopper pays by card" }),
);

const tree = (changes: RuleNode[]): V2Tree => ({
  product: [node({ id: "pay", type: "area", title: "Payments", children: capabilities })],
  changes,
});

describe("changeAge", () => {
  it("reads createdAt, falling back to lastModified for a change recorded before the field", () => {
    expect(changeAge({ createdAt: ago(3), lastModified: ago(1) }, NOW)).toEqual({ createdAt: ago(3), ageDays: 3 });
    expect(changeAge({ lastModified: ago(5) }, NOW)).toEqual({ createdAt: ago(5), ageDays: 5 });
  });

  it("answers nothing when no stamp is usable, and never a negative age", () => {
    expect(changeAge({}, NOW)).toEqual({});
    expect(changeAge({ createdAt: "not a date" }, NOW)).toEqual({});
    expect(changeAge({ createdAt: new Date(NOW.getTime() + DAY).toISOString() }, NOW).ageDays).toBe(0);
  });
});

describe("listInbox", () => {
  const held = (id: string, fields: Record<string, unknown> = {}) =>
    node({ id, type: "change", title: `Pay by card ${id}`, intent: `Intent of ${id}`, needsPlacement: true, ...fields });

  it("lists every open change with needsPlacement, oldest first, with intent, age and at most five candidates", () => {
    const { rows } = listInbox(
      tree([
        held("newer", { createdAt: ago(1) }),
        held("older", { createdAt: ago(9) }),
        held("unstamped"),
        node({ id: "placed", type: "change", title: "Placed", needsPlacement: false }),
        held("done", { status: "cancelled" }),
        held("applied", { appliedAt: ago(2) }),
      ]),
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(["older", "newer", "unstamped"]);
    expect(rows[0]).toMatchObject({ title: "Pay by card older", intent: "Intent of older", createdAt: ago(9), ageDays: 9 });
    expect(rows[2].ageDays).toBeUndefined();
    for (const row of rows) {
      expect(row.shortlist).toHaveLength(5);
      expect(row.shortlist[0]).toMatchObject({ score: expect.any(Number), strength: expect.any(String), reasons: expect.any(Array) });
      expect(row.relation).toMatch(/^(touches|amends)$/);
    }
  });

  it("is empty when nothing awaits placement", () => {
    expect(listInbox(tree([node({ id: "placed", type: "change", title: "Placed" })]), NOW).rows).toEqual([]);
  });
});
