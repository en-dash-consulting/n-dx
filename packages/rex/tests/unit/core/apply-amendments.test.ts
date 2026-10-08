/**
 * The apply engine: added, modified and removed amendments, History lines,
 * metAt / appliedAt stamps, and refusals that leave the tree untouched.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { ApplyAmendmentsError, appendHistory, applyAmendments } from "../../../src/core/apply-amendments.js";
import { specHash, type RuleNode, type V2Tree } from "../../../src/schema/v2-rules.js";
import type { Amendment } from "../../../src/schema/v2.js";
import { loadPrdModel } from "../../../src/store/prd-model-reader.js";
import { writePrdModel } from "../../../src/store/prd-model-writer.js";
import { withLock } from "../../../src/store/file-lock.js";
import { prdLockPath } from "../../../src/store/paths.js";
import { copyV2Fixture } from "../../helpers/v2-fixture.js";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const APPLIED_AT = NOW.toISOString();
const OPTS = { appliedAt: APPLIED_AT, now: NOW, newId: () => "new-id" };

const AREA = "area-1";
const CAP = "cap-1";
const CON = "con-1";
const CHANGE = "change-1";

function tree(amends: Amendment[] = [], change: Partial<RuleNode> = {}): V2Tree {
  return {
    product: [
      {
        id: AREA,
        type: "area",
        title: "Checkout",
        slug: "checkout",
        displayId: "A1",
        status: "pending",
        children: [
          {
            id: CAP,
            type: "capability",
            title: "Pay by card",
            slug: "pay-by-card",
            displayId: "A1.1",
            statement: "A shopper can pay by card.",
            criteria: [
              { id: "c1", text: "Charged once" },
              { id: "c2", text: "Declines show why" },
            ],
            body: "Card payments.",
            status: "pending",
            revisedAt: "2026-09-01T00:00:00.000Z",
          },
          { id: CON, type: "constraint", title: "PCI", slug: "pci", statement: "Card data never touches our servers.", status: "pending" },
        ],
      } as RuleNode,
    ],
    changes: [{ id: CHANGE, type: "change", title: "Wallets", slug: "wallets", displayId: "CH-1", status: "in_progress", amends, ...change } as RuleNode],
  };
}

function find(nodes: readonly RuleNode[], id: string): RuleNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const hit = find(node.children ?? [], id);
    if (hit) return hit;
  }
  return undefined;
}

function get(t: V2Tree, id: string): RuleNode {
  const node = find([...t.product, ...t.changes], id);
  if (!node) throw new Error(`no node ${id}`);
  return node;
}

function refusal(fn: () => unknown): ApplyAmendmentsError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ApplyAmendmentsError) return err;
    throw err;
  }
  throw new Error("expected ApplyAmendmentsError");
}

describe("applyAmendments: added", () => {
  const added: Amendment = {
    target: "A1.2",
    delta: "added",
    summary: "Wallets",
    under: "A1",
    title: "Pay by wallet",
    proposed: "A shopper can pay with a wallet.",
    criteria: { add: [{ id: "c1", text: "Apple Pay on Safari" }] },
  };

  it("creates the capability under its area with statement, criteria, metAt and History", () => {
    const { tree: out, applied } = applyAmendments(tree([added]), "CH-1", OPTS);
    const node = get(out, "new-id");
    expect(get(out, AREA).children?.map((c) => c.id)).toEqual([CAP, CON, "new-id"]);
    expect(node).toMatchObject({
      type: "capability",
      title: "Pay by wallet",
      slug: "pay-by-wallet",
      displayId: "A1.2",
      statement: "A shopper can pay with a wallet.",
      criteria: [{ id: "c1", text: "Apple Pay on Safari" }],
      metAt: specHash({ statement: "A shopper can pay with a wallet.", criteria: [{ id: "c1", text: "Apple Pay on Safari" }] }),
      body: "## History\n\n- 2026-10-07 CH-1 added: Wallets",
    });
    expect(applied).toEqual([{ delta: "added", nodeId: "new-id", summary: "Wallets" }]);
    expect(get(out, CHANGE).appliedAt).toBe(APPLIED_AT);
  });

  it("uses a non-display target as the id and nests under a capability", () => {
    const { tree: out } = applyAmendments(tree([{ ...added, target: "cap-2", under: CAP }]), CHANGE, OPTS);
    expect(get(out, CAP).children?.[0]).toMatchObject({ id: "cap-2", type: "capability" });
    expect(get(out, "cap-2").displayId).toBeUndefined();
  });

  it("suffixes the slug when a sibling holds it", () => {
    const { tree: out } = applyAmendments(tree([{ ...added, title: "Pay by card", target: "abcdef99" }]), CHANGE, OPTS);
    expect(get(out, "abcdef99").slug).toBe("pay-by-card-abcdef");
  });

  it("refuses a missing or non-container parent, a missing title and a taken id", () => {
    expect(refusal(() => applyAmendments(tree([{ ...added, under: undefined }]), CHANGE, OPTS)).problems[0]).toMatch(/needs under/);
    expect(refusal(() => applyAmendments(tree([{ ...added, under: CON }]), CHANGE, OPTS)).problems[0]).toMatch(/not a live area or capability/);
    expect(refusal(() => applyAmendments(tree([{ ...added, title: " " }]), CHANGE, OPTS)).problems[0]).toMatch(/needs a title/);
    expect(refusal(() => applyAmendments(tree([{ ...added, target: "A1.1" }]), CHANGE, OPTS)).problems[0]).toMatch(/already has this id/);
  });

  it("refuses an id held by a retired node or a change, which would share its state row", () => {
    const retired = tree([{ ...added, target: CAP }]);
    get(retired, CAP).status = "deleted";
    expect(refusal(() => applyAmendments(retired, CHANGE, OPTS)).problems[0]).toMatch(/retired ones included/);
    expect(refusal(() => applyAmendments(tree([{ ...added, target: CHANGE }]), CHANGE, OPTS)).problems[0]).toMatch(/already has this id/);
    expect(refusal(() => applyAmendments(tree([added]), CHANGE, { ...OPTS, newId: () => CAP })).problems[0]).toMatch(/new id cap-1 is already taken/);
  });
});

describe("applyAmendments: modified", () => {
  const modify = (patch: Partial<Amendment>): Amendment => ({ target: "A1.1", delta: "modified", summary: "Tighten", ...patch });

  it("adds a criterion by id", () => {
    const { tree: out } = applyAmendments(tree([modify({ criteria: { add: [{ id: "c3", text: "Receipt sent" }] } })]), CHANGE, OPTS);
    expect(get(out, CAP).criteria?.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("replaces a criterion by id, in place", () => {
    const { tree: out } = applyAmendments(tree([modify({ criteria: { replace: [{ id: "c1", text: "Charged exactly once" }] } })]), CHANGE, OPTS);
    expect(get(out, CAP).criteria).toEqual([
      { id: "c1", text: "Charged exactly once" },
      { id: "c2", text: "Declines show why" },
    ]);
  });

  it("removes a criterion by id", () => {
    const { tree: out } = applyAmendments(tree([modify({ criteria: { remove: ["c2"] } })]), CHANGE, OPTS);
    expect(get(out, CAP).criteria).toEqual([{ id: "c1", text: "Charged once" }]);
  });

  it("writes the proposed statement, stamps metAt, clears revisedAt and appends History", () => {
    const { tree: out } = applyAmendments(tree([modify({ proposed: "A shopper can pay by card or wallet." })]), CHANGE, OPTS);
    const cap = get(out, CAP);
    expect(cap.statement).toBe("A shopper can pay by card or wallet.");
    expect(cap.metAt).toBe(specHash({ statement: cap.statement, criteria: cap.criteria }));
    expect(cap.revisedAt).toBeUndefined();
    expect(cap.body).toBe("Card payments.\n\n## History\n\n- 2026-10-07 CH-1 modified: Tighten");
  });

  it("writes a constraint's proposed statement", () => {
    const { tree: out } = applyAmendments(tree([{ target: CON, delta: "modified", summary: "s", proposed: "No card data stored." }]), CHANGE, OPTS);
    expect(get(out, CON)).toMatchObject({ statement: "No card data stored.", metAt: specHash({ statement: "No card data stored." }) });
  });

  it("refuses unknown criterion ids, a duplicate add, criteria on a constraint and an empty edit", () => {
    expect(refusal(() => applyAmendments(tree([modify({ criteria: { replace: [{ id: "c9", text: "x" }] } })]), CHANGE, OPTS)).problems[0]).toMatch(/c9 to replace/);
    expect(refusal(() => applyAmendments(tree([modify({ criteria: { remove: ["c9"] } })]), CHANGE, OPTS)).problems[0]).toMatch(/c9 to remove/);
    expect(refusal(() => applyAmendments(tree([modify({ criteria: { add: [{ id: "c1", text: "x" }] } })]), CHANGE, OPTS)).problems[0]).toMatch(/c1 to add already exists/);
    expect(refusal(() => applyAmendments(tree([{ target: CON, delta: "modified", summary: "s", criteria: { add: [{ id: "c1", text: "x" }] } }]), CHANGE, OPTS)).problems[0]).toMatch(/constraint has no criteria/);
    expect(refusal(() => applyAmendments(tree([modify({})]), CHANGE, OPTS)).problems[0]).toMatch(/nothing to modify/);
  });
});

describe("applyAmendments: removed", () => {
  it("retires the node and records History", () => {
    const { tree: out } = applyAmendments(tree([{ target: CAP, delta: "removed", summary: "Cards go" }]), CHANGE, OPTS);
    const cap = get(out, CAP);
    expect(cap.status).toBe("deleted");
    expect(cap.body).toMatch(/- 2026-10-07 CH-1 removed: Cards go$/);
  });

  it("refuses an area with live descendants, naming them, and leaves the input untouched", () => {
    const input = tree([{ target: "A1", delta: "removed", summary: "Checkout goes" }]);
    const before = structuredClone(input);
    const err = refusal(() => applyAmendments(input, CHANGE, OPTS));
    expect(err.problems).toEqual([
      "amendment 1 (removed A1): live descendants A1.1, con-1 would be hidden; remove them in this change too",
    ]);
    expect(input).toEqual(before);
  });

  it("refuses when the change removes only some of the live descendants", () => {
    const err = refusal(() =>
      applyAmendments(tree([{ target: "A1", delta: "removed", summary: "a" }, { target: "A1.1", delta: "removed", summary: "c" }]), CHANGE, OPTS),
    );
    expect(err.problems[0]).toMatch(/live descendants con-1 would be hidden/);
  });

  it("retires an area together with every live descendant the change also removes, in either order", () => {
    const area = { target: "A1", delta: "removed", summary: "a" } as const;
    const rest = [
      { target: "A1.1", delta: "removed", summary: "c" },
      { target: CON, delta: "removed", summary: "p" },
    ] as const;
    for (const amends of [[area, ...rest], [...rest, area]]) {
      const { tree: out } = applyAmendments(tree([...amends]), CHANGE, OPTS);
      expect([AREA, CAP, CON].map((id) => get(out, id).status)).toEqual(["deleted", "deleted", "deleted"]);
    }
  });

  it("ignores descendants that are already retired", () => {
    const input = tree([{ target: "A1", delta: "removed", summary: "a" }]);
    get(input, CAP).status = "deleted";
    get(input, CON).status = "deleted";
    expect(get(applyAmendments(input, CHANGE, OPTS).tree, AREA).status).toBe("deleted");
  });

  it("refuses a target that is already retired", () => {
    const input = tree([{ target: CAP, delta: "removed", summary: "again" }]);
    get(input, CAP).status = "deleted";
    expect(refusal(() => applyAmendments(input, CHANGE, OPTS)).problems[0]).toMatch(/not a live product node/);
  });
});

describe("applyAmendments: the change", () => {
  it("leaves the input tree untouched, also when refused", () => {
    const input = tree([{ target: CAP, delta: "modified", summary: "s", proposed: "New" }]);
    const before = structuredClone(input);
    applyAmendments(input, CHANGE, OPTS);
    expect(input).toEqual(before);
    const bad = tree([
      { target: CAP, delta: "modified", summary: "ok", proposed: "New" },
      { target: "nope", delta: "removed", summary: "bad" },
    ]);
    const badBefore = structuredClone(bad);
    expect(refusal(() => applyAmendments(bad, CHANGE, OPTS)).problems).toHaveLength(1);
    expect(bad).toEqual(badBefore);
  });

  it("refuses an applied, cancelled or unknown change", () => {
    expect(refusal(() => applyAmendments(tree([], { appliedAt: "2026-01-01T00:00:00.000Z" }), CHANGE, OPTS)).message).toMatch(/already applied at 2026-01-01/);
    expect(refusal(() => applyAmendments(tree([], { status: "cancelled" }), CHANGE, OPTS)).message).toMatch(/cancelled/);
    expect(refusal(() => applyAmendments(tree(), "CH-9", OPTS)).message).toMatch(/no live change/);
  });

  it("applies amendments in order, so a later one sees an earlier one's node", () => {
    const { tree: out } = applyAmendments(
      tree([
        { target: "cap-2", delta: "added", summary: "add", under: AREA, title: "Refunds", proposed: "Refunds work." },
        { target: "cap-2", delta: "modified", summary: "tighten", criteria: { add: [{ id: "c1", text: "Within a day" }] } },
      ]),
      CHANGE,
      OPTS,
    );
    expect(get(out, "cap-2").criteria).toEqual([{ id: "c1", text: "Within a day" }]);
    expect(get(out, "cap-2").body).toBe("## History\n\n- 2026-10-07 CH-1 added: add\n- 2026-10-07 CH-1 modified: tighten");
  });

  it("stamps only appliedAt for a touches-only change", () => {
    const input = tree([], { amends: undefined, touches: [CAP] });
    const { tree: out, applied } = applyAmendments(input, CHANGE, OPTS);
    expect(applied).toEqual([]);
    expect(out.product).toEqual(input.product);
    expect(get(out, CHANGE).appliedAt).toBe(APPLIED_AT);
  });
});

describe("specHash and the body", () => {
  it("does not change when the capability's prose body is edited", () => {
    const { tree: out } = applyAmendments(tree([{ target: CAP, delta: "modified", summary: "s", proposed: "New" }]), CHANGE, OPTS);
    const cap = get(out, CAP);
    const edited = { ...cap, body: `${cap.body}\n\nMore prose about cards.` };
    expect(specHash(edited)).toBe(cap.metAt);
    expect(specHash({ ...cap, statement: "Other" })).not.toBe(cap.metAt);
  });
});

describe("appendHistory", () => {
  it("adds to an existing section before the next heading, after prose with a blank line", () => {
    expect(appendHistory("## History\n\nRaised from tickets.\n\n## Notes\n\nx", "- d")).toBe(
      "## History\n\nRaised from tickets.\n\n- d\n\n## Notes\n\nx",
    );
    expect(appendHistory("## History\n\n- a", "- b")).toBe("## History\n\n- a\n- b");
    expect(appendHistory(undefined, "- a")).toBe("## History\n\n- a");
  });
});

describe("applyAmendments on disk", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "rex-apply-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  async function snapshot(dir: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      out[relative(dir, path)] = await readFile(path, "utf-8");
    }
    return out;
  }

  const quiet = { env: {}, warn: () => {} };

  it("leaves product/ untouched when a touches-only change is applied", async () => {
    const rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
    const model = await loadPrdModel(rexDir, quiet);
    const change = model.tree.changes[0];
    change.touches = [change.amends![0].target];
    delete change.amends;
    const before = await snapshot(join(rexDir, "product"));

    const { tree: applied } = applyAmendments(model.tree, change.id, OPTS);
    const result = await withLock(prdLockPath(rexDir), () => writePrdModel(rexDir, { ...model, tree: applied }));

    expect(await snapshot(join(rexDir, "product"))).toEqual(before);
    expect(result.written.filter((p) => p.startsWith("product/"))).toEqual([]);
    expect(await readFile(join(rexDir, "changes/add-apple-pay/state.yaml"), "utf-8")).toMatch(/appliedAt: "?2026-10-07T12:00:00\.000Z"?/);
  });

  it("writes a modified capability that reads back met", async () => {
    const rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
    const model = await loadPrdModel(rexDir, quiet);
    const { tree: applied } = applyAmendments(model.tree, "CH-1", OPTS);
    await withLock(prdLockPath(rexDir), () => writePrdModel(rexDir, { ...model, tree: applied }));

    const reread = await loadPrdModel(rexDir, quiet);
    const cap = get(reread.tree, "a0000000-0000-4000-8000-000000000002");
    expect(cap.criteria?.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(cap.metAt).toBe(specHash({ statement: cap.statement, criteria: cap.criteria }));
    expect(cap.revisedAt).toBeUndefined();
    expect(cap.body).toBe("## History\n\n- 2026-10-07 CH-1 modified: Wallets count as cards");
    expect(get(reread.tree, "c0000000-0000-4000-8000-000000000001").appliedAt).toBe(APPLIED_AT);
  });
});
