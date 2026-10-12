/**
 * Reviewer environment resolution failure — integration tests.
 *
 * `loadVendorCliEnv` is async and can reject on a config or LLM-config load
 * error. Every reviewer failure must still reach `runCrossVendorReview` as
 * `spawnError`, because that is the signal it falls back to the shell test
 * command on. Nothing in the real config loaders rejects on a malformed file
 * today, so the failure is injected by mocking `config.js`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("../../packages/core/config.js", async (importOriginal) => ({
  ...(await importOriginal()),
  loadVendorCliEnv: vi.fn(async () => {
    throw new Error("llm config unreadable");
  }),
}));

const { runReviewerLlm, runReviewerLlmCapturing, runCrossVendorReview } = await import(
  "../../packages/core/pair-programming.js"
);

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ndx-pair-env-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Executable reviewer stub that exits 0 (and answers `--version`). */
function writeMockReviewer(dir) {
  const jsPath = join(dir, "mock-reviewer.js");
  writeFileSync(
    jsPath,
    "#!/usr/bin/env node\nif (process.argv[2] === '--version') { console.log('mock 1.0.0'); process.exit(0); }\nprocess.exit(0);\n",
    "utf-8",
  );
  if (process.platform === "win32") {
    const cmdPath = join(dir, "mock-reviewer.cmd");
    writeFileSync(cmdPath, `@"${process.execPath}" "${jsPath}" %*\r\n`, "utf-8");
    return cmdPath;
  }
  chmodSync(jsPath, 0o755);
  return jsPath;
}

describe("reviewer environment cannot be resolved", () => {
  it.each([
    [runReviewerLlm, {}],
    [runReviewerLlmCapturing, { output: "" }],
  ])("%s resolves with spawnError instead of rejecting", async (run, extra) => {
    const result = await run({ cliPath: writeMockReviewer(tmpDir), prompt: "review", dir: tmpDir, reviewer: "claude" });
    expect(result).toEqual({
      exitCode: 1,
      timedOut: false,
      spawnError: "could not resolve the reviewer environment: llm config unreadable",
      ...extra,
    });
  });

  it("runCrossVendorReview then runs the configured test command", async () => {
    writeFileSync(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ llm: { claude: { cli_path: writeMockReviewer(tmpDir) } } }),
      "utf-8",
    );
    const testCommand = `${process.execPath} -e "process.exit(0)"`;

    const result = await runCrossVendorReview({ dir: tmpDir, reviewer: "claude", testCommand });

    expect(result).toMatchObject({ mode: "shell-test-only", skipped: false, passed: true, command: testCommand });
  });

  it("without a test command the review is skipped, naming the cause", async () => {
    writeFileSync(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ llm: { claude: { cli_path: writeMockReviewer(tmpDir) } } }),
      "utf-8",
    );

    const result = await runCrossVendorReview({ dir: tmpDir, reviewer: "claude" });

    expect(result.mode).toBe("skipped");
    expect(result.reason).toContain("llm config unreadable");
  });
});
