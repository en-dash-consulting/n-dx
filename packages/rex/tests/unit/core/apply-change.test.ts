import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyChange } from "../../../src/core/apply-change.js";
import { loadPrdModel } from "../../../src/store/prd-model-reader.js";
import { indexTree } from "../../../src/schema/v2-rules.js";
import { completeFixtureTask, copyV2Fixture, FIXTURE_CHANGE } from "../../helpers/v2-fixture.js";

const CAPABILITY = "a0000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-11-05T00:00:00.000Z");

let tmp: string;
let rexDir: string;

/** Every file under rexDir with its contents, to show a call wrote nothing. */
async function snapshot(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(rexDir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) out[join(entry.parentPath, entry.name)] = await readFile(join(entry.parentPath, entry.name), "utf-8");
  }
  return out;
}

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-apply-change-"));
  rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("applyChange", () => {
  it("previews the amendments and their product nodes, writing nothing", async () => {
    await completeFixtureTask(rexDir);
    const before = await snapshot();
    const outcome = await applyChange(rexDir, "CH-1", { preview: true, clock: () => NOW });
    expect(outcome).toEqual({
      ok: true,
      change: FIXTURE_CHANGE,
      appliedAt: NOW.toISOString(),
      written: false,
      applied: [{ delta: "modified", nodeId: CAPABILITY, summary: "Wallets count as cards", node: { id: CAPABILITY, displayId: "A1.1", title: "Pay by card", type: "capability" } }],
    });
    expect(await snapshot()).toEqual(before);
  });

  it("applies under the lock, stamping the change applied", async () => {
    await completeFixtureTask(rexDir);
    const outcome = await applyChange(rexDir, FIXTURE_CHANGE, { clock: () => NOW });
    expect(outcome).toMatchObject({ ok: true, change: FIXTURE_CHANGE, written: true });
    const model = await loadPrdModel(rexDir);
    if (model.layout !== "v2") throw new Error("expected v2");
    const index = indexTree(model.tree);
    expect(index.resolve(FIXTURE_CHANGE)?.appliedAt).toBe(NOW.toISOString());
    expect(index.resolve(CAPABILITY)?.criteria?.map((c) => c.id)).toContain("c3");
  });

  it("returns rex's refusal and writes nothing when the change's work is open", async () => {
    const before = await snapshot();
    for (const preview of [true, false]) {
      const outcome = await applyChange(rexDir, "CH-1", { preview });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) continue;
      expect(outcome.message).toMatch(/^Cannot apply change CH-1: .*not completed/);
      expect(outcome.problems.length).toBeGreaterThan(0);
    }
    expect(await snapshot()).toEqual(before);
  });
});
