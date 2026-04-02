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

describe("rex prune", { timeout: 120_000 }, () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-e2e-prune-"));
    run(["init", tmpDir]);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reports nothing to prune on empty PRD", () => {
    const output = run(["prune", tmpDir]);
    expect(output).toContain("Nothing to prune.");
  });

  it("reports nothing to prune on pending items", () => {
    run(["add", "epic", "--title=Active Epic", tmpDir]);
    const output = run(["prune", "--no-consolidate", tmpDir]);
    expect(output).toContain("Nothing to prune.");
  });

  it("prunes a completed epic", () => {
    const epicOut = run(["add", "epic", "--title=Done Epic", tmpDir]);
    const epicId = epicOut.match(/ID: (.+)/)?.[1]?.trim();
    run(["update", epicId!, "--status=in_progress", "--force", tmpDir]);
    run(["update", epicId!, "--status=completed", "--force", tmpDir]);

    const output = run(["prune", tmpDir]);
    expect(output).toContain("Pruned 1 completed item");
    expect(output).toContain("Done Epic");
  });

  it("archives pruned items to .rex/archive.json", async () => {
    const epicOut = run(["add", "epic", "--title=Archived Epic", tmpDir]);
    const epicId = epicOut.match(/ID: (.+)/)?.[1]?.trim();
    run(["update", epicId!, "--status=in_progress", "--force", tmpDir]);
    run(["update", epicId!, "--status=completed", "--force", tmpDir]);

    run(["prune", tmpDir]);

    const archivePath = join(tmpDir, ".rex", "archive.json");
    const archive = JSON.parse(await readFile(archivePath, "utf-8"));
    expect(archive.schema).toBe("rex/archive/v1");
    expect(archive.batches).toHaveLength(1);
    expect(archive.batches[0].items[0].title).toBe("Archived Epic");
    expect(archive.batches[0].count).toBe(1);
  });

  it("dry-run shows what would be pruned without mutating", async () => {
    const epicOut = run(["add", "epic", "--title=Preview Epic", tmpDir]);
    const epicId = epicOut.match(/ID: (.+)/)?.[1]?.trim();
    run(["update", epicId!, "--status=in_progress", "--force", tmpDir]);
    run(["update", epicId!, "--status=completed", "--force", tmpDir]);

    const dryOutput = run(["prune", "--dry-run", "--no-consolidate", tmpDir]);
    expect(dryOutput).toContain("Would prune:");
    expect(dryOutput).toContain("Preview Epic");

    // Item should still be in the PRD after dry-run
    const status = run(["status", "--format=json", tmpDir]);
    const doc = JSON.parse(status);
    expect(doc.items.some((i: { title: string }) => i.title === "Preview Epic")).toBe(true);
  });

  it("dry-run with --format=json returns structured output", () => {
    const epicOut = run(["add", "epic", "--title=JSON Epic", tmpDir]);
    const epicId = epicOut.match(/ID: (.+)/)?.[1]?.trim();
    run(["update", epicId!, "--status=in_progress", "--force", tmpDir]);
    run(["update", epicId!, "--status=completed", "--force", tmpDir]);

    const output = run(["prune", "--dry-run", "--format=json", "--no-consolidate", tmpDir]);
    const parsed = JSON.parse(output);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].title).toBe("JSON Epic");
  });

  it("prune with --format=json returns structured result", async () => {
    const epicOut = run(["add", "epic", "--title=JSON Prune", tmpDir]);
    const epicId = epicOut.match(/ID: (.+)/)?.[1]?.trim();
    run(["update", epicId!, "--status=in_progress", "--force", tmpDir]);
    run(["update", epicId!, "--status=completed", "--force", tmpDir]);

    const output = run(["prune", "--format=json", tmpDir]);
    const parsed = JSON.parse(output);
    expect(parsed.prunedCount).toBe(1);
    expect(parsed.pruned).toHaveLength(1);
    expect(parsed.pruned[0].title).toBe("JSON Prune");
  });

  it("does not prune partially completed subtrees", () => {
    // Create epic with two tasks — only one completed
    const epicOut = run(["add", "epic", "--title=Mixed Epic", tmpDir]);
    const epicId = epicOut.match(/ID: (.+)/)?.[1]?.trim();

    const taskOut = run(["add", "task", "--title=Done Task", `--parent=${epicId}`, tmpDir]);
    const taskId = taskOut.match(/ID: (.+)/)?.[1]?.trim();
    run(["add", "task", "--title=Active Task", `--parent=${epicId}`, tmpDir]);

    run(["update", taskId!, "--status=in_progress", "--force", tmpDir]);
    run(["update", taskId!, "--status=completed", "--force", tmpDir]);

    const output = run(["prune", "--no-consolidate", tmpDir]);
    // The completed task should be pruned from under the epic
    expect(output).toContain("Pruned 1 completed item");
    expect(output).toContain("Done Task");

    // The epic and active task should remain
    const status = run(["status", "--format=json", tmpDir]);
    const doc = JSON.parse(status);
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0].title).toBe("Mixed Epic");
    expect(doc.items[0].children).toHaveLength(1);
    expect(doc.items[0].children[0].title).toBe("Active Task");
  });

  it("--yes flag skips confirmation and prunes", () => {
    const epicOut = run(["add", "epic", "--title=Auto Epic", tmpDir]);
    const epicId = epicOut.match(/ID: (.+)/)?.[1]?.trim();
    run(["update", epicId!, "--status=in_progress", "--force", tmpDir]);
    run(["update", epicId!, "--status=completed", "--force", tmpDir]);

    const output = run(["prune", "--yes", "--no-consolidate", tmpDir]);
    expect(output).toContain("Pruned 1 completed item");
    expect(output).toContain("Auto Epic");
  });

  it("-y short flag skips confirmation and prunes", () => {
    const epicOut = run(["add", "epic", "--title=Short Flag Epic", tmpDir]);
    const epicId = epicOut.match(/ID: (.+)/)?.[1]?.trim();
    run(["update", epicId!, "--status=in_progress", "--force", tmpDir]);
    run(["update", epicId!, "--status=completed", "--force", tmpDir]);

    const output = run(["prune", "-y", "--no-consolidate", tmpDir]);
    expect(output).toContain("Pruned 1 completed item");
    expect(output).toContain("Short Flag Epic");
  });

  it("dry-run shows impact counts with subtree details", () => {
    // Create an epic with a task (2-item subtree)
    const epicOut = run(["add", "epic", "--title=Impact Epic", tmpDir]);
    const epicId = epicOut.match(/ID: (.+)/)?.[1]?.trim();

    const taskOut = run(["add", "task", "--title=Impact Task", `--parent=${epicId}`, tmpDir]);
    const taskId = taskOut.match(/ID: (.+)/)?.[1]?.trim();

    run(["update", epicId!, "--status=in_progress", "--force", tmpDir]);
    run(["update", taskId!, "--status=in_progress", "--force", tmpDir]);
    run(["update", taskId!, "--status=completed", "--force", tmpDir]);
    run(["update", epicId!, "--status=completed", "--force", tmpDir]);

    const dryOutput = run(["prune", "--dry-run", "--no-consolidate", tmpDir]);
    expect(dryOutput).toContain("Would prune:");
    expect(dryOutput).toContain("Impact Epic");
    expect(dryOutput).toContain("2 items including children");
    expect(dryOutput).toContain("Impact: 2 total items");
    expect(dryOutput).toContain("1 epic");
  });

  it("dry-run JSON output includes totalItems count", () => {
    const epicOut = run(["add", "epic", "--title=Total Epic", tmpDir]);
    const epicId = epicOut.match(/ID: (.+)/)?.[1]?.trim();

    const taskOut = run(["add", "task", "--title=Total Task", `--parent=${epicId}`, tmpDir]);
    const taskId = taskOut.match(/ID: (.+)/)?.[1]?.trim();

    run(["update", epicId!, "--status=in_progress", "--force", tmpDir]);
    run(["update", taskId!, "--status=in_progress", "--force", tmpDir]);
    run(["update", taskId!, "--status=completed", "--force", tmpDir]);
    run(["update", epicId!, "--status=completed", "--force", tmpDir]);

    const output = run(["prune", "--dry-run", "--format=json", "--no-consolidate", tmpDir]);
    const parsed = JSON.parse(output);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.totalItems).toBe(2);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].title).toBe("Total Epic");
  });

  it("logs prune events to execution log", async () => {
    const epicOut = run(["add", "epic", "--title=Log Epic", tmpDir]);
    const epicId = epicOut.match(/ID: (.+)/)?.[1]?.trim();
    run(["update", epicId!, "--status=in_progress", "--force", tmpDir]);
    run(["update", epicId!, "--status=completed", "--force", tmpDir]);

    run(["prune", tmpDir]);

    const logPath = join(tmpDir, ".rex", "execution-log.jsonl");
    const logContent = await readFile(logPath, "utf-8");
    const lines = logContent.trim().split("\n").map((l) => JSON.parse(l));
    const pruneEvent = lines.find((l: { event: string }) => l.event === "items_pruned");
    expect(pruneEvent).toBeDefined();
    expect(pruneEvent.detail).toContain("Log Epic");
  });
});
