/**
 * The pre-run planning commit's `N-DX-Item` names the unit `--task` runs, by
 * canonical id. On v2 `--task` also takes a display id (CH-1), an alias or a
 * change, which resolve to one of the change's tasks; restacks and landing
 * key on the canonical id, so the trailer never carries the ref as typed.
 * A ref that resolves to nothing leaves the trailer out.
 *
 * cmdRun resolves with {@link resolveTaskRefId} and hands the result to the
 * gate; this drives both against a real repository holding rex's v2 fixture.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import { performPreRunCommitGateIfNeeded, PLANNING_COMMIT_SUBJECT } from "../../src/agent/lifecycle/shared.js";
import { resolveTaskRefId } from "../../src/cli/commands/run.js";
import { initGitFixtureRepo, RM_RETRY } from "../helpers/index.js";

const execFile = promisify(execFileCb);

const FIXTURE = join(import.meta.dirname, "../../../rex/tests/fixtures/v2-tree");
/** The fixture's change, CH-1. */
const CHANGE_ID = "c0000000-0000-4000-8000-000000000001";
/** Its open task, the unit a ref to CH-1 runs. */
const WIRE_ID = "c0000000-0000-4000-8000-000000000002";

describe("pre-run planning commit: N-DX-Item names the resolved task", () => {
  let projectDir: string;
  let rexDir: string;

  async function git(...args: string[]): Promise<string> {
    return (await execFile("git", args, { cwd: projectDir })).stdout.trim();
  }

  /** What cmdRun does: resolve the ref, then run the gate with that id. */
  async function gateFor(ref: string): Promise<string> {
    const itemId = await resolveTaskRefId(rexDir, ref);
    expect(
      await performPreRunCommitGateIfNeeded({
        projectDir,
        henchDir: join(projectDir, ".hench"),
        autonomous: true,
        ...(itemId ? { itemId } : {}),
        deps: { isTTY: false },
      }),
    ).toBe("proceed");
    expect(await git("log", "-1", "--format=%s")).toBe(PLANNING_COMMIT_SUBJECT);
    return git("log", "-1", "--format=%(trailers:key=N-DX-Item,valueonly)");
  }

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-planning-item-"));
    rexDir = join(projectDir, ".rex");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await initGitFixtureRepo(projectDir);
    await cp(FIXTURE, rexDir, { recursive: true });
    await writeFile(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "shop", adapter: "file" }));
    await git("add", ".");
    await git("commit", "-m", "initial");
    // A pending planning edit for the gate to commit.
    await writeFile(join(rexDir, "product", "planning-note.md"), "# Note\n");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true, ...RM_RETRY });
  });

  it("writes the task's id when --task is the change's display id", async () => {
    expect(await gateFor("CH-1")).toBe(WIRE_ID);
  });

  it("writes the task's id when --task is the change's id", async () => {
    expect(await gateFor(CHANGE_ID)).toBe(WIRE_ID);
  });

  it("writes the id unchanged when --task is already the task's id", async () => {
    expect(await gateFor(WIRE_ID)).toBe(WIRE_ID);
  });

  it("leaves N-DX-Item out when the ref resolves to nothing", async () => {
    expect(await resolveTaskRefId(rexDir, "CH-404")).toBeUndefined();
    expect(await gateFor("CH-404")).toBe("");
  });
});
