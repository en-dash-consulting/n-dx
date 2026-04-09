import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cliPath = join(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
  "dist",
  "cli",
  "index.js",
);

function run(args: string[]): string {
  return execFileSync("node", [cliPath, ...args], {
    encoding: "utf-8",
    timeout: 10000,
  });
}

describe("rex CLI workflow", { timeout: 120_000 }, () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-e2e-wf-"));
    run(["init", tmpDir]);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("full cycle: add epic → feature → task → next → update → status", async () => {
    // Add epic
    const epicOut = run([
      "add",
      "epic",
      tmpDir,
      '--title=Auth System',
      "--priority=high",
    ]);
    expect(epicOut).toContain("Created epic: Auth System");
    const epicId = epicOut.match(/ID: (.+)/)?.[1]?.trim();
    expect(epicId).toBeDefined();

    // Add feature under epic
    const featOut = run([
      "add",
      "feature",
      tmpDir,
      '--title=OAuth Flow',
      `--parent=${epicId}`,
    ]);
    expect(featOut).toContain("Created feature: OAuth Flow");
    const featId = featOut.match(/ID: (.+)/)?.[1]?.trim();

    // Add task under feature
    const taskOut = run([
      "add",
      "task",
      tmpDir,
      '--title=Implement Token Exchange',
      `--parent=${featId}`,
      "--priority=critical",
    ]);
    expect(taskOut).toContain("Created task: Implement Token Exchange");
    const taskId = taskOut.match(/ID: (.+)/)?.[1]?.trim();

    // Next should return the task
    const nextOut = run(["next", tmpDir]);
    expect(nextOut).toContain("Implement Token Exchange");
    expect(nextOut).toContain("[task]");

    // Update task to completed
    const updateOut = run([
      "update",
      taskId!,
      tmpDir,
      "--status=completed",
    ]);
    expect(updateOut).toContain("status: completed");

    // Status should show the tree (--all to include completed items)
    const statusOut = run(["status", tmpDir, "--all"]);
    expect(statusOut).toContain("Auth System");
    expect(statusOut).toContain("OAuth Flow");
    expect(statusOut).toContain("●"); // completed icon
  });

  it("validate passes on valid PRD", () => {
    const output = run(["validate", tmpDir]);
    expect(output).toContain("All checks passed");
  });

  it("add validates parent-child level relationships", () => {
    // Adding a feature without parent should fail
    try {
      run(["add", "feature", tmpDir, '--title=Orphan Feature']);
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      const e = err as { stderr?: string; status?: number };
      expect(e.status).not.toBe(0);
    }
  });

  it("next reports COMPLETE when no tasks", () => {
    const output = run(["next", tmpDir]);
    expect(output).toContain("No items");
  });

  it("status shows empty state", () => {
    const output = run(["status", tmpDir]);
    expect(output).toContain("No items yet");
  });

  it("status --format=json outputs JSON", () => {
    run(["add", "epic", tmpDir, '--title=Test Epic']);
    const output = run(["status", tmpDir, "--format=json"]);
    const parsed = JSON.parse(output);
    expect(parsed.schema).toBe("rex/v1");
    expect(parsed.items.length).toBe(1);
  });

  it("status --format=tree shows hierarchy with icons", () => {
    const epicOut = run(["add", "epic", tmpDir, '--title=Auth System', "--priority=high"]);
    const epicId = epicOut.match(/ID: (.+)/)?.[1]?.trim();
    const featOut = run(["add", "feature", tmpDir, '--title=Login', `--parent=${epicId}`]);
    const featId = featOut.match(/ID: (.+)/)?.[1]?.trim();
    run(["add", "task", tmpDir, '--title=Build form', `--parent=${featId}`]);

    const output = run(["status", tmpDir, "--format=tree"]);
    // Title, hierarchy, icons, indentation, completion counts
    expect(output).toContain("PRD:");
    expect(output).toContain("Auth System");
    expect(output).toContain("Login");
    expect(output).toContain("Build form");
    expect(output).toContain("○"); // pending icon
    expect(output).toContain("[high]"); // priority
    expect(output).toContain("[0/"); // completion count
  });

  it("status --format=unknown errors", () => {
    try {
      run(["status", tmpDir, "--format=csv"]);
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      const e = err as { stderr?: string; status?: number };
      expect(e.status).not.toBe(0);
    }
  });

  it("execution log records actions", async () => {
    run(["add", "epic", tmpDir, '--title=Logged Epic']);
    const log = await readFile(
      join(tmpDir, ".rex", "execution-log.jsonl"),
      "utf-8",
    );
    const lines = log.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    const entry = JSON.parse(lines[0]);
    expect(entry.event).toBe("item_added");
  });
});
