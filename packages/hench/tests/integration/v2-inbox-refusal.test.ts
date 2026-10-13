/**
 * `ndx work --task=<id>` on a v2 tree refuses an Inbox change (`needsPlacement`)
 * and a task inside one, naming placement. Rex would refuse to close it, so a
 * run would end completed with the item still open.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendFile, cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveStore } from "@n-dx/rex";
import { selectTaskEntry } from "../../src/agent/planning/brief.js";
import { loadV2Tree } from "../../src/agent/planning/work-selection.js";
import { RM_RETRY } from "../helpers/index.js";

const FIXTURE = join(import.meta.dirname, "../../../rex/tests/fixtures/v2-tree");
const CHANGE_ID = "c0000000-0000-4000-8000-000000000001";
const TASK_ID = "c0000000-0000-4000-8000-000000000002";

let root: string;
let rexDir: string;

async function select(ref: string) {
  const s = await resolveStore(rexDir);
  const tree = (await loadV2Tree(s))!;
  return selectTaskEntry((await s.loadDocument()).items, { tree, taskId: ref });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hench-v2-inbox-"));
  rexDir = join(root, ".rex");
  await cp(FIXTURE, rexDir, { recursive: true });
  await writeFile(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "shop", adapter: "file" }));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, ...RM_RETRY });
});

describe("explicit --task on a v2 tree", () => {
  it("accepts a placed change and its task", async () => {
    expect((await select(CHANGE_ID)).item.id).toBe(CHANGE_ID);
    expect((await select(TASK_ID)).item.id).toBe(TASK_ID);
  });

  describe("with the change in the Inbox", () => {
    beforeEach(async () => {
      await appendFile(
        join(rexDir, "changes/add-apple-pay/state.yaml"),
        `    needsPlacement: true\n`,
      );
    });

    it.each([["the change", CHANGE_ID], ["its display id", "CH-1"], ["its task", TASK_ID]])(
      "refuses %s, naming placement",
      async (_label, ref) => {
        const err = await select(ref).catch((e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toContain("needs placement");
        expect(err.suggestion).toContain("place_change");
      },
    );
  });
});
