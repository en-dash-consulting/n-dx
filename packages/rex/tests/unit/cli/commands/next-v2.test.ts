/**
 * `rex next` on a v2 tree selects through `findNextWork`, on a temp copy of
 * the v2 fixture.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdNext } from "../../../../src/cli/commands/next.js";
import { DEFAULT_CONFIG } from "../../../../src/schema/index.js";
import { openClaimsStore } from "../../../../src/store/claims.js";
import { copyV2Fixture, editText } from "../../../helpers/v2-fixture.js";

const CHANGE = "c0000000-0000-4000-8000-000000000001";
const TASK = "c0000000-0000-4000-8000-000000000002";

describe("rex next on a v2 tree", () => {
  let tmp: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmp = realpathSync.native(await mkdtemp(join(tmpdir(), "rex-next-v2-")));
    execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: tmp });
    await copyV2Fixture(join(tmp, ".rex"), "lf");
    await writeFile(join(tmp, ".rex", "config.json"), JSON.stringify(DEFAULT_CONFIG("shop")));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await rm(tmp, { recursive: true, force: true });
  });

  const output = (): string => logSpy.mock.calls.map((c) => c[0] ?? "").join("\n");

  it("prints the selected task with its change", async () => {
    await cmdNext(tmp, {});
    expect(output()).toContain("[task]");
    expect(output()).toContain("Wire the button");
    expect(output()).toContain(TASK);
  });

  it("prints a task-less change as [change], never [epic]", async () => {
    await rm(join(tmp, ".rex", "changes", "add-apple-pay", "wire-the-button.md"));
    await cmdNext(tmp, {});
    expect(output()).toContain("[change]");
    expect(output()).toContain(CHANGE);
    expect(output()).not.toContain("[epic]");
  });

  it("--format=json keeps the v1 fields and adds changeId", async () => {
    await cmdNext(tmp, { format: "json" });
    const body = JSON.parse(output());
    expect(body.item).toMatchObject({ id: TASK, type: "task" });
    expect(body.item).not.toHaveProperty("level");
    for (const p of body.parents) expect(p).not.toHaveProperty("level");
    expect(body.parents.map((p: { id: string }) => p.id)).toEqual([CHANGE]);
    expect(body.changeId).toBe(CHANGE);
    expect(body.explanation.reason).toBe("priority");
    expect(body.skippedClaimed).toEqual([]);
  });

  it("passes over work claimed by another worktree and reports COMPLETE", async () => {
    expect((await openClaimsStore(tmp).claim(TASK, { worktreeRoot: join(tmp, "elsewhere") })).ok).toBe(true);
    await cmdNext(tmp, {});
    expect(output()).toMatch(/COMPLETE .*1 claimed elsewhere/);
  });

  it("never selects an Inbox change", async () => {
    // needsPlacement is tool state: it lives in state.yaml, not the frontmatter.
    await editText(join(tmp, ".rex", "changes", "add-apple-pay", "state.yaml"), (text) =>
      text.replace(/^    status: "in_progress"$/m, '    status: "in_progress"\n    needsPlacement: true'),
    );
    await cmdNext(tmp, { format: "json" });
    expect(JSON.parse(output()).item).toBeNull();
  });
});
