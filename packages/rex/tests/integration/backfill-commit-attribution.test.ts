/**
 * Integration tests for backfill-commit-attribution command.
 *
 * Tests the backfill command's ability to parse N-DX-Status trailers from git history
 * and populate the commits array in PRD items.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { cmdBackfillCommitAttribution } from "../../src/cli/commands/backfill-commit-attribution.js";
import { FolderTreeStore } from "../../src/store/folder-tree-store.js";
import type { PRDDocument, PRDItem } from "../../src/schema/index.js";
import { SCHEMA_VERSION } from "../../src/schema/index.js";
import { randomUUID } from "node:crypto";

const execAsync = promisify(execCb);

/**
 * Initialize git repo with test configuration.
 */
async function setupGitRepo(dir: string): Promise<void> {
  await execAsync("git init", { cwd: dir });
  await execAsync("git config user.email test@test.com", { cwd: dir });
  await execAsync("git config user.name Test", { cwd: dir });
}

/**
 * Create a commit with a specific N-DX-Status trailer.
 */
async function createCommitWithTrailer(
  dir: string,
  file: string,
  content: string,
  taskId: string,
  oldStatus: string,
  newStatus: string,
): Promise<string> {
  await writeFile(join(dir, file), content, "utf-8");
  await execAsync(`git add ${file}`, { cwd: dir });

  const message = `Complete task\n\nN-DX-Status: ${taskId} ${oldStatus} → ${newStatus}`;
  const messageFile = join(dir, ".commit-msg");
  await writeFile(messageFile, message, "utf-8");

  await execAsync(`git commit -F ${messageFile}`, { cwd: dir });

  const { stdout } = await execAsync("git rev-parse HEAD", { cwd: dir });
  const sha = stdout.trim();

  return sha;
}

/**
 * Read the PRD item from the folder tree.
 */
async function readPRDItem(rexDir: string, itemId: string): Promise<PRDItem | null> {
  const store = new FolderTreeStore(rexDir);
  return store.getItem(itemId);
}

