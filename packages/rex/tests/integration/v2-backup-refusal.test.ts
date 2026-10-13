/**
 * restoreFromBackup and getAvailableBackups refuse a v2 tree, so no caller
 * (CLI, dashboard) can swap a v1 snapshot in beside product/ and split it.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  V2RestoreRefusedError,
  V2_RESTORE_REFUSAL,
  getAvailableBackups,
  pruneBackups,
  restoreFromBackup,
} from "../../src/core/backup-snapshots.js";
import { copyV2Fixture } from "../helpers/v2-fixture.js";

const SNAPSHOT = "2026-08-25T22-01-32.215Z";

let tmp: string;
let rexDir: string;

beforeEach(async () => {
  tmp = realpathSync.native(await mkdtemp(join(tmpdir(), "rex-v2-backup-")));
  rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
  const snapshot = join(rexDir, ".backups", `prd_tree_${SNAPSHOT}`, "old-epic");
  await mkdir(snapshot, { recursive: true });
  await writeFile(join(snapshot, "index.md"), "---\nid: old\ntitle: Old epic\nlevel: epic\nstatus: pending\n---\n");
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("v2 tree", () => {
  it("restoreFromBackup refuses and creates no prd_tree/", async () => {
    const attempt = restoreFromBackup(rexDir, SNAPSHOT);
    await expect(attempt).rejects.toBeInstanceOf(V2RestoreRefusedError);
    await expect(attempt).rejects.toThrow(V2_RESTORE_REFUSAL);
    expect(existsSync(join(rexDir, "prd_tree"))).toBe(false);
  });

  it("getAvailableBackups refuses", async () => {
    await expect(getAvailableBackups(rexDir)).rejects.toBeInstanceOf(V2RestoreRefusedError);
  });

  it("pruneBackups still enforces retention", async () => {
    for (let i = 0; i < 3; i++) {
      await mkdir(join(rexDir, ".backups", `prd_tree_2026-08-2${i}T00-00-00.000Z`), { recursive: true });
    }
    await pruneBackups(rexDir, 2);
    expect((await readdir(join(rexDir, ".backups"))).sort()).toEqual([
      "prd_tree_2026-08-22T00-00-00.000Z",
      `prd_tree_${SNAPSHOT}`,
    ]);
  });

  it("uses the wording `rex restore` prints", () => {
    expect(V2_RESTORE_REFUSAL).toBe("Restore is v1-only until after the v2 cut; recover a v2 tree from git history.");
  });
});
