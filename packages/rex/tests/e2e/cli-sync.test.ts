/**
 * E2E tests for the `rex sync` CLI command.
 */

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

describe("rex sync", { timeout: 120_000 }, () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-e2e-sync-"));
    // Initialize .rex/ directory
    run(["init", tmpDir]);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("shows helpful error when no adapter is configured", () => {
    const output = run(["sync", tmpDir], true);
    expect(output).toContain("not configured");
    expect(output).toContain("rex adapter add");
  });

  it("shows helpful error for specific adapter name", () => {
    const output = run(["sync", "--adapter=notion", tmpDir], true);
    expect(output).toContain("notion");
    expect(output).toContain("not configured");
  });

  it("appears in help output", () => {
    const output = run(["--help"]);
    expect(output).toContain("sync");
  });
});
