import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
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

describe("rex --quiet", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-e2e-quiet-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("suppresses init output with --quiet", () => {
    const normal = run(["init", tmpDir]);
    expect(normal).toContain("Initialized .n-dx/rex/");

    // Clean up and re-init with --quiet
    const tmpDir2 = tmpDir + "-q";
    const quiet = run(["init", "--quiet", tmpDir2]);
    expect(quiet).toBe("");

    // Clean up
    execFileSync("rm", ["-rf", tmpDir2]);
  });

  it("suppresses init output with -q shorthand", () => {
    const tmpDir2 = tmpDir + "-q2";
    const quiet = run(["init", "-q", tmpDir2]);
    expect(quiet).toBe("");
    execFileSync("rm", ["-rf", tmpDir2]);
  });

  it("shows minimal status output with --quiet", () => {
    run(["init", tmpDir]);
    const normal = run(["status", tmpDir]);
    expect(normal).toContain("PRD:");

    const quiet = run(["status", "--quiet", tmpDir]);
    // Quiet mode shows a one-line summary for tree format
    expect(quiet.trim()).toMatch(/\d+% complete \(\d+\/\d+\)/);
  });

  it("preserves JSON output in quiet mode", () => {
    run(["init", tmpDir]);
    const quiet = run(["status", "--format=json", "--quiet", tmpDir]);
    const doc = JSON.parse(quiet);
    expect(doc).toHaveProperty("schema");
    expect(doc).toHaveProperty("items");
  });

  it("shows essential result for add in quiet mode", () => {
    run(["init", tmpDir]);
    const output = run([
      "add",
      "epic",
      "--title=Test Epic",
      "--quiet",
      tmpDir,
    ]);
    // Should still show the created item
    expect(output).toContain("Created epic:");
    expect(output).toContain("ID:");
  });

  it("shows validation results in quiet mode", () => {
    run(["init", tmpDir]);
    const output = run(["validate", "--quiet", tmpDir]);
    // Check results are essential — should still appear
    expect(output).toContain("✓");
    expect(output).toContain("All checks passed.");
  });

  it("shows next task output in quiet mode", () => {
    run(["init", tmpDir]);
    const output = run(["next", "--quiet", tmpDir]);
    // No items, should still show the message
    expect(output).toContain("No items in PRD");
  });
});