describe("backfill-commit-attribution", () => {
  let projectDir: string;
  let rexDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "backfill-test-"));
    rexDir = join(projectDir, ".rex");
    await mkdir(rexDir, { recursive: true });

    // Mock console to reduce noise
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Setup git repo
    await setupGitRepo(projectDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("populates commits array from N-DX-Status trailers", async () => {
    // Create PRD with a task
    const taskId = randomUUID();
    const task: PRDItem = {
      id: taskId,
      title: "Test Task",
      status: "completed",
      level: "task",
    };

    const doc: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "Test PRD",
      items: [task],
    };

    const store = new FolderTreeStore(rexDir);
    await store.saveDocument(doc);

    // Create initial commit
    await writeFile(join(projectDir, "src.ts"), "export const x = 1;\n", "utf-8");
    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "initial"', { cwd: projectDir });

    // Create a commit with N-DX-Status trailer
    const sha = await createCommitWithTrailer(
      projectDir,
      "src.ts",
      "export const x = 2;\n",
      taskId,
      "in_progress",
      "completed",
    );

    // Run backfill
    await cmdBackfillCommitAttribution(projectDir);

    // Verify item now has commits array
    const updated = await readPRDItem(rexDir, taskId);
    expect(updated).not.toBeNull();
    expect(updated!.commits).toBeDefined();
    expect(updated!.commits).toHaveLength(1);
    expect(updated!.commits![0].hash).toBe(sha);
    expect(updated!.commits![0].author).toBe("Test");
    expect(updated!.commits![0].authorEmail).toBe("test@test.com");
    expect(updated!.commits![0].timestamp).toBeDefined();
  });

  it("is idempotent: re-running backfill does not duplicate commits", async () => {
    const taskId = randomUUID();
    const task: PRDItem = {
      id: taskId,
      title: "Test Task",
      status: "completed",
      level: "task",
    };

    const doc: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "Test PRD",
      items: [task],
    };

    const store = new FolderTreeStore(rexDir);
    await store.saveDocument(doc);

    // Create initial commit
    await writeFile(join(projectDir, "src.ts"), "export const x = 1;\n", "utf-8");
    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "initial"', { cwd: projectDir });

    // Create a commit with N-DX-Status trailer
    await createCommitWithTrailer(
      projectDir,
      "src.ts",
      "export const x = 2;\n",
      taskId,
      "in_progress",
      "completed",
    );

    // First backfill run
    await cmdBackfillCommitAttribution(projectDir);
    let updated = await readPRDItem(rexDir, taskId);
    expect(updated!.commits).toHaveLength(1);

    // Second backfill run should not add duplicates
    await cmdBackfillCommitAttribution(projectDir);
    updated = await readPRDItem(rexDir, taskId);
    expect(updated!.commits).toHaveLength(1);
  });

  it("accumulates multiple commits for the same item", async () => {
    const taskId = randomUUID();
    const task: PRDItem = {
      id: taskId,
      title: "Test Task",
      status: "completed",
      level: "task",
    };

    const doc: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "Test PRD",
      items: [task],
    };

    const store = new FolderTreeStore(rexDir);
    await store.saveDocument(doc);

    // Create initial commit
    await writeFile(join(projectDir, "src.ts"), "export const x = 1;\n", "utf-8");
    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "initial"', { cwd: projectDir });

    // Create two commits with N-DX-Status trailers for the same item
    const sha1 = await createCommitWithTrailer(
      projectDir,
      "src.ts",
      "export const x = 2;\n",
      taskId,
      "pending",
      "in_progress",
    );

    const sha2 = await createCommitWithTrailer(
      projectDir,
      "src.ts",
      "export const x = 3;\n",
      taskId,
      "in_progress",
      "completed",
    );

    // Run backfill
    await cmdBackfillCommitAttribution(projectDir);

    // Verify both commits are recorded
    const updated = await readPRDItem(rexDir, taskId);
    expect(updated!.commits).toHaveLength(2);
    expect(updated!.commits![0].hash).toBe(sha1);
    expect(updated!.commits![1].hash).toBe(sha2);
  });

  it("skips commits for items not in PRD", async () => {
    // Create a commit with N-DX-Status trailer for a non-existent task
    const nonExistentTaskId = randomUUID();

    await writeFile(join(projectDir, "src.ts"), "export const x = 1;\n", "utf-8");
    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "initial"', { cwd: projectDir });

    // Create commit with trailer for non-existent task
    const message = `Complete task\n\nN-DX-Status: ${nonExistentTaskId} pending → completed`;
    const messageFile = join(projectDir, ".commit-msg");
    await writeFile(messageFile, message, "utf-8");

    // Setup empty PRD
    const doc: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "Test PRD",
      items: [],
    };

    const store = new FolderTreeStore(rexDir);
    await store.saveDocument(doc);

    // Stage a change before the trailer commit — git commit needs something to commit.
    await writeFile(join(projectDir, "src.ts"), "export const x = 2;\n", "utf-8");
    await execAsync("git add .", { cwd: projectDir });
    await execAsync(`git commit -F ${messageFile}`, { cwd: projectDir });

    // Run backfill — should not error
    await expect(cmdBackfillCommitAttribution(projectDir)).resolves.toBeUndefined();

    // PRD should still be empty
    const doc2 = await store.loadDocument();
    expect(doc2.items).toHaveLength(0);
  });

  it("handles commits without N-DX-Status trailers gracefully", async () => {
    const taskId = randomUUID();
    const task: PRDItem = {
      id: taskId,
      title: "Test Task",
      status: "completed",
      level: "task",
    };

    const doc: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "Test PRD",
      items: [task],
    };

    const store = new FolderTreeStore(rexDir);
    await store.saveDocument(doc);

    // Create multiple commits, only one with a trailer
    await writeFile(join(projectDir, "src.ts"), "export const x = 1;\n", "utf-8");
    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "initial"', { cwd: projectDir });

    // Commit without trailer
    await writeFile(join(projectDir, "src.ts"), "export const x = 2;\n", "utf-8");
    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "update"', { cwd: projectDir });

    // Commit with trailer
    const sha = await createCommitWithTrailer(
      projectDir,
      "src.ts",
      "export const x = 3;\n",
      taskId,
      "in_progress",
      "completed",
    );

    // Run backfill
    await cmdBackfillCommitAttribution(projectDir);

    // Only the commit with trailer should be recorded
    const updated = await readPRDItem(rexDir, taskId);
    expect(updated!.commits).toHaveLength(1);
    expect(updated!.commits![0].hash).toBe(sha);
  });
});
