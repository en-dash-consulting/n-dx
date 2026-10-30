/**
 * `ndx work --plan-queue --format=json <dir>` through the real CLI, on a v2
 * project. Pins the orchestration half: stdout is the plan JSON alone, the
 * command exits 0 without a configured vendor, and it starts no run, takes no
 * claim and writes no file. The rules are covered in
 * packages/hench/tests/unit/queue/plan-queue.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createTmpDir, removeTmpDir, runResult, setupHenchDir } from "./e2e-helpers.js";

const V2_FIXTURE = join(import.meta.dirname, "../../packages/rex/tests/fixtures/v2-tree");

/** Every file under `dir` with its content, so any write shows as a difference. */
async function snapshot(dir) {
  const out = {};
  const walk = async (d) => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) await walk(p);
      else out[relative(dir, p)] = await readFile(p, "utf-8");
    }
  };
  await walk(dir);
  return out;
}

describe("ndx work --plan-queue", () => {
  let dir;

  beforeAll(async () => {
    dir = await createTmpDir("ndx-work-plan-queue-");
    await setupHenchDir(dir);
    await mkdir(join(dir, ".hench", "runs"), { recursive: true });
    await cp(V2_FIXTURE, join(dir, ".rex"), { recursive: true });
    await writeFile(
      join(dir, ".rex", "config.json"),
      JSON.stringify({ schema: "rex/v1", project: "v2-project", adapter: "file" }) + "\n",
    );
  });

  afterAll(async () => {
    if (dir) await removeTmpDir(dir);
  });

  it("prints the plan as JSON, exits 0 and changes no file", async () => {
    const before = await snapshot(dir);
    const result = runResult(["work", "--plan-queue", "--format=json", dir]);

    expect(result.code, result.stderr).toBe(0);
    const plan = JSON.parse(result.stdout);
    expect(plan).toMatchObject({ activeRuns: 0, runLimit: 3 });
    // CH-1 has no touches, so its one ready task runs alone.
    expect(plan.lanes).toEqual([
      {
        command: "n-dx work --task=c0000000-0000-4000-8000-000000000002 --auto .",
        changeId: "c0000000-0000-4000-8000-000000000001",
        tasks: [expect.objectContaining({ id: "c0000000-0000-4000-8000-000000000002", title: "Wire the button" })],
      },
    ]);
    expect(plan.excluded).toEqual([]);
    expect(await snapshot(dir)).toEqual(before);
  });
});

// A lane chains its steps with `&&`, but a run can exit 0 without completing
// its task (a transient vendor error). The step for a blocked task therefore
// refuses, through the real CLI, while its blocker is still open.
describe("a --plan-queue lane step for a blocked task", () => {
  const WIRE = "c0000000-0000-4000-8000-000000000002";
  const SHIP = "c0000000-0000-4000-8000-000000000003";
  let dir;

  beforeAll(async () => {
    dir = await createTmpDir("ndx-work-plan-queue-lane-");
    await setupHenchDir(dir);
    await mkdir(join(dir, ".hench", "runs"), { recursive: true });
    await cp(V2_FIXTURE, join(dir, ".rex"), { recursive: true });
    await writeFile(
      join(dir, ".rex", "config.json"),
      JSON.stringify({ schema: "rex/v1", project: "v2-project", adapter: "file" }) + "\n",
    );
    await writeFile(
      join(dir, ".rex", "changes", "add-apple-pay", "ship-it.md"),
      `---\nid: "${SHIP}"\ntype: "task"\ntitle: "Ship it"\nslug: "ship-it"\nblockedBy: ["${WIRE}"]\n---\n`,
    );
  });

  afterAll(async () => {
    if (dir) await removeTmpDir(dir);
  });

  it("does not start while its blocker is unfinished, though the step before exited 0", async () => {
    const result = runResult(["work", "--plan-queue", "--format=json", dir]);
    expect(result.code, result.stderr).toBe(0);
    const [lane] = JSON.parse(result.stdout).lanes;
    const steps = lane.command.split(" && ");
    expect(steps).toEqual([
      `n-dx work --task=${WIRE} --auto .`,
      `n-dx work --task=${SHIP} --require-unblocked --auto .`,
    ]);

    // WIRE is still pending, as after a run that exited 0 without completing it.
    // --dry-run stands in for a vendor; selection refuses before either matters.
    const args = steps[1].split(" ").slice(1, -1);
    const step = runResult([...args, "--dry-run", dir]);
    expect(step.code).not.toBe(0);
    expect(step.stdout + step.stderr).toContain(`blocked by unfinished work: ${WIRE} (pending)`);
  });
});
