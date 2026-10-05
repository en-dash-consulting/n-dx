/**
 * Flag-combination refusals for `hench run`.
 *
 * A flag the run cannot honor must fail loudly, not silently no-op. The
 * project already applies that rule to `--review` on the api provider, to
 * `--review-model`/`--review-optional` without `--review`, and to
 * `--epic-by-epic` with `--epic`; these tests cover the same rule for
 * `--mine`, whose silent form is the worst of the set — `--epic-by-epic`
 * carries no assignee filter, so an accepted-but-ignored `--mine` would run
 * and commit under other people's tasks while the operator believed the run
 * was scoped to their own.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const CLI_PATH = join(import.meta.dirname, "../../dist/cli/index.js");
const TIMEOUT = 30_000;

function runResult(args: string[]): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync("node", [CLI_PATH, ...args], {
      encoding: "utf-8",
      timeout: TIMEOUT,
      stdio: "pipe",
    });
    return { stdout, stderr: "", code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.status ?? 1 };
  }
}

describe("hench run — flag conflict refusals", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-run-flags-"));
    expect(runResult(["init", tmpDir]).code).toBe(0);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // --resolve is a mode: any value but "false" resolves and never runs. With no
  // --task, resolve's own refusal is the proof the run path was not taken.
  it.each(["--resolve", "--resolve=true", "--resolve=yes"])("treats %s as resolve, not a run", (flag) => {
    const { stderr, code } = runResult(["run", flag, tmpDir]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/--resolve requires --task/);
  });

  it("refuses --mine together with --epic-by-epic instead of ignoring it", () => {
    const { stderr, code } = runResult(["run", "--mine", "--epic-by-epic", tmpDir]);

    expect(code).toBe(1);
    expect(stderr).toContain("Cannot use --mine with --epic-by-epic");
    // The suggestion has to name the way out, not just the conflict.
    expect(stderr).toContain("cannot filter by assignee");
  });

  it("accepts --epic-by-epic on its own (the refusal is the combination, not the flag)", () => {
    // Guards against a refusal written so broadly it breaks --epic-by-epic
    // itself. This run gets past argument validation; whatever it does next
    // is not this test's business, only that it is not the --mine refusal.
    const { stderr } = runResult(["run", "--epic-by-epic", "--dry-run", tmpDir]);
    expect(stderr).not.toContain("Cannot use --mine with --epic-by-epic");
  });
});
