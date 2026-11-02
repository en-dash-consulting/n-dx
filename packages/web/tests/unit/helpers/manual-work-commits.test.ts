import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, headSha, workCommitsSince } from "../../e2e-ui-manual/helpers/real-vendor-project.js";

let dir: string;

function commit(message: string): void {
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.email=t@test.local", "-c", "user.name=t", "commit", "-q", "-m", message]);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ndx-work-commits-"));
  git(dir, ["init", "-q"]);
  await mkdir(join(dir, ".ndx", "rex", "changes"), { recursive: true });
  await writeFile(join(dir, ".ndx", "rex", "changes", "state.yaml"), "status: pending\n");
  await writeFile(join(dir, "README.md"), "fixture\n");
  commit("seed");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("workCommitsSince", () => {
  it("does not count hench's own PRD completion record as the agent's work", async () => {
    const base = headSha(dir);
    await writeFile(join(dir, ".ndx", "rex", "changes", "state.yaml"), "status: completed\n");
    commit("chore(prd): commit PRD tree changes (task t1 completed)");

    expect(headSha(dir)).not.toBe(base);
    expect(workCommitsSince(dir, base)).toEqual([]);
  });

  it("counts a commit that changes a file outside the tool directories", async () => {
    const base = headSha(dir);
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "farewell.js"), "export const x = 1;\n");
    await writeFile(join(dir, ".ndx", "rex", "changes", "state.yaml"), "status: completed\n");
    commit("feat: farewell");
    const work = headSha(dir);
    await writeFile(join(dir, ".ndx", "rex", "changes", "state.yaml"), "status: completed # again\n");
    commit("chore(prd): commit PRD tree changes (task t1 completed)");

    expect(workCommitsSince(dir, base)).toEqual([work]);
  });

  it("ignores commits made before the baseline", async () => {
    await writeFile(join(dir, "README.md"), "changed before the run\n");
    commit("setup");
    expect(workCommitsSince(dir, headSha(dir))).toEqual([]);
  });
});
