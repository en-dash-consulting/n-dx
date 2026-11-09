/**
 * Branch work sets on a real v2 tree: assign and unassign write `delivery`
 * through the PRD transaction, and the model reader reads it back.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assignToBranch, readWorkSet, unassignFromBranch, WorkSetError } from "../../src/core/work-set.js";
import { loadPrdModel } from "../../src/store/prd-model-reader.js";
import { FIXTURE_CHANGE, FIXTURE_TASK, copyV2Fixture } from "../helpers/v2-fixture.js";

let root: string;
let rexDir: string;
const changeState = () => readFile(join(rexDir, "changes", "add-apple-pay", "state.yaml"), "utf-8");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "rex-work-set-"));
  rexDir = await copyV2Fixture(join(root, ".rex"), "lf");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("work sets on a v2 tree", () => {
  it("assigns a change's open task to a branch, reads it back, and unassigns it", async () => {
    const report = await assignToBranch(rexDir, [FIXTURE_CHANGE], "feat/apple-pay");
    expect(report.assigned).toEqual([FIXTURE_TASK]);
    expect(await changeState()).toContain(`    delivery: {"branch":"feat/apple-pay"}\n`);

    const { tree } = await loadPrdModel(rexDir);
    expect(readWorkSet(tree, "feat/apple-pay")).toEqual({ branch: "feat/apple-pay", ids: [FIXTURE_TASK], hasAssignments: true, earlier: [] });

    await expect(assignToBranch(rexDir, [FIXTURE_TASK], "feat/other")).rejects.toThrow(WorkSetError);
    expect(await changeState()).not.toContain("feat/other");

    const removed = await unassignFromBranch(rexDir, [FIXTURE_CHANGE]);
    expect(removed.removed).toEqual([{ id: FIXTURE_TASK, from: "feat/apple-pay" }]);
    expect(await changeState()).not.toContain("delivery");
  });
});
