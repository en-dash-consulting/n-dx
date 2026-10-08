/**
 * rex.applyOn: when a change's amendments reach the product layer under
 * complete (default), review and release, and where the setting is read.
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appliesOn, applyOnTrigger, changesAwaitingApply, loadApplyOn, parseApplyOn, type ApplyOn } from "../../../src/core/apply-policy.js";
import { ApplyAmendmentsError } from "../../../src/core/apply-amendments.js";
import { isOpenChange, type RuleNode, type V2Tree } from "../../../src/schema/v2-rules.js";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const OPTS = { appliedAt: NOW.toISOString(), now: NOW };
const OLD = "A shopper can pay by card.";
const NEW = "A shopper can pay by card or wallet.";

function tree(status: RuleNode["status"] = "completed"): V2Tree {
  return {
    product: [
      {
        id: "area-1",
        type: "area",
        title: "Checkout",
        slug: "checkout",
        status: "pending",
        children: [{ id: "cap-1", type: "capability", title: "Pay", slug: "pay", displayId: "A1.1", statement: OLD, status: "pending" }],
      } as RuleNode,
    ],
    changes: [
      {
        id: "change-1",
        type: "change",
        title: "Wallets",
        slug: "wallets",
        displayId: "CH-1",
        status,
        amends: [{ delta: "modified", target: "A1.1", proposed: NEW, summary: "Add wallets" }],
      } as RuleNode,
    ],
  };
}

const statement = (t: V2Tree): string | undefined => t.product[0].children?.[0].statement;

function run(applyOn: ApplyOn, trigger: Parameters<typeof applyOnTrigger>[2], t = tree()) {
  return applyOnTrigger(t, "CH-1", trigger, { ...OPTS, applyOn });
}

describe("rex.applyOn modes", () => {
  it("complete applies when the change completes, and a release stamp does not apply it", () => {
    const done = run("complete", "complete");
    expect(done.applied).toBe(true);
    if (done.applied) {
      expect(statement(done.result.tree)).toBe(NEW);
      expect(done.result.tree.changes[0].appliedAt).toBe(OPTS.appliedAt);
    }
    expect(run("complete", "release").applied).toBe(false);
  });

  it("review leaves a completed change open, its capability changing, until a steward applies it", () => {
    const t = tree();
    const completed = run("review", "complete", t);
    expect(completed).toEqual({ applied: false, reason: expect.stringContaining('rex.applyOn is "review"') });
    expect(run("review", "release", t).applied).toBe(false);
    expect(statement(t)).toBe(OLD);
    expect(isOpenChange(t.changes[0])).toBe(true);
    expect(changesAwaitingApply(t).map((c) => c.id)).toEqual(["change-1"]);

    const steward = run("review", "steward", t);
    expect(steward.applied).toBe(true);
    if (steward.applied) {
      expect(statement(steward.result.tree)).toBe(NEW);
      expect(changesAwaitingApply(steward.result.tree)).toEqual([]);
    }
  });

  it("release waits for the release stamp", () => {
    const t = tree();
    expect(run("release", "complete", t).applied).toBe(false);
    expect(isOpenChange(t.changes[0])).toBe(true);
    const stamped = run("release", "release", t);
    expect(stamped.applied).toBe(true);
    if (stamped.applied) expect(statement(stamped.result.tree)).toBe(NEW);
  });

  it("complete and release act only on completed changes; a steward may apply any open change", () => {
    const t = tree("in_progress");
    expect(run("complete", "complete", t)).toEqual({ applied: false, reason: "change CH-1 is in_progress, not completed" });
    expect(run("release", "release", t).applied).toBe(false);
    expect(run("release", "steward", t).applied).toBe(true);
  });

  it("an applied change is refused as the engine refuses it", () => {
    const t = tree();
    t.changes[0].appliedAt = "2026-10-01T00:00:00.000Z";
    expect(() => run("complete", "complete", t)).toThrow(ApplyAmendmentsError);
    expect(changesAwaitingApply(t)).toEqual([]);
  });

  it("appliesOn: a steward applies under every mode; complete and release only under their own", () => {
    for (const mode of ["complete", "review", "release"] as const) {
      expect(appliesOn(mode, "steward")).toBe(true);
      expect(appliesOn(mode, "complete")).toBe(mode === "complete");
      expect(appliesOn(mode, "release")).toBe(mode === "release");
    }
  });
});

describe("rex.applyOn setting", () => {
  it("defaults to complete; an invalid value falls back with a warning", () => {
    expect(parseApplyOn({})).toEqual({ applyOn: "complete", warnings: [] });
    expect(parseApplyOn({ applyOn: "review" })).toEqual({ applyOn: "review", warnings: [] });
    const bad = parseApplyOn({ applyOn: "merge" });
    expect(bad.applyOn).toBe("complete");
    expect(bad.warnings).toEqual(['rex.applyOn: "merge" is not one of complete, review, release; using "complete"']);
  });

  it("is read from .n-dx.json beside the .rex directory, complete when absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "apply-on-"));
    try {
      await mkdir(join(root, ".rex"));
      expect((await loadApplyOn(join(root, ".rex"))).applyOn).toBe("complete");
      await writeFile(join(root, ".n-dx.json"), JSON.stringify({ rex: { applyOn: "release" } }));
      expect((await loadApplyOn(join(root, ".rex"))).applyOn).toBe("release");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
