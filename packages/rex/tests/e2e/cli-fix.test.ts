/**
 * E2E tests for the `rex fix` CLI command.
 *
 * Validates that the fix command correctly detects and repairs common PRD
 * issues through the full CLI → core pipeline, including exit codes,
 * output formats, and dry-run behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { serializeDocument } from "../../src/store/markdown-serializer.js";
import { readPRD } from "../helpers/rex-dir-test-support.js";
import type { PRDDocument } from "../../src/schema/index.js";

const cliPath = join(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
  "dist",
  "cli",
  "index.js",
);

function run(args: string[], expectFail = false): string {
  try {
    return execFileSync("node", [cliPath, ...args], {
      encoding: "utf-8",
      timeout: 10000,
    });
  } catch (err: unknown) {
    if (expectFail) {
      const e = err as { stderr?: string; stdout?: string };
      return (e.stderr ?? "") + (e.stdout ?? "");
    }
    throw err;
  }
}

/** Write a PRD with specific items for testing fix scenarios. */
async function writePrd(dir: string, items: unknown[]): Promise<void> {
  const doc = { schema: "rex/v1", title: "Fix Test", items } as PRDDocument;
  await writeFile(join(dir, ".rex", "prd.md"), serializeDocument(doc));
}

describe("rex fix", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-e2e-fix-"));
    run(["init", tmpDir]);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reports no issues on a clean PRD", () => {
    const output = run(["fix", tmpDir]);
    expect(output).toContain("No issues");
  });

  it("fixes missing completedAt on completed items", async () => {
    await writePrd(tmpDir, [
      {
        id: "t-1",
        level: "task",
        title: "Done task",
        status: "completed",
        priority: "medium",
        // missing completedAt
      },
    ]);

    const output = run(["fix", tmpDir]);
    expect(output).toContain("Fixed");

    // Verify the fix was persisted
    const prd = readPRD(tmpDir);
    expect(prd.items[0].completedAt).toBeTruthy();
  });

  it("fixes orphan blockedBy references", async () => {
    await writePrd(tmpDir, [
      {
        id: "t-1",
        level: "task",
        title: "Blocked task",
        status: "blocked",
        priority: "medium",
        blockedBy: ["nonexistent-id"],
      },
    ]);

    const output = run(["fix", tmpDir]);
    expect(output).toContain("Fixed");

    const prd = readPRD(tmpDir);
    // Orphan reference should be removed
    expect(prd.items[0].blockedBy ?? []).not.toContain("nonexistent-id");
  });

  it("dry-run does not mutate the PRD", async () => {
    await writePrd(tmpDir, [
      {
        id: "t-1",
        level: "task",
        title: "Done task",
        status: "completed",
        priority: "medium",
      },
    ]);

    const before = await readFile(join(tmpDir, ".rex", "prd.md"), "utf-8");
    const output = run(["fix", "--dry-run", tmpDir]);
    const after = await readFile(join(tmpDir, ".rex", "prd.md"), "utf-8");

    expect(output).toContain("Would fix");
    expect(before).toEqual(after);
  });

  it("JSON output includes summary with byKind breakdown", async () => {
    await writePrd(tmpDir, [
      {
        id: "t-1",
        level: "task",
        title: "Done task",
        status: "completed",
        priority: "medium",
      },
    ]);

    const output = run(["fix", "--format=json", tmpDir]);
    const parsed = JSON.parse(output);

    expect(parsed.summary).toBeDefined();
    expect(parsed.summary.total).toBeGreaterThan(0);
    expect(parsed.summary.byKind).toBeDefined();
    expect(parsed.dryRun).toBe(false);
  });

  it("JSON dry-run output sets dryRun flag", async () => {
    await writePrd(tmpDir, [
      {
        id: "t-1",
        level: "task",
        title: "Done task",
        status: "completed",
        priority: "medium",
      },
    ]);

    const output = run(["fix", "--format=json", "--dry-run", tmpDir]);
    const parsed = JSON.parse(output);

    expect(parsed.dryRun).toBe(true);
    expect(parsed.summary.mutated).toBe(0);
  });

  it("appears in help output", () => {
    const output = run(["--help"]);
    expect(output).toContain("fix");
  });
});
