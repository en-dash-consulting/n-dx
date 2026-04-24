import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseDocument } from "../../src/store/markdown-parser.js";

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

async function expectCanonicalFilesInSync(tmpDir: string): Promise<{
  schema: string;
  title: string;
  items: Array<Record<string, unknown>>;
}> {
  const jsonDoc = JSON.parse(await readFile(join(tmpDir, ".rex", "prd.json"), "utf-8"));
  const parsed = parseDocument(await readFile(join(tmpDir, ".rex", "prd.md"), "utf-8"));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) {
    throw parsed.error;
  }
  expect(normalizeForMarkdown(parsed.data)).toEqual(normalizeForMarkdown(jsonDoc));
  return jsonDoc;
}

function normalizeForMarkdown<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForMarkdown(entry)) as T;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    if (Array.isArray(entry) && entry.length === 0 && key !== "items") continue;
    normalized[key] = normalizeForMarkdown(entry);
  }
  return normalized as T;
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
    await expectCanonicalFilesInSync(tmpDir);

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
    await expectCanonicalFilesInSync(tmpDir);

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
    await expectCanonicalFilesInSync(tmpDir);

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
    await expectCanonicalFilesInSync(tmpDir);

    // Edit task title/description
    const editOut = run([
      "update",
      taskId!,
      tmpDir,
      "--title=Implement OAuth Token Exchange",
      "--description=Refresh token exchange path and error handling",
    ]);
    expect(editOut).toContain("Updated task: Implement Token Exchange");
    let synced = await expectCanonicalFilesInSync(tmpDir);
    expect(JSON.stringify(synced)).toContain("Implement OAuth Token Exchange");

    // Next should return the task
    const nextOut = run(["next", tmpDir]);
    expect(nextOut).toContain("Implement OAuth Token Exchange");
    expect(nextOut).toContain("[task]");

    // Update task status to completed
    const updateOut = run([
      "update",
      taskId!,
      tmpDir,
      "--status=completed",
    ]);
    expect(updateOut).toContain("status: completed");
    synced = await expectCanonicalFilesInSync(tmpDir);
    expect(JSON.stringify(synced)).toContain("\"status\":\"completed\"");

    // Add a second epic so the feature move remains structurally valid
    const secondEpicOut = run([
      "add",
      "epic",
      tmpDir,
      '--title=Execution System',
    ]);
    const secondEpicId = secondEpicOut.match(/ID: (.+)/)?.[1]?.trim();
    await expectCanonicalFilesInSync(tmpDir);

    // Move the feature under the second epic
    const moveOut = run(["move", featId!, tmpDir, `--parent=${secondEpicId}`]);
    expect(moveOut).toContain("Moved feature: OAuth Flow");
    synced = await expectCanonicalFilesInSync(tmpDir);
    const movedEpic = synced.items.find((item) => item.id === secondEpicId);
    expect(movedEpic?.children?.some((item) => item.id === featId)).toBe(true);

    // Status should show the tree (--all to include completed items)
    const statusOut = run(["status", tmpDir, "--all"]);
    expect(statusOut).toContain("Auth System");
    expect(statusOut).toContain("OAuth Flow");
    expect(statusOut).toContain("Implement OAuth Token Exchange");
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
