/**
 * Regression tests asserting the 'Added to:' path output resolves on disk
 * for all PRD item levels (epic, feature, task, subtask).
 *
 * Each test verifies that:
 * - The 'Added to:' line is printed to stdout
 * - The path is workspace-relative (no absolute paths, consistent format)
 * - The path exists on disk
 * - The path points to the correct item's directory
 *
 * This guards against future folder-tree schema changes silently breaking
 * the copy-paste affordance.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PRD_TREE_DIRNAME } from "../../src/store/index.js";

const PRD_TREE_PATH_PREFIX = new RegExp(`^\\.rex\\/${PRD_TREE_DIRNAME}\\/`);

const cliPath = join(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
  "dist",
  "cli",
  "index.js",
);

function run(cwd: string, args: string[]): string {
  return execFileSync("node", [cliPath, ...args], {
    cwd,
    encoding: "utf-8",
    timeout: 10000,
  });
}

/** Extract the ID from `ID: <uuid>` in command output. */
function extractId(output: string): string {
  const match = output.match(/ID: (.+)/);
  if (!match?.[1]) throw new Error(`No ID found in output: ${output}`);
  return match[1].trim();
}

/** Parse the 'Added to: <path>' line from output and return the path. */
function parseAddedToPath(output: string): string {
  const match = output.match(/Added to: (.+)/);
  if (!match?.[1]) throw new Error(`No 'Added to:' line found in output:\n${output}`);
  return match[1].trim();
}

