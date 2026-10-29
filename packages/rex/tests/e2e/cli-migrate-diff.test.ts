import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { formatPlanFile, type PlanFile } from "../../src/migrations/plan-file.js";
import { v1ToV2, v1TreeSource } from "../../src/migrations/v1-to-v2/index.js";

const cli = fileURLToPath(new URL("../../dist/cli/index.js", import.meta.url));

describe("rex migrate-diff", () => {
  let dir: string;
  let before: PlanFile;
  let after: PlanFile;
  const run = (args: string[]) => spawnSync(process.execPath, [cli, "migrate-diff", ...args], {
    cwd: dir, encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"],
  });
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rex-plan-diff-"));
    before = await v1ToV2.plan(v1TreeSource([
      { id: "a", title: "Old task", level: "task", status: "pending" },
    ]), { cutAt: "2026-10-08T00:00:00.000Z" });
    after = await v1ToV2.plan(v1TreeSource([
      { id: "b", title: "New task", level: "task", status: "pending" },
    ]), { cutAt: "2026-10-09T00:00:00.000Z" });
    await writeFile(join(dir, "before plan.json"), formatPlanFile(before));
    await writeFile(join(dir, "after plan.json"), formatPlanFile(after));
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it.each(["equals", "separate"])("compares real pipeline files without a project or any writes (%s flags)", async (style) => {
    const names = await readdir(dir);
    const oldText = await readFile(join(dir, "before plan.json"), "utf8");
    const newText = await readFile(join(dir, "after plan.json"), "utf8");
    const args = style === "equals"
      ? ["--before=before plan.json", "--after=after plan.json"]
      : ["--before", "before plan.json", "--after", "after plan.json"];
    const proc = run(args);
    expect(proc.status, proc.stderr).toBe(0);
    expect(proc.stdout).toContain('Dropped "Old task" (a)');
    expect(proc.stdout).toContain('Added "New task" (b)');
    expect(proc.stdout).toContain("Counts by kind:");
    expect(await readdir(dir)).toEqual(names);
    expect(await readFile(join(dir, "before plan.json"), "utf8")).toBe(oldText);
    expect(await readFile(join(dir, "after plan.json"), "utf8")).toBe(newText);
  });

  it("reports identical files as no differences", () => {
    const proc = run(["--before=before plan.json", "--after=before plan.json"]);
    expect(proc.status, proc.stderr).toBe(0);
    expect(proc.stdout.trim()).toBe("No differences between migration plans.");
  });

  it.each([
    [[], /Missing --before/],
    [["--before=before plan.json"], /Missing --after/],
    [["--before", "--after=after plan.json"], /Missing --before/],
    [["--before=missing.json", "--after=after plan.json"], /ENOENT/],
  ] as const)("refuses invalid arguments %j", (args, message) => {
    const proc = run([...args]);
    expect(proc.status).not.toBe(0);
    expect(proc.stderr).toMatch(message);
  });

  it("reports malformed plan input instead of a successful empty diff", async () => {
    await writeFile(join(dir, "after plan.json"), "{}");
    const proc = run(["--before=before plan.json", "--after=after plan.json"]);
    expect(proc.status).not.toBe(0);
    expect(proc.stderr).toContain("not a migration plan file");
  });

  it("documents the command in help", () => {
    const proc = run(["--help"]);
    expect(proc.status).toBe(0);
    expect(proc.stdout).toContain("--before=<path>");
    expect(proc.stdout).toContain("--after=<path>");
  });
});
