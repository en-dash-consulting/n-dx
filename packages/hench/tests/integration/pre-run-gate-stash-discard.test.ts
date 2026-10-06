/**
 * The pre-run gate's `stash` and `discard` answers, against a real repository.
 *
 * The unit suite injects both as spies, which proves the gate routes to them
 * but says nothing about what they do to a working tree — and these are the
 * two answers that can lose work. So this suite runs the real implementations:
 *
 *  - stash must take untracked files with it, or the run starts on a tree the
 *    gate just reported as handled, and the next gate down refuses it.
 *  - stash must not take ignored files (`.hench/`, build output) with it.
 *  - discard must revert tracked edits and delete untracked files, and must
 *    leave a `git stash create` snapshot behind so the answer is recoverable.
 *  - discard must leave ignored files alone (`git clean -fd`, never `-fdx`).
 *
 * @see packages/hench/src/agent/lifecycle/shared.ts — performPreRunCommitGateIfNeeded
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import {
  performPreRunCommitGateIfNeeded,
  type PreRunCommitChoice,
  type PreRunCommitGateOptions,
} from "../../src/agent/lifecycle/shared.js";
import { commitGitFixtureBaseline, RM_RETRY } from "../helpers/index.js";

const execFile = promisify(execFileCb);

const PROPOSED = "chore: tidy up before the run";

describe("pre-run gate: stash and discard against real git", () => {
  let projectDir: string;

  const git = async (...args: string[]) =>
    (await execFile("git", args, { cwd: projectDir })).stdout;

  /**
   * Real stash/discard, stubbed prompt and message generation — the LLM and
   * the TTY are the only parts a test must not reach.
   */
  const gateOpts = (
    choice: PreRunCommitChoice,
    confirmDiscard = true,
  ): PreRunCommitGateOptions => ({
    projectDir,
    henchDir: join(projectDir, ".hench"),
    deps: {
      collectDiff: async () => ({ diff: "", stat: " 1 file changed" }),
      proposeMessage: async () => PROPOSED,
      promptChoice: async () => choice,
      confirmDiscard: async () => confirmDiscard,
      isTTY: true,
    },
  });

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-pre-run-gate-"));
    await writeFile(join(projectDir, "tracked.ts"), "export const a = 1;\n");
    await writeFile(join(projectDir, ".gitignore"), "ignored/\n");
    await mkdir(join(projectDir, "ignored"), { recursive: true });
    await writeFile(join(projectDir, "ignored", "state.json"), "{}\n");
    commitGitFixtureBaseline(projectDir);

    // The dirty tree the gate is asked about: one tracked edit, one untracked
    // file, plus an ignored file that is nobody's uncommitted work.
    await writeFile(join(projectDir, "tracked.ts"), "export const a = 2;\n");
    await writeFile(join(projectDir, "untracked.ts"), "export const b = 3;\n");
    await writeFile(join(projectDir, "ignored", "state.json"), '{"run":1}\n');
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true, ...RM_RETRY });
  });

  it("stashes tracked and untracked changes under the proposed message", async () => {
    expect(await performPreRunCommitGateIfNeeded(gateOpts("stash"))).toBe("proceed");

    expect((await git("status", "--porcelain")).trim()).toBe("");
    expect(await readFile(join(projectDir, "tracked.ts"), "utf-8")).toBe("export const a = 1;\n");
    expect(existsSync(join(projectDir, "untracked.ts"))).toBe(false);

    const stashes = await git("stash", "list");
    expect(stashes).toContain(`hench pre-run: ${PROPOSED}`);

    // Everything is recoverable in one step — the point of choosing stash.
    await git("stash", "pop");
    expect(await readFile(join(projectDir, "tracked.ts"), "utf-8")).toBe("export const a = 2;\n");
    expect(existsSync(join(projectDir, "untracked.ts"))).toBe(true);
  });

  it("leaves ignored files out of the stash", async () => {
    await performPreRunCommitGateIfNeeded(gateOpts("stash"));
    expect(await readFile(join(projectDir, "ignored", "state.json"), "utf-8")).toBe('{"run":1}\n');
  });

  it("discards tracked edits and untracked files, keeping a recoverable snapshot", async () => {
    expect(await performPreRunCommitGateIfNeeded(gateOpts("discard"))).toBe("proceed");

    expect((await git("status", "--porcelain")).trim()).toBe("");
    expect(await readFile(join(projectDir, "tracked.ts"), "utf-8")).toBe("export const a = 1;\n");
    expect(existsSync(join(projectDir, "untracked.ts"))).toBe(false);
    // Discard does not go through the stash list — the snapshot is dangling.
    expect((await git("stash", "list")).trim()).toBe("");

    // The dropped stash is a real commit holding everything that was removed,
    // untracked files included. `git stash store <sha>` is the documented
    // recovery and it must bring the whole dirty tree back.
    const unreachable = (await git("fsck", "--no-progress", "--unreachable"))
      .split("\n")
      .filter((line) => line.startsWith("unreachable commit "))
      .map((line) => line.replace("unreachable commit ", "").trim());
    const withSubjects = await Promise.all(
      unreachable.map(
        async (sha) => [sha, (await git("log", "-1", "--format=%s", sha)).trim()] as const,
      ),
    );
    const snapshot = withSubjects.find(([, subject]) => subject.includes("hench pre-run discard"));
    expect(snapshot).toBeDefined();
    await git("stash", "store", snapshot![0]);
    await git("stash", "pop");
    expect(await readFile(join(projectDir, "tracked.ts"), "utf-8")).toBe("export const a = 2;\n");
    expect(existsSync(join(projectDir, "untracked.ts"))).toBe(true);
  });

  it("never drops a stash entry the operator put there", async () => {
    // A discard drops the entry it just pushed. If it ever dropped `stash@{0}`
    // unconditionally, this pre-existing entry would be what disappeared.
    await writeFile(join(projectDir, "tracked.ts"), "export const a = 99;\n");
    await git("stash", "push", "-m", "operator's own work");
    await writeFile(join(projectDir, "tracked.ts"), "export const a = 2;\n");

    await performPreRunCommitGateIfNeeded(gateOpts("discard"));

    const stashes = await git("stash", "list");
    expect(stashes).toContain("operator's own work");
    expect(stashes.trim().split("\n")).toHaveLength(1);
  });

  it("leaves ignored files alone when discarding", async () => {
    await performPreRunCommitGateIfNeeded(gateOpts("discard"));
    expect(await readFile(join(projectDir, "ignored", "state.json"), "utf-8")).toBe('{"run":1}\n');
  });

  it("changes nothing when the discard confirmation is declined", async () => {
    expect(await performPreRunCommitGateIfNeeded(gateOpts("discard", false))).toBe("proceed");
    expect(await readFile(join(projectDir, "tracked.ts"), "utf-8")).toBe("export const a = 2;\n");
    expect(existsSync(join(projectDir, "untracked.ts"))).toBe(true);
  });
});