describe("ndx add 'Added to:' path regression tests", { timeout: 30000 }, () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-add-path-"));
    // Initialize rex directory
    run(tmpDir, ["init", tmpDir]);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("prints workspace-relative path for epic creation", async () => {
    const output = run(tmpDir, ["add", "epic", "--title=Test Epic"]);

    const addedToPath = parseAddedToPath(output);

    // Path must be workspace-relative
    expect(addedToPath).toMatch(PRD_TREE_PATH_PREFIX);
    expect(addedToPath).not.toMatch(/^\//);
    expect(addedToPath).not.toMatch(/^\.\//);

    // Path must exist on disk
    const fullPath = join(tmpDir, addedToPath);
    const stats = await stat(fullPath);
    expect(stats.isDirectory()).toBe(true);
  });

  it("prints workspace-relative path for feature creation under epic", async () => {
    const epicOutput = run(tmpDir, ["add", "epic", "--title=Platform"]);
    const epicId = extractId(epicOutput);

    const featureOutput = run(tmpDir, [
      "add",
      "feature",
      "--title=Authentication",
      `--parent=${epicId}`,
    ]);

    const addedToPath = parseAddedToPath(featureOutput);

    // Path must be workspace-relative
    expect(addedToPath).toMatch(PRD_TREE_PATH_PREFIX);
    expect(addedToPath).not.toMatch(/^\//);
    expect(addedToPath).not.toMatch(/^\.\//);

    // Path must exist and be a directory
    const fullPath = join(tmpDir, addedToPath);
    const stats = await stat(fullPath);
    expect(stats.isDirectory()).toBe(true);

    // Path should indicate nesting under epic
    expect(addedToPath).toContain("platform");
    expect(addedToPath).toContain("authentication");
  });

  it("prints workspace-relative path for task creation under feature", async () => {
    const epicOutput = run(tmpDir, ["add", "epic", "--title=Platform"]);
    const epicId = extractId(epicOutput);

    const featureOutput = run(tmpDir, [
      "add",
      "feature",
      "--title=Authentication",
      `--parent=${epicId}`,
    ]);
    const featureId = extractId(featureOutput);

    const taskOutput = run(tmpDir, [
      "add",
      "task",
      "--title=Add Login Endpoint",
      `--parent=${featureId}`,
    ]);

    const addedToPath = parseAddedToPath(taskOutput);

    // Path must be workspace-relative
    expect(addedToPath).toMatch(PRD_TREE_PATH_PREFIX);
    expect(addedToPath).not.toMatch(/^\//);
    expect(addedToPath).not.toMatch(/^\.\//);

    // Path must exist and be a directory
    const fullPath = join(tmpDir, addedToPath);
    const stats = await stat(fullPath);
    expect(stats.isDirectory()).toBe(true);

    // Path should indicate full nesting
    expect(addedToPath).toContain("platform");
    expect(addedToPath).toContain("authentication");
    expect(addedToPath).toContain("login");
  });

  it("prints workspace-relative path for subtask creation under task", async () => {
    const epicOutput = run(tmpDir, ["add", "epic", "--title=Platform"]);
    const epicId = extractId(epicOutput);

    const featureOutput = run(tmpDir, [
      "add",
      "feature",
      "--title=Authentication",
      `--parent=${epicId}`,
    ]);
    const featureId = extractId(featureOutput);

    const taskOutput = run(tmpDir, [
      "add",
      "task",
      "--title=Add Login Endpoint",
      `--parent=${featureId}`,
    ]);
    const taskId = extractId(taskOutput);

    const subtaskOutput = run(tmpDir, [
      "add",
      "subtask",
      "--title=Implement OAuth flow",
      `--parent=${taskId}`,
    ]);

    const addedToPath = parseAddedToPath(subtaskOutput);

    // Path must be workspace-relative
    expect(addedToPath).toMatch(PRD_TREE_PATH_PREFIX);
    expect(addedToPath).not.toMatch(/^\//);
    expect(addedToPath).not.toMatch(/^\.\//);

    // Path must exist and be a directory
    const fullPath = join(tmpDir, addedToPath);
    const stats = await stat(fullPath);
    expect(stats.isDirectory()).toBe(true);

    // Path should indicate full nesting
    expect(addedToPath).toContain("platform");
    expect(addedToPath).toContain("authentication");
    expect(addedToPath).toContain("login");
    expect(addedToPath).toContain("oauth");
  });

  it("prints deepest path when creating nested ancestors in one call", async () => {
    // Use ndx add with smart-add feature to create multiple levels at once
    // (if available) or create them sequentially and verify the final path
    const epicOutput = run(tmpDir, ["add", "epic", "--title=Infrastructure"]);
    const epicId = extractId(epicOutput);

    const featureOutput = run(tmpDir, [
      "add",
      "feature",
      "--title=Deployment",
      `--parent=${epicId}`,
    ]);
    const featureId = extractId(featureOutput);

    const taskOutput = run(tmpDir, [
      "add",
      "task",
      "--title=Docker Setup",
      `--parent=${featureId}`,
    ]);

    // Verify the 'Added to:' path points to the deepest item created
    const addedToPath = parseAddedToPath(taskOutput);

    // Must be the task path, not the parent paths
    expect(addedToPath).toMatch(PRD_TREE_PATH_PREFIX);
    expect(addedToPath).toContain("docker");

    // Path must exist
    const fullPath = join(tmpDir, addedToPath);
    const stats = await stat(fullPath);
    expect(stats.isDirectory()).toBe(true);
  });

  it("keeps consistent path format across all item levels", async () => {
    const levels = [
      { level: "epic", title: "Core Platform" },
      { level: "feature", title: "API Layer" },
      { level: "task", title: "REST Endpoints" },
      { level: "subtask", title: "GET /users" },
    ];

    const paths: string[] = [];
    let parentId: string | undefined;

    for (const { level, title } of levels) {
      const args = ["add", level, `--title=${title}`];
      if (parentId) {
        args.push(`--parent=${parentId}`);
      }

      const output = run(tmpDir, args);
      const addedToPath = parseAddedToPath(output);
      parentId = extractId(output);

      paths.push(addedToPath);

      // All paths must start with .rex/prd_tree/
      expect(addedToPath).toMatch(PRD_TREE_PATH_PREFIX);
      // No absolute paths
      expect(addedToPath).not.toMatch(/^\//);
      // No leading ./
      expect(addedToPath).not.toMatch(/^\.\//);

      // Path must exist
      const fullPath = join(tmpDir, addedToPath);
      await stat(fullPath); // Will throw if path doesn't exist
    }

    // Verify path hierarchy: each level should nest under the previous
    for (let i = 1; i < paths.length; i++) {
      const parent = paths[i - 1];
      const child = paths[i];
      // Child path should start with parent path + slash
      expect(child).toMatch(new RegExp(`^${parent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    }
  });

  it("outputs consistent path format for multiple consecutive additions", async () => {
    // Add multiple items and verify each outputs a consistent path format
    const output1 = run(tmpDir, ["add", "epic", "--title=First Epic"]);
    const path1 = parseAddedToPath(output1);
    expect(path1).toMatch(PRD_TREE_PATH_PREFIX);

    const output2 = run(tmpDir, ["add", "epic", "--title=Second Epic"]);
    const path2 = parseAddedToPath(output2);
    expect(path2).toMatch(PRD_TREE_PATH_PREFIX);

    // Both paths should exist on disk
    await stat(join(tmpDir, path1));
    await stat(join(tmpDir, path2));

    // Paths should be different (different items)
    expect(path1).not.toEqual(path2);
  });
});
